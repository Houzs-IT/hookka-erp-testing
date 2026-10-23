import { type ReactNode } from "react";
import { useContainerLayout, useResponsiveLayout } from "../lib/responsive-layout";

type Props = {
  children: ReactNode;
  /**
   * Which area the dock aligns to. `auto` follows the split-view pane the dock
   * is rendered in (list pane / detail pane / the whole content area), so a
   * toast or bar from a screen lands under that screen without the screen
   * working out the split state itself.
   */
  scope?: "content" | "list" | "detail" | "auto";
  /** Gap above the phone's bottom edge, in px, before the safe-area inset (clears the tab bar). */
  phoneBottom?: number;
  /**
   * Gap above a tablet's bottom edge, in px. 0 (default) sits flush, as the
   * action bars do; a floating toast passes its own gap and gets the safe-area
   * inset added.
   */
  tabletBottom?: number;
  zIndex?: number;
};

/** Fixed actions aligned to the phone column or their owning tablet pane. */
export function ResponsiveActionDock({
  children,
  scope = "content",
  phoneBottom = 56,
  tabletBottom = 0,
  zIndex = 30,
}: Props) {
  const layout = useResponsiveLayout();
  const { pane } = useContainerLayout();
  const resolved = scope === "auto" ? (pane === "full" ? "content" : pane) : scope;
  const phone = layout.mode === "phone";
  const split = layout.canSplitDetail;
  const tabletLeft = layout.railWidth + (resolved === "detail" && split ? layout.splitMasterWidth : 0);
  const tabletWidth =
    resolved === "list" && split ? layout.splitMasterWidth : undefined;

  return (
    <div
      data-responsive-action-dock={resolved}
      style={{
        position: "fixed",
        left: phone ? 0 : tabletLeft,
        right: phone || tabletWidth == null ? 0 : "auto",
        width: tabletWidth,
        bottom: phone
          ? `calc(${phoneBottom}px + env(safe-area-inset-bottom))`
          : tabletBottom > 0
            ? `calc(${tabletBottom}px + env(safe-area-inset-bottom))`
            : 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex,
      }}
    >
      {children}
    </div>
  );
}
