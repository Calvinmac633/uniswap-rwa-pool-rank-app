// Pure filter-matching logic, kept separate from the UI (same pattern as
// math/apr.ts etc.) — no fetching, safe to run client-side, easy to reason
// about independent of how the panel renders.
import type { HookBadge } from "./chain/hooks";
import type { RowComputation } from "./clientCompute";
import type { PoolRow, UniswapVersion, WindowKey } from "./types";

export type MinMax = { min: number | null; max: number | null };
const NO_BOUND: MinMax = { min: null, max: null };

export type Filters = {
  search: string;
  /** Empty set = no restriction (matches every version). */
  versions: Set<UniswapVersion>;
  /** Empty set = no restriction. A pool matches if it has ANY of the checked badges. */
  hookBadges: Set<HookBadge>;
  fee: MinMax; // percent, e.g. 0.3 for 0.30%
  tvl: MinMax; // usd
  yourShare: MinMax; // percent
  vol24h: MinMax; // usd
  aprWindow: WindowKey;
  apr: MinMax; // percent, applies to whichever window is selected above
  momentum: MinMax;
  suggestedRange: MinMax; // percent
};

export const DEFAULT_FILTERS: Filters = {
  search: "",
  versions: new Set(),
  hookBadges: new Set(),
  fee: NO_BOUND,
  tvl: NO_BOUND,
  yourShare: NO_BOUND,
  vol24h: NO_BOUND,
  aprWindow: "24h",
  apr: NO_BOUND,
  momentum: { min: 0.5, max: null }, // preserves the app's original default (Step 6c)
  suggestedRange: NO_BOUND,
};

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.versions.size > 0 ||
    filters.hookBadges.size > 0 ||
    filters.fee.min !== null ||
    filters.fee.max !== null ||
    filters.tvl.min !== null ||
    filters.tvl.max !== null ||
    filters.yourShare.min !== null ||
    filters.yourShare.max !== null ||
    filters.vol24h.min !== null ||
    filters.vol24h.max !== null ||
    filters.apr.min !== null ||
    filters.apr.max !== null ||
    filters.momentum.min !== DEFAULT_FILTERS.momentum.min ||
    filters.momentum.max !== null ||
    filters.suggestedRange.min !== null ||
    filters.suggestedRange.max !== null
  );
}

/** A value we don't have yet (n/a, still loading) always passes — it isn't evidence the pool fails the filter. */
function inRange(value: number | null, range: MinMax): boolean {
  if (value === null) return true;
  if (range.min !== null && Number.isFinite(range.min) && value < range.min) return false;
  if (range.max !== null && Number.isFinite(range.max) && value > range.max) return false;
  return true;
}

export function matchesFilters(
  d: { row: PoolRow; computed: RowComputation },
  filters: Filters,
  slowLoaded: boolean
): boolean {
  const { row, computed } = d;

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const hit =
      row.identity.rwaToken.symbol.toLowerCase().includes(q) || row.identity.counterToken.symbol.toLowerCase().includes(q);
    if (!hit) return false;
  }

  if (filters.versions.size > 0 && !filters.versions.has(row.identity.version)) return false;

  if (filters.hookBadges.size > 0 && !row.hookBadges.some((b) => filters.hookBadges.has(b))) return false;

  const feePpm = row.tickState.kind === "concentrated" ? row.tickState.liveLpFee : row.tickState.kind === "full-range" ? row.tickState.feePpm : null;
  if (!inRange(feePpm !== null ? feePpm / 10_000 : null, filters.fee)) return false;

  if (!inRange(row.fast?.reserveInUsdTotal ?? null, filters.tvl)) return false;

  if (!inRange(computed.userShareOfLiquidity !== null ? computed.userShareOfLiquidity * 100 : null, filters.yourShare)) return false;

  if (!inRange(row.fast?.volume24hUsd ?? null, filters.vol24h)) return false;

  // APR/momentum/suggested-range all come from slow-tier data — a row that
  // hasn't loaded that yet shouldn't be hidden as if it failed the filter.
  if (slowLoaded) {
    const apr = computed.windowAprs[filters.aprWindow];
    if (!inRange(apr.kind === "value" ? apr.apr * 100 : null, filters.apr)) return false;
    if (!inRange(computed.momentum, filters.momentum)) return false;
    if (!inRange(computed.suggestedRangePercent, filters.suggestedRange)) return false;
  }

  return true;
}
