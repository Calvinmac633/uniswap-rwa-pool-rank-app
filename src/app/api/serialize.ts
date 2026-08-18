// PoolRow contains bigints (liquidity, sqrtPriceX96, reserves), which
// JSON.stringify can't handle. This is the one place that converts them to
// strings for the wire — src/lib/wireTypes.ts has the matching client-side
// shape and the reverse conversion.
import type { PoolRow } from "@/lib/types";
import type { WirePoolRow } from "@/lib/wireTypes";

export function serializePoolRow(row: PoolRow): WirePoolRow {
  const { tickState } = row;

  const wireTickState: WirePoolRow["tickState"] =
    tickState.kind === "concentrated"
      ? { ...tickState, sqrtPriceX96: tickState.sqrtPriceX96.toString(), liquidity: tickState.liquidity.toString() }
      : tickState.kind === "full-range"
        ? { ...tickState, reserve0: tickState.reserve0.toString(), reserve1: tickState.reserve1.toString() }
        : tickState;

  return { ...row, tickState: wireTickState };
}
