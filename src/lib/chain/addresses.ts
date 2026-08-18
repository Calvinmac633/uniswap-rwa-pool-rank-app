// Every address here was checked against a live source before being hardcoded —
// see the comment on each. None of this is secret; it's all public contract
// addresses on Robinhood Chain (chain id 4663).
//
// `getAddress()` both validates the string (throws at startup on a typo) and
// normalizes it to its EIP-55 checksum casing.
import { getAddress } from "viem";

// Confirmed live: eth_chainId against https://rpc.mainnet.chain.robinhood.com
// returned 0x1237 == 4663 (checked 2026-08-18).
export const ROBINHOOD_CHAIN_ID = 4663;

export const ROBINHOOD_RPC_URL =
  process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export const ROBINHOOD_EXPLORER_URL = "https://robinhoodchain.blockscout.com";

// Uniswap v4 core contracts, chain 4663 — cross-checked against Uniswap's own
// https://developers.uniswap.org/deployments.json (matched byte-for-byte,
// checksum casing aside) AND confirmed to have live bytecode via eth_getCode.
export const POOL_MANAGER = getAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951");
export const STATE_VIEW = getAddress("0xF3334192D15450CdD385c8B70e03f9A6bD9E673b");
export const POSITION_MANAGER_V4 = getAddress("0x58daec3116aae6D93017bAAea7749052E8a04fA7");
export const V4_QUOTER = getAddress("0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94");
export const RESERVES_LENS = getAddress("0x0000001b173C3bbF3984D417d8614E3eed34865B");

// NOT in deployments.json for this chain (that file only lists v4 "labs-supported"
// contracts here) — but both confirmed to have live bytecode via eth_getCode, and
// GeckoTerminal independently reports real, actively-traded pools through them
// (dex slugs uniswap-v2-robinhood / uniswap-v3-robinhood both returned live pools
// with real volume when checked 2026-08-18). We never call these directly for pool
// discovery (GeckoTerminal gives us pool addresses directly), so their exact
// factory addresses are not actually needed anywhere in this app.
export const UNIVERSAL_ROUTER = getAddress("0x8876789976decbfcbbbe364623c63652db8c0904");

// Deterministic cross-chain deployment (same address on virtually every EVM chain);
// confirmed to have live bytecode on Robinhood Chain via eth_getCode.
export const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");

// Confirmed via docs.robinhood.com/chain/contracts AND eth_getCode.
export const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
export const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");

// GeckoTerminal network slug. NOT "robinhood-chain" as one might guess — confirmed
// by direct call to /networks/robinhood/dexes (200 OK with real DEX data), even
// though this slug curiously doesn't appear in the generic paginated /networks
// listing. Trust the direct endpoint over the listing.
export const GECKO_NETWORK = "robinhood";

// Confirmed via GET /networks/robinhood/dexes (2026-08-18) — GeckoTerminal returned
// 32 DEX entries total on this chain; these are the three that are actually Uniswap.
// Do not guess these strings; re-verify against that endpoint if pools stop showing up.
export const GECKO_DEX_SLUGS = {
  v2: "uniswap-v2-robinhood",
  v3: "uniswap-v3-robinhood",
  v4: "uniswap-v4-robinhood",
} as const;

export type UniswapVersion = keyof typeof GECKO_DEX_SLUGS;
