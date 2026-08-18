// Step 6d: realized volatility from hourly candles, expressed as an expected
// 24h 1-sigma price move — "±X% to stay in range ~24h". Reuses the same
// hourly candles already fetched for the window-APR math (see apr.ts); no
// extra request.
import type { Candle } from "../gecko/ohlcv";

const MIN_CANDLES_FOR_VOLATILITY = 8; // below this, a stdev estimate is too noisy to show

/**
 * Realized volatility, scaled from hourly to a 24h 1-sigma move, as a
 * fraction (0.05 = 5%). Returns null when there isn't enough candle history
 * yet — never a fabricated number.
 */
export function realizedVol24h1Sigma(hourlyCandles: Candle[]): number | null {
  if (hourlyCandles.length < MIN_CANDLES_FOR_VOLATILITY) return null;

  const closes = hourlyCandles.map((c) => c.c).filter((c) => c > 0);
  if (closes.length < MIN_CANDLES_FOR_VOLATILITY) return null;

  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i]! / closes[i - 1]!));
  }

  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
  const hourlyStdDev = Math.sqrt(variance);

  // Standard sqrt-time scaling from hourly to 24h, assuming roughly i.i.d.
  // returns hour to hour (a simplification — real crypto/equity markets have
  // volatility clustering — but the right order of magnitude for "how tight
  // can I realistically set my range").
  return hourlyStdDev * Math.sqrt(24);
}
