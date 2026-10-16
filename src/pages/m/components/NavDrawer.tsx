// NavDrawer — the phone left drawer (owner 2026-10-12 phone nav shell).
//
// 324px panel sliding in from the left over a dimmed backdrop. Pinned at the
// top: brand row + close, the profile card (with sign-out) and a module
// search. Scrolling below: theme toggle, install, the grouped module list
// (MORE_GROUPS through visibleModuleGroups — the existing navGate filter) and
// the desktop-app link. Same building blocks as /m/more (ModuleMenu.tsx).
//
// Phone only: MobileLayout mounts it while layout.mode === "phone".
// A11y: role="dialog" + aria-modal, Escape / backdrop / close button close it,
// Tab is trapped inside, focus returns to the opener, body scroll is locked,
// safe-area insets padded, and the closed panel is `inert`.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { M } from "../theme";
import { visibleModuleGroups } from "../nav";
import { NAV_DRAWER_ID } from "../lib/nav-drawer";
import { useItUnread, withItBadge } from "../lib/it-unread";
import { usePermissions } from "@/lib/use-permission";
import { InstallAppCard } from "./InstallAppCard";
import {
  DesktopAppLink,
  ModuleGroupList,
  ProfileCard,
  ThemeToggleCard,
} from "./ModuleMenu";

export const NAV_DRAWER_WIDTH = 324;
const SLIDE_MS = 240;

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function NavDrawer({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isNavAllowed } = usePermissions();
  const itUnread = useItUnread();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const transition = prefersReducedMotion() ? "none" : `transform ${SLIDE_MS}ms ease`;

  // Clear the search each time the drawer closes.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

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
        onClose();
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
  }, [open, onClose]);

  const groups = withItBadge(visibleModuleGroups(isNavAllowed, query), itUnread);
  const go = (path: string) => {
    onClose();
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
        transition: open || transition === "none"
          ? "visibility 0s"
          : `visibility 0s linear ${SLIDE_MS}ms`,
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(31, 29, 27, 0.45)",
          opacity: open ? 1 : 0,
          transition: transition === "none" ? "none" : `opacity ${SLIDE_MS}ms ease`,
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
          maxWidth: "calc(100vw - 40px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: M.paper,
          borderRight: `1px solid ${M.border}`,
          boxShadow: "8px 0 30px rgba(31,29,27,0.18)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition,
          outline: "none",
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
        }}
      >
        {/* Pinned: brand row, profile, search */}
        <div style={{ flex: "none", padding: "10px 14px 12px", borderBottom: `1px solid ${M.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, marginBottom: 8 }}>
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
            <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: M.raisin }}>Hookka</div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              style={{
                width: 44,
                height: 44,
                marginRight: -10,
                background: "none",
                border: "none",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: M.raisin,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <X size={22} strokeWidth={1.9} />
            </button>
          </div>

          <ProfileCard marginBottom={12} />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 44,
              padding: "0 14px",
              borderRadius: 14,
              backgroundColor: M.card,
              border: `1px solid ${M.border}`,
            }}
          >
            <Search size={18} strokeWidth={1.75} color={M.muted} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules..."
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
              }}
            />
          </label>
        </div>

        {/* Scrolling: theme, install, modules, desktop link */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: "14px 14px calc(16px + env(safe-area-inset-bottom))",
          }}
        >
          {query.trim() === "" ? (
            <>
              <ThemeToggleCard />
              <InstallAppCard />
            </>
          ) : null}
          {groups.length > 0 ? (
            <ModuleGroupList groups={groups} onSelect={go} currentPath={pathname} />
          ) : (
            <div
              role="status"
              style={{ padding: "28px 8px", textAlign: "center", fontSize: 13, color: M.muted }}
            >
              No modules match "{query.trim()}"
            </div>
          )}
          <DesktopAppLink />
        </div>
      </div>
    </div>
  );
}
