// Pool discovery: scans every pool on the three Uniswap DEX slugs on this chain
// (not the ~30 other DEXes GeckoTerminal also tracks here — pancakeswap forks,
// curve, ramses, etc. are out of scope per "every Uniswap liquidity pool").
//
// We scan *all* pools rather than going through /tokens/{address}/pools per RWA
// token, for two reasons:
//  1. The per-token endpoint caps at its own top-20-by-liquidity/volume — it can
//     silently miss a real but smaller pool.
//  2. Scanning once here also gives us the classifier's full candidate token set
//     "for free" (Step 1's cross-check needs every token that appears in any
//     Uniswap pool, not just the ones already in Robinhood's registry).
//
// This is the "discovery" tier: cached aggressively and re-run on demand, not
// on every page load — see aggregate.ts.
import { GECKO_DEX_SLUGS, GECKO_NETWORK } from "../chain/addresses";
import { geckoGet } from "./client";
import { stripNetworkPrefix, type GeckoPoolEntry } from "./types";
import type { UniswapVersion } from "../types";

const PAGE_SIZE_ASSUMPTION = 20; // GeckoTerminal's documented/observed page size

// Confirmed empirically (2026-08-18): the free tier hard-caps list endpoints at
// page 10 and returns HTTP 401 with "exceeds the allowed max number for page
// (10). Upgrade to Analyst plan..." beyond that — not a rate limit, a plan
// limit. So this is the *real* ceiling (200 pools/dex, 600 total across
// v2/v3/v4), not a guessed safety margin.
const MAX_PAGES_PER_DEX = 10;

export type DiscoveredPool = {
  address: string; // lowercased; v4 = poolId, v2/v3 = pool contract address
  version: UniswapVersion;
  dexSlug: string;
  name: string;
  baseTokenAddress: string; // lowercased
  quoteTokenAddress: string; // lowercased
  basePriceUsd: number | null;
  quotePriceUsd: number | null;
  reserveInUsd: number | null;
  volume24hUsd: number | null;
  poolCreatedAt: string | null;
};

export type DiscoveryScanResult = {
  pools: DiscoveredPool[];
  candidateTokens: Set<string>;
  errors: string[];
  hitSafetyCap: string[]; // dex slugs where we stopped at MAX_PAGES_PER_DEX, not an empty page
};

function parsePool(entry: GeckoPoolEntry, version: UniswapVersion, dexSlug: string): DiscoveredPool {
  const a = entry.attributes;
  return {
    address: a.address.toLowerCase(),
    version,
    dexSlug,
    name: a.name,
    baseTokenAddress: stripNetworkPrefix(entry.relationships.base_token.data.id).toLowerCase(),
    quoteTokenAddress: stripNetworkPrefix(entry.relationships.quote_token.data.id).toLowerCase(),
    basePriceUsd: a.base_token_price_usd !== null ? Number(a.base_token_price_usd) : null,
    quotePriceUsd: a.quote_token_price_usd !== null ? Number(a.quote_token_price_usd) : null,
    reserveInUsd: a.reserve_in_usd !== null ? Number(a.reserve_in_usd) : null,
    volume24hUsd: a.volume_usd?.h24 !== undefined ? Number(a.volume_usd.h24) : null,
    poolCreatedAt: a.pool_created_at,
  };
}

// Discovery is the deliberately-slow, cached-aggressively tier (see aggregate.ts),
// so it can afford to retry a rate-limited page rather than giving up on the
// rest of a dex immediately — but not so patient that a handful of slow pages
// balloon total wall time past several minutes (observed directly: sequential
// dex scanning + a 10s/3-retry cooldown here pushed a cold discovery past
// 5 minutes on a bad run). Combined with scanning dexes concurrently (below)
// and geckoGet's own internal 429 backoff, 2 retries at 5s is still resilient
// to real transient rate-limiting without compounding into minutes of wait.
const PAGE_RETRY_COOLDOWN_MS = 5_000;
const PAGE_RETRIES = 2;

async function scanDex(version: UniswapVersion, dexSlug: string, errors: string[]): Promise<{ pools: DiscoveredPool[]; hitCap: boolean }> {
  const pools: DiscoveredPool[] = [];

  for (let page = 1; page <= MAX_PAGES_PER_DEX; page++) {
    let result: Awaited<ReturnType<typeof geckoGet<{ data: GeckoPoolEntry[] }>>> | null = null;
    for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
      result = await geckoGet<{ data: GeckoPoolEntry[] }>(`/networks/${GECKO_NETWORK}/dexes/${dexSlug}/pools`, { page });
      if (result.ok) break;
      // A 401 here means "this page number exceeds the free plan's limit" —
      // a fixed ceiling, not a transient failure, so retrying it is pure waste.
      if (result.status === 401) break;
      if (attempt < PAGE_RETRIES) await new Promise((r) => setTimeout(r, PAGE_RETRY_COOLDOWN_MS));
    }

    if (!result!.ok) {
      if (result!.status !== 401) {
        errors.push(`${dexSlug} page ${page}: ${result!.error} (gave up after ${PAGE_RETRIES + 1} attempts)`);
      }
      break; // stop this dex on error rather than guessing whether later pages exist
    }

    const entries = result!.data.data;
    for (const entry of entries) {
      pools.push(parsePool(entry, version, dexSlug));
    }

    if (entries.length < PAGE_SIZE_ASSUMPTION) {
      return { pools, hitCap: false }; // short page == last page
    }
    if (page === MAX_PAGES_PER_DEX) {
      return { pools, hitCap: true };
    }
  }

  return { pools, hitCap: false };
}

export async function discoverUniswapPools(): Promise<DiscoveryScanResult> {
  const errors: string[] = [];
  const hitSafetyCap: string[] = [];
  const allPools: DiscoveredPool[] = [];

  // Scan all three dexes concurrently rather than one after another. They all
  // draw from the same shared rate limiter (geckoGet's throttle) either way,
  // so this doesn't increase total API throughput — but it stops one dex's
  // retry cooldown from stalling the other two, which measurably matters:
  // observed wall time for a full scan varied from ~2min to 5+min run to run
  // when sequential, entirely driven by how many pages on any one dex needed
  // a retry.
  const versions = Object.entries(GECKO_DEX_SLUGS) as [UniswapVersion, string][];
  const results = await Promise.all(versions.map(([version, dexSlug]) => scanDex(version, dexSlug, errors)));
  results.forEach(({ pools, hitCap }, i) => {
    allPools.push(...pools);
    if (hitCap) hitSafetyCap.push(versions[i]![1]);
  });

  const candidateTokens = new Set<string>();
  for (const pool of allPools) {
    candidateTokens.add(pool.baseTokenAddress);
    candidateTokens.add(pool.quoteTokenAddress);
  }

  return { pools: allPools, candidateTokens, errors, hitSafetyCap };
}
