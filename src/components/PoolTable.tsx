import { ROBINHOOD_EXPLORER_URL } from "@/lib/chain/addresses";
import { formatUsdCompact, formatPercent, formatFeePpm } from "@/lib/format";
import { WINDOW_KEYS, type PoolRow, type WindowApr, type WindowKey } from "@/lib/types";
import type { RowComputation } from "@/lib/clientCompute";
import { Sparkline } from "./Sparkline";
import { HookBadges } from "./HookBadges";
import { CopyableAddress } from "./CopyableAddress";

const SPARKLINE_WINDOWS: WindowKey[] = [...WINDOW_KEYS].reverse(); // long -> short, per Step 6c

export type DisplayRow = { row: PoolRow; computed: RowComputation };

// The columns with one obvious numeric value to sort by. Text/categorical
// columns (Asset, Counter-asset, Version, Hooks, Trend, Suggested range)
// aren't included — there's no single natural sort key for those.
export type SortColumn = "fee" | "tvl" | "activeLiquidity" | "vol24h" | "momentum" | WindowKey;
export type SortDirection = "asc" | "desc";

export const DEFAULT_SORT: { column: SortColumn; direction: SortDirection } = { column: "24h", direction: "desc" };

/** The raw numeric value a row sorts by for a given column, or null if unavailable — nulls always sort last. */
export function getSortValue(d: DisplayRow, column: SortColumn): number | null {
  const { row, computed } = d;
  switch (column) {
    case "fee": {
      const ts = row.tickState;
      return ts.kind === "concentrated" ? ts.liveLpFee : ts.kind === "full-range" ? ts.feePpm : null;
    }
    case "tvl":
      return row.fast?.reserveInUsdTotal ?? null;
    case "activeLiquidity":
      return computed.activeLiquidityUsd;
    case "vol24h":
      return row.fast?.volume24hUsd ?? null;
    case "momentum":
      return computed.momentum;
    default: {
      const apr = computed.windowAprs[column];
      return apr?.kind === "value" ? apr.apr : null;
    }
  }
}

export function compareRows(a: DisplayRow, b: DisplayRow, column: SortColumn, direction: SortDirection): number {
  const va = getSortValue(a, column);
  const vb = getSortValue(b, column);
  if (va === null && vb === null) return 0;
  if (va === null) return 1; // n/a always sorts last, regardless of direction
  if (vb === null) return -1;
  return direction === "desc" ? vb - va : va - vb;
}

function momentumClass(momentum: number | null): string {
  if (momentum === null) return "";
  if (momentum > 1.1) return "momentum-hot";
  if (momentum < 0.9) return "momentum-fading";
  return "momentum-steady";
}

function explorerAddressUrl(address: string): string {
  // v4 poolIds aren't explorer-addressable (they're not contract addresses) —
  // link the hook or fall back to the pool manager isn't useful either, so
  // callers should only use this for real token/contract addresses.
  return `${ROBINHOOD_EXPLORER_URL}/address/${address}`;
}

/** One window's cell: APR stacked above that same window's volume. */
function AprWindowCell({
  apr,
  volumeUsd,
  loaded,
  unavailableReason,
}: {
  apr: WindowApr;
  volumeUsd: number | undefined;
  loaded: boolean;
  unavailableReason: string | null;
}) {
  if (!loaded) return <span className="na">loading…</span>;
  if (unavailableReason) {
    return (
      <span className="na" title={unavailableReason}>
        n/a
      </span>
    );
  }
  if (apr.kind !== "value") return <span className="na">n/a</span>;

  return (
    <div className="apr-cell">
      <div className="apr-value">{formatPercent(apr.apr)}</div>
      <div className="apr-volume">{volumeUsd !== undefined ? formatUsdCompact(volumeUsd) : <span className="na">n/a</span>}</div>
    </div>
  );
}

type SortableHeaderProps = {
  column: SortColumn;
  label: string;
  title?: string;
  activeSort: { column: SortColumn; direction: SortDirection };
  onSort: (column: SortColumn) => void;
};

/** Click cycles: descending -> ascending -> back to the default sort (see DEFAULT_SORT). */
function SortableHeader({ column, label, title, activeSort, onSort }: SortableHeaderProps) {
  const isActive = activeSort.column === column;
  return (
    <th className="num sortable" title={title} onClick={() => onSort(column)}>
      {label}
      <span className="sort-indicator">{isActive ? (activeSort.direction === "desc" ? " ▼" : " ▲") : ""}</span>
    </th>
  );
}

type PoolTableProps = {
  rows: DisplayRow[];
  slowDataLoadedFor: Set<string>;
  sort: { column: SortColumn; direction: SortDirection };
  onSort: (column: SortColumn) => void;
};

export function PoolTable({ rows, slowDataLoadedFor, sort, onSort }: PoolTableProps) {
  if (rows.length === 0) {
    return <div className="empty-state">No qualifying RWA pools found yet.</div>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Pool</th>
            <SortableHeader column="fee" label="Fee" activeSort={sort} onSort={onSort} />
            <SortableHeader column="tvl" label="Total TVL" activeSort={sort} onSort={onSort} />
            <SortableHeader column="activeLiquidity" label="Active liquidity" activeSort={sort} onSort={onSort} />
            <SortableHeader column="vol24h" label="Vol 24h" activeSort={sort} onSort={onSort} />
            {WINDOW_KEYS.map((w) => (
              <SortableHeader key={w} column={w} label={w} activeSort={sort} onSort={onSort} />
            ))}
            <th title="Trend shape across all windows, long (1mo) to short (1h)">Decay Ratio</th>
            <SortableHeader column="momentum" label="Momentum" activeSort={sort} onSort={onSort} />
            <th>Suggested range</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, computed }) => {
            const { identity, tickState, fast, hookBadges } = row;
            const isDynamicFee = tickState.kind === "concentrated" && tickState.isDynamicFee;
            const feePpm = tickState.kind === "concentrated" ? tickState.liveLpFee : tickState.kind === "full-range" ? tickState.feePpm : null;
            const sparklineValues = SPARKLINE_WINDOWS.map((w) => {
              const a = computed.windowAprs[w];
              return a.kind === "value" ? a.apr : null;
            });
            const slowLoaded = slowDataLoadedFor.has(identity.address);

            return (
              <tr key={identity.address}>
                <td>
                  <div className="asset-cell">
                    <div className="asset-line1">
                      <a className="explorer-link asset-symbol" href={explorerAddressUrl(identity.rwaToken.address)} target="_blank" rel="noopener noreferrer">
                        {identity.rwaToken.symbol}
                      </a>
                      {identity.rwaToken.warning && (
                        <span className="warnings-icon" title={identity.rwaToken.warning}>
                          ⚠
                        </span>
                      )}
                      <span className="counter-symbol">/ {identity.counterToken.symbol}</span>
                    </div>
                    <div className="asset-line2">
                      <span className="version-pill">{identity.version}</span>
                      <HookBadges
                        badges={hookBadges}
                        hookAddress={tickState.kind === "concentrated" ? tickState.hookAddress : null}
                      />
                      <CopyableAddress value={identity.address} />
                    </div>
                  </div>
                </td>
                <td>
                  {feePpm !== null ? formatFeePpm(feePpm) : "—"}
                  {isDynamicFee && (
                    <span className="badge badge-dynamic-fee" style={{ marginLeft: 4 }} title="Live fee — this pool uses a dynamic-fee hook, so the rate can change block to block.">
                      dynamic
                    </span>
                  )}
                </td>
                <td className="num" title="GeckoTerminal total reserves — NOT the active-liquidity denominator used for APR">
                  {formatUsdCompact(fast?.reserveInUsdTotal)}
                </td>
                <td
                  className="num"
                  title={
                    tickState.kind === "concentrated"
                      ? "Approximate dollar value of the pool's active liquidity, at the range width you've currently selected — narrower ranges show a smaller figure for the same underlying liquidity, since a dollar goes further in a tighter range."
                      : undefined
                  }
                >
                  {formatUsdCompact(computed.activeLiquidityUsd)}
                  {computed.userShareOfLiquidity !== null && (
                    <div style={{ color: "var(--text-faint)", fontSize: 10.5 }}>
                      your share ≈ {formatPercent(computed.userShareOfLiquidity, 3)}
                    </div>
                  )}
                </td>
                <td className="num">{formatUsdCompact(fast?.volume24hUsd)}</td>
                {WINDOW_KEYS.map((w) => (
                  <td key={w} className="num">
                    <AprWindowCell
                      apr={computed.windowAprs[w]}
                      volumeUsd={row.slow?.windowVolumeUsd[w]}
                      loaded={slowLoaded}
                      unavailableReason={computed.unavailableReason}
                    />
                  </td>
                ))}
                <td>
                  {!slowLoaded ? (
                    <span className="na">loading…</span>
                  ) : (
                    <Sparkline values={sparklineValues} />
                  )}
                </td>
                <td className="num">
                  {computed.momentum !== null ? (
                    <span className={`momentum ${momentumClass(computed.momentum)}`}>{computed.momentum.toFixed(2)}×</span>
                  ) : (
                    <span className="na">—</span>
                  )}
                </td>
                <td>
                  {computed.suggestedRangePercent !== null ? (
                    <>
                      ±{computed.suggestedRangePercent.toFixed(1)}% / 24h (1σ)
                      {computed.rangeTighterThanSuggested && (
                        <span className="range-warning" title="Your chosen range is materially tighter than the pool's realized 24h volatility — it's likely to exit range fast, making the displayed APR optimistic.">
                          ⚠ tight
                        </span>
                      )}
                    </>
                  ) : tickState.kind === "full-range" ? (
                    <span className="na">n/a (full range)</span>
                  ) : (
                    <span className="na">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
