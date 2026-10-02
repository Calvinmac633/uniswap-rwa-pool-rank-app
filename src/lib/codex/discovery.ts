// Pool discovery via Codex: one filtered, paginated query for every Uniswap
// pool that involves a known RWA token and clears a liquidity floor. Replaces
// GeckoTerminal's per-DEX listing (throttled, and hard-capped at 200 pools/DEX
// — it was silently missing pools), and returns TVL/volume in the same pass.
//
// The liquidity floor is not optional: ~39k pools touch a registry token on
// this chain, nearly all dead spam. At $10k it's a handful of calls.
import { GECKO_DEX_SLUGS, POOL_MANAGER, ROBINHOOD_CHAIN_ID, UNISWAP_V2_FACTORY, UNISWAP_V3_FACTORY, USDG, WETH } from "../chain/addresses";
import type { DiscoveredPool, DiscoveryScanResult } from "../gecko/discovery";
import type { UniswapVersion } from "../types";
import { codexQuery } from "./client";

const PAGE_SIZE = 200; // Codex's max per request
const MAX_PAGES = 50; // safety stop, far above what a sane liquidity floor needs
const PRICE_BATCH_SIZE = 25; // getTokenPrices silently truncates beyond 25 inputs

export const DEFAULT_MIN_LIQUIDITY_USD = 10_000;
// Only pools trading right now: no swaps in the last hour means no fees being earned.
export const DEFAULT_MIN_VOLUME_1H_USD = 1;

// Codex reports the factory (v2/v3) or PoolManager (v4) as `exchange.address`.
const VERSION_BY_EXCHANGE: Record<string, UniswapVersion> = {
  [UNISWAP_V2_FACTORY.toLowerCase()]: "v2",
  [UNISWAP_V3_FACTORY.toLowerCase()]: "v3",
  [POOL_MANAGER.toLowerCase()]: "v4",
};

type FilterPairsResult = {
  pair: { address: string; token0: string; token1: string; createdAt: number | null };
  exchange: { address: string };
  liquidity: string | null;
  volumeUSD24: string | null;
};

const FILTER_PAIRS_QUERY = `
  query Discover($tokens: [String], $exchanges: [String], $minLiquidity: Float, $minVolume1h: Float, $offset: Int) {
    filterPairs(
      filters: { network: [${ROBINHOOD_CHAIN_ID}], exchangeAddress: $exchanges, tokenAddress: $tokens, liquidity: { gte: $minLiquidity }, volumeUSD1: { gte: $minVolume1h } }
      limit: ${PAGE_SIZE}
      offset: $offset
    ) {
      results {
        pair { address token0 token1 createdAt }
        exchange { address }
        liquidity
        volumeUSD24
      }
    }
  }
`;

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchTokenPrices(addresses: string[], errors: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  for (let i = 0; i < addresses.length; i += PRICE_BATCH_SIZE) {
    const batch = addresses.slice(i, i + PRICE_BATCH_SIZE);
    const result = await codexQuery<{ getTokenPrices: Array<{ address: string; priceUsd: number | null } | null> }>(
      `query Prices($inputs: [GetPriceInput]) { getTokenPrices(inputs: $inputs) { address priceUsd } }`,
      { inputs: batch.map((address) => ({ address, networkId: ROBINHOOD_CHAIN_ID })) }
    );
    if (!result.ok) {
      errors.push(`Codex token prices: ${result.error}`);
      continue;
    }
    for (const p of result.data.getTokenPrices) {
      if (p?.priceUsd != null) prices.set(p.address.toLowerCase(), p.priceUsd);
    }
  }
  return prices;
}

/**
 * Every Uniswap v2/v3/v4 pool on Robinhood Chain involving any of `rwaTokenAddresses`
 * with at least `minLiquidityUsd` of liquidity and `minVolume1hUsd` traded in the
 * last hour. Base/quote are token0/token1.
 */
export async function discoverUniswapPoolsViaCodex(
  rwaTokenAddresses: string[],
  minLiquidityUsd: number = DEFAULT_MIN_LIQUIDITY_USD,
  minVolume1hUsd: number = DEFAULT_MIN_VOLUME_1H_USD
): Promise<DiscoveryScanResult> {
  const errors: string[] = [];
  const hitSafetyCap: string[] = [];
  const tokens = rwaTokenAddresses.map((a) => a.toLowerCase());
  if (tokens.length === 0) return { pools: [], candidateTokens: new Set(), errors: ["No RWA token addresses to search for."], hitSafetyCap };

  const results: FilterPairsResult[] = [];
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) {
      hitSafetyCap.push("codex");
      break;
    }
    const result = await codexQuery<{ filterPairs: { results: FilterPairsResult[] } }>(FILTER_PAIRS_QUERY, {
      tokens,
      exchanges: Object.keys(VERSION_BY_EXCHANGE),
      minLiquidity: minLiquidityUsd,
      minVolume1h: minVolume1hUsd,
      offset: page * PAGE_SIZE,
    });
    if (!result.ok) {
      errors.push(`Codex pool discovery page ${page + 1}: ${result.error}`);
      break;
    }
    results.push(...result.data.filterPairs.results);
    if (result.data.filterPairs.results.length < PAGE_SIZE) break;
  }

  // Only tokens that can end up on a qualifying row need a price: RWA tokens
  // plus the allowed counter-assets (see resolveSides in pools/aggregate.ts).
  const prices = await fetchTokenPrices([...new Set([...tokens, USDG.toLowerCase(), WETH.toLowerCase()])], errors);

  const pools: DiscoveredPool[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const version = VERSION_BY_EXCHANGE[r.exchange.address.toLowerCase()];
    const address = r.pair.address.toLowerCase();
    if (!version || seen.has(address)) continue;
    seen.add(address);
    const token0 = r.pair.token0.toLowerCase();
    const token1 = r.pair.token1.toLowerCase();
    pools.push({
      address,
      version,
      dexSlug: GECKO_DEX_SLUGS[version],
      name: "",
      baseTokenAddress: token0,
      quoteTokenAddress: token1,
      basePriceUsd: prices.get(token0) ?? null,
      quotePriceUsd: prices.get(token1) ?? null,
      reserveInUsd: toNumber(r.liquidity),
      volume24hUsd: toNumber(r.volumeUSD24),
      poolCreatedAt: r.pair.createdAt ? new Date(r.pair.createdAt * 1000).toISOString() : null,
    });
  }

  const candidateTokens = new Set<string>();
  for (const p of pools) {
    candidateTokens.add(p.baseTokenAddress);
    candidateTokens.add(p.quoteTokenAddress);
  }

  return { pools, candidateTokens, errors, hitSafetyCap };
}
