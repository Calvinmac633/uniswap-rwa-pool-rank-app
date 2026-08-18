// Two-tier data pipeline, per the performance strategy: discovery (which pools
// exist — expensive, rate-limited by GeckoTerminal's per-dex pool listing calls)
// is cached long and rarely re-run; the fast refresh only re-fetches current
// metrics for pools we already know about via /pools/multi/ (30 per call) plus
// multicalled tick state (viem RPC, unrelated to GeckoTerminal's rate limit) —
// both fast enough to run on every page load / manual refresh.
import { decodeHookPermissions, type HookBadge } from "../chain/hooks";
import { discoverUniswapPools, type DiscoveredPool } from "../gecko/discovery";
import { fetchPoolMetrics } from "../gecko/multi";
import { classifyTokens, type ClassifiedToken } from "../rwa/classify";
import { resolveV4PoolKeys } from "./v4Index";
import { getTickStates } from "./tickState";
import type { DiscoveryMeta, FastMetrics, PoolIdentity, PoolRow, RwaTokenInfo, CounterTokenInfo } from "../types";

type QualifyingPool = { pool: DiscoveredPool; rwa: ClassifiedToken; counter: ClassifiedToken; baseIsRwa: boolean };

type DiscoveryCache = {
  qualifying: QualifyingPool[];
  meta: Pick<DiscoveryMeta, "rwaTokenCount" | "registryError" | "classificationWarnings" | "dexPagesHitSafetyCap">;
  discoveredAt: number;
};

const DISCOVERY_TTL_MS = 30 * 60 * 1000; // pools are created rarely
const METRICS_TTL_MS = 90 * 1000; // fast tier: safe to redo often, but avoid refetching on every slider tweak

let discoveryCache: DiscoveryCache | null = null;
let metricsCache: { rows: PoolRow[]; meta: DiscoveryMeta; fetchedAt: number } | null = null;

// De-dupes concurrent callers onto a single in-flight request instead of each
// starting their own — without this, two overlapping requests (e.g. React
// StrictMode's double-invoked effect in dev, or a double-clicked refresh
// button) each fire their own full discovery/metrics pass and compete for the
// same GeckoTerminal rate-limit budget, which compounds badly (observed
// directly while testing this: a handful of overlapping requests turned a
// normally-instant cached response into multiple 30-90s stalls).
let inFlightDiscovery: Promise<DiscoveryCache> | null = null;
let inFlightMetrics: Promise<FastRefreshResult> | null = null;

function toRwaTokenInfo(token: ClassifiedToken): RwaTokenInfo {
  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    isin: token.isin,
    logoUrl: token.logoUrl,
    warning: token.warning,
  };
}

function toCounterTokenInfo(token: ClassifiedToken): CounterTokenInfo {
  return { address: token.address, symbol: token.symbol, decimals: token.decimals };
}

/**
 * Picks which side of the pool is "the RWA asset" vs "the counter-asset", and
 * records whether that was GeckoTerminal's "base" or "quote" side — needed to
 * correctly map base_token_price_usd/quote_token_price_usd onto rwa/counter
 * later, since GeckoTerminal's base/quote is a display convention independent
 * of the pool's actual on-chain token0/token1 order.
 */
function resolveSides(
  pool: DiscoveredPool,
  tokens: Map<string, ClassifiedToken>
): { rwa: ClassifiedToken; counter: ClassifiedToken; baseIsRwa: boolean } | null {
  const base = tokens.get(pool.baseTokenAddress);
  const quote = tokens.get(pool.quoteTokenAddress);
  if (!base || !quote) return null;

  if (base.isRwa) return { rwa: base, counter: quote, baseIsRwa: true };
  // Covers both "only quote is RWA" and the rare stock/stock case, which falls
  // through to base-as-asset above instead (an arbitrary but consistent pick).
  if (quote.isRwa) return { rwa: quote, counter: base, baseIsRwa: false };
  return null;
}

async function runDiscovery(): Promise<DiscoveryCache> {
  const discovery = await discoverUniswapPools();
  const classification = await classifyTokens(discovery.candidateTokens);

  const qualifying: QualifyingPool[] = [];
  for (const pool of discovery.pools) {
    const sides = resolveSides(pool, classification.tokens);
    if (sides) qualifying.push({ pool, ...sides });
  }

  const classificationWarnings = [...classification.tokens.values()]
    .map((t) => t.warning)
    .filter((w): w is string => Boolean(w));

  return {
    qualifying,
    meta: {
      rwaTokenCount: [...classification.tokens.values()].filter((t) => t.isRwa).length,
      registryError: classification.registryError,
      classificationWarnings,
      dexPagesHitSafetyCap: discovery.hitSafetyCap,
    },
    discoveredAt: Date.now(),
  };
}

/** Which pools exist + their RWA/counter classification. Cached ~30min; pass force to rescan now. */
export async function getDiscoveredPools(forceRefresh = false): Promise<DiscoveryCache> {
  if (!forceRefresh && discoveryCache && Date.now() - discoveryCache.discoveredAt < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  if (inFlightDiscovery) return inFlightDiscovery;

  inFlightDiscovery = (async () => {
    try {
      discoveryCache = await runDiscovery();
      metricsCache = null; // pool set may have changed; don't serve stale rows for pools that no longer qualify
      return discoveryCache;
    } finally {
      inFlightDiscovery = null;
    }
  })();
  return inFlightDiscovery;
}

export type FastRefreshResult = { rows: PoolRow[]; meta: DiscoveryMeta };

/** Current TVL/volume/tick-state for already-discovered pools. Cached briefly. */
export async function getFastPoolData(options: { forceRefresh?: boolean; forceRescan?: boolean } = {}): Promise<FastRefreshResult> {
  const discovery = await getDiscoveredPools(options.forceRescan ?? false);

  if (!options.forceRefresh && !options.forceRescan && metricsCache && Date.now() - metricsCache.fetchedAt < METRICS_TTL_MS) {
    return { rows: metricsCache.rows, meta: metricsCache.meta };
  }
  if (inFlightMetrics) return inFlightMetrics;

  inFlightMetrics = (async () => {
    try {
      const result = await refreshMetrics(discovery);
      metricsCache = { ...result, fetchedAt: Date.now() };
      return result;
    } finally {
      inFlightMetrics = null;
    }
  })();
  return inFlightMetrics;
}

async function refreshMetrics(discovery: DiscoveryCache): Promise<FastRefreshResult> {
  const { qualifying } = discovery;

  const v4PoolIds = qualifying.filter((q) => q.pool.version === "v4").map((q) => q.pool.address);
  const [metricsResult, v4Index] = await Promise.all([
    fetchPoolMetrics(qualifying.map((q) => q.pool.address)),
    resolveV4PoolKeys(v4PoolIds),
  ]);

  const tickStates = await getTickStates(
    qualifying.map((q) => q.pool),
    v4Index
  );

  const rows: PoolRow[] = qualifying.map(({ pool, rwa, counter, baseIsRwa }) => {
    const rwaIsToken0 = BigInt(rwa.address) < BigInt(counter.address);
    const tickState = tickStates.get(pool.address) ?? { kind: "unavailable" as const, reason: "not read" };
    const liveMetrics = metricsResult.metrics.get(pool.address);

    // Map GeckoTerminal's base/quote prices onto rwa/counter using the same
    // side the token itself came from (recorded in resolveSides).
    const rwaTokenPriceUsd = liveMetrics
      ? (baseIsRwa ? liveMetrics.basePriceUsd : liveMetrics.quotePriceUsd)
      : (baseIsRwa ? pool.basePriceUsd : pool.quotePriceUsd);
    const counterTokenPriceUsd = liveMetrics
      ? (baseIsRwa ? liveMetrics.quotePriceUsd : liveMetrics.basePriceUsd)
      : (baseIsRwa ? pool.quotePriceUsd : pool.basePriceUsd);

    const identity: PoolIdentity = {
      address: pool.address,
      version: pool.version,
      dexSlug: pool.dexSlug,
      rwaToken: toRwaTokenInfo(rwa),
      counterToken: toCounterTokenInfo(counter),
      rwaIsToken0,
      poolCreatedAt: pool.poolCreatedAt,
    };

    const hookBadges: HookBadge[] =
      tickState.kind === "concentrated" && tickState.hookAddress
        ? decodeHookPermissions(tickState.hookAddress).badges
        : tickState.kind === "concentrated"
          ? ["none"]
          : [];

    // Prefer the just-fetched live metrics; fall back to the discovery-time
    // snapshot if this pool's batch call failed, rather than showing nothing.
    const fast: FastMetrics = {
      reserveInUsdTotal: liveMetrics?.reserveInUsd ?? pool.reserveInUsd,
      volume24hUsd: liveMetrics?.volume24hUsd ?? pool.volume24hUsd,
      rwaTokenPriceUsd,
      counterTokenPriceUsd,
      lastUpdated: new Date().toISOString(),
    };

    const warnings = [rwa.warning, counter.warning].filter((w): w is string => Boolean(w));
    if (tickState.kind === "unavailable") warnings.push(tickState.reason);
    if (identity.version === "v4" && tickState.kind === "concentrated" && tickState.tickSpacing === null) {
      warnings.push("tickSpacing unknown — v4 Initialize event not found in index yet, range math unavailable.");
    }
    if (!liveMetrics) warnings.push("Live TVL/volume refresh failed for this pool; showing last known values.");

    return { identity, tickState, hookBadges, fast, slow: null, warnings };
  });

  const meta: DiscoveryMeta = {
    discoveredAt: new Date(discovery.discoveredAt).toISOString(),
    poolCount: rows.length,
    fetchErrors: metricsResult.errors,
    ...discovery.meta,
  };

  return { rows, meta };
}
