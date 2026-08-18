// Client-side (JSON-safe) mirror of the server-side types in types.ts — bigints
// become strings on the wire. See src/app/api/serialize.ts for the conversion.
import type { PoolRow, TickState } from "./types";

type WireTickState =
  | (Extract<TickState, { kind: "concentrated" }> extends infer T
      ? T extends { sqrtPriceX96: bigint; liquidity: bigint }
        ? Omit<T, "sqrtPriceX96" | "liquidity"> & { sqrtPriceX96: string; liquidity: string }
        : never
      : never)
  | (Extract<TickState, { kind: "full-range" }> extends infer T
      ? T extends { reserve0: bigint; reserve1: bigint }
        ? Omit<T, "reserve0" | "reserve1"> & { reserve0: string; reserve1: string }
        : never
      : never)
  | Extract<TickState, { kind: "unavailable" }>;

export type WirePoolRow = Omit<PoolRow, "tickState"> & { tickState: WireTickState };

/** Reconstructs real bigints from a WirePoolRow fetched from /api/pools. */
export function deserializePoolRow(row: WirePoolRow): PoolRow {
  const { tickState } = row;

  if (tickState.kind === "concentrated") {
    return {
      ...row,
      tickState: { ...tickState, sqrtPriceX96: BigInt(tickState.sqrtPriceX96), liquidity: BigInt(tickState.liquidity) },
    };
  }
  if (tickState.kind === "full-range") {
    return {
      ...row,
      tickState: { ...tickState, reserve0: BigInt(tickState.reserve0), reserve1: BigInt(tickState.reserve1) },
    };
  }
  return { ...row, tickState };
}
