import type { HookBadge } from "./chain/hooks";

export type UniswapVersion = "v2" | "v3" | "v4";

export type WindowKey = "1h" | "2h" | "4h" | "6h" | "8h" | "12h" | "24h" | "3d" | "1w" | "1mo";
export const WINDOW_KEYS: WindowKey[] = ["1h", "2h", "4h", "6h", "8h", "12h", "24h", "3d", "1w", "1mo"];
export const WINDOW_HOURS: Record<WindowKey, number> = {
  "1h": 1,
  "2h": 2,
  "4h": 4,
  "6h": 6,
  "8h": 8,
  "12h": 12,
  "24h": 24,
  "3d": 72,
  "1w": 168,
  "1mo": 720, // 30 days, matches the ~30 daily candles fetched
};

/** APR for one window, or "n/a" when there isn't enough candle history yet. */
export type WindowApr = { kind: "value"; apr: number } | { kind: "n/a" };

export type RwaTokenInfo = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isin?: string;
  logoUrl?: string;
  warning?: string;
};

export type CounterTokenInfo = {
  address: string;
  symbol: string;
  decimals: number;
};

export type PoolIdentity = {
  /** v2/v3: the pool contract address. v4: the bytes32 poolId. Always lowercase. */
  address: string;
  version: UniswapVersion;
  dexSlug: string;
  rwaToken: RwaTokenInfo;
  counterToken: CounterTokenInfo;
  /** True if rwaToken is token0 in the underlying pool/pair ordering. */
  rwaIsToken0: boolean;
  poolCreatedAt: string | null;
};

/** Live, per-request tick/reserve state — never falls back to a reserves-based estimate. */
export type TickState =
  | {
      kind: "concentrated"; // v3 or v4
      sqrtPriceX96: bigint;
      tick: number;
      liquidity: bigint;
      tickSpacing: number | null; // null until resolved from the v4 Initialize-event index
      // Both in parts per million (divide by 1e6 for a fraction), same unit as
      // v2's feePpm below.
      staticFee: number; // as stored in the pool key / v3 fee()
      liveLpFee: number; // from getSlot0 (v4) or fee() (v3) — the one to actually display
      isDynamicFee: boolean;
      hookAddress: `0x${string}` | null; // v4 only
    }
  | {
      kind: "full-range"; // v2
      reserve0: bigint;
      reserve1: bigint;
      // Same unit as v3/v4's `fee` (parts per million; divide by 1e6 for a
      // fraction — e.g. 3000 == 0.30%), NOT basis points, despite the name
      // resemblance. Constant for every standard v2 pair.
      feePpm: number;
    }
  | { kind: "unavailable"; reason: string };

export type FastMetrics = {
  reserveInUsdTotal: number | null; // GeckoTerminal's total reserves — explicitly NOT the active-liquidity denominator
  volume24hUsd: number | null;
  rwaTokenPriceUsd: number | null;
  counterTokenPriceUsd: number | null;
  lastUpdated: string;
};

export type SlowMetrics = {
  windowVolumeUsd: Partial<Record<WindowKey, number>>; // only windows with enough candle history
  hourlyCandleCount: number;
  dailyCandleCount: number;
  realizedVol24h1Sigma: number | null; // as a fraction, e.g. 0.05 = 5%
  candlesFetchedAt: string;
};

export type PoolRow = {
  identity: PoolIdentity;
  tickState: TickState;
  hookBadges: HookBadge[];
  fast: FastMetrics | null;
  slow: SlowMetrics | null;
  /** Populated client-side once deposit size + range width are known. */
  computed?: {
    windowAprs: Record<WindowKey, WindowApr>;
    momentum: number | null; // APR_6h / APR_24h
    userShareOfLiquidity: number | null;
  };
  warnings: string[];
};

export type DiscoveryMeta = {
  discoveredAt: string;
  rwaTokenCount: number;
  poolCount: number;
  registryError?: string;
  /** Registry-vs-on-chain-probe disagreements — shown per-row (see PoolIdentity.rwaToken.warning), not in a banner. */
  classificationWarnings: string[];
  /** Failed pools/multi or tick-state batches — some rows may be showing stale/partial data. Surfaced as a banner. */
  fetchErrors: string[];
  dexPagesHitSafetyCap: string[]; // dex slugs where pagination stopped at the cap, not an empty page
};
