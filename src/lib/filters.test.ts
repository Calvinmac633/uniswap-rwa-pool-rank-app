import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, hasActiveFilters, matchesFilters, type Filters } from "./filters";
import type { PoolRow } from "./types";
import type { RowComputation } from "./clientCompute";

function makeRow(overrides: Partial<PoolRow> = {}): PoolRow {
  return {
    identity: {
      address: "0xpool",
      version: "v3",
      dexSlug: "uniswap-v3-robinhood",
      rwaToken: { address: "0xrwa", symbol: "SPY", name: "SPDR S&P 500 ETF Trust", decimals: 18 },
      counterToken: { address: "0xusdg", symbol: "USDG", decimals: 6 },
      rwaIsToken0: true,
      poolCreatedAt: null,
    },
    tickState: {
      kind: "concentrated",
      sqrtPriceX96: 0n,
      tick: 0,
      liquidity: 1000n,
      tickSpacing: 10,
      staticFee: 500,
      liveLpFee: 500,
      isDynamicFee: false,
      hookAddress: null,
    },
    hookBadges: ["none"],
    fast: { reserveInUsdTotal: 100_000, volume24hUsd: 50_000, rwaTokenPriceUsd: 500, counterTokenPriceUsd: 1, lastUpdated: "" },
    slow: null,
    warnings: [],
    ...overrides,
  };
}

function makeComputed(overrides: Partial<RowComputation> = {}): RowComputation {
  return {
    windowAprs: {
      "1h": { kind: "n/a" },
      "2h": { kind: "n/a" },
      "4h": { kind: "n/a" },
      "6h": { kind: "n/a" },
      "8h": { kind: "n/a" },
      "12h": { kind: "n/a" },
      "24h": { kind: "value", apr: 0.5 }, // 50%
      "3d": { kind: "n/a" },
      "1w": { kind: "n/a" },
      "1mo": { kind: "n/a" },
    },
    momentum: 0.9,
    userShareOfLiquidity: 0.02, // 2%
    suggestedRangePercent: 3,
    rangeTighterThanSuggested: false,
    unavailableReason: null,
    ...overrides,
  };
}

test("matchesFilters: default filters keep a normal row (except the momentum floor still applies)", () => {
  const row = makeRow();
  const computed = makeComputed(); // momentum 0.9 > default floor 0.5
  assert.equal(matchesFilters({ row, computed }, DEFAULT_FILTERS, true), true);
});

test("matchesFilters: default momentum floor (0.5) still excludes a fading pool", () => {
  const row = makeRow();
  const computed = makeComputed({ momentum: 0.3 });
  assert.equal(matchesFilters({ row, computed }, DEFAULT_FILTERS, true), false);
});

test("matchesFilters: a row that hasn't loaded slow-tier data is never hidden by APR/momentum/range filters", () => {
  const row = makeRow();
  const computed = makeComputed({ momentum: null }); // no momentum yet
  const filters: Filters = { ...DEFAULT_FILTERS, apr: { min: 1000, max: null } }; // impossible bound
  assert.equal(matchesFilters({ row, computed }, filters, false), true);
});

test("matchesFilters: TVL min/max excludes pools outside the range, passes through unavailable TVL", () => {
  const row = makeRow({ fast: { reserveInUsdTotal: null, volume24hUsd: 1, rwaTokenPriceUsd: 1, counterTokenPriceUsd: 1, lastUpdated: "" } });
  const computed = makeComputed();
  const filters: Filters = { ...DEFAULT_FILTERS, tvl: { min: 1_000_000, max: null } };
  // TVL unavailable -> not excluded by the TVL filter itself
  assert.equal(matchesFilters({ row, computed }, filters, true), true);

  const rowWithTvl = makeRow({ fast: { reserveInUsdTotal: 100, volume24hUsd: 1, rwaTokenPriceUsd: 1, counterTokenPriceUsd: 1, lastUpdated: "" } });
  assert.equal(matchesFilters({ row: rowWithTvl, computed }, filters, true), false); // $100 < $1M min
});

test("matchesFilters: search matches either side of the pair, case-insensitively", () => {
  const row = makeRow();
  const computed = makeComputed();
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, search: "spy" }, true), true);
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, search: "usdg" }, true), true);
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, search: "nvda" }, true), false);
});

test("matchesFilters: version filter is a whitelist, hook filter is an OR-match", () => {
  const row = makeRow();
  const computed = makeComputed();
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, versions: new Set(["v3"]) }, true), true);
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, versions: new Set(["v4"]) }, true), false);
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, hookBadges: new Set(["none"]) }, true), true);
  assert.equal(matchesFilters({ row, computed }, { ...DEFAULT_FILTERS, hookBadges: new Set(["takes-swap-cut"]) }, true), false);
});

test("hasActiveFilters: false for the untouched default, true once anything changes", () => {
  assert.equal(hasActiveFilters(DEFAULT_FILTERS), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, search: "spy" }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, tvl: { min: 100, max: null } }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, momentum: { min: 0, max: null } }), true); // moved off the default floor
});
