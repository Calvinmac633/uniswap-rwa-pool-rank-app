type ControlsProps = {
  depositUsd: number;
  onDepositUsdChange: (v: number) => void;
  rangeWidthPercent: number;
  onRangeWidthPercentChange: (v: number) => void;
  momentumFloor: number;
  onMomentumFloorChange: (v: number) => void;
  onRefresh: () => void;
  onRescan: () => void;
  refreshing: boolean;
  lastUpdated: string | null;
};

export function Controls({
  depositUsd,
  onDepositUsdChange,
  rangeWidthPercent,
  onRangeWidthPercentChange,
  momentumFloor,
  onMomentumFloorChange,
  onRefresh,
  onRescan,
  refreshing,
  lastUpdated,
}: ControlsProps) {
  return (
    <div className="controls">
      <div className="control">
        <label htmlFor="deposit">Deposit size (USD)</label>
        <input
          id="deposit"
          type="number"
          min={0}
          step={100}
          value={depositUsd}
          onChange={(e) => onDepositUsdChange(Number(e.target.value))}
        />
      </div>
      <div className="control">
        <label htmlFor="range">Range width (±%)</label>
        <input
          id="range"
          type="number"
          min={0.01}
          max={99}
          step={0.5}
          value={rangeWidthPercent}
          onChange={(e) => onRangeWidthPercentChange(Number(e.target.value))}
        />
      </div>
      <div className="control">
        <label htmlFor="momentum">Momentum floor (6h/24h)</label>
        <input
          id="momentum"
          type="number"
          min={0}
          step={0.1}
          value={momentumFloor}
          onChange={(e) => onMomentumFloorChange(Number(e.target.value))}
        />
      </div>
      <div className="control-buttons">
        {lastUpdated && <span className="last-updated">updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
        <button onClick={onRescan} disabled={refreshing} title="Re-scan all Uniswap DEX pool listings for new/removed pools (slower)">
          Rescan pools
        </button>
        <button className="primary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
