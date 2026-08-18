import { createPublicClient, http, type Chain } from "viem";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC_URL } from "./addresses";

// Robinhood Chain isn't in viem's built-in chain list, so it's defined here.
// The multicall3 address is the standard deterministic cross-chain deployment —
// confirmed live on this chain via eth_getCode (2026-08-18) before relying on it.
export const robinhoodChain: Chain = {
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ROBINHOOD_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
};

// The public RPC is rate-limited and shared across every user of this app, so we
// keep a single client/module instance rather than creating one per request.
export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(ROBINHOOD_RPC_URL, {
    // A handful of retries with backoff smooths over the RPC's occasional flaky
    // rejections (observed directly on this endpoint — see chain/getLogs.ts).
    retryCount: 3,
    retryDelay: 400,
    timeout: 20_000,
  }),
});
