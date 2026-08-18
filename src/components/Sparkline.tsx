// Renders APR shape across windows, long -> short (left to right), per Step 6c:
// "shape communicates this instantly; a single ratio does not." Gaps (n/a
// windows, e.g. a pool younger than the window) are skipped rather than
// interpolated or drawn as zero.
type SparklineProps = {
  values: (number | null)[];
  width?: number;
  height?: number;
};

export function Sparkline({ values, width = 90, height = 22 }: SparklineProps) {
  const validValues = values.filter((v): v is number => v !== null);
  if (validValues.length < 2) {
    return <span className="na">—</span>;
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const range = max - min || Math.abs(max) || 1;
  const pad = 2;
  const innerHeight = height - pad * 2;
  const step = width / (values.length - 1);

  // Break into contiguous runs so a gap (n/a window) doesn't draw a
  // misleading straight line across missing data.
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    const y = pad + innerHeight - ((v - min) / range) * innerHeight;
    current.push({ x: i * step, y });
  });
  if (current.length > 0) runs.push(current);

  const trendingUp = validValues[validValues.length - 1]! > validValues[0]!;
  const stroke = trendingUp ? "var(--green)" : "var(--red)";

  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {runs.map((run, i) => (
        <polyline
          key={i}
          points={run.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
