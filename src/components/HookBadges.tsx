import { HOOK_BADGE_DISCLAIMER, HOOK_BADGE_LABELS, HOOK_BADGE_TOOLTIPS, type HookBadge } from "@/lib/chain/hooks";
import { ROBINHOOD_EXPLORER_URL } from "@/lib/chain/addresses";

type HookBadgesProps = {
  badges: HookBadge[];
  hookAddress: `0x${string}` | null;
};

// Dynamic-fee is a separate mechanism (lives in the pool's fee field, not the
// hook address) and is rendered in the table's Fee column instead of here.
export function HookBadges({ badges, hookAddress }: HookBadgesProps) {
  return (
    <div title={HOOK_BADGE_DISCLAIMER}>
      {badges.map((badge) => (
        <span key={badge} className={`badge badge-${badge}`} title={HOOK_BADGE_TOOLTIPS[badge]}>
          {HOOK_BADGE_LABELS[badge]}
        </span>
      ))}
      {hookAddress && hookAddress !== "0x0000000000000000000000000000000000000000" && (
        <div>
          <a
            className="explorer-link"
            href={`${ROBINHOOD_EXPLORER_URL}/address/${hookAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10.5 }}
          >
            {hookAddress.slice(0, 6)}…{hookAddress.slice(-4)}
          </a>
        </div>
      )}
    </div>
  );
}
