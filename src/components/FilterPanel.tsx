"use client";

import { HOOK_BADGE_LABELS, type HookBadge } from "@/lib/chain/hooks";
import { DEFAULT_FILTERS, type Filters, type MinMax } from "@/lib/filters";
import { WINDOW_KEYS, type UniswapVersion, type WindowKey } from "@/lib/types";

const VERSIONS: UniswapVersion[] = ["v2", "v3", "v4"];
const HOOK_BADGES: HookBadge[] = ["none", "custom-logic", "takes-swap-cut", "charges-on-deposit", "charges-on-exit"];

type FilterPanelProps = {
  filters: Filters;
  onChange: (filters: Filters) => void;
};

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  const toggleInSet = <T,>(set_: Set<T>, value: T): Set<T> => {
    const next = new Set(set_);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="filter-panel">
      <div className="filter-group">
        <label className="filter-group-label">Search</label>
        <input
          type="text"
          className="filter-search"
          placeholder="Ticker, e.g. SPY or USDG"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label className="filter-group-label">Version</label>
        <div className="filter-chips">
          {VERSIONS.map((v) => (
            <button
              key={v}
              type="button"
              className={`filter-chip${filters.versions.has(v) ? " active" : ""}`}
              onClick={() => set("versions", toggleInSet(filters.versions, v))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label className="filter-group-label">Hooks</label>
        <div className="filter-chips">
          {HOOK_BADGES.map((b) => (
            <button
              key={b}
              type="button"
              className={`filter-chip${filters.hookBadges.has(b) ? " active" : ""}`}
              onClick={() => set("hookBadges", toggleInSet(filters.hookBadges, b))}
            >
              {HOOK_BADGE_LABELS[b]}
            </button>
          ))}
        </div>
      </div>

      <MinMaxField label="Fee (%)" value={filters.fee} onChange={(v) => set("fee", v)} />
      <MinMaxField label="Total TVL ($)" value={filters.tvl} onChange={(v) => set("tvl", v)} />
      <MinMaxField label="Your Share (%)" value={filters.yourShare} onChange={(v) => set("yourShare", v)} />
      <MinMaxField label="Vol 24h ($)" value={filters.vol24h} onChange={(v) => set("vol24h", v)} />

      <div className="filter-group">
        <label className="filter-group-label">APR window to filter</label>
        <select className="filter-select" value={filters.aprWindow} onChange={(e) => set("aprWindow", e.target.value as WindowKey)}>
          {WINDOW_KEYS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>
      <MinMaxField label={`${filters.aprWindow} APR (%)`} value={filters.apr} onChange={(v) => set("apr", v)} />

      <MinMaxField label="Momentum (6h/24h)" value={filters.momentum} onChange={(v) => set("momentum", v)} />
      <MinMaxField label="Suggested range (±%)" value={filters.suggestedRange} onChange={(v) => set("suggestedRange", v)} />

      <button type="button" className="filter-reset" onClick={() => onChange(DEFAULT_FILTERS)}>
        Reset filters
      </button>
    </div>
  );
}

function MinMaxField({ label, value, onChange }: { label: string; value: MinMax; onChange: (v: MinMax) => void }) {
  return (
    <div className="filter-group">
      <label className="filter-group-label">{label}</label>
      <div className="filter-minmax">
        <input
          type="number"
          placeholder="min"
          value={value.min ?? ""}
          onChange={(e) => onChange({ ...value, min: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <span className="filter-minmax-sep">–</span>
        <input
          type="number"
          placeholder="max"
          value={value.max ?? ""}
          onChange={(e) => onChange({ ...value, max: e.target.value === "" ? null : Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
