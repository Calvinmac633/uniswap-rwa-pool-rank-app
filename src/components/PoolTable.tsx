import { ROBINHOOD_EXPLORER_URL } from "@/lib/chain/addresses";
import { formatUsdCompact, formatCompactNumber, formatPercent, formatFeePpm } from "@/lib/format";
import { WINDOW_KEYS, type PoolRow, type WindowApr, type WindowKey } from "@/lib/types";
import type { RowComputation } from "@/lib/clientCompute";
import { Sparkline } from "./Sparkline";
import { HookBadges } from "./HookBadges";
import { CopyableAddress } from "./CopyableAddress";

const SPARKLINE_WINDOWS: WindowKey[] = [...WINDOW_KEYS].reverse(); // long -> short, per Step 6c

export type DisplayRow = { row: PoolRow; computed: RowComputation };

type PoolTableProps = {
  rows: DisplayRow[];
  slowDataLoadedFor: Set<string>;
};

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

export function PoolTable({ rows, slowDataLoadedFor }: PoolTableProps) {
  if (rows.length === 0) {
    return <div className="empty-state">No qualifying RWA pools found yet.</div>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Counter-asset</th>
            <th>Version</th>
            <th>Fee</th>
            <th>Hooks</th>
            <th className="num">Total TVL</th>
            <th className="num">Active liquidity</th>
            <th className="num">Vol 24h</th>
            {WINDOW_KEYS.map((w) => (
              <th key={w} className="num">
                {w}
              </th>
            ))}
            <th title="Trend shape across all windows, long (1mo) to short (1h)">Trend</th>
            <th className="num">Momentum</th>
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
                    <a className="explorer-link asset-symbol" href={explorerAddressUrl(identity.rwaToken.address)} target="_blank" rel="noopener noreferrer">
                      {identity.rwaToken.symbol}
                    </a>
                    {identity.rwaToken.warning && (
                      <span className="warnings-icon" title={identity.rwaToken.warning}>
                        ⚠
                      </span>
                    )}
                    <CopyableAddress value={identity.address} />
                  </div>
                </td>
                <td>{identity.counterToken.symbol}</td>
                <td>
                  <span className="version-pill">{identity.version}</span>
                </td>
                <td>
                  {feePpm !== null ? formatFeePpm(feePpm) : "—"}
                  {isDynamicFee && (
                    <span className="badge badge-dynamic-fee" style={{ marginLeft: 4 }} title="Live fee — this pool uses a dynamic-fee hook, so the rate can change block to block.">
                      dynamic
                    </span>
                  )}
                </td>
                <td>
                  <HookBadges
                    badges={hookBadges}
                    hookAddress={tickState.kind === "concentrated" ? tickState.hookAddress : null}
                  />
                </td>
                <td className="num" title="GeckoTerminal total reserves — NOT the active-liquidity denominator used for APR">
                  {formatUsdCompact(fast?.reserveInUsdTotal)}
                </td>
                <td className="num">
                  {tickState.kind === "concentrated"
                    ? formatCompactNumber(tickState.liquidity)
                    : tickState.kind === "full-range"
                      ? "full range"
                      : "—"}
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
