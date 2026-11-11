// NavDrawer — the phone left drawer (owner 2026-10-12 phone nav shell;
// reskinned 2026-10-16 to the Claude Design Home.dc.html drawer).
//
// 318px panel with a 28px rounded right edge, sliding in from the left over a
// dimmed, blurred backdrop. Pinned at the top: brand row + round close chip,
// the profile card and a module search. Scrolling below: theme toggle and the
// grouped module list (MORE_GROUPS through visibleModuleGroups — the existing
// navGate filter). Pinned at the bottom: Sign out + the desktop-app link.
//
// Visuals follow the design; typography (sizes / weights / text colours)
// follows the existing /m screens (owner 2026-10-16). The design's install
// card is left out (Home shows it) and so is its static footer label: the
// desktop-app link takes that slot, since it is the only phone route back to
// desktop. /m/more keeps the ModuleMenu.tsx versions unchanged.
//
// Phone only: MobileLayout mounts it while layout.mode === "phone".
// A11y: role="dialog" + aria-modal, Escape / backdrop / close button close it,
// Tab is trapped inside, focus returns to the opener, body scroll is locked,
// safe-area insets padded, and the closed panel is `inert`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, Moon, Search, Sun, X } from "lucide-react";
import { M } from "../theme";
import { visibleModuleGroups, type ModuleGroup } from "../nav";
import { NAV_DRAWER_ID } from "../lib/nav-drawer";
import { useMobileThemeMode } from "../lib/theme-mode";
import { usePermissions } from "@/lib/use-permission";
import { getCurrentUser } from "@/lib/auth";
import { setPreferDesktop } from "@/lib/prefer-desktop";
import { handleSignOut, initialsOf, prettyRole } from "./module-menu-data";

export const NAV_DRAWER_WIDTH = 318;
const SLIDE_MS = 260;
const SLIDE_EASE = "cubic-bezier(.2,.8,.2,1)";

// Borderless white surfaces lifted by a soft shadow (design).
const CARD_SHADOW = "0 1px 2px rgba(31,29,27,.05), 0 8px 22px -14px rgba(31,29,27,.2)";
const CHIP_SHADOW = "0 1px 2px rgba(31,29,27,.06), 0 6px 16px -8px rgba(31,29,27,.22)";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const ellipsis = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function NavDrawer({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isNavAllowed } = usePermissions();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const reduced = prefersReducedMotion();
  const transition = reduced ? "none" : `transform ${SLIDE_MS}ms ${SLIDE_EASE}`;

  // Every close path inside the drawer goes through here, so the search is
  // cleared in the handler rather than by an effect watching `open`.
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  // Escape, focus trap, focus restore and body scroll lock (same contract as
  // Sheet.tsx).
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (!focusable.length) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = panelRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => {
      (closeRef.current ?? panelRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, close]);

  const groups = visibleModuleGroups(isNavAllowed, query);
  const go = (path: string) => {
    close();
    if (path !== pathname) navigate(path);
  };

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        // Stay visible until the slide-out finishes, then hide.
        transition: open || reduced
          ? "visibility 0s"
          : `visibility 0s linear ${SLIDE_MS}ms`,
      }}
    >
      {/* Backdrop */}
      <div
        onClick={close}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(31, 29, 27, 0.32)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          opacity: open ? 1 : 0,
          transition: reduced ? "none" : "opacity 240ms ease",
        }}
      />

      {/* Panel */}
      <div
        id={NAV_DRAWER_ID}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: NAV_DRAWER_WIDTH,
          // Leave a strip of backdrop to tap on narrow phones (320px).
          maxWidth: "calc(100vw - 44px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: M.paper,
          borderTopRightRadius: 28,
          borderBottomRightRadius: 28,
          overflow: "hidden",
          boxShadow: "18px 0 48px -12px rgba(31,29,27,.32)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition,
          outline: "none",
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
        }}
      >
        {/* Pinned: brand row, profile, search */}
        <div style={{ flex: "none", padding: "6px 18px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 48 }}>
            <div
              aria-hidden="true"
              className="m-no-invert"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "#1F1D1B",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <span style={{ fontWeight: 800, color: "#fff", fontSize: 15 }}>H</span>
            </div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, color: M.raisin }}>
              Hookka
            </div>
            {/* 40px chip inside a 44px target. */}
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close menu"
              style={{
                width: 44,
                height: 44,
                marginRight: -6,
                background: "none",
                border: "none",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flex: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: M.card,
                  color: M.raisin,
                  boxShadow: CHIP_SHADOW,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} strokeWidth={2} />
              </span>
            </button>
          </div>

          <DrawerProfile />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 44,
              marginTop: 12,
              padding: "0 13px",
              borderRadius: 14,
              backgroundColor: M.card,
              boxShadow: CARD_SHADOW,
            }}
          >
            <Search size={18} strokeWidth={1.75} color={M.faint} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules"
              aria-label="Search modules"
              autoComplete="off"
              enterKeyHint="search"
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: "inherit",
                // 16px stops iOS Safari zooming the page on focus.
                fontSize: 16,
                color: M.raisin,
                padding: 0,
              }}
            />
          </label>
        </div>

        {/* Scrolling: theme, modules */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: "4px 18px 16px",
          }}
        >
          {query.trim() === "" ? <DrawerThemeToggle /> : null}
          {groups.length > 0 ? (
            <DrawerModuleList groups={groups} onSelect={go} currentPath={pathname} />
          ) : (
            <div
              role="status"
              style={{ padding: "28px 8px", textAlign: "center", fontSize: 13, color: M.muted }}
            >
              No modules match "{query.trim()}"
            </div>
          )}
        </div>

        {/* Pinned footer: sign out + desktop app */}
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px calc(12px + env(safe-area-inset-bottom))",
            backgroundColor: M.paper,
            borderTop: `1px solid ${M.divider}`,
          }}
        >
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 44,
              padding: "0 4px",
              border: "none",
              background: "none",
              fontFamily: "inherit",
              cursor: "pointer",
              color: M.sevCritical,
              fontSize: 14,
              fontWeight: 700,
              textAlign: "left",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <LogOut size={18} strokeWidth={2} aria-hidden="true" />
            Sign out
          </button>
          {/* The flag stops the desktop shell sending this phone straight back
              to /m (BUG-2026-10-02-250). */}
          <a
            href="/dashboard"
            onClick={() => setPreferDesktop(true)}
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 44,
              fontSize: 11,
              color: M.ink,
              textDecoration: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Open desktop app
          </a>
        </div>
      </div>
    </div>
  );
}

/** Profile card — gradient avatar + name + role · company. Sign-out lives in
 * the footer. Real identity from the signed-in session. */
function DrawerProfile() {
  const user = getCurrentUser();
  const name = user?.displayName || user?.email || "—";
  const role = prettyRole(user?.role || "");
  // Same fixed brand constant as ModuleMenu's ProfileCard.
  const company = "HOOKKA INDUSTRIES";
  const initials = initialsOf(user?.displayName || "", user?.email || "");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 14,
        padding: "12px 13px",
        borderRadius: 16,
        background: M.card,
        boxShadow: CARD_SHADOW,
      }}
    >
      <div
        aria-hidden="true"
        className="m-no-invert"
        style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 15,
          flex: "none",
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, ...ellipsis }}>{name}</div>
        <div style={{ fontSize: 12.5, color: M.muted, marginTop: 2, ...ellipsis }}>
          {role ? (
            <>
              <span style={{ color: M.taupe, fontWeight: 600 }}>{role}</span>
              {" · "}
            </>
          ) : null}
          {company}
        </div>
      </div>
    </div>
  );
}

/** Dark/Light switch row — same behaviour as ModuleMenu's ThemeToggleCard. */
function DrawerThemeToggle() {
  const { mode, toggle } = useMobileThemeMode();
  const dark = mode === "dark";
  return (
    <div
      style={{
        marginTop: 16,
        background: M.card,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: CARD_SHADOW,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={dark}
        aria-label="Dark mode"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 56,
          padding: "8px 14px 8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: dark ? "#2A2722" : "#FAEFCB",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {dark ? (
            <Moon size={16} color="#D9BD7B" strokeWidth={1.9} />
          ) : (
            <Sun size={16} color="#9C6F1E" strokeWidth={1.9} />
          )}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>
            {dark ? "Dark mode" : "Light mode"}
          </span>
          <span style={{ display: "block", fontSize: 12, color: M.muted, marginTop: 1 }}>
            Tap to switch to {dark ? "light" : "dark"}
          </span>
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 26,
            borderRadius: 13,
            background: dark ? M.taupe : M.hairline,
            position: "relative",
            flex: "none",
            transition: "background .18s",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: dark ? 21 : 3,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              transition: "left .18s",
              boxShadow: "0 1px 3px rgba(31,29,27,.25)",
            }}
          />
        </span>
      </button>
    </div>
  );
}

type ModuleListProps = {
  groups: ModuleGroup[];
  onSelect: (path: string) => void;
  currentPath: string;
};

/** Grouped module list — round icon tile + label + optional count badge. The
 * current page gets a gold left bar, a tinted row and a solid taupe tile. */
function DrawerModuleList({ groups, onSelect, currentPath }: ModuleListProps) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <div
            style={{
              margin: "20px 4px 8px",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: M.taupe,
            }}
          >
            {group.title}
          </div>
          <div
            style={{
              background: M.card,
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: CARD_SHADOW,
            }}
          >
            {group.items.map((item, idx) => {
              const Icon = item.icon;
              const current =
                currentPath === item.path || currentPath.startsWith(`${item.path}/`);
              return (
                <button
                  key={`${item.path}-${item.label}`}
                  type="button"
                  onClick={() => onSelect(item.path)}
                  aria-current={current ? "page" : undefined}
                  style={{
                    position: "relative",
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 48,
                    padding: "7px 14px 7px 12px",
                    background: current ? M.divider : "transparent",
                    border: "none",
                    borderTop: idx === 0 ? "none" : `1px solid ${M.divider}`,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {current ? (
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 10,
                        bottom: 10,
                        width: 3,
                        borderRadius: "0 3px 3px 0",
                        background: M.gold,
                      }}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: current ? M.taupe : M.divider,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.9}
                      color={current ? "var(--m-text-on-accent)" : M.taupe}
                    />
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 14,
                      fontWeight: current ? 700 : 500,
                      color: current ? M.taupe : M.raisin,
                      ...ellipsis,
                    }}
                  >
                    {item.label}
                  </span>
                  {item.badge ? (
                    <span
                      aria-label={`${item.badge} unread`}
                      style={{
                        minWidth: 20,
                        height: 20,
                        boxSizing: "border-box",
                        padding: "0 6px",
                        borderRadius: 999,
                        background: M.sevCritical,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
