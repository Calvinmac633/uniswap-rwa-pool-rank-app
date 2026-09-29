// Slow tier: per-pool candle history from Codex getBars — one call per pool
// (~0.3s) for 30 days of hourly bars, with daily candles rolled up locally.
// Replaces GeckoTerminal's two throttled OHLCV calls per pool.
import { ROBINHOOD_CHAIN_ID } from "../chain/addresses";
import { codexQuery } from "./client";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type PoolCandles = {
  hourly: Candle[]; // up to 168 (1 week), fewer if the pool is younger than that
  daily: Candle[]; // up to 30 complete 24h buckets
  fetchedAt: number;
};

const HOURS_FETCHED = 720; // 30 days — within getBars' 1500-bar cap
const HOURLY_KEPT = 168; // the hourly-window + volatility math was built around a week

type Bars = { t: number[] | null; c: Array<number | null> | null; volume: Array<string | null> | null };

// removeLeadingNullValues trims bars from before the pool existed, so bar count
// == real history length (short history must render "n/a", never 0). Empty
// hours after that come back as zero-volume bars, keeping the series contiguous.
const BARS_QUERY = `
  query Bars($symbol: String!, $from: Int!, $to: Int!) {
    getBars(symbol: $symbol, from: $from, to: $to, resolution: "60", countback: ${HOURS_FETCHED}, removeEmptyBars: false, removeLeadingNullValues: true) {
      t c volume
    }
  }
`;

function toHourlyCandles(bars: Bars): Candle[] {
  const t = bars.t ?? [];
  const candles: Candle[] = [];
  let lastClose = 0;
  for (let i = 0; i < t.length; i++) {
    // An empty hour means the price didn't move — carry the last close forward.
    const close = bars.c?.[i] ?? lastClose;
    lastClose = close;
    candles.push({ t: t[i]!, o: close, h: close, l: close, c: close, v: Number(bars.volume?.[i] ?? 0) || 0 });
  }
  return candles;
}

/** Complete trailing 24h buckets, oldest first. A partial oldest day is dropped. */
function rollUpDaily(hourly: Candle[]): Candle[] {
  const daily: Candle[] = [];
  for (let end = hourly.length; end - 24 >= 0; end -= 24) {
    const day = hourly.slice(end - 24, end);
    daily.unshift({
      t: day[0]!.t,
      o: day[0]!.c,
      h: Math.max(...day.map((c) => c.c)),
      l: Math.min(...day.map((c) => c.c)),
      c: day[day.length - 1]!.c,
      v: day.reduce((sum, c) => sum + c.v, 0),
    });
  }
  return daily;
}

export type CandleFetchResult = { pools: Map<string, PoolCandles>; errors: string[] };

export async function fetchCandlesForPools(poolAddresses: string[]): Promise<CandleFetchResult> {
  const pools = new Map<string, PoolCandles>();
  const errors: string[] = [];
  const to = Math.floor(Date.now() / 1000);
  const from = to - (HOURS_FETCHED + 24) * 3600;

  // codexQuery's own throttle paces these under the free-tier rate limit.
  await Promise.all(
    poolAddresses.map(async (address) => {
      const result = await codexQuery<{ getBars: Bars | null }>(BARS_QUERY, {
        symbol: `${address}:${ROBINHOOD_CHAIN_ID}`,
        from,
        to,
      });
      if (!result.ok) {
        errors.push(`${address}: ${result.error}`);
        return;
      }
      const all = result.data.getBars ? toHourlyCandles(result.data.getBars) : [];
      pools.set(address, { hourly: all.slice(-HOURLY_KEPT), daily: rollUpDaily(all), fetchedAt: Date.now() });
    })
  );

  return { pools, errors };
}
