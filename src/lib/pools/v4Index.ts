// Resolves v4 PoolKey info (hooks + tickSpacing, mainly) for specific poolIds
// by querying the PoolManager's Initialize event log — the only on-chain
// source for those fields; StateView exposes live price/liquidity/fee by
// poolId, but not the immutable PoolKey fields.
//
// IMPORTANT: this deliberately does NOT scan "every Initialize event on the
// chain". PoolManager is a shared, permissionless singleton — ANY project can
// call initialize() on it, not just Uniswap's own frontend/hooks, and this
// chain has heavy pool-creation activity from many sources. A blind full-chain
// scan (the original approach here) pulled back **402,296** Initialize events
// and took 5+ minutes — of which we only ever needed the ~200 poolIds that
// GeckoTerminal's `uniswap-v4-robinhood` listing already identified as ours.
// Instead, this filters the log query by the exact poolIds requested, via the
// event's indexed `id` topic (an RPC-side OR-filter) — the result set is then
// bounded by how many pools we're asking about, not how many exist globally.
//
// GeckoTerminal's v4 pool "address" field is already the raw bytes32 poolId on
// this chain (confirmed empirically 2026-08-18: it's a 64-hex-char value, and a
// sample pool's id matched a known WETH/USDG v4 pool one-for-one) — so unlike
// the concern raised in the original build spec, no separate matching-by-token-
// pair step is needed to connect a GeckoTerminal pool to this index; poolId is
// the shared key.
import { POOL_MANAGER } from "../chain/addresses";
import { publicClient } from "../chain/client";
import { getLogsChunked } from "../chain/getLogsChunked";
import { POOL_MANAGER_INITIALIZE_EVENT } from "../chain/abis";

export type V4PoolKeyInfo = {
  poolId: string; // lowercase, 0x-prefixed
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

// A poolId's Initialize event is immutable once it happens, so resolved
// entries are cached forever (no TTL) — only genuinely new poolIds ever need
// a fresh query.
const cache = new Map<string, V4PoolKeyInfo>();

const BATCH_SIZE = 50; // conservative cap on the indexed-topic OR-filter array size per call

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Resolves PoolKey info (hooks, tickSpacing, initial fee) for exactly the given v4 poolIds. */
export async function resolveV4PoolKeys(poolIds: string[]): Promise<Map<string, V4PoolKeyInfo>> {
  const result = new Map<string, V4PoolKeyInfo>();
  const missing: `0x${string}`[] = [];

  for (const id of poolIds) {
    const lower = id.toLowerCase();
    const cached = cache.get(lower);
    if (cached) {
      result.set(lower, cached);
    } else {
      missing.push(lower as `0x${string}`);
    }
  }
  if (missing.length === 0) return result;

  const latestBlock = await publicClient.getBlockNumber();

  for (const batch of chunk(missing, BATCH_SIZE)) {
    const logs = await getLogsChunked({
      address: POOL_MANAGER,
      event: POOL_MANAGER_INITIALIZE_EVENT,
      args: { id: batch },
      fromBlock: 0n,
      toBlock: latestBlock,
    });

    for (const log of logs) {
      const { id, currency0, currency1, fee, tickSpacing, hooks } = log.args;
      if (!id || !currency0 || !currency1 || fee === undefined || tickSpacing === undefined || !hooks) continue;
      const entry: V4PoolKeyInfo = {
        poolId: id.toLowerCase(),
        currency0: currency0.toLowerCase(),
        currency1: currency1.toLowerCase(),
        fee,
        tickSpacing,
        hooks,
      };
      cache.set(entry.poolId, entry);
      result.set(entry.poolId, entry);
    }
  }

  return result;
}
