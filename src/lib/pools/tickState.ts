// Live tick/reserve state reads, multicalled per version. This is the
// concentrated-liquidity-aware alternative to GeckoTerminal's reserve_in_usd
// (which is total reserves, the wrong denominator for fee share — see
// docs/README). If a read fails, the pool gets `{ kind: "unavailable" }" and the
// UI shows a blank APR for it — we never fall back to a reserves-based estimate,
// per the explicit "a wrong number is worse than no number" requirement.
import { getAddress, isAddressEqual, zeroAddress, type Address } from "viem";
import { publicClient } from "../chain/client";
import { STATE_VIEW } from "../chain/addresses";
import { STATE_VIEW_ABI, V2_PAIR_ABI, V3_POOL_ABI } from "../chain/abis";
import { isDynamicFee } from "../chain/hooks";
import type { DiscoveredPool } from "../gecko/discovery";
import type { V4PoolKeyInfo } from "./v4Index";
import type { TickState } from "../types";

// Parts per million (same unit v3/v4 use for `fee`, NOT basis points) — 3000 /
// 1e6 = 0.30%, baked into the standard V2 swap formula (997/1000), not configurable.
const V2_STATIC_FEE_PPM = 3000;

export async function getTickStates(
  pools: DiscoveredPool[],
  v4Index: Map<string, V4PoolKeyInfo>
): Promise<Map<string, TickState>> {
  const results = new Map<string, TickState>();

  const v4Pools = pools.filter((p) => p.version === "v4");
  const v3Pools = pools.filter((p) => p.version === "v3");
  const v2Pools = pools.filter((p) => p.version === "v2");

  await Promise.all([
    readV4(v4Pools, v4Index, results),
    readV3(v3Pools, results),
    readV2(v2Pools, results),
  ]);

  return results;
}

async function readV4(pools: DiscoveredPool[], v4Index: Map<string, V4PoolKeyInfo>, out: Map<string, TickState>) {
  if (pools.length === 0) return;

  const poolIds = pools.map((p) => p.address as `0x${string}`);
  const slot0Results = await publicClient.multicall({
    contracts: poolIds.map((poolId) => ({
      address: STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: "getSlot0",
      args: [poolId],
    } as const)),
  });
  const liquidityResults = await publicClient.multicall({
    contracts: poolIds.map((poolId) => ({
      address: STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: "getLiquidity",
      args: [poolId],
    } as const)),
  });

  pools.forEach((pool, i) => {
    const slot0 = slot0Results[i];
    const liq = liquidityResults[i];
    if (slot0?.status !== "success" || liq?.status !== "success") {
      out.set(pool.address, {
        kind: "unavailable",
        reason: `StateView read failed: ${slot0?.status !== "success" ? slot0?.error : liq?.error}`,
      });
      return;
    }

    const [sqrtPriceX96, tick, , lpFee] = slot0.result;
    const keyInfo = v4Index.get(pool.address);

    out.set(pool.address, {
      kind: "concentrated",
      sqrtPriceX96,
      tick,
      liquidity: liq.result,
      tickSpacing: keyInfo?.tickSpacing ?? null,
      staticFee: keyInfo?.fee ?? lpFee,
      liveLpFee: lpFee,
      isDynamicFee: keyInfo ? isDynamicFee(keyInfo.fee) : false,
      hookAddress: keyInfo?.hooks ?? null,
    });
  });
}

async function readV3(pools: DiscoveredPool[], out: Map<string, TickState>) {
  if (pools.length === 0) return;

  const addresses = pools.map((p) => getAddress(p.address));
  const [slot0Results, liquidityResults, feeResults, tickSpacingResults] = await Promise.all([
    publicClient.multicall({
      contracts: addresses.map((address) => ({ address, abi: V3_POOL_ABI, functionName: "slot0" } as const)),
    }),
    publicClient.multicall({
      contracts: addresses.map((address) => ({ address, abi: V3_POOL_ABI, functionName: "liquidity" } as const)),
    }),
    publicClient.multicall({
      contracts: addresses.map((address) => ({ address, abi: V3_POOL_ABI, functionName: "fee" } as const)),
    }),
    publicClient.multicall({
      contracts: addresses.map((address) => ({ address, abi: V3_POOL_ABI, functionName: "tickSpacing" } as const)),
    }),
  ]);

  pools.forEach((pool, i) => {
    const slot0 = slot0Results[i];
    const liq = liquidityResults[i];
    const fee = feeResults[i];
    const tickSpacing = tickSpacingResults[i];
    if (slot0?.status !== "success" || liq?.status !== "success" || fee?.status !== "success") {
      out.set(pool.address, {
        kind: "unavailable",
        reason: `v3 pool read failed: ${slot0?.status !== "success" ? slot0?.error : liq?.status !== "success" ? liq?.error : fee?.error}`,
      });
      return;
    }

    const [sqrtPriceX96, tick] = slot0.result;
    out.set(pool.address, {
      kind: "concentrated",
      sqrtPriceX96,
      tick,
      liquidity: liq.result,
      tickSpacing: tickSpacing?.status === "success" ? tickSpacing.result : null,
      staticFee: fee.result,
      liveLpFee: fee.result, // v3 fees are static; no dynamic-fee concept
      isDynamicFee: false,
      hookAddress: null,
    });
  });
}

async function readV2(pools: DiscoveredPool[], out: Map<string, TickState>) {
  if (pools.length === 0) return;

  const addresses = pools.map((p) => getAddress(p.address));
  const reserveResults = await publicClient.multicall({
    contracts: addresses.map((address) => ({ address, abi: V2_PAIR_ABI, functionName: "getReserves" } as const)),
  });

  pools.forEach((pool, i) => {
    const reserves = reserveResults[i];
    if (reserves?.status !== "success") {
      out.set(pool.address, { kind: "unavailable", reason: `v2 getReserves failed: ${reserves?.error}` });
      return;
    }

    // Pass the contract's token0/token1 reserves through as-is — do not attempt
    // to reorder into "base/quote" here. Every consumer (liquidity math, price
    // display) instead uses PoolIdentity.rwaIsToken0, which is computed once
    // from a plain address comparison (Uniswap v2/v3/v4 all enforce token0 <
    // token1 by address sort, so that comparison alone is authoritative — no
    // on-chain token0()/token1() call needed). Keeping every version's
    // TickState in raw contract order avoids a whole class of "which side did
    // I just reorder" bugs.
    const [reserve0, reserve1] = reserves.result;
    out.set(pool.address, {
      kind: "full-range",
      reserve0,
      reserve1,
      feePpm: V2_STATIC_FEE_PPM,
    });
  });
}
