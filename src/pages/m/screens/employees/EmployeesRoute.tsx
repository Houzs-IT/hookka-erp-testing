// EmployeesRoute — the /m/employees shell (HK-0125, Employees 3.dc.html).
//
// Draws the approved header (hamburger · "Employees" · round "⋯" button) and the nine-section underline tab bar, then
// shows the section under it. Working Hours and Attendance (Phase 2) have their own view-only screens; every other
// section except Overview still renders its existing config-driven list (the same data source `employeesConfig` always
// had), through the generic ModuleListScreen in its `embedded` mode. Rows still open /m/employees/:id and
// /m/payslips/:id exactly as before.
//
// Employee Master is desktop-only: it is not one of the nine sections and not in any "⋯" menu. A section whose menu has no
// ready item shows no "⋯" button.
// The section lives in the URL (`?section=`) so Back from a detail screen returns to the same section.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Ellipsis } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { MobileHeader } from "../../components";
import { useStickyBelowHeader } from "../../lib/header-geometry";
import { M } from "../../theme";
import { ModuleListScreen } from "../ModuleListScreen";
import AttendanceSection from "./AttendanceSection";
import DepartmentLaborSection from "./DepartmentLaborSection";
import DepartmentPerformanceSection from "./DepartmentPerformanceSection";
import EfficiencySection from "./EfficiencySection";
import EmployeePerformanceSection from "./EmployeePerformanceSection";
import LaborCostSection from "./LaborCostSection";
import PayrollSection from "./PayrollSection";
import MenuSheet from "./MenuSheet";
import OverviewSection from "./OverviewSection";
import { ATT_PARAMS } from "./attendance-model";
import { EMPLOYEES_SECTIONS, resolveSection, sectionConfig, type EmployeesSectionKey } from "./employees-sections";
import { DP_PARAMS } from "./department-performance-model";
import { EFF_PARAMS } from "./efficiency-model";
import { EP_PARAMS } from "./employee-performance-model";
import { LC_PARAMS } from "./labor-cost-model";
import { PAY_PARAMS } from "./payroll-model";
import { EFFICIENCY_REPORT_URL, menuItems, menuTitle, type MenuAction } from "./employees-menu";
import { MenuBridgeContext, type MenuBridge } from "./menu-context";
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
  // Working Hours registers its Print action here while it has entries to print (see menu-context.ts).
  const [whPrint, setWhPrint] = useState<(() => void) | null>(null);
  const bridge = useMemo<MenuBridge>(() => ({ setPrint: (fn) => setWhPrint(() => fn) }), []);
  const { hasPermission } = usePermissions();
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
        for (const k of [...WH_PARAMS, ...ATT_PARAMS, ...EFF_PARAMS, ...EP_PARAMS, ...DP_PARAMS, ...LC_PARAMS, ...PAY_PARAMS]) p.delete(k);
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
    if (section === "overview" || section === "working-hours" || section === "attendance" || section === "efficiency" || section === "employee-performance" || section === "department-labor" || section === "department-performance" || section === "labor-cost" || section === "payroll") return null;
    const tab = EMPLOYEES_SECTIONS.find((s) => s.key === section)?.tab;
    return tab ? sectionConfig(tab) : null;
  }, [section]);

  const items = menuItems(section, {
    canWorkersRead: hasPermission("workers", "read"),
    canPrintWorkingHours: section === "working-hours" && whPrint !== null,
  });
  function pick(a: MenuAction) {
    setMenuOpen(false);
    if (a === "efficiency-report") window.open(EFFICIENCY_REPORT_URL, "_blank", "noopener"); // no date: the previous working day
    else if (a === "print-working-hours") whPrint?.(); // inside the tap, so the print window is allowed to open
  }

  return (
    <MenuBridgeContext.Provider value={bridge}>
      {/* The HTML turns every input placeholder brown at 75% (input::placeholder). */}
      <style>{".emp-ph::placeholder{color:#6B5C32;opacity:.75}"}</style>
      <MobileHeader
        title="Employees"
        menu
        trailing={
          items.length === 0 ? undefined : (
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
          )
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

      {section === "overview" ? <OverviewSection pending={adj} onGo={go} /> : null}
      {section === "working-hours" ? <WorkingHoursSection pending={adj} /> : null}
      {section === "attendance" ? <AttendanceSection /> : null}

      {section === "efficiency" ? <EfficiencySection /> : null}
      {section === "employee-performance" ? <EmployeePerformanceSection /> : null}
      {section === "department-labor" ? <DepartmentLaborSection /> : null}
      {section === "department-performance" ? <DepartmentPerformanceSection /> : null}
      {section === "labor-cost" ? <LaborCostSection /> : null}
      {section === "payroll" ? <PayrollSection /> : null}

      {listConfig ? (
        <ModuleListScreen
          key={section}
          config={listConfig}
          embedded
          subTabsStickyOffset={PILL_BAR_HEIGHT}
        />
      ) : null}

      <MenuSheet
        open={menuOpen}
        title={menuTitle(section, EMPLOYEES_SECTIONS.find((x) => x.key === section)?.label)}
        items={items}
        onClose={() => setMenuOpen(false)}
        onPick={pick}
      />
    </MenuBridgeContext.Provider>
  );
}
