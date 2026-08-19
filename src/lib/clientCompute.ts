// Ties the pure math modules together per-row, given the user's deposit size
// and range width. Runs entirely client-side on already-fetched data (no
// fetch/RPC calls in this file) so adjusting the controls recomputes instantly
// — see liquidity.ts/apr.ts for why that's safe to bundle into the browser.
import { computeTickRange, computeLiquidityForDeposit } from "./math/liquidity";
import { computeUserShare, computeWindowAprs, computeMomentum } from "./math/apr";
import type { PoolRow, WindowApr, WindowKey } from "./types";

export type RowComputation = {
  windowAprs: Record<WindowKey, WindowApr>;
  momentum: number | null;
  userShareOfLiquidity: number | null;
  /**
   * Active liquidity expressed in USD instead of Uniswap's raw internal L
   * unit (which isn't human-readable — it's not a dollar amount or a token
   * count). For v2 this is just the pool's total value (v2 has no
   * concentration, so all of it is always "active"). For v3/v4 there's no
   * single USD figure for a bare L value without also assuming a range width
   * — this uses the width from the Range Width control, so it's "how many
   * dollars, spread across the range you've selected, would match the pool's
   * real active liquidity." It will shift when you change that control (a
   * dollar goes further in a narrower range) — that's expected, not a bug.
   */
  activeLiquidityUsd: number | null;
  /** null when this pool has no concentration risk (v2) or range data isn't available yet. */
  suggestedRangePercent: number | null;
  /** True when the user's chosen range is materially tighter than the suggested one (see Step 6d). */
  rangeTighterThanSuggested: boolean;
  unavailableReason: string | null;
};

const FEE_PPM_DIVISOR = 1_000_000;
// "Materially tighter" threshold: the user's range would need to be less than
// half the suggested 1-sigma width before we warn — a smaller gap is normal
// risk-taking, not a data-quality problem.
const TIGHTER_RANGE_WARNING_RATIO = 0.5;

export function computeRowMetrics(row: PoolRow, depositUsd: number, rangeWidthPercent: number): RowComputation {
  const empty = (reason: string): RowComputation => ({
    windowAprs: Object.fromEntries(
      (["1h", "2h", "4h", "6h", "8h", "12h", "24h", "3d", "1w", "1mo"] as WindowKey[]).map((w) => [w, { kind: "n/a" as const }])
    ) as Record<WindowKey, WindowApr>,
    momentum: null,
    userShareOfLiquidity: null,
    activeLiquidityUsd: null,
    suggestedRangePercent: null,
    rangeTighterThanSuggested: false,
    unavailableReason: reason,
  });

  if (row.tickState.kind === "unavailable") {
    return empty("Live tick state unavailable for this pool.");
  }
  if (!(depositUsd > 0)) {
    return empty("Enter a deposit size greater than $0.");
  }
  // computeTickRange requires 0 < rangeWidthPercent < 100 and throws outside
  // that — a plain number input can easily produce 0/negative/NaN/empty
  // mid-edit (the HTML min/max attributes only affect the browser's built-in
  // validation UI, not what onChange actually delivers), so this has to be
  // checked here rather than trusted from the control.
  if (!(rangeWidthPercent > 0) || rangeWidthPercent >= 100) {
    return empty("Enter a range width between 0 and 100%.");
  }

  const windowVolumeUsd = row.slow?.windowVolumeUsd ?? {};
  const suggestedRangePercent =
    row.slow?.realizedVol24h1Sigma !== null && row.slow?.realizedVol24h1Sigma !== undefined
      ? row.slow.realizedVol24h1Sigma * 100
      : null;

  if (row.tickState.kind === "full-range") {
    // v2: always full-range by construction — a proportional $D deposit into
    // a pool worth $R (GeckoTerminal's total reserves) buys a D/(R+D) share of
    // the pool, and of its fees, with no range/tick concept at all.
    const poolValueUsd = row.fast?.reserveInUsdTotal ?? null;
    if (poolValueUsd === null) return empty("Pool USD value unavailable.");

    const userShareOfLiquidity = depositUsd / (poolValueUsd + depositUsd);
    const feeFraction = row.tickState.feePpm / FEE_PPM_DIVISOR;
    const windowAprs = computeWindowAprs(windowVolumeUsd, feeFraction, userShareOfLiquidity, depositUsd);

    return {
      windowAprs,
      momentum: computeMomentum(windowAprs),
      userShareOfLiquidity,
      activeLiquidityUsd: poolValueUsd, // v2 has no concentration — the whole pool is always "active"
      suggestedRangePercent: null, // no range risk on a full-range v2 position
      rangeTighterThanSuggested: false,
      unavailableReason: null,
    };
  }

  // v3 / v4 concentrated liquidity.
  if (row.tickState.tickSpacing === null) {
    return empty("tickSpacing unknown for this v4 pool (Initialize event not indexed yet).");
  }
  const price0Usd = row.identity.rwaIsToken0 ? row.fast?.rwaTokenPriceUsd : row.fast?.counterTokenPriceUsd;
  const price1Usd = row.identity.rwaIsToken0 ? row.fast?.counterTokenPriceUsd : row.fast?.rwaTokenPriceUsd;
  if (!price0Usd || !price1Usd) {
    return empty("Token USD price unavailable for this pool.");
  }

  const decimals0 = row.identity.rwaIsToken0 ? row.identity.rwaToken.decimals : row.identity.counterToken.decimals;
  const decimals1 = row.identity.rwaIsToken0 ? row.identity.counterToken.decimals : row.identity.rwaToken.decimals;

  const { tickLower, tickUpper } = computeTickRange(row.tickState.tick, row.tickState.tickSpacing, rangeWidthPercent);
  const { liquidity: userLiquidity } = computeLiquidityForDeposit({
    sqrtPriceX96Current: row.tickState.sqrtPriceX96,
    tickLower,
    tickUpper,
    price0Usd,
    price1Usd,
    decimals0,
    decimals1,
    depositUsd,
  });

  const userShareOfLiquidity = computeUserShare(userLiquidity, row.tickState.liquidity);
  const feeFraction = row.tickState.liveLpFee / FEE_PPM_DIVISOR;
  const windowAprs = computeWindowAprs(windowVolumeUsd, feeFraction, userShareOfLiquidity, depositUsd);

  // Liquidity is linear in deposit size (see liquidity.test.ts), so the same
  // ratio that produced userLiquidity from depositUsd converts the pool's
  // real active liquidity into an equivalent dollar figure, at the range
  // width currently selected.
  const activeLiquidityUsd = userLiquidity > 0n ? depositUsd * (Number(row.tickState.liquidity) / Number(userLiquidity)) : null;

  const rangeTighterThanSuggested =
    suggestedRangePercent !== null && rangeWidthPercent < suggestedRangePercent * TIGHTER_RANGE_WARNING_RATIO;

  return {
    windowAprs,
    momentum: computeMomentum(windowAprs),
    userShareOfLiquidity,
    activeLiquidityUsd,
    suggestedRangePercent,
    rangeTighterThanSuggested,
    unavailableReason: null,
  };
}
