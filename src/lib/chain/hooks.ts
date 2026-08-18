// Uniswap v4 hook permission decoding — delegates the actual bit-decoding to
// @uniswap/v4-sdk's own Hook.permissions() rather than hand-rolling the bit
// math, so this stays correct automatically if Uniswap ever changes the flag
// layout. Cross-checked on 2026-08-18: the SDK's internal hookFlagIndex and
// DYNAMIC_FEE_FLAG both matched a direct read of the live Hooks.sol /
// LPFeeLibrary.sol source in @uniswap/v4-core before this was written.
import { Hook, DYNAMIC_FEE_FLAG as SDK_DYNAMIC_FEE_FLAG } from "@uniswap/v4-sdk";
import { zeroAddress } from "viem";

export const DYNAMIC_FEE_FLAG = SDK_DYNAMIC_FEE_FLAG;
export function isDynamicFee(staticFee: number): boolean {
  return staticFee === DYNAMIC_FEE_FLAG;
}

export type HookPermissions = ReturnType<typeof Hook.permissions>;

export type HookBadge =
  | "takes-swap-cut"
  | "charges-on-deposit"
  | "charges-on-exit"
  | "custom-logic"
  | "none";

export type DecodedHookPermissions = {
  address: `0x${string}`;
  hasHook: boolean;
  badges: HookBadge[];
  raw: HookPermissions;
};

export function decodeHookPermissions(hookAddress: `0x${string}`): DecodedHookPermissions {
  const hasHook = hookAddress.toLowerCase() !== zeroAddress;
  const raw = Hook.permissions(hookAddress);

  if (!hasHook) {
    return { address: hookAddress, hasHook, badges: ["none"], raw };
  }

  const badges: HookBadge[] = [];

  // Delta-returning flags first — these are the ones that let a hook take value
  // out of flow before it reaches LPs, so they matter most to an LP evaluating
  // this pool.
  if (raw.beforeSwapReturnsDelta || raw.afterSwapReturnsDelta) {
    badges.push("takes-swap-cut");
  }
  if (raw.afterAddLiquidityReturnsDelta) {
    badges.push("charges-on-deposit");
  }
  if (raw.afterRemoveLiquidityReturnsDelta) {
    badges.push("charges-on-exit");
  }

  // Any other callback (swap/liquidity/donate/initialize hooks that don't
  // return a delta) still means "behavior modified" even though it can't
  // directly skim value in the same way.
  const hasNonDeltaCallback =
    raw.beforeInitialize ||
    raw.afterInitialize ||
    raw.beforeAddLiquidity ||
    raw.beforeRemoveLiquidity ||
    raw.beforeSwap ||
    raw.afterSwap ||
    raw.beforeDonate ||
    raw.afterDonate;
  if (hasNonDeltaCallback && badges.length === 0) {
    badges.push("custom-logic");
  }

  if (badges.length === 0) {
    // Non-zero address but somehow no recognized flags set — shouldn't happen
    // for a real v4 hook, but don't silently call it "none" if it isn't.
    badges.push("custom-logic");
  }

  return { address: hookAddress, hasHook, badges, raw };
}

export const HOOK_BADGE_LABELS: Record<HookBadge, string> = {
  "takes-swap-cut": "takes swap cut",
  "charges-on-deposit": "charges on deposit",
  "charges-on-exit": "charges on exit",
  "custom-logic": "custom logic",
  none: "none",
};

export const HOOK_BADGE_TOOLTIPS: Record<HookBadge, string> = {
  "takes-swap-cut": "This hook can intercept swap flow and take a cut before LPs are paid.",
  "charges-on-deposit": "This hook can charge you when you enter this position.",
  "charges-on-exit": "This hook can charge you when you leave this position.",
  "custom-logic": "This hook modifies pool behavior but cannot directly redirect value via a returned delta.",
  none: "Standard pool with no hook attached.",
};

export const HOOK_BADGE_DISCLAIMER =
  "Badges show what a hook CAN do based on its permission bits, not what it actually does. " +
  "Unusual hooks warrant manual review of the hook contract before depositing.";
