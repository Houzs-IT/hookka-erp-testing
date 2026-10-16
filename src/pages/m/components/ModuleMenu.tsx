// ModuleMenu — the menu building blocks shared by the /m/more screen and the
// phone NavDrawer, so both render the same profile, theme toggle, grouped
// module list and desktop link (extracted unchanged from screens/More.tsx).
//
// Real user identity comes from the signed-in session (getCurrentUser);
// sign-out reuses the SAME POST /api/auth/logout + clearAuth flow as the
// desktop top bar. No fabricated profile data. Which rows show is decided by
// visibleModuleGroups (nav.ts) — the existing navGate / isNavAllowed filter.
import { ChevronRight, LogOut, Moon, Sun } from "lucide-react";
import { MobileCard } from "./MobileCard";
import type { ModuleGroup } from "../nav";
import { M } from "../theme";
import { useMobileThemeMode } from "../lib/theme-mode";
import { getCurrentUser } from "@/lib/auth";
import { setPreferDesktop } from "@/lib/prefer-desktop";
import { handleSignOut, initialsOf, prettyRole } from "./module-menu-data";

/** Profile header card — avatar + name + role·company + sign-out. */
export function ProfileCard({ marginBottom = 18 }: { marginBottom?: number }) {
  const user = getCurrentUser();
  const name = user?.displayName || user?.email || "—";
  const role = prettyRole(user?.role || "");
  // Company is a fixed brand constant for this single-tenant office app (the
  // desktop top bar defaults the same). TODO: surface the active organisation
  // here if a multi-org session field becomes available on the office session.
  const company = "HOOKKA INDUSTRIES";
  const initials = initialsOf(user?.displayName || "", user?.email || "");

  return (
    <MobileCard
      radius={18}
      style={{
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 13,
        marginBottom,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 50,
          height: 50,
          borderRadius: "50%",
          background: M.taupe,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 18,
          flex: "none",
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: M.raisin,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: M.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {[role, company].filter(Boolean).join(" · ")}
        </div>
      </div>
      <button
        onClick={handleSignOut}
        aria-label="Sign out"
        style={{
          background: "none",
          border: "none",
          width: 44,
          height: 44,
          margin: -10,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <LogOut size={20} strokeWidth={1.9} color="#C0463A" />
      </button>
    </MobileCard>
  );
}

/** Dark/Light Mode toggle — CHANGELOG: "手机版在 More 菜单、即时切换、记忆设置".
 * A single-row card that flips the body[data-theme] attribute and persists to
 * localStorage. */
export function ThemeToggleCard() {
  const { mode, toggle } = useMobileThemeMode();
  return (
    <MobileCard radius={14} style={{ padding: 0, marginBottom: 18, overflow: "hidden" }}>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={mode === "dark"}
        aria-label="Dark mode"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          color: M.raisin,
          textAlign: "left",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: mode === "dark" ? "#2A2722" : "#FAEFCB",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {mode === "dark" ? (
            <Moon size={18} color="#D9BD7B" strokeWidth={1.9} />
          ) : (
            <Sun size={18} color="#9C6F1E" strokeWidth={1.9} />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>
            {mode === "dark" ? "Dark mode" : "Light mode"}
          </div>
          <div style={{ fontSize: 12, color: M.muted, marginTop: 1 }}>
            Tap to switch to {mode === "dark" ? "light" : "dark"}
          </div>
        </div>
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 26,
            borderRadius: 13,
            background: mode === "dark" ? M.taupe : M.hairline,
            position: "relative",
            flex: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: mode === "dark" ? 21 : 3,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              transition: "left .18s",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)",
            }}
          />
        </span>
      </button>
    </MobileCard>
  );
}

type GroupListProps = {
  groups: ModuleGroup[];
  onSelect: (path: string) => void;
  /** Path of the current route; its row gets aria-current="page". */
  currentPath?: string;
};

/** Grouped module list — parchment icon tile + label + optional red count
 * badge + chevron. Pass groups from visibleModuleGroups (nav.ts). */
export function ModuleGroupList({ groups, onSelect, currentPath }: GroupListProps) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#A89F8D",
              margin: "14px 4px 9px",
            }}
          >
            {group.title}
          </div>
          <MobileCard padded={false} radius={16}>
            {group.items.map((item, idx) => {
              const Icon = item.icon;
              const last = idx === group.items.length - 1;
              const current =
                currentPath !== undefined &&
                (currentPath === item.path || currentPath.startsWith(`${item.path}/`));
              return (
                <button
                  key={`${item.path}-${item.label}`}
                  onClick={() => onSelect(item.path)}
                  aria-current={current ? "page" : undefined}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    minHeight: 50,
                    padding: "13px 15px",
                    background: "none",
                    border: "none",
                    borderBottom: last ? "none" : `1px solid ${M.divider}`,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      backgroundColor: "#F4EFE6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={18} strokeWidth={1.75} color={M.taupe} />
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 14,
                      fontWeight: current ? 700 : 500,
                      color: current ? M.taupe : M.raisin,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                  </span>
                  {item.badge ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#fff",
                        background: "#C0463A",
                        padding: "1px 8px",
                        borderRadius: 20,
                      }}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                  <ChevronRight size={18} strokeWidth={1.75} color="#C4BDB2" />
                </button>
              );
            })}
          </MobileCard>
        </section>
      ))}
    </>
  );
}

/** Link back to the full desktop app. The flag stops the desktop shell sending
 * this phone straight back to /m (BUG-2026-10-02-250). */
export function DesktopAppLink() {
  return (
    <a
      href="/dashboard"
      onClick={() => setPreferDesktop(true)}
      style={{
        display: "block",
        textAlign: "center",
        fontSize: 12,
        color: M.muted,
        textDecoration: "none",
        padding: "18px 0 8px",
      }}
    >
      Open the full desktop app
    </a>
  );
}
