// Shapes matching GeckoTerminal's actual JSON, confirmed by live calls against
// the `robinhood` network on 2026-08-18 (not assumed from generic API docs,
// which were largely unreachable/JS-rendered at the time of writing).
export type GeckoVolumeWindows = { m5: string; m15: string; m30: string; h1: string; h6: string; h24: string };

export type GeckoPoolAttributes = {
  address: string;
  name: string;
  pool_created_at: string | null;
  reserve_in_usd: string | null;
  volume_usd: GeckoVolumeWindows;
  base_token_price_usd: string | null;
  quote_token_price_usd: string | null;
};

export type GeckoPoolRelationships = {
  base_token: { data: { id: string; type: "token" } };
  quote_token: { data: { id: string; type: "token" } };
  dex: { data: { id: string; type: "dex" } };
};

export type GeckoPoolEntry = {
  id: string;
  type: "pool";
  attributes: GeckoPoolAttributes;
  relationships: GeckoPoolRelationships;
};

export type GeckoOhlcvResponse = {
  data: {
    attributes: {
      // [unix_timestamp_seconds, open, high, low, close, volume]
      ohlcv_list: [number, number, number, number, number, number][];
    };
  };
};

/** Strips GeckoTerminal's "<network>_0x..." token/pool id prefix down to the raw address. */
export function stripNetworkPrefix(id: string): string {
  const idx = id.indexOf("_0x");
  return idx === -1 ? id : id.slice(idx + 1);
}
