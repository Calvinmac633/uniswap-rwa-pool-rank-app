const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

export function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return usdCompact.format(value);
}

/** Used for both APR values and plain ratios (e.g. momentum-adjacent shares) — same formula either way. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatFeePpm(ppm: number): string {
  return `${(ppm / 10_000).toFixed(2)}%`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
