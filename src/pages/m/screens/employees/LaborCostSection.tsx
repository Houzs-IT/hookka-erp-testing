// LaborCostSection — Employees → Labor Cost (Employees 3.dc.html `sec.isLC`), VIEW-ONLY (HK-0125 Phase 5b).
//
// The period button + category chips (All · Sofa · Bedframe · Accessory), "BREAKDOWN · period", and three collapsible cards:
//   Production Breakdown (open; "N departments - RM", N = distinct departments) — one small table per (department, category):
//     Department, Category, Hours, Labor cost and, with revenue access, Category revenue and Cost / Revenue;
//   Overhead Breakdown — the non-production departments with their bucket (Overhead, Borrowed (Warehousing), Shortfall);
//   Revenue Raw Data (needs `revenue-figures:read`) — the first five recognised units, then "View all N units" on its own page.
// Costing is desktop's Labor Cost tab (labor-cost-model.ts). Without `revenue-figures:read` the revenue columns and the Revenue
// Raw Data card are not drawn and a grey lock note says why. If the data the cost needs failed to load, labor cost reads
// "Unavailable" (hours still show). The category is in the URL (`lcc`) with the shared period. The only write is "..." → Settle month
// (SettleSheet / settle-month.ts), offered for one full finished month with payslips when payslips:update + create are held.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronRight, Factory, Lock, PackageCheck, Warehouse } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { formatRM } from "@/lib/utils";
import { M } from "../../theme";
import { thisMonthRange } from "./employees-dates";
import { payrollEligible } from "./department-labor-model";
import { CARD, SHEET_CARD } from "./employees-styles";
import { useMenuBridge } from "./menu-context";
import { laborCostPrint } from "./menu-prints";
import { labelOfMonth, payslipRows } from "./payroll-model";
import { runPrintDoc } from "./run-print";
import SettleSheet from "./SettleSheet";
import { settleAvailable } from "./settle-month";
import { catLabel, computeLaborCost, costRatio, overheadBucket, parseLcCategory, productionDeptCount, revenueUnits, type LcCategory, type LcRow, type RevenueUnit } from "./labor-cost-model";
import { PeriodSheet } from "./PeriodSheet";
import RevenueUnitsPage from "./RevenueUnitsPage";
import { laborCostState, useLaborCost } from "./use-labor-cost";
import { useEmployeesPeriod } from "./use-employees-period";

const PREVIEW = 5;
const CHIPS: { k: LcCategory; l: string }[] = [
  { k: "", l: "All" },
  { k: "SOFA", l: "Sofa" },
  { k: "BEDFRAME", l: "Bedframe" },
  { k: "ACCESSORY", l: "Accessory" },
];
const HOURS = (h: number) => `${(Math.round(h * 10) / 10).toFixed(1)} h`;
const dmy = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd || "—");

const chipStyle = (on: boolean): CSSProperties => ({
  flex: "none",
  height: 34,
  padding: "0 13px",
  borderRadius: 999,
  border: "none",
  background: on ? "#6B5C32" : "#FFFFFF",
  color: on ? "#FFFFFF" : "#3A352C",
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: on ? 700 : 600,
  boxShadow: on ? "none" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)",
  display: "flex",
  alignItems: "center",
  whiteSpace: "nowrap",
  cursor: "pointer",
});

type Kv = { k: string; v: string; w?: number; fg?: string; bg?: string };

/** One row as the HTML's vertical table: a 112px key column and the value beside it. */
function VerticalTable({ cells }: { cells: Kv[] }) {
  return (
    <div style={{ borderRadius: 10, overflow: "hidden", boxShadow: "inset 0 0 0 1px #E6E0D9" }}>
      {cells.map((g, i) => (
        <div key={g.k} style={{ display: "grid", gridTemplateColumns: "112px minmax(0, 1fr)", borderTop: i ? "1px solid #EEE9E4" : "none", background: g.bg ?? "#FFFFFF" }}>
          <span style={{ padding: "7px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#6B5C32", background: "#FAF8F4", borderRight: "1px solid #EEE9E4" }}>{g.k}</span>
          <span style={{ padding: "7px 10px", fontSize: 12.5, fontWeight: g.w ?? 500, color: g.fg ?? M.raisin, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{g.v}</span>
        </div>
      ))}
    </div>
  );
}

function Fold({ icon, title, sub, value, open, onToggle, children }: { icon: ReactNode; title: string; sub: string; value?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ ...SHEET_CARD, overflow: "hidden" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "9px 14px", border: "none", background: "#FFFFFF", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
        <span aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: "#F4EFE6", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B5C32" }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{title}</span>
          <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span>
        </span>
        {value ? <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{value}</span> : null}
        <span style={{ flex: "none", display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: "#8B7A4E" }}>
          <ChevronDown size={17} strokeWidth={2} />
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}

const Note = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: "10px 14px 12px", borderTop: "1px solid #F0ECE9", fontSize: 11.5, lineHeight: 1.45, color: M.ink, background: "#FAF8F4" }}>{children}</div>
);
const Empty = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: "16px 14px", borderTop: "1px solid #F0ECE9", textAlign: "center", fontSize: 13, color: M.ink }}>{children}</div>
);
const MoreButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} style={{ width: "100%", height: 42, border: "none", borderTop: "1px solid #F0ECE9", background: "#FFFFFF", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#6B5C32", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
    {children}
  </button>
);
const Status = ({ children }: { children: string }) => (
  <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
    {children}
  </div>
);

export default function LaborCostSection() {
  const { range, label, today, setRange } = useEmployeesPeriod();
  const [params, setParams] = useSearchParams();
  const category = parseLcCategory(params.get("lcc"));
  const [open, setOpen] = useState<{ prod: boolean; oh: boolean; rev: boolean }>({ prod: true, oh: false, rev: false });
  const [all, setAll] = useState<{ prod: boolean; oh: boolean }>({ prod: false, oh: false });
  const [periodOpen, setPeriodOpen] = useState(false);
  const [unitsPage, setUnitsPage] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);

  const data = useLaborCost(range);
  const st = laborCostState(data);
  const { workers, entries, depts, holidays, effSalary, versions, revenue } = data;
  const result =
    st.ready && workers.value && entries.value && depts.value
      ? computeLaborCost({
          entries: entries.value,
          workers: workers.value,
          depts: depts.value,
          holidays: holidays.value ?? [],
          versions: versions.value ?? [],
          effSalary: effSalary.value ?? {},
          range: { from: range.from, to: range.to },
          category,
          byDeptCategory: revenue.value?.byDeptCategory ?? null,
          costDataOk: st.costDataOk,
        })
      : null;
  const money = (sen: number) => (result?.mode === "unavailable" ? "Unavailable" : formatRM(sen));
  const revOk = st.revenue === "ok";
  const units: RevenueUnit[] = revOk && revenue.value ? revenueUnits(revenue.value.rows, category) : [];

  // "..." → Print report (the Production Breakdown; revenue only with revenue-figures:read) and Settle month. Settle month needs ONE
  // full finished month with no category and stored payslips (desktop's rule), plus the two permissions the server enforces.
  const bridge = useMenuBridge();
  const { hasPermission } = usePermissions();
  const month = range.from.slice(0, 7);
  const settleRange = payrollEligible(range, category, today);
  const monthPayslips = useCachedJson<unknown>(data.allowed && settleRange ? `/api/payslips?period=${month}` : null, 120);
  const settleOk = settleAvailable({
    range,
    category,
    today,
    hasPayslips: (payslipRows(monthPayslips.data)?.length ?? 0) > 0,
    canUpdate: hasPermission("payslips", "update"),
    canCreate: hasPermission("payslips", "create"),
  });
  const printable = !!result && result.production.length > 0;
  useEffect(() => {
    if (!bridge || !data.allowed) return;
    bridge.set({
      ...(settleOk ? { "settle-month": { run: () => setSettleOpen(true) } } : {}),
      ...(printable && result ? { print: { run: () => runPrintDoc(laborCostPrint({ result, range, category, canSeeRevenue: data.canRevenue })) } } : {}),
    });
    return () => bridge.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `result` is derived from the loaded sources; re-register when it changes
  }, [bridge, data.allowed, data.canRevenue, settleOk, printable, result, range.from, range.to, category]);

  const base = thisMonthRange(today);
  const isDefaultPeriod = range.from === base.from && range.to === base.to;
  const chipOn = category;
  const dateBtn: CSSProperties = {
    flex: "none",
    marginRight: 6,
    width: 34,
    height: 34,
    borderRadius: "50%",
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

  function pickCategory(c: LcCategory) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (c) next.set("lcc", c);
        else next.delete("lcc");
        return next;
      },
      { replace: true },
    );
    setAll({ prod: false, oh: false });
  }

  if (!data.permLoading && !data.allowed) {
    return (
      <div role="status" style={{ margin: "16px 18px", background: "#FFFFFF", borderRadius: 16, padding: "26px 20px", textAlign: "center", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)" }}>
        <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", background: "#F0ECE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={20} strokeWidth={1.9} color="#6B5C32" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>No access to Labor Cost</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4 }}>Needs workers + payslips read.</div>
      </div>
    );
  }

  const prodRows = result?.production ?? [];
  const ohRows = result?.overhead ?? [];
  const shownProd = all.prod ? prodRows : prodRows.slice(0, PREVIEW);
  const shownOh = all.oh ? ohRows : ohRows.slice(0, PREVIEW);
  const deptCount = productionDeptCount(prodRows);

  const prodCells = (r: LcRow): Kv[] => {
    const cells: Kv[] = [
      { k: "Department", v: r.deptName, w: 700 },
      { k: "Category", v: catLabel(r.category) },
      { k: "Hours", v: HOURS(r.hours) },
      { k: "Labor cost", v: money(r.costSen), w: 700, fg: result?.mode === "unavailable" ? "#9A9082" : M.raisin, bg: "#F4EFE6" },
    ];
    if (st.revenue !== "locked") {
      const ratio = result?.mode === "unavailable" || !revOk ? { text: "—", fg: M.raisin } : costRatio(r.costSen, r.revenueSen);
      cells.push({ k: "Category revenue", v: revOk && r.revenueSen > 0 ? formatRM(r.revenueSen) : "—" }, { k: "Cost / Revenue", v: ratio.text, w: 700, fg: ratio.fg });
    }
    return cells;
  };
  const unitCells = (u: RevenueUnit): Kv[] => [
    { k: "Date", v: dmy(u.date ?? "") },
    { k: "Product", v: u.productName || u.productCode || "—", w: 700 },
    { k: "Category", v: catLabel(u.category ?? "") },
    { k: "Customer", v: u.customerName || "—" },
    { k: "SO", v: u.soNo || "—" },
    { k: "Qty", v: String(u.qty ?? "—") },
    { k: "Unit price", v: formatRM(Number(u.unitPriceSen) || 0) },
    { k: "Total", v: formatRM(Number(u.totalPriceSen) || 0), w: 700, bg: "#F4EFE6" },
  ];

  return (
    <>
      {st.revenue === "locked" && data.allowed ? (
        <div role="status" style={{ margin: "12px 18px 0", display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 14, background: "#F0ECE9" }}>
          <Lock size={16} strokeWidth={2} color="#6B5C32" />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45, color: "#3A352C" }}>Revenue figures need revenue-figures:read.</span>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px 4px" }}>
        <button type="button" onClick={() => setPeriodOpen(true)} aria-label={`Period: ${label}`} title={label} aria-haspopup="dialog" style={dateBtn}>
          <CalendarDays size={16} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {CHIPS.map((c) => (
            <button key={c.l} type="button" aria-pressed={chipOn === c.k} onClick={() => pickCategory(c.k)} style={chipStyle(chipOn === c.k)}>
              {c.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 18px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "2px 4px 0" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32", textTransform: "uppercase" }}>Breakdown</span>
          <span style={{ minWidth: 0, fontSize: 12, fontWeight: 600, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{label}</span>
        </div>

        {data.permLoading || st.loading ? <Status>Loading labor cost…</Status> : null}
        {st.failed ? <Status>Couldn't load labor cost for this period.</Status> : null}
        {result && !st.costDataOk ? (
          <div role="status" style={{ ...CARD, padding: "11px 14px", fontSize: 12.5, lineHeight: 1.45, color: "#85600F", background: "#FAEFCB" }}>
            Labor cost is unavailable because some of the data it needs couldn't load. Hours are still shown.
          </div>
        ) : null}

        {result ? (
          <>
            <Fold icon={<Factory size={16} strokeWidth={1.9} />} title="Production Breakdown" sub={`${deptCount} department${deptCount === 1 ? "" : "s"} - ${money(result.productionSen)}`} open={open.prod} onToggle={() => setOpen((o) => ({ ...o, prod: !o.prod }))}>
              {prodRows.length === 0 ? <Empty>No production hours for this period.</Empty> : null}
              {shownProd.map((r) => (
                <div key={r.id} style={{ padding: "10px 14px", borderTop: "1px solid #F0ECE9" }}>
                  <VerticalTable cells={prodCells(r)} />
                </div>
              ))}
              {prodRows.length > PREVIEW ? (
                <MoreButton onClick={() => setAll((a) => ({ ...a, prod: !a.prod }))}>
                  {all.prod ? "Show less" : `Show all ${prodRows.length}`}
                  <span style={{ display: "flex", transform: all.prod ? "rotate(180deg)" : "none" }}>
                    <ChevronDown size={15} strokeWidth={2} />
                  </span>
                </MoreButton>
              ) : null}
              {st.revenue !== "locked" && prodRows.length > 0 ? <Note>% = labor cost ÷ that department’s slice of category revenue.</Note> : null}
            </Fold>

            <Fold icon={<Warehouse size={16} strokeWidth={1.9} />} title="Overhead Breakdown" sub={`${ohRows.length} - ${money(result.overheadSen)} - not in Production Labor Cost`} open={open.oh} onToggle={() => setOpen((o) => ({ ...o, oh: !o.oh }))}>
              {ohRows.length === 0 ? <Empty>No non-production hours for this period.</Empty> : null}
              {ohRows.length > 0 ? (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 14px", background: "#F4EFE6", borderTop: "1px solid #F0ECE9", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#6B5C32" }}>
                  <span>Department</span>
                  <span>Labor cost</span>
                </div>
              ) : null}
              {shownOh.map((r) => {
                const b = overheadBucket(r);
                return (
                  <div key={r.id} style={{ padding: "10px 14px", borderTop: "1px solid #F0ECE9" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{r.deptName}</span>
                      <span style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: result.mode === "unavailable" ? "#9A9082" : M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(r.costSen)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{HOURS(r.hours)}</span>
                      <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: b.bg, color: b.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{b.label}</span>
                    </div>
                  </div>
                );
              })}
              {ohRows.length > PREVIEW ? (
                <MoreButton onClick={() => setAll((a) => ({ ...a, oh: !a.oh }))}>
                  {all.oh ? "Show less" : `Show all ${ohRows.length}`}
                  <span style={{ display: "flex", transform: all.oh ? "rotate(180deg)" : "none" }}>
                    <ChevronDown size={15} strokeWidth={2} />
                  </span>
                </MoreButton>
              ) : null}
              <Note>Not in production labor cost. Not tagged to a category, so it stays the same for Sofa, Bedframe or Accessory.</Note>
            </Fold>

            {st.revenue !== "locked" ? (
              <Fold icon={<PackageCheck size={16} strokeWidth={1.9} />} title="Revenue Raw Data" sub={revOk ? `${units.length} unit${units.length === 1 ? "" : "s"}` : st.revenue === "failed" ? "Unavailable" : "Loading…"} open={open.rev} onToggle={() => setOpen((o) => ({ ...o, rev: !o.rev }))}>
                {st.revenue === "failed" ? <Empty>Couldn't load revenue for this period.</Empty> : null}
                {revOk && units.length === 0 ? <Empty>No revenue recognised for this selection.</Empty> : null}
                {units.slice(0, PREVIEW).map((u, i) => (
                  <div key={`${u.date}-${u.soNo}-${u.productCode}-${i}`} style={{ padding: "10px 14px", borderTop: "1px solid #F0ECE9" }}>
                    <VerticalTable cells={unitCells(u)} />
                  </div>
                ))}
                {units.length > PREVIEW ? (
                  <MoreButton onClick={() => setUnitsPage(true)}>
                    View all {units.length} units
                    <ChevronRight size={15} strokeWidth={2} />
                  </MoreButton>
                ) : null}
                {revOk ? <Note>Counted when a unit finishes Upholstery.</Note> : null}
              </Fold>
            ) : null}
          </>
        ) : null}
        <div style={{ height: 96 }} />
      </div>

      <SettleSheet open={settleOpen} period={month} monthLabel={labelOfMonth(month)} onClose={() => setSettleOpen(false)} />
      {unitsPage && revOk ? <RevenueUnitsPage rows={units} sub={`${label}${category ? ` · ${catLabel(category)}` : ""}`} onClose={() => setUnitsPage(false)} /> : null}
      <PeriodSheet open={periodOpen} onClose={() => setPeriodOpen(false)} range={range} today={today} onApply={(r) => setRange(r)} />
    </>
  );
}
