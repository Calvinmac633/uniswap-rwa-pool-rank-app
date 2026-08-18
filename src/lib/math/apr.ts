// Step 6b/6c: window volumes sliced locally from the once-fetched candle sets,
// per-window APR, and the momentum ratio. Pure functions — no fetching here —
// so this is safe to run both server-side and client-side (the UI recomputes
// APR instantly when the user tweaks deposit size / range width, without a
// server round trip, since only the liquidity share depends on those inputs).
import type { Candle } from "../gecko/ohlcv";
import { WINDOW_HOURS, WINDOW_KEYS, type WindowApr, type WindowKey } from "../types";

const HOURLY_WINDOWS: WindowKey[] = ["1h", "2h", "4h", "6h", "8h", "12h", "24h"];
const DAILY_WINDOWS: WindowKey[] = ["3d", "1w", "1mo"];

function sumTrailingVolume(candles: Candle[], count: number): number | null {
  if (candles.length < count) return null; // not enough history — caller renders "n/a", never 0
  const trailing = candles.slice(candles.length - count);
  return trailing.reduce((sum, c) => sum + c.v, 0);
}

/** Slices every window's total volume out of the once-fetched hourly/daily candle sets. */
export function computeWindowVolumes(hourly: Candle[], daily: Candle[]): Partial<Record<WindowKey, number>> {
  const volumes: Partial<Record<WindowKey, number>> = {};

  for (const w of HOURLY_WINDOWS) {
    const vol = sumTrailingVolume(hourly, WINDOW_HOURS[w]);
    if (vol !== null) volumes[w] = vol;
  }
  for (const w of DAILY_WINDOWS) {
    const vol = sumTrailingVolume(daily, WINDOW_HOURS[w] / 24);
    if (vol !== null) volumes[w] = vol;
  }

  return volumes;
}

/**
 * userShare = L_user / (L_active + L_user) — how much of the pool's fee flow
 * this deposit would capture. Both liquidity values are the float-precision
 * estimates from tick state / computeLiquidityForDeposit (fine for a ranking
 * tool; see liquidity.ts for why exactness isn't needed here).
 */
export function computeUserShare(userLiquidity: bigint, activeLiquidity: bigint): number {
  const user = Number(userLiquidity);
  const active = Number(activeLiquidity);
  if (user <= 0 || !Number.isFinite(user)) return 0;
  return user / (active + user);
}

/**
 * APR per window: windowVolume × feeFraction × userShare gives the user's fees
 * for that window; normalized to a daily rate, then annualized. feeFraction is
 * the live fee (ppm / 1e6) — never a hardcoded tier, per the build spec.
 */
export function computeWindowAprs(
  windowVolumes: Partial<Record<WindowKey, number>>,
  feeFraction: number,
  userShare: number,
  depositUsd: number
): Record<WindowKey, WindowApr> {
  const result = {} as Record<WindowKey, WindowApr>;

  for (const w of WINDOW_KEYS) {
    const volume = windowVolumes[w];
    if (volume === undefined || !(depositUsd > 0)) {
      result[w] = { kind: "n/a" };
      continue;
    }
    const windowFeesUsd = volume * feeFraction * userShare;
    const dailyFeesUsd = windowFeesUsd * (24 / WINDOW_HOURS[w]);
    const apr = (dailyFeesUsd * 365) / depositUsd;
    result[w] = { kind: "value", apr };
  }

  return result;
}

/** APR_6h / APR_24h — >1 accelerating, <1 fading, ≈1 steady. Null if either window lacks history. */
export function computeMomentum(windowAprs: Record<WindowKey, WindowApr>): number | null {
  const apr6h = windowAprs["6h"];
  const apr24h = windowAprs["24h"];
  if (apr6h.kind !== "value" || apr24h.kind !== "value" || apr24h.apr === 0) return null;
  return apr6h.apr / apr24h.apr;
}
