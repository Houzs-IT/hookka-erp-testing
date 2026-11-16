// EmployeesRoute — the /m/employees shell (HK-0125, Employees 3.dc.html).
//
// Draws the approved header (hamburger · "Employees" · round "⋯" button) and the nine-section underline tab bar, then
// shows the section under it. Working Hours and Attendance (Phase 2) have their own view-only screens; every other
// section except Overview still renders its existing config-driven list (the same data source `employeesConfig` always
// had), through the generic ModuleListScreen in its `embedded` mode. Rows still open /m/employees/:id and
// /m/payslips/:id exactly as before.
//
// Employee Master is not one of the nine sections in the design, so it stays reachable from the "⋯" menu.
// The section lives in the URL (`?section=`) so Back from a detail screen returns to the same section.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, Ellipsis, Users } from "lucide-react";
import { MobileHeader, Sheet } from "../../components";
import { useStickyBelowHeader } from "../../lib/header-geometry";
import { M } from "../../theme";
import { ModuleListScreen } from "../ModuleListScreen";
import AttendanceSection from "./AttendanceSection";
import { ATT_PARAMS } from "./attendance-model";
import { EMPLOYEES_SECTIONS, MASTER_TAB, resolveSection, sectionConfig, type EmployeesSectionKey } from "./employees-sections";
import { pendingBadge } from "./time-adjustments-model";
import { usePendingAdjustments } from "./use-time-adjustments";
import WorkingHoursSection from "./WorkingHoursSection";
import { WH_PARAMS } from "./working-hours-model";

/** Height of the section bar (42px tabs + 4px top padding) — what a list's own sticky sub-tabs must clear. */
const PILL_BAR_HEIGHT = 46;

export default function EmployeesRoute() {
  const [params, setParams] = useSearchParams();
  const section = resolveSection(params.get("section"));
  const [menuOpen, setMenuOpen] = useState(false);
  const barTop = useStickyBelowHeader();
  const barRef = useRef<HTMLDivElement>(null);
  // Fetched ONCE here: the Working Hours tab badge and the request card below read this same list.
  const adj = usePendingAdjustments();
  const badge = pendingBadge(adj.rows);

  function go(next: EmployeesSectionKey) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("section", next);
        // A section's own filters (date, search, location…) never follow you to another section.
        for (const k of [...WH_PARAMS, ...ATT_PARAMS]) p.delete(k);
        return p;
      },
      { replace: true },
    );
  }

  // Keep the active tab in view when the section changes (or is restored from the URL).
  useEffect(() => {
    const bar = barRef.current;
    const el = bar?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar || !el) return;
    bar.scrollTo({ left: Math.max(0, el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2), behavior: "smooth" });
  }, [section]);

  const listConfig = useMemo(() => {
    if (section === "overview" || section === "working-hours" || section === "attendance") return null;
    if (section === "employee-master") return sectionConfig(MASTER_TAB);
    const tab = EMPLOYEES_SECTIONS.find((s) => s.key === section)?.tab;
    return tab ? sectionConfig(tab) : null;
  }, [section]);

  return (
    <>
      {/* The HTML turns every input placeholder brown at 75% (input::placeholder). */}
      <style>{".emp-ph::placeholder{color:#6B5C32;opacity:.75}"}</style>
      <MobileHeader
        title="Employees"
        menu
        trailing={
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="More actions"
            aria-haspopup="dialog"
            style={{
              width: 42,
              height: 42,
              flex: "none",
              borderRadius: "50%",
              border: "none",
              background: M.card,
              boxShadow: "0 1px 2px rgba(31,29,27,.06), 0 6px 16px -8px rgba(31,29,27,.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: M.taupe,
              cursor: "pointer",
              padding: 0,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Ellipsis size={19} strokeWidth={2} />
          </button>
        }
      />

      <div
        style={{
          position: "sticky",
          top: barTop,
          zIndex: 31,
          background: M.paper,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div
          ref={barRef}
          role="tablist"
          aria-label="Employees sections"
          style={{
            display: "flex",
            gap: 18,
            overflowX: "auto",
            padding: "4px 18px 0",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
            boxShadow: "inset 0 -1px 0 #E6E0D9",
          }}
        >
          {EMPLOYEES_SECTIONS.map((s) => {
            const on = s.key === section;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={on}
                data-sec={s.key}
                onClick={() => go(s.key)}
                style={{
                  flex: "none",
                  height: 42,
                  padding: "0 2px",
                  border: "none",
                  borderRadius: 0,
                  background: "none",
                  color: on ? M.raisin : M.ink,
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  fontWeight: on ? 700 : 600,
                  boxShadow: `inset 0 -2.5px 0 ${on ? M.taupe : "transparent"}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {s.label}
                {s.key === "working-hours" && badge ? (
                  <span
                    aria-label={`${badge} pending time adjustment requests`}
                    style={{
                      minWidth: 18,
                      height: 18,
                      boxSizing: "border-box",
                      padding: "0 5px",
                      borderRadius: 999,
                      background: on ? M.taupe : "#FAEFCB",
                      color: on ? "#FFFFFF" : "#85600F",
                      fontSize: 10.5,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {section === "overview" ? <OverviewPlaceholder /> : null}
      {section === "working-hours" ? <WorkingHoursSection pending={adj} /> : null}
      {section === "attendance" ? <AttendanceSection /> : null}

      {section === "employee-master" ? (
        <div style={{ padding: "12px 18px 0", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>
          EMPLOYEE MASTER
        </div>
      ) : null}

      {listConfig ? (
        <ModuleListScreen
          key={section}
          config={listConfig}
          embedded
          subTabsStickyOffset={PILL_BAR_HEIGHT}
        />
      ) : null}

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Employees">
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            go("employee-master");
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 4px",
            border: "none",
            background: "none",
            fontFamily: "inherit",
            textAlign: "left",
            cursor: "pointer",
            color: M.raisin,
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: 10,
              background: M.card,
              boxShadow: "inset 0 0 0 1px #E6E0D9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: M.taupe,
            }}
          >
            <Users size={18} strokeWidth={1.9} />
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Employee Master</span>
          <ChevronRight size={16} strokeWidth={2} color={M.muted} />
        </button>
      </Sheet>
    </>
  );
}

/** Overview arrives in a later phase (the four month-to-date cards + Needs action). Nothing here pretends to be data. */
function OverviewPlaceholder() {
  return (
    <div style={{ padding: "14px 18px 0" }}>
      <div
        role="status"
        style={{
          padding: 16,
          borderRadius: 16,
          background: M.card,
          boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>Overview is coming soon</div>
        <div style={{ fontSize: 12.5, color: M.ink, marginTop: 4, lineHeight: 1.45 }}>
          The month-to-date cards and Needs action will appear here. Every other section opens as before.
        </div>
      </div>
    </div>
  );
}
