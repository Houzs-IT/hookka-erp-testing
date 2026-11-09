// ---------------------------------------------------------------------------
// dropdown-placement.ts — open a dropdown upward when there is no room below,
// and never let it run off the screen.
//
// A picker near the bottom of the viewport (the last line of a sales order,
// a field at the foot of a dialog) used to open its menu straight down, off
// the screen: the options were there but unreachable without scrolling the
// page, which on a modal is often impossible. Every shared dropdown
// (SearchableSelect, MaterialPicker) now asks this helper which side to open
// on and how tall it may be.
//
// Rule: open BELOW if the menu fits there, or if below still has at least as
// much room as above; otherwise open ABOVE. The height is capped at 60% of
// the viewport and at the room on the chosen side, with a small floor so the
// menu is never a sliver.
// ---------------------------------------------------------------------------
import * as React from "react";

export type DropdownSide = "below" | "above";

export interface DropdownPlacement {
  side: DropdownSide;
  /** Max height in px the menu may take on that side. */
  maxHeight: number;
}

/** Gap between the trigger and the menu (Tailwind mt-1 / mb-1). */
export const DROPDOWN_GAP = 4;
/** Breathing room kept between the menu and the viewport edge. */
export const DROPDOWN_VIEWPORT_MARGIN = 8;
/** Never shrink a menu below this — a 30px list is worse than a scroll. */
export const DROPDOWN_MIN_HEIGHT = 120;
/** Hard cap as a share of the viewport height. */
export const DROPDOWN_MAX_VH = 0.6;

/** Pure — exported for the regression test. */
export function computeDropdownPlacement(
  anchor: { top: number; bottom: number },
  viewportHeight: number,
  desiredHeight: number,
): DropdownPlacement {
  const cap = Math.max(
    DROPDOWN_MIN_HEIGHT,
    Math.min(desiredHeight, Math.floor(viewportHeight * DROPDOWN_MAX_VH)),
  );
  const below = viewportHeight - anchor.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN;
  const above = anchor.top - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN;
  const side: DropdownSide = below >= cap || below >= above ? "below" : "above";
  const room = side === "below" ? below : above;
  return { side, maxHeight: Math.max(DROPDOWN_MIN_HEIGHT, Math.min(cap, room)) };
}

/**
 * Track the placement of a dropdown anchored to `anchorRef` while `open`.
 * Re-measures on scroll (any scroller) and resize, so a menu opened in a
 * scrolled modal follows its trigger.
 */
export function useDropdownPlacement(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  desiredHeight: number,
): DropdownPlacement {
  const [placement, setPlacement] = React.useState<DropdownPlacement>({
    side: "below",
    maxHeight: desiredHeight,
  });

  React.useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const next = computeDropdownPlacement(
        el.getBoundingClientRect(),
        window.innerHeight,
        desiredHeight,
      );
      setPlacement((prev) =>
        prev.side === next.side && prev.maxHeight === next.maxHeight ? prev : next,
      );
    };
    // Measured before paint on open, so no frame shows the menu on the
    // wrong side; the listeners keep it right while the page moves.
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef, open, desiredHeight]);

  return placement;
}
