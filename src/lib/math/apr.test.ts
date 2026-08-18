import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWindowVolumes, computeWindowAprs, computeUserShare, computeMomentum } from "./apr";
import { WINDOW_KEYS, type WindowApr } from "../types";
import type { Candle } from "../gecko/ohlcv";

function makeCandles(count: number, volumePerCandle: number, startT = 0, stepSeconds = 3600): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    t: startT + i * stepSeconds,
    o: 1,
    h: 1,
    l: 1,
    c: 1,
    v: volumePerCandle,
  }));
}

test("computeWindowVolumes: windows with enough history sum correctly; short-history windows are omitted (never zero)", () => {
  const hourly = makeCandles(10, 100); // only 10 hourly candles — not enough for 12h/24h
  const daily = makeCandles(2, 1000, 0, 86400); // only 2 daily candles — not enough for 3d/1w/1mo

  const volumes = computeWindowVolumes(hourly, daily);

  assert.equal(volumes["1h"], 100);
  assert.equal(volumes["4h"], 400);
  assert.equal(volumes["8h"], 800);
  assert.equal(volumes["12h"], undefined, "12h needs 12 hourly candles, only 10 exist");
  assert.equal(volumes["24h"], undefined);
  assert.equal(volumes["3d"], undefined, "3d needs 3 daily candles, only 2 exist");
  assert.equal(volumes["1w"], undefined);
  assert.equal(volumes["1mo"], undefined);
});

test("computeWindowVolumes: full history populates every window", () => {
  const hourly = makeCandles(168, 50);
  const daily = makeCandles(30, 1200, 0, 86400);
  const volumes = computeWindowVolumes(hourly, daily);
  for (const w of WINDOW_KEYS) {
    assert.ok(volumes[w] !== undefined, `expected ${w} to be populated`);
  }
});

test("computeUserShare: zero user liquidity -> zero share; equal liquidity -> 50%", () => {
  assert.equal(computeUserShare(0n, 1000n), 0);
  assert.equal(computeUserShare(1000n, 1000n), 0.5);
});

test("computeWindowAprs: missing volume renders n/a, not a value of 0", () => {
  const aprs = computeWindowAprs({}, 0.003, 0.1, 10_000);
  for (const w of WINDOW_KEYS) {
    assert.equal(aprs[w].kind, "n/a");
  }
});

test("computeWindowAprs: basic arithmetic sanity check", () => {
  // $1,000,000 volume in the 24h window, 0.3% fee, user has 10% of active
  // liquidity, $10,000 deposit.
  // dailyFees = 1,000,000 * 0.003 * 0.10 = 300; APR = 300 * 365 / 10,000 = 10.95
  const aprs = computeWindowAprs({ "24h": 1_000_000 }, 0.003, 0.1, 10_000);
  const apr24h = aprs["24h"] as Extract<WindowApr, { kind: "value" }>;
  assert.equal(apr24h.kind, "value");
  assert.ok(Math.abs(apr24h.apr - 10.95) < 1e-9);
});

test("computeMomentum: accelerating, fading, and steady cases", () => {
  const accelerating = computeWindowAprs({ "6h": 100_000, "24h": 200_000 }, 0.003, 0.1, 10_000);
  const fading = computeWindowAprs({ "6h": 50_000, "24h": 400_000 }, 0.003, 0.1, 10_000);
  const steady = computeWindowAprs({ "6h": 100_000, "24h": 400_000 }, 0.003, 0.1, 10_000);

  // 6h volume normalized to a day is volume*4; equal-rate (steady) 24h volume is 4x the 6h volume.
  assert.ok(computeMomentum(steady)! > 0.99 && computeMomentum(steady)! < 1.01);
  assert.ok(computeMomentum(accelerating)! > 1, "6h running hotter than 24h average should be >1");
  assert.ok(computeMomentum(fading)! < 1, "6h running cooler than 24h average should be <1");
});

test("computeMomentum: null when either window lacks history", () => {
  const aprs = computeWindowAprs({ "24h": 1_000_000 }, 0.003, 0.1, 10_000); // no 6h volume
  assert.equal(computeMomentum(aprs), null);
});
