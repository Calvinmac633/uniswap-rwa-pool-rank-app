// Robinhood's own asset registry API. This is the same live, authoritative
// source that powers docs.robinhood.com/chain/contracts (that page renders its
// token table client-side from this data, which is why it can't be scraped as
// static HTML — confirmed 2026-08-18, the page literally shows "Loading
// tokens…" to a non-JS fetch).
//
// This is a *better* discovery source than deriving candidates purely from
// GeckoTerminal pool listings and probing them: it's Robinhood's own record of
// which tokens are real Stock Tokens on which chain, kept current without us
// maintaining a hardcoded allowlist. We still cross-check every result against
// the on-chain uiMultiplier() probe in classify.ts — if this registry and the
// chain ever disagree, the UI surfaces that instead of silently picking one.
import { ROBINHOOD_CHAIN_ID } from "../chain/addresses";

const ASSETS_API_URL = "https://api.robinhood.com/rhj/assets";

type RawAsset = {
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  status: string;
  isin?: string;
  logoUrl?: string;
  deployments: Array<{ contractAddress: string; chainId: number }>;
};

type RawAssetsResponse = { assets: RawAsset[] };

export type RegistryToken = {
  address: string; // lowercased
  symbol: string;
  name: string;
  decimals: number;
  isin?: string;
  logoUrl?: string;
  active: boolean;
};

let cache: { tokens: Map<string, RegistryToken>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // matches the sibling app's precedent for this same API

export type RegistryFetchResult =
  | { ok: true; tokens: Map<string, RegistryToken> }
  | { ok: false; error: string };

async function fetchRegistry(): Promise<RegistryFetchResult> {
  let res: Response;
  try {
    res = await fetch(ASSETS_API_URL, { cache: "no-store" });
  } catch (err) {
    return { ok: false, error: `Robinhood assets API unreachable: ${(err as Error).message}` };
  }
  if (!res.ok) {
    return { ok: false, error: `Robinhood assets API returned HTTP ${res.status}` };
  }

  const data = (await res.json()) as RawAssetsResponse;
  const tokens = new Map<string, RegistryToken>();

  for (const asset of data.assets) {
    for (const deployment of asset.deployments) {
      if (deployment.chainId !== ROBINHOOD_CHAIN_ID) continue;
      const address = deployment.contractAddress.toLowerCase();
      tokens.set(address, {
        address,
        symbol: asset.tokenSymbol,
        name: asset.tokenName,
        decimals: asset.tokenDecimals,
        isin: asset.isin,
        logoUrl: asset.logoUrl,
        active: asset.status === "ASSET_STATUS_ACTIVE",
      });
    }
  }

  return { ok: true, tokens };
}

/** Fetches (with a short cache) every Robinhood Stock Token/ETF address on chain 4663. */
export async function getRegistryTokens(): Promise<RegistryFetchResult> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, tokens: cache.tokens };
  }

  const result = await fetchRegistry();
  if (result.ok) {
    cache = { tokens: result.tokens, fetchedAt: Date.now() };
  }
  return result;
}
