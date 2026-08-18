// Required disclosure (Step 7) — kept visible on every load, not behind a
// dismiss/collapse control, per "visible not buried."
export function Disclosure() {
  return (
    <div className="disclosure">
      <strong>Estimated APR assumes the position stays in range for the full period and excludes impermanent loss.</strong>{" "}
      Historical windows apply past volume to today&apos;s liquidity. These are equities trading 24/7 against a market
      that closes — weekend and overnight gaps can move price through a tight range while you sleep, leaving the
      position fully converted to the losing side. Realized returns will be lower than displayed, often substantially.
    </div>
  );
}
