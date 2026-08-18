// RWA token classification: reconciles Robinhood's live asset registry against
// an on-chain uiMultiplier() probe (ERC-8056) for every candidate token address
// we've seen in a pool. Neither source is trusted blindly — where they disagree,
// we surface a warning instead of silently picking one (see `warnings` below).
//
// We deliberately never classify by symbol string matching: a memecoin can be
// named "TSLA" trivially, and GeckoTerminal pool data on this chain already
// shows exactly that kind of thing (e.g. a "CATS" token paired with WETH) — only
// uiMultiplier() success and/or registry membership count as evidence.
import { getAddress, zeroAddress } from "viem";
import { publicClient } from "../chain/client";
import { ERC20_ABI, ERC8056_ABI } from "../chain/abis";
import { getRegistryTokens, type RegistryToken } from "./registry";

export type ClassifiedToken = {
  address: string; // lowercased
  symbol: string;
  name: string;
  decimals: number;
  isRwa: boolean;
  inRegistry: boolean;
  uiMultiplierOk: boolean;
  isin?: string;
  logoUrl?: string;
  /** Set when the registry and the on-chain probe disagree. */
  warning?: string;
};

export type ClassificationResult = {
  tokens: Map<string, ClassifiedToken>;
  registryError?: string;
};

/**
 * Classifies every candidate token address as RWA or not, given:
 *  - `candidates`: token addresses observed in Uniswap pools on this chain
 *    (from GeckoTerminal pool discovery)
 *  - Robinhood's live asset registry (fetched here)
 *
 * Registry tokens that *weren't* in `candidates` (e.g. not yet in any pool) are
 * still probed and included, so a brand-new stock token shows up the moment a
 * pool exists for it, without waiting for a code change.
 */
export async function classifyTokens(candidates: Iterable<string>): Promise<ClassificationResult> {
  const registryResult = await getRegistryTokens();
  const registry = registryResult.ok ? registryResult.tokens : new Map<string, RegistryToken>();

  const candidateSet = new Set<string>();
  for (const addr of candidates) candidateSet.add(addr.toLowerCase());
  for (const addr of registry.keys()) candidateSet.add(addr);
  candidateSet.delete(zeroAddress); // native-ETH placeholder used by GeckoTerminal, not a real token

  const addressList = [...candidateSet].map((a) => getAddress(a));

  const uiMultiplierResults = await publicClient.multicall({
    contracts: addressList.map((address) => ({
      address,
      abi: ERC8056_ABI,
      functionName: "uiMultiplier",
    })),
  });

  const metaResults = await publicClient.multicall({
    contracts: addressList.flatMap((address) => [
      { address, abi: ERC20_ABI, functionName: "symbol" } as const,
      { address, abi: ERC20_ABI, functionName: "name" } as const,
      { address, abi: ERC20_ABI, functionName: "decimals" } as const,
    ]),
  });

  const tokens = new Map<string, ClassifiedToken>();

  addressList.forEach((address, i) => {
    const lower = address.toLowerCase();
    const uiMultiplierOk = uiMultiplierResults[i]?.status === "success";
    const registryEntry = registry.get(lower);
    const inRegistry = registryEntry !== undefined;

    const symbolResult = metaResults[i * 3];
    const nameResult = metaResults[i * 3 + 1];
    const decimalsResult = metaResults[i * 3 + 2];

    const symbol =
      registryEntry?.symbol ??
      (symbolResult?.status === "success" ? (symbolResult.result as string) : lower.slice(0, 8));
    const name =
      registryEntry?.name ??
      (nameResult?.status === "success" ? (nameResult.result as string) : "Unknown token");
    const decimals =
      registryEntry?.decimals ??
      (decimalsResult?.status === "success" ? (decimalsResult.result as number) : 18);

    let warning: string | undefined;
    if (inRegistry && registryEntry!.active && !uiMultiplierOk) {
      warning = `${symbol} is listed in Robinhood's asset registry for this chain, but uiMultiplier() reverted on-chain — registry may be stale, or this address may be wrong. Treating as NOT an RWA token.`;
    } else if (!inRegistry && uiMultiplierOk) {
      warning = `${symbol} implements uiMultiplier() on-chain but is not (yet) in Robinhood's public asset registry. Treating as an RWA token, but verify manually before trusting this row.`;
    } else if (inRegistry && !registryEntry!.active && uiMultiplierOk) {
      warning = `${symbol} implements uiMultiplier() on-chain but Robinhood's registry marks it as inactive/delisted.`;
    }

    // Registry membership requires an *active* entry; the on-chain probe is the
    // deciding vote either way, per the prompt's own discovery mechanism.
    const isRwa = uiMultiplierOk;

    tokens.set(lower, {
      address: lower,
      symbol,
      name,
      decimals,
      isRwa,
      inRegistry,
      uiMultiplierOk,
      isin: registryEntry?.isin,
      logoUrl: registryEntry?.logoUrl,
      warning,
    });
  });

  return { tokens, registryError: registryResult.ok ? undefined : registryResult.error };
}
