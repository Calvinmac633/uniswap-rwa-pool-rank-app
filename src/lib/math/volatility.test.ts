import { test } from "node:test";
import assert from "node:assert/strict";
import { realizedVol24h1Sigma } from "./volatility";
import type { Candle } from "../gecko/ohlcv";

function candleAt(close: number, t: number): Candle {
  return { t, o: close, h: close, l: close, c: close, v: 0 };
}

test("realizedVol24h1Sigma: null when there isn't enough candle history", () => {
  const candles = [1, 2, 3].map((c, i) => candleAt(c, i * 3600));
  assert.equal(realizedVol24h1Sigma(candles), null);
});

test("realizedVol24h1Sigma: flat prices -> ~zero volatility", () => {
  const candles = Array.from({ length: 48 }, (_, i) => candleAt(100, i * 3600));
  const vol = realizedVol24h1Sigma(candles);
  assert.ok(vol !== null);
  assert.ok(vol! < 1e-9, `expected ~0 volatility for flat prices, got ${vol}`);
});

test("realizedVol24h1Sigma: alternating up/down moves produce a positive, finite volatility", () => {
  const closes = Array.from({ length: 48 }, (_, i) => (i % 2 === 0 ? 100 : 105));
  const candles = closes.map((c, i) => candleAt(c, i * 3600));
  const vol = realizedVol24h1Sigma(candles);
  assert.ok(vol !== null && vol > 0 && Number.isFinite(vol));
});
