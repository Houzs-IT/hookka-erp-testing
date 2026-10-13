// MobileHeader — sticky top bar for every /m screen (Home included on phones).
// Optional back button (taupe) + title; centered to the content width.
// `menu` (top-level screens: module lists, /m/more): on phones the leading
// slot is the flat hamburger that opens the NavDrawer, replacing the back
// button. Tablets ignore `menu` and keep the back button exactly as before.
//
// Phone geometry (owner 2026-10-13, global header consistency): a fixed 52px
// row + the top safe-area inset, 12px side padding, and ONE 44×44 leading slot
// shared by the hamburger and the back arrow (both 20px glyphs), so the title
// never shifts when you move between a list and its detail. Tablet styling is
// unchanged.
import { ChevronLeft } from "lucide-react";
import { type ReactNode } from "react";
import { M, M_MAX_WIDTH } from "../theme";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { useNavDrawer } from "../lib/nav-drawer";
import { MOBILE_HEADER_ROW } from "../lib/header-geometry";
import { MenuButton } from "./MenuButton";

type Props = {
  title: string;
  onBack?: () => void;
  /** Optional trailing action (e.g. a + button). */
  trailing?: ReactNode;
  /** Top-level screen: show the drawer hamburger on phones. */
  menu?: boolean;
};

export function MobileHeader({ title, onBack: onBackProp, trailing, menu = false }: Props) {
  const { mode } = useResponsiveLayout();
  const drawer = useNavDrawer();
  const phone = mode === "phone";
  const showMenu = menu && mode === "phone" && drawer !== null;
  const onBack = showMenu ? undefined : onBackProp;
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        justifyContent: "center",
        backgroundColor: M.paper,
        borderBottom: `1px solid ${M.border}`,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: phone ? M_MAX_WIDTH : "none",
          display: "flex",
          alignItems: "center",
          gap: phone ? 4 : 6,
          ...(phone ? { height: MOBILE_HEADER_ROW } : { minHeight: MOBILE_HEADER_ROW }),
          padding: "0 12px",
          boxSizing: "border-box",
        }}
      >
        {showMenu ? <MenuButton /> : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            style={
              phone
                ? {
                    // Same 44×44 slot + -10 pull as MenuButton.
                    width: 44,
                    height: 44,
                    marginLeft: -10,
                    background: "none",
                    border: "none",
                    padding: 0,
                    flex: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: M.taupe,
                    WebkitTapHighlightColor: "transparent",
                  }
                : {
                    background: "none",
                    border: "none",
                    padding: 6,
                    marginLeft: -6,
                    cursor: "pointer",
                    display: "flex",
                    color: M.taupe,
                  }
            }
          >
            {/* Phones: 20px, matching the hamburger glyph. Tablets keep 24. */}
            <ChevronLeft size={phone ? 20 : 24} strokeWidth={2} />
          </button>
        ) : null}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 18,
            fontWeight: 700,
            color: M.raisin,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            ...(phone ? { lineHeight: "24px" } : null),
          }}
        >
          {title}
        </div>
        {trailing ? (
          <div
            style={
              phone
                ? { flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }
                : { flexShrink: 0 }
            }
          >
            {trailing}
          </div>
        ) : null}
      </div>
    </div>
  );
}
