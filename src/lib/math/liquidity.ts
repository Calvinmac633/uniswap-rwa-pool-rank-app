// Step 6a liquidity math. Every sqrt-price/tick conversion goes through
// @uniswap/v3-sdk's TickMath and SqrtPriceMath (the same core math v4 uses —
// v4-sdk doesn't re-export its own copy, confirmed by inspecting its exports)
// rather than being hand-rolled, per the build spec's explicit instruction.
// This app never submits a transaction, so the float-precision loss from
// converting JSBI results to `number` for the final USD-denominated estimate
// is an intentional, documented tradeoff — the ranking only needs to be
// accurate to a fraction of a percent, not wei-exact.
import { TickMath, SqrtPriceMath, nearestUsableTick } from "@uniswap/v3-sdk";
import JSBI from "jsbi";

const REFERENCE_LIQUIDITY = JSBI.BigInt(Number.MAX_SAFE_INTEGER); // large enough to avoid the SDK's integer math rounding tiny ranges to zero; exact value is irrelevant, it cancels out below

export type TickRange = { tickLower: number; tickUpper: number };

/**
 * Converts a symmetric ±percent price range around the current tick into tick
 * bounds aligned to the pool's tickSpacing. The percent→tick-count conversion
 * is plain log arithmetic (not the fixed-point conversion the SDK owns); tick
 * alignment uses the SDK's own nearestUsableTick rather than hand-rolled
 * floor/ceil snapping.
 */
export function computeTickRange(currentTick: number, tickSpacing: number, rangeWidthPercent: number): TickRange {
  if (!(rangeWidthPercent > 0) || rangeWidthPercent >= 100) {
    throw new Error(`rangeWidthPercent must be between 0 and 100 (exclusive), got ${rangeWidthPercent}`);
  }

  const tickOffset = Math.max(1, Math.round(Math.log(1 + rangeWidthPercent / 100) / Math.log(1.0001)));

  const clamp = (t: number) => Math.min(TickMath.MAX_TICK, Math.max(TickMath.MIN_TICK, t));
  const rawLower = clamp(currentTick - tickOffset);
  const rawUpper = clamp(currentTick + tickOffset);

  let tickLower = nearestUsableTick(rawLower, tickSpacing);
  let tickUpper = nearestUsableTick(rawUpper, tickSpacing);

  if (tickLower >= tickUpper) {
    // Requested width rounds to less than one tick spacing — widen to the
    // narrowest valid range around the current tick rather than returning a
    // degenerate/inverted one.
    const base = nearestUsableTick(clamp(currentTick), tickSpacing);
    tickLower = clamp(base - tickSpacing);
    tickUpper = clamp(base + tickSpacing);
  }

  return { tickLower, tickUpper };
}

export type LiquidityForDepositInput = {
  sqrtPriceX96Current: bigint;
  tickLower: number;
  tickUpper: number;
  /** USD value of one whole (decimal-adjusted) token0 / token1. */
  price0Usd: number;
  price1Usd: number;
  decimals0: number;
  decimals1: number;
  depositUsd: number;
};

export type LiquidityForDepositResult = {
  liquidity: bigint;
  amount0: number; // decimal-adjusted (whole-token units), for display only
  amount1: number;
  /** True if the position would be single-sided at today's price (price is outside the chosen range). */
  singleSided: boolean;
};

/**
 * Computes the liquidity a $depositUsd position would supply across
 * [tickLower, tickUpper] at the pool's current price. An in-range LP can't
 * choose the token0/token1 split independently — it's determined entirely by
 * the range and the current price — so this solves for the liquidity that
 * makes the two sides' combined USD value equal depositUsd, using
 * SqrtPriceMath.getAmount{0,1}Delta (SDK-provided) for the token-amounts-per-
 * unit-of-liquidity ratio, then scales linearly (amounts are linear in L).
 */
export function computeLiquidityForDeposit(input: LiquidityForDepositInput): LiquidityForDepositResult {
  const { tickLower, tickUpper, price0Usd, price1Usd, decimals0, decimals1, depositUsd } = input;

  const sqrtCurrent = JSBI.BigInt(input.sqrtPriceX96Current.toString());
  const sqrtLower = TickMath.getSqrtRatioAtTick(tickLower);
  const sqrtUpper = TickMath.getSqrtRatioAtTick(tickUpper);

  let amount0Ref: JSBI;
  let amount1Ref: JSBI;
  let singleSided = false;

  if (JSBI.lessThanOrEqual(sqrtCurrent, sqrtLower)) {
    singleSided = true;
    amount0Ref = SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, REFERENCE_LIQUIDITY, true);
    amount1Ref = JSBI.BigInt(0);
  } else if (JSBI.greaterThanOrEqual(sqrtCurrent, sqrtUpper)) {
    singleSided = true;
    amount0Ref = JSBI.BigInt(0);
    amount1Ref = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, REFERENCE_LIQUIDITY, true);
  } else {
    amount0Ref = SqrtPriceMath.getAmount0Delta(sqrtCurrent, sqrtUpper, REFERENCE_LIQUIDITY, true);
    amount1Ref = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtCurrent, REFERENCE_LIQUIDITY, true);
  }

  const amount0RefWhole = Number(amount0Ref.toString()) / 10 ** decimals0;
  const amount1RefWhole = Number(amount1Ref.toString()) / 10 ** decimals1;
  const refValueUsd = amount0RefWhole * price0Usd + amount1RefWhole * price1Usd;

  if (!(refValueUsd > 0)) {
    return { liquidity: 0n, amount0: 0, amount1: 0, singleSided };
  }

  const scale = depositUsd / refValueUsd;

  return {
    liquidity: BigInt(Math.floor(Number(REFERENCE_LIQUIDITY.toString()) * scale)),
    amount0: amount0RefWhole * scale,
    amount1: amount1RefWhole * scale,
    singleSided,
  };
}

