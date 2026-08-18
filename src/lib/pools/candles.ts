// Slow tier orchestration: fetches OHLCV candles for known pools (one call per
// pool, rate-limited — no batch endpoint exists) and derives window volumes +
// realized volatility from them. Cached per-pool for hours, since "these
// barely move hour to hour" — refetching on every page load would both be slow
// and pointless.
import { fetchCandlesForPools } from "../gecko/ohlcv";
import { computeWindowVolumes } from "../math/apr";
import { realizedVol24h1Sigma } from "../math/volatility";
import type { SlowMetrics } from "../types";

const SLOW_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type CacheEntry = { metrics: SlowMetrics; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

export type SlowRefreshResult = { metrics: Map<string, SlowMetrics>; errors: string[]; poolsFetched: number };

/**
 * Returns slow-tier metrics for the given pool addresses, fetching only the
 * ones that are missing or stale. Pass forceRefresh to ignore the cache
 * entirely (the UI's explicit "refresh trend data" action, distinct from the
 * fast tier's plain refresh).
 */
export async function getSlowPoolData(poolAddresses: string[], forceRefresh = false): Promise<SlowRefreshResult> {
  const now = Date.now();
  const stale = forceRefresh
    ? poolAddresses
    : poolAddresses.filter((addr) => {
        const entry = cache.get(addr);
        return !entry || now - entry.fetchedAt > SLOW_TTL_MS;
      });

  const errors: string[] = [];
  if (stale.length > 0) {
    const { pools, errors: fetchErrors } = await fetchCandlesForPools(stale);
    errors.push(...fetchErrors);

    for (const [address, candles] of pools) {
      const windowVolumeUsd = computeWindowVolumes(candles.hourly, candles.daily);
      const metrics: SlowMetrics = {
        windowVolumeUsd,
        hourlyCandleCount: candles.hourly.length,
        dailyCandleCount: candles.daily.length,
        realizedVol24h1Sigma: realizedVol24h1Sigma(candles.hourly),
        candlesFetchedAt: new Date().toISOString(),
      };
      cache.set(address, { metrics, fetchedAt: now });
    }
  }

  const metrics = new Map<string, SlowMetrics>();
  for (const addr of poolAddresses) {
    const entry = cache.get(addr);
    if (entry) metrics.set(addr, entry.metrics);
  }

  return { metrics, errors, poolsFetched: stale.length };
}
