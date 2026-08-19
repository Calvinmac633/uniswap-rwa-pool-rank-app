"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls } from "@/components/Controls";
import { Disclosure } from "@/components/Disclosure";
import { PoolTable, compareRows, DEFAULT_SORT, type DisplayRow, type SortColumn } from "@/components/PoolTable";
import { computeRowMetrics } from "@/lib/clientCompute";
import { deserializePoolRow, type WirePoolRow } from "@/lib/wireTypes";
import type { DiscoveryMeta, PoolRow, SlowMetrics } from "@/lib/types";

const CANDLE_BATCH_SIZE = 60; // matches the API route's own cap
const DEFAULT_TOP_N_FOR_TREND_DATA = 60;

type FastApiResponse = { rows: WirePoolRow[]; meta: DiscoveryMeta } | { error: string };

async function fetchFastData(params: { refresh?: boolean; rescan?: boolean }): Promise<{ rows: PoolRow[]; meta: DiscoveryMeta }> {
  const qs = new URLSearchParams();
  if (params.refresh) qs.set("refresh", "1");
  if (params.rescan) qs.set("rescan", "1");
  const res = await fetch(`/api/pools?${qs.toString()}`);
  const data = (await res.json()) as FastApiResponse;
  if ("error" in data) throw new Error(data.error);
  return { rows: data.rows.map(deserializePoolRow), meta: data.meta };
}

async function fetchCandleBatch(addresses: string[]): Promise<Record<string, SlowMetrics>> {
  if (addresses.length === 0) return {};
  const res = await fetch("/api/pools/candles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses }),
  });
  const data = (await res.json()) as { metrics: Record<string, SlowMetrics>; errors: string[] } | { error: string };
  if ("error" in data) throw new Error(data.error);
  return data.metrics;
}

export default function Home() {
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [meta, setMeta] = useState<DiscoveryMeta | null>(null);
  const [slowMetrics, setSlowMetrics] = useState<Record<string, SlowMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trendLoadState, setTrendLoadState] = useState<{ loaded: number; total: number } | null>(null);

  const [depositUsd, setDepositUsd] = useState(10_000);
  const [rangeWidthPercent, setRangeWidthPercent] = useState(5);
  const [momentumFloor, setMomentumFloor] = useState(0.5);
  const [sort, setSort] = useState(DEFAULT_SORT);

  // Click cycles: descending -> ascending -> back to the default sort.
  const handleSort = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "desc" };
      if (prev.direction === "desc") return { column, direction: "asc" };
      return DEFAULT_SORT;
    });
  }, []);

  // Guards against a slow trend-data load from a previous pool set clobbering
  // state after the user hits "rescan" and gets a different pool list back.
  const loadGeneration = useRef(0);

  const loadTrendData = useCallback(async (addresses: string[]) => {
    const generation = ++loadGeneration.current;
    setTrendLoadState({ loaded: 0, total: addresses.length });

    for (let i = 0; i < addresses.length; i += CANDLE_BATCH_SIZE) {
      if (loadGeneration.current !== generation) return; // superseded by a newer load
      const batch = addresses.slice(i, i + CANDLE_BATCH_SIZE);
      try {
        const batchMetrics = await fetchCandleBatch(batch);
        if (loadGeneration.current !== generation) return;
        setSlowMetrics((prev) => ({ ...prev, ...batchMetrics }));
      } catch (err) {
        // A failed candle batch shouldn't take down the rest of the table —
        // those rows just stay "n/a" for APR, per the "no half-loaded table
        // pretending to be complete, but also don't crash on partial failure" rule.
        console.error("Trend data batch failed:", err);
      }
      setTrendLoadState({ loaded: Math.min(i + CANDLE_BATCH_SIZE, addresses.length), total: addresses.length });
    }
  }, []);

  const loadFast = useCallback(
    async (params: { refresh?: boolean; rescan?: boolean }) => {
      setRefreshing(true);
      setLoadError(null);
      try {
        const { rows: newRows, meta: newMeta } = await fetchFastData(params);
        setRows(newRows);
        setMeta(newMeta);

        // Auto-load trend data for the top N pools by 24h volume so APR
        // columns populate without the user having to ask — the rest is
        // available via "Load trend data for all pools" below the table.
        const topAddresses = [...newRows]
          .sort((a, b) => (b.fast?.volume24hUsd ?? 0) - (a.fast?.volume24hUsd ?? 0))
          .slice(0, DEFAULT_TOP_N_FOR_TREND_DATA)
          .map((r) => r.identity.address);
        void loadTrendData(topAddresses);
      } catch (err) {
        setLoadError((err as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadTrendData]
  );

  useEffect(() => {
    void loadFast({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayRows: DisplayRow[] = useMemo(() => {
    return rows.map((row) => {
      const merged: PoolRow = { ...row, slow: slowMetrics[row.identity.address] ?? row.slow };
      return { row: merged, computed: computeRowMetrics(merged, depositUsd, rangeWidthPercent) };
    });
  }, [rows, slowMetrics, depositUsd, rangeWidthPercent]);

  const slowDataLoadedFor = useMemo(() => new Set(Object.keys(slowMetrics)), [slowMetrics]);

  // Default sort: 24h APR descending, with the momentum filter applied — see
  // Step 6c: raw 24h APR alone systematically surfaces one-off spikes. Any
  // column can be clicked to sort by instead (see PoolTable's compareRows).
  const visibleRows = useMemo(() => {
    const filtered = displayRows.filter((d) => {
      if (!slowDataLoadedFor.has(d.row.identity.address)) return true; // don't hide rows still loading
      if (d.computed.momentum === null) return true; // n/a momentum isn't evidence of a bad pool
      if (!Number.isFinite(momentumFloor)) return true; // cleared/invalid input -> no floor, not "hide everything"
      return d.computed.momentum >= momentumFloor;
    });
    return filtered.sort((a, b) => compareRows(a, b, sort.column, sort.direction));
  }, [displayRows, momentumFloor, slowDataLoadedFor, sort]);

  const hiddenByMomentumCount = displayRows.length - visibleRows.length;
  const remainingForTrendData = rows.length - slowDataLoadedFor.size;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Robinhood Chain RWA LP Screener</h1>
      </div>
      <p className="page-subtitle">
        Uniswap pools on Robinhood Chain paired with a tokenized real-world asset, ranked by estimated fee APR for a
        concentrated LP position. Read-only — no wallet connection, no transactions.
      </p>

      <Disclosure />

      {loadError && <div className="banner banner-error">Failed to load pool data: {loadError}</div>}
      {meta?.registryError && (
        <div className="banner banner-warning">
          Robinhood asset registry unreachable ({meta.registryError}) — RWA classification is relying on the on-chain
          uiMultiplier() probe alone until this recovers.
        </div>
      )}
      {meta && meta.fetchErrors.length > 0 && (
        <div className="banner banner-warning">
          {meta.fetchErrors.length} data refresh call{meta.fetchErrors.length === 1 ? "" : "s"} failed — some rows below
          may be showing stale TVL/volume instead of current values. This table is not guaranteed complete/current
          until a refresh succeeds cleanly.
        </div>
      )}
      {meta && meta.dexPagesHitSafetyCap.length > 0 && (
        <div className="banner banner-warning">
          Pool discovery hit the free API's page cap for: {meta.dexPagesHitSafetyCap.join(", ")}. There may be more
          pools on these DEXes than shown below.
        </div>
      )}
      {trendLoadState && trendLoadState.loaded < trendLoadState.total && (
        <div className="banner banner-info">
          Loading trend data: {trendLoadState.loaded}/{trendLoadState.total} pools. APR columns fill in as this completes
          — this is rate-limited by GeckoTerminal's free tier, so it takes a bit.
        </div>
      )}
      {hiddenByMomentumCount > 0 && (
        <div className="banner banner-info">
          {hiddenByMomentumCount} pool{hiddenByMomentumCount === 1 ? "" : "s"} hidden by the momentum floor ({momentumFloor}×).
        </div>
      )}

      <Controls
        depositUsd={depositUsd}
        onDepositUsdChange={setDepositUsd}
        rangeWidthPercent={rangeWidthPercent}
        onRangeWidthPercentChange={setRangeWidthPercent}
        momentumFloor={momentumFloor}
        onMomentumFloorChange={setMomentumFloor}
        onRefresh={() => void loadFast({ refresh: true })}
        onRescan={() => void loadFast({ rescan: true })}
        refreshing={refreshing}
        lastUpdated={rows[0]?.fast?.lastUpdated ?? null}
      />

      {loading ? (
        <div className="empty-state">Loading pools…</div>
      ) : (
        <>
          <PoolTable rows={visibleRows} slowDataLoadedFor={slowDataLoadedFor} sort={sort} onSort={handleSort} />
          {remainingForTrendData > 0 && (!trendLoadState || trendLoadState.loaded >= trendLoadState.total) && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => void loadTrendData(rows.map((r) => r.identity.address).filter((a) => !slowDataLoadedFor.has(a)))}
              >
                Load trend data for the remaining {remainingForTrendData} pool{remainingForTrendData === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
