// Slow tier: OHLCV candles. No batch endpoint exists for this (confirmed — every
// other GeckoTerminal endpoint this app uses supports batching or full-listing,
// this one genuinely doesn't), so it's one call per pool, rate-limited. Fetched
// once per pool (a week of hourly + ~30 daily candles) and cached for hours;
// every window/momentum/volatility number is then sliced out of that locally
// instead of making a request per window.
import { GECKO_NETWORK } from "../chain/addresses";
import { geckoGet } from "./client";
import type { GeckoOhlcvResponse } from "./types";

// [unix_timestamp_seconds, open, high, low, close, volume]
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type PoolCandles = {
  hourly: Candle[]; // up to 168 (1 week), fewer if the pool/chain is younger than that
  daily: Candle[]; // up to 30
  fetchedAt: number;
};

const HOURLY_LIMIT = 168; // 1 week
const DAILY_LIMIT = 30;

function toCandles(resp: GeckoOhlcvResponse): Candle[] {
  return resp.data.attributes.ohlcv_list
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t); // GeckoTerminal returns newest-first; we want chronological
}

export type CandleFetchResult = { pools: Map<string, PoolCandles>; errors: string[] };

/**
 * Fetches candles for each pool address sequentially (this endpoint has no
 * batch form, and the client's own rate limiter serializes these anyway — this
 * function just makes that serialization explicit and reports per-pool errors
 * instead of failing the whole batch on one bad pool).
 */
export async function fetchCandlesForPools(poolAddresses: string[]): Promise<CandleFetchResult> {
  const pools = new Map<string, PoolCandles>();
  const errors: string[] = [];

  for (const address of poolAddresses) {
    const [hourlyResult, dailyResult] = await Promise.all([
      geckoGet<GeckoOhlcvResponse>(`/networks/${GECKO_NETWORK}/pools/${address}/ohlcv/hour`, { limit: HOURLY_LIMIT }),
      geckoGet<GeckoOhlcvResponse>(`/networks/${GECKO_NETWORK}/pools/${address}/ohlcv/day`, { limit: DAILY_LIMIT }),
    ]);

    if (!hourlyResult.ok || !dailyResult.ok) {
      errors.push(
        `${address}: ${!hourlyResult.ok ? `hourly candles - ${hourlyResult.error}` : ""}${!hourlyResult.ok && !dailyResult.ok ? "; " : ""}${!dailyResult.ok ? `daily candles - ${dailyResult.error}` : ""}`
      );
      continue;
    }

    pools.set(address, {
      hourly: toCandles(hourlyResult.data),
      daily: toCandles(dailyResult.data),
      fetchedAt: Date.now(),
    });
  }

  return { pools, errors };
}
