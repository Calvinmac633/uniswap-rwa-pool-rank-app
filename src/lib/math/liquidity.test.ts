import { test } from "node:test";
import assert from "node:assert/strict";
import { TickMath } from "@uniswap/v3-sdk";
import { computeTickRange, computeLiquidityForDeposit } from "./liquidity";

test("computeTickRange: bounds are aligned to tickSpacing and bracket the current tick", () => {
  const { tickLower, tickUpper } = computeTickRange(0, 60, 5);
  assert.ok(tickLower % 60 === 0, "tickLower must be a multiple of tickSpacing");
  assert.ok(tickUpper % 60 === 0, "tickUpper must be a multiple of tickSpacing");
  assert.ok(tickLower < 0 && tickUpper > 0, "range should bracket the current tick");
});

test("computeTickRange: wider percent produces a wider range", () => {
  const narrow = computeTickRange(0, 10, 2);
  const wide = computeTickRange(0, 10, 20);
  assert.ok(wide.tickUpper - wide.tickLower > narrow.tickUpper - narrow.tickLower);
});

test("computeTickRange: a range narrower than one tick spacing still returns a valid, non-degenerate range", () => {
  const { tickLower, tickUpper } = computeTickRange(0, 200, 0.01);
  assert.ok(tickLower < tickUpper);
  assert.equal(tickUpper - tickLower, 400); // widened to exactly one tick spacing each side
});

test("computeTickRange: rejects non-positive or >=100 percent widths", () => {
  assert.throws(() => computeTickRange(0, 60, 0));
  assert.throws(() => computeTickRange(0, 60, 100));
  assert.throws(() => computeTickRange(0, 60, -5));
});

test("computeLiquidityForDeposit: in-range, symmetric range, equal prices -> ~even split, and reconstructed USD value matches the deposit", () => {
  const sqrtPriceX96Current = BigInt(TickMath.getSqrtRatioAtTick(0).toString()); // price == 1 at tick 0
  const { tickLower, tickUpper } = computeTickRange(0, 60, 5);

  const result = computeLiquidityForDeposit({
    sqrtPriceX96Current,
    tickLower,
    tickUpper,
    price0Usd: 1,
    price1Usd: 1,
    decimals0: 18,
    decimals1: 18,
    depositUsd: 10_000,
  });

  const reconstructedUsd = result.amount0 * 1 + result.amount1 * 1;
  assert.ok(
    Math.abs(reconstructedUsd - 10_000) / 10_000 < 0.001,
    `reconstructed USD value (${reconstructedUsd}) should be within 0.1% of the $10,000 deposit`
  );
  assert.ok(!result.singleSided, "current price is inside the range, so this must not be single-sided");

  // Centered range + equal prices should split close to 50/50.
  const ratio = result.amount0 / result.amount1;
  assert.ok(ratio > 0.9 && ratio < 1.1, `expected a roughly even split, got amount0/amount1 = ${ratio}`);
});

test("computeLiquidityForDeposit: price below range -> entirely token0, zero token1", () => {
  const sqrtPriceX96Current = BigInt(TickMath.getSqrtRatioAtTick(-1000).toString());
  const result = computeLiquidityForDeposit({
    sqrtPriceX96Current,
    tickLower: 0,
    tickUpper: 6000,
    price0Usd: 1,
    price1Usd: 1,
    decimals0: 18,
    decimals1: 18,
    depositUsd: 5_000,
  });

  assert.ok(result.singleSided);
  assert.equal(result.amount1, 0);
  assert.ok(result.amount0 > 0);
});

test("computeLiquidityForDeposit: price above range -> entirely token1, zero token0", () => {
  const sqrtPriceX96Current = BigInt(TickMath.getSqrtRatioAtTick(7000).toString());
  const result = computeLiquidityForDeposit({
    sqrtPriceX96Current,
    tickLower: 0,
    tickUpper: 6000,
    price0Usd: 1,
    price1Usd: 1,
    decimals0: 18,
    decimals1: 18,
    depositUsd: 5_000,
  });

  assert.ok(result.singleSided);
  assert.equal(result.amount0, 0);
  assert.ok(result.amount1 > 0);
});

test("computeLiquidityForDeposit: liquidity scales linearly with deposit size", () => {
  const sqrtPriceX96Current = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
  const { tickLower, tickUpper } = computeTickRange(0, 60, 5);
  const base = { sqrtPriceX96Current, tickLower, tickUpper, price0Usd: 1, price1Usd: 1, decimals0: 18, decimals1: 18 };

  const small = computeLiquidityForDeposit({ ...base, depositUsd: 1_000 });
  const big = computeLiquidityForDeposit({ ...base, depositUsd: 10_000 });

  const ratio = Number(big.liquidity) / Number(small.liquidity);
  assert.ok(Math.abs(ratio - 10) < 0.01, `expected liquidity to scale ~10x, got ${ratio}x`);
});
