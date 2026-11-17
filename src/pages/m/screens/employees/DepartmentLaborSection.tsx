// DepartmentLaborSection — Employees → Department Labor (Employees 3.dc.html `sec.isDL`), VIEW-ONLY (HK-0125 Phase 4, step 3).
//
// A search box + the period button, "N DEPARTMENTS · period" with the ⇅ filter button, one card per department (name, Prod /
// Non-prod tag, Total Hours, Workers, Category Total, the category columns, and the cost line), top 5 then "Show all N", and a
// TOTAL strip over every matching department. Only departments with hours in the selected scope are listed, highest cost first.
// Costing is desktop's Department Labor tab (department-labor-model.ts) so the two can be compared for the same period. The cost
// line says "Total" (and "matches Payroll") ONLY for an unfiltered, completed calendar month whose payroll data loaded; otherwise
// "Estimated Labor Cost", and "Unavailable" when the data the estimate needs did not load. Nothing is written.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpDown, CalendarDays, DollarSign, Search } from "lucide-react";
import { formatRM } from "@/lib/utils";
import { M } from "../../theme";
import DeptLaborFilterSheet from "./DeptLaborFilterSheet";
import {
  computeDepartmentLabor,
  costLabel,
  filterCount,
  footnote,
  totalsOf,
  visibleRows,
  type CostMode,
  type DlCategory,
  type DlResult,
  type DlRow,
  type DlType,
} from "./department-labor-model";
import { thisMonthRange } from "./employees-dates";
import { CARD, SHEET_CARD, TONE } from "./employees-styles";
import { PeriodSheet } from "./PeriodSheet";
import { laborState, useDepartmentLabor } from "./use-department-labor";
import { useEmployeesPeriod } from "./use-employees-period";

const PREVIEW = 5;
const HOURS = (h: number) => (h > 0 ? `${(Math.round(h * 10) / 10).toFixed(1)}h` : "—");

const Status = ({ children, tone }: { children: ReactNode; tone?: "amber" }) => (
  <div role="status" style={{ ...CARD, padding: tone ? "11px 14px" : 22, marginBottom: tone ? 10 : 0, textAlign: tone ? "left" : "center", fontSize: tone ? 12.5 : 13, lineHeight: 1.45, color: tone ? "#85600F" : M.ink, background: tone ? "#FAEFCB" : M.card }}>
    {children}
  </div>
);

type Cell = { k: string; v: string; fg?: string };

/** The stat cells of a card (or of the total strip), as the HTML lays them out. */
function rowCells(r: DlRow, mode: CostMode, category: DlCategory): Cell[] {
  const money = (sen: number) => (mode === "unavailable" || sen <= 0 ? "—" : formatRM(sen));
  const cells: Cell[] = [
    { k: "Total Hours", v: HOURS(r.totalHours) },
    { k: "Workers", v: r.workerIds.length > 0 ? String(r.workerIds.length) : "—" },
    { k: "Category Total", v: money(r.catTotalSen) },
  ];
  if (!category || category === "SOFA") cells.push({ k: "Sofa", v: money(r.sofaSen) });
  if (!category || category === "BEDFRAME") cells.push({ k: "Bedframe", v: money(r.bedframeSen) });
  if (!category || category === "ACCESSORY") cells.push({ k: "Accessory", v: money(r.accessorySen) });
  if (mode === "payroll") {
    cells.push({ k: "Labor (incl. EPF)", v: money(r.laborSen) });
    cells.push({ k: "Under-recorded", v: money(r.underSen), fg: r.underSen > 0 ? "#9A3A2D" : undefined });
  }
  return cells;
}

function StatGrid({ cells, bg }: { cells: Cell[]; bg: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", marginTop: 10, padding: "9px 10px", borderRadius: 10, background: bg }}>
      {cells.map((t) => (
        <div key={t.k} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.k}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.fg ?? M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
        </div>
      ))}
    </div>
  );
}

function CostLine({ label, mode, sen, color, border }: { label: string; mode: CostMode; sen: number; color: string; border: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: M.ink }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: mode === "unavailable" ? "#9A9082" : color, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{mode === "unavailable" ? "Unavailable" : formatRM(sen)}</span>
    </div>
  );
}

export default function DepartmentLaborSection() {
  const { range, label, today, setRange } = useEmployeesPeriod();
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<{ category: DlCategory; type: DlType; depts: readonly string[] }>({ category: "", type: "all", depts: [] });
  const [all, setAll] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const data = useDepartmentLabor(range, sheet.category, today);
  const st = laborState(data);
  const filters = { ...sheet, q };

  const { workers, entries, depts, holidays, effSalary, versions, payslips, docks } = data;
  const result: DlResult | null = useMemo(() => {
    if (!st.ready || !workers.value || !entries.value || !depts.value) return null;
    return computeDepartmentLabor({
      entries: entries.value,
      workers: workers.value,
      depts: depts.value,
      holidays: holidays.value ?? [],
      versions: versions.value ?? [],
      effSalary: effSalary.value ?? {},
      payslips: payslips.value,
      docks: docks.value,
      range: { from: range.from, to: range.to },
      category: sheet.category,
      today,
      costDataOk: st.costDataOk,
    });
  }, [st.ready, st.costDataOk, workers.value, entries.value, depts.value, holidays.value, versions.value, effSalary.value, payslips.value, docks.value, range.from, range.to, sheet.category, today]);

  const rows = result ? visibleRows(result, filters) : [];
  const totals = totalsOf(rows);
  const shown = all ? rows : rows.slice(0, PREVIEW);
  const n = filterCount(filters);
  const mode: CostMode = result?.mode ?? "estimate";
  const note = result ? footnote(result, filters) : null;
  const base = thisMonthRange(today);
  const isDefaultPeriod = range.from === base.from && range.to === base.to;
  const dateBtn: CSSProperties = {
    flex: "none",
    width: 40,
    height: 40,
    borderRadius: 12,
    border: "none",
    background: isDefaultPeriod ? "#FFFFFF" : "#6B5C32",
    color: isDefaultPeriod ? "#6B5C32" : "#FFFFFF",
    boxShadow: isDefaultPeriod ? "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)" : "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  };
  const totalCells: Cell[] = (() => {
    const t = totals;
    const money = (sen: number) => (mode === "unavailable" || sen <= 0 ? "—" : formatRM(sen));
    if (mode === "payroll") {
      return [
        { k: "Total Hours", v: HOURS(t.hours) },
        { k: "Labor (incl. EPF)", v: money(t.laborSen) },
        { k: "Under-recorded", v: money(t.underSen), fg: t.underSen > 0 ? "#9A3A2D" : undefined },
        { k: "Workers", v: t.workers > 0 ? String(t.workers) : "—" },
        { k: "Category Total", v: money(t.catTotalSen) },
      ];
    }
    return [
      { k: "Total Hours", v: HOURS(t.hours) },
      { k: "Workers", v: t.workers > 0 ? String(t.workers) : "—" },
      { k: "Category Total", v: money(t.catTotalSen) },
    ];
  })();

  return (
    <>
      <div style={{ padding: "14px 18px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ flex: 1, minWidth: 0, height: 40, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: "#FFFFFF", borderRadius: 12, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 8px 22px -10px rgba(31,29,27,.18)" }}>
          <Search size={17} strokeWidth={1.75} color="#9CA3AF" />
          <input
            className="emp-ph"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search department"
            aria-label="Search department"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: M.raisin, padding: 0 }}
          />
        </label>
        <button type="button" onClick={() => setPeriodOpen(true)} aria-label={`Period: ${label}`} aria-haspopup="dialog" style={dateBtn}>
          <CalendarDays size={16} strokeWidth={2} />
        </button>
      </div>

      <div style={{ padding: "12px 18px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 8px" }}>
          <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {result ? `${rows.length} department${rows.length === 1 ? "" : "s"}` : "Departments"}
          </span>
          <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{label}</span>
          <span aria-hidden="true" style={{ flex: 1, minWidth: 8, height: 1, background: "#E6E0D9" }} />
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-label="Filter departments"
            aria-haspopup="dialog"
            style={{ position: "relative", flex: "none", width: 38, height: 38, borderRadius: "50%", border: "none", background: n ? "#6B5C32" : "#FFFFFF", color: n ? "#FFFFFF" : "#6B5C32", boxShadow: n ? "none" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <ArrowUpDown size={16} strokeWidth={2} />
            {n ? (
              <span style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: "#9A3A2D", color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #FAF8F4" }}>{n}</span>
            ) : null}
          </button>
        </div>

        {data.permLoading || st.loading ? <Status>Loading department labor…</Status> : null}
        {!data.permLoading && !data.allowed ? <Status>Department Labor needs access to payslips and employee records.</Status> : null}
        {st.failed ? <Status>Couldn't load department labor for this period.</Status> : null}
        {result && !st.costDataOk ? <Status tone="amber">Labor cost is unavailable because some of the data it needs couldn't load. Hours and workers are still shown.</Status> : null}
        {result?.payrollMissing ? <Status tone="amber">Payroll couldn't be loaded, so this is an estimate from logged hours, not the Payroll figure.</Status> : null}

        {result && rows.length === 0 ? <Status>{filterCount(filters) || q.trim() ? "No departments match." : "No hours recorded in this period."}</Status> : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          {shown.map((r) => {
            const tag = r.isProduction ? TONE.green : TONE.amber;
            return (
              <article key={r.deptCode} aria-label={r.deptName} style={{ ...SHEET_CARD, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.deptName}</span>
                    <span style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, background: tag.bg, color: tag.fg, fontSize: 10, fontWeight: 700 }}>{r.isProduction ? "Production" : "Non-production"}</span>
                  </span>
                </div>
                <StatGrid cells={rowCells(r, mode, sheet.category)} bg="#FAF8F4" />
                <CostLine label={costLabel(mode)} mode={mode} sen={r.costSen} color={M.raisin} border="#F0ECE9" />
              </article>
            );
          })}
        </div>
        {result && rows.length > PREVIEW ? (
          <button type="button" onClick={() => setAll((v) => !v)} style={{ width: "100%", height: 42, marginTop: 10, border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#6B5C32", cursor: "pointer" }}>
            {all ? "Show less" : `Show all ${rows.length}`}
          </button>
        ) : null}

        {result && rows.length > 0 ? (
          <section aria-label="Total" style={{ marginTop: 12, borderRadius: 14, background: "#FAF7F0", boxShadow: "inset 0 0 0 1px rgba(107,92,50,.3)", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DollarSign size={15} strokeWidth={2} color="#6B5C32" />
              <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>TOTAL</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: M.ink }}>
                ({totals.departments} department{totals.departments === 1 ? "" : "s"})
              </span>
            </div>
            <StatGrid cells={totalCells} bg="#FFFFFF" />
            <CostLine label={costLabel(mode)} mode={mode} sen={totals.costSen} color="#6B5C32" border="rgba(107,92,50,.25)" />
            {note === "matches-payroll" ? <div style={{ fontSize: 11, color: M.ink, marginTop: 4, textAlign: "right" }}>Fully loaded (incl. EPF) — matches Payroll</div> : null}
            {note === "filtered-payroll" ? <div style={{ fontSize: 11, color: M.ink, marginTop: 4, textAlign: "right" }}>Fully loaded (incl. EPF) — filtered view, not the full Payroll</div> : null}
          </section>
        ) : null}
        <div style={{ height: 96 }} />
      </div>

      <PeriodSheet open={periodOpen} onClose={() => setPeriodOpen(false)} range={range} today={today} onApply={(r) => setRange(r)} />
      <DeptLaborFilterSheet
        open={filterOpen}
        value={sheet}
        depts={(depts.value ?? []).map((d) => ({ code: d.code, name: d.shortName || d.name || d.code }))}
        onApply={(v) => {
          setSheet(v);
          setAll(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </>
  );
}

