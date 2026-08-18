"use client";

import { useState } from "react";
import { shortenAddress } from "@/lib/format";

type CopyableAddressProps = {
  /** The full value copied to the clipboard — a real contract address for v2/v3, a poolId for v4. */
  value: string;
};

// Shows a shortened address/poolId; click copies the full value to the
// clipboard so it can be pasted into a block explorer, GeckoTerminal, etc.
export function CopyableAddress({ value }: CopyableAddressProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be denied (permissions, insecure context) — nothing
      // meaningful to recover into, so just leave the "copied" state off.
    }
  }

  return (
    <button type="button" className="copy-address" onClick={handleCopy} title={copied ? "Copied!" : `Click to copy: ${value}`}>
      {shortenAddress(value)}
      <span className="copy-icon">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
