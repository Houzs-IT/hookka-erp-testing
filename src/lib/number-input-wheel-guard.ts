// ---------------------------------------------------------------------------
// number-input-wheel-guard.ts — stop the mouse wheel from silently changing a
// focused <input type="number">.
//
// A browser steps a FOCUSED number input up/down on every wheel tick while the
// pointer is over it. An operator who types "12" into a qty cell and then
// scrolls the page with the cursor still on the cell saves 9 or 15 without
// noticing. There are 300+ number inputs across the pages, most of them raw
// <input>s, so a per-component onWheel would miss most of them; this one
// document-level listener covers every one, present and future.
//
// The fix is the standard one: blur the input as the wheel starts. The page
// scrolls as the user intended and the value is untouched. Blurring also
// commits a MoneyInput draft, exactly as clicking elsewhere would.
// ---------------------------------------------------------------------------

/** Pure decision, exported for the regression test. */
export function shouldBlurOnWheel(
  target: { tagName?: string; type?: string } | null,
  active: unknown,
): boolean {
  if (!target || target !== active) return false;
  return String(target.tagName).toUpperCase() === "INPUT" && String(target.type).toLowerCase() === "number";
}

let installed = false;

export function installNumberInputWheelGuard(doc: Document = document): void {
  if (installed) return;
  installed = true;
  doc.addEventListener(
    "wheel",
    (e) => {
      const t = e.target as HTMLInputElement | null;
      if (shouldBlurOnWheel(t, doc.activeElement)) t?.blur();
    },
    // Passive: we never preventDefault — the page must still scroll.
    { passive: true, capture: true },
  );
}
