// MenuButton — the flat hamburger that opens the phone NavDrawer.
//
// Flat icon, no box (owner 2026-10-12 design). Renders only in phone mode,
// inside the NavDrawerProvider; on tablets the LeftRail is the navigation, so
// the button is absent and headers look exactly as before.
import { Menu } from "lucide-react";
import { M } from "../theme";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { NAV_DRAWER_ID, useNavDrawer } from "../lib/nav-drawer";

export function MenuButton({ edge = -10 }: { edge?: number }) {
  const { mode } = useResponsiveLayout();
  const drawer = useNavDrawer();
  if (mode !== "phone" || !drawer) return null;
  return (
    <button
      type="button"
      onClick={drawer.open}
      aria-label="Open menu"
      aria-haspopup="dialog"
      aria-expanded={drawer.isOpen}
      aria-controls={NAV_DRAWER_ID}
      style={{
        width: 44,
        height: 44,
        // Pull the 44px target out to the gutter so the 24px glyph lines up
        // with the content edge.
        marginLeft: edge,
        background: "none",
        border: "none",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        cursor: "pointer",
        color: M.raisin,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Menu size={24} strokeWidth={1.9} />
    </button>
  );
}
