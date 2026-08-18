// Fast-tier metrics refresh: given pool addresses we already know about (from a
// cached discovery pass — see discovery.ts), re-fetch just their current
// TVL/volume/price in batches of 30. Confirmed empirically (2026-08-18) that
// this endpoint accepts a comma-joined list mixing v3 addresses and v4 poolIds
// in the same call.
import { GECKO_NETWORK } from "../chain/addresses";
import { geckoGet } from "./client";
import type { GeckoPoolEntry } from "./types";

const BATCH_SIZE = 30;

export type PoolMetrics = {
  reserveInUsd: number | null;
  volume24hUsd: number | null;
  basePriceUsd: number | null;
  quotePriceUsd: number | null;
};

export type MultiMetricsResult = {
  metrics: Map<string, PoolMetrics>; // keyed by lowercased pool address/poolId
  errors: string[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function fetchPoolMetrics(poolAddresses: string[]): Promise<MultiMetricsResult> {
  const metrics = new Map<string, PoolMetrics>();
  const errors: string[] = [];

  const batches = chunk([...new Set(poolAddresses)], BATCH_SIZE);
  for (const batch of batches) {
    const result = await geckoGet<{ data: GeckoPoolEntry[] }>(
      `/networks/${GECKO_NETWORK}/pools/multi/${batch.join(",")}`
    );
    if (!result.ok) {
      errors.push(`pools/multi batch of ${batch.length}: ${result.error}`);
      continue;
    }
    for (const entry of result.data.data) {
      const address = entry.attributes.address.toLowerCase();
      metrics.set(address, {
        reserveInUsd: entry.attributes.reserve_in_usd !== null ? Number(entry.attributes.reserve_in_usd) : null,
        volume24hUsd: entry.attributes.volume_usd?.h24 !== undefined ? Number(entry.attributes.volume_usd.h24) : null,
        basePriceUsd: entry.attributes.base_token_price_usd !== null ? Number(entry.attributes.base_token_price_usd) : null,
        quotePriceUsd: entry.attributes.quote_token_price_usd !== null ? Number(entry.attributes.quote_token_price_usd) : null,
      });
    }
  }

  return { metrics, errors };
}
