// PayrollSection — Employees → Payroll, the LIST (Employees 3.dc.html `sec.isPAY`), VIEW-ONLY (HK-0125 Phase 6a).
//
// Top to bottom: the Payroll month button (its own month, `pm` in the URL — not the shared period), four summary cards for the WHOLE month
// (Total Pay ›, Gross Pay, Net Pay, Statutory (all) ›, the two arrows open their sheets), "Payroll Processing · month", search + filter, one
// card per payslip (top 5, then "Show all N workers") and a TOTAL strip that follows the search and filters. A worker card opens its payslip
// detail (PayslipPage, `pay` in the URL; Back keeps the month, search and filters). Figures and rules: payroll-model.ts. A month with no stored payslips reads "No payslip records
// … Payslips are generated on desktop."; the current Malaysia month shows desktop's live estimate (marked "Estimate") only when the stored
// request succeeded with zero records; a failed request is an error, never an empty month. Nothing is written.
import { useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronRight, DollarSign, Lock, Search, ArrowUpDown } from "lucide-react";
import { M } from "../../theme";
import { initialsOf } from "./employee-performance-model";
import { SHEET_CARD } from "./employees-styles";
import { CardSheetView, FilterSheet, MonthSheet } from "./PayrollSheets";
import PayslipPage from "./PayslipPage";
import type { DetailRow } from "./payslip-detail-model";
import {
  cards,
  deptOptions,
  filterCount,
  labelOfMonth,
  matches,
  parseDeduction,
  parseMonth,
  statusTone,
  statutorySheet,
  stripCells,
  totalPaySheet,
  totalsOf,
  workerCells,
  type Card,
  type PayFilters,
} from "./payroll-model";
import { usePayroll } from "./use-payroll";
import { todayYmdMYForReads } from "@/lib/staging-today";

const PREVIEW = 5;

const Status = ({ children, sub }: { children: string; sub?: string }) => (
  <div role="status" style={{ ...SHEET_CARD, padding: "24px 18px", textAlign: "center" }}>
    <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{children}</div>
    {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 4 }}>{sub}</div> : null}
  </div>
);

export default function PayrollSection() {
  const today = todayYmdMYForReads();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const month = parseMonth(params.get("pm"), today);
  const q = params.get("pq") ?? "";
  const f: PayFilters = { q, st: params.get("pst") ?? "all", dept: params.get("pdp") ?? "all", ded: parseDeduction(params.get("pdd")) };
  const [all, setAll] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState<"tot" | "stat" | null>(null);

  const data = usePayroll(month, today);
  const nameOf = (code: string) => {
    const d = data.depts.find((x) => x.code === code);
    return d?.shortName || d?.name || code;
  };
  const rows = data.view.kind === "stored" || data.view.kind === "estimate" ? data.view.rows : [];
  const monthTotals = totalsOf(rows);
  const list = rows.filter((p) => matches(p, f));
  const shown = all ? list : list.slice(0, PREVIEW);
  const listTotals = totalsOf(list);
  const nFilters = filterCount(f);
  const payId = params.get("pay");
  const open = payId ? (rows.find((r) => r.id === payId) as DetailRow | undefined) : undefined;

  // Opening a payslip PUSHES a history entry (the month, search and filters stay in the URL), so Back and the hardware back return to the
  // list exactly as it was. With no earlier entry (a reload or a shared link) Back just removes the payslip from the URL.
  function openPayslip(id: string) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("pay", id);
      return p;
    });
  }
  function closePayslip() {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete("pay");
          return p;
        },
        { replace: true },
      );
  }

  function set(next: Partial<Record<"pm" | "pq" | "pst" | "pdp" | "pdd", string>>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v && v !== "all") p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );
    setAll(false);
  }

  const roundBtn = (on: boolean): CSSProperties => ({
    position: "relative",
    flex: "none",
    width: 40,
    height: 40,
    borderRadius: 12,
    border: "none",
    background: on ? "#6B5C32" : "#FFFFFF",
    color: on ? "#FFFFFF" : "#6B5C32",
    boxShadow: on ? "none" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  });

  if (!data.permLoading && !data.allowed) {
    return (
      <div role="status" style={{ margin: "16px 18px", background: "#FFFFFF", borderRadius: 16, padding: "26px 20px", textAlign: "center", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)" }}>
        <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", background: "#F0ECE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={20} strokeWidth={1.9} color="#6B5C32" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>No access to Payroll</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4 }}>Needs payslips:read.</div>
      </div>
    );
  }

  const label = labelOfMonth(month);
  const hasRows = rows.length > 0;
  const sheet = cardOpen === "tot" ? totalPaySheet(monthTotals) : cardOpen === "stat" ? statutorySheet(monthTotals) : null;

  return (
    <>
      <div style={{ padding: "12px 18px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <button
          type="button"
          onClick={() => setMonthOpen(true)}
          aria-label={`Payroll month: ${label}. Change`}
          aria-haspopup="dialog"
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", height: 46, padding: "0 14px", border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <CalendarDays size={17} strokeWidth={2} color="#6B5C32" />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: M.raisin }}>{label}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#6B5C32" }}>Change</span>
          <ChevronDown size={15} strokeWidth={2} color="#8B7A4E" />
        </button>

        {payId && !open && (data.view.kind === "stored" || data.view.kind === "estimate" || data.view.kind === "empty") ? (
          <Status sub="It may belong to another month.">That payslip isn't in this list.</Status>
        ) : null}
        {data.permLoading || data.view.kind === "loading" ? <Status>Loading payroll…</Status> : null}
        {data.view.kind === "error" ? <Status sub="Please try again.">{data.view.what === "estimate" ? `Couldn't load the estimate for ${label}.` : `Couldn't load payslips for ${label}.`}</Status> : null}
        {data.view.kind === "empty" ? <Status sub="Payslips are generated on desktop.">{`No payslip records for ${label}.`}</Status> : null}

        {hasRows ? (
          <>
            <section aria-label="Summary" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: "1fr", gap: 8 }}>
              {cards(monthTotals).map((c: Card) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.tap ? () => setCardOpen(c.key as "tot" | "stat") : undefined}
                  disabled={!c.tap}
                  aria-haspopup={c.tap ? "dialog" : undefined}
                  style={{ ...SHEET_CARD, border: "none", borderRadius: 12, padding: 12, minWidth: 0, minHeight: 66, boxSizing: "border-box", fontFamily: "inherit", textAlign: "left", cursor: c.tap ? "pointer" : "default", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, overflow: "visible" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 16 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: "#9A9082", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: 0.6 }}>{c.l}</span>
                    {c.tap ? <span style={{ display: "flex", color: "#8B7A4E", fontSize: 14, lineHeight: 1 }}>›</span> : null}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: c.fg, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{c.v}</div>
                  {c.sub ? <div style={{ fontSize: 11, lineHeight: 1.3, color: c.subFg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub}</div> : null}
                </button>
              ))}
            </section>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 0" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.1, whiteSpace: "nowrap", overflow: "hidden" }}>
                <DollarSign size={17} strokeWidth={2} color="#6B5C32" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>Payroll Processing - {label}</span>
              </span>
              {data.view.kind === "estimate" ? (
                <span title="Payslips are not generated yet — this is the live estimate" style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: "#FAEFCB", color: "#85600F", fontSize: 11, fontWeight: 700 }}>Estimate</span>
              ) : null}
            </div>
            {data.view.kind === "estimate" ? <div style={{ margin: "-6px 4px 0", fontSize: 11.5, lineHeight: 1.45, color: M.ink }}>Payslips for {label} are not generated yet. These figures are the live estimate.</div> : null}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ flex: 1, minWidth: 0, height: 40, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)" }}>
                <Search size={16} strokeWidth={2} color="#9CA3AF" />
                <input className="emp-ph" type="search" value={q} onChange={(e) => set({ pq: e.target.value })} placeholder="Search name or employee no." aria-label="Search workers" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 15, color: M.raisin, padding: 0 }} />
              </label>
              <button type="button" onClick={() => setFilterOpen(true)} aria-label="Filter workers" aria-haspopup="dialog" style={roundBtn(nFilters > 0)}>
                <ArrowUpDown size={16} strokeWidth={2} />
                {nFilters > 0 ? (
                  <span style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: "#9A3A2D", color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #FAF8F4" }}>{nFilters}</span>
                ) : null}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
              {shown.map((p, i) => {
                const st = statusTone(p.status);
                return (
                  <button
                    key={p.id ?? `${p.employeeId}-${i}`}
                    type="button"
                    onClick={() => (p.id ? openPayslip(p.id) : undefined)}
                    aria-label={`Open payroll for ${p.employeeName ?? "worker"}`}
                    aria-haspopup="dialog"
                    style={{ ...SHEET_CARD, display: "block", width: "100%", padding: "12px 14px", border: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", background: "#F4EFE6", color: "#6B5C32", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{initialsOf(p.employeeName ?? "")}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.employeeName || "—"}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: "#6B7280", marginTop: 1 }}>
                          {p.employeeNo || "—"} - {nameOf(p.departmentCode ?? "")}
                        </span>
                      </span>
                      <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                      <span style={{ display: "flex", color: "#8B7A4E" }}>
                        <ChevronRight size={16} strokeWidth={2} />
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", marginTop: 10, padding: "9px 10px", borderRadius: 10, background: "#FAF8F4" }}>
                      {workerCells(p).map((c) => (
                        <div key={c.k} style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{c.k}</div>
                          <div style={{ fontSize: 12.5, fontWeight: c.w, color: c.fg, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{c.v}</div>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {list.length === 0 ? (
              <div role="status" style={{ ...SHEET_CARD, padding: "22px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>No workers match these filters.</div>
                <button type="button" onClick={() => set({ pq: "", pst: "all", pdp: "all", pdd: "all" })} style={{ marginTop: 10, height: 36, padding: "0 16px", border: "none", borderRadius: 10, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px #E6E0D9", color: "#6B5C32", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Reset filters
                </button>
              </div>
            ) : null}
            {list.length > PREVIEW ? (
              <button type="button" onClick={() => setAll((v) => !v)} style={{ height: 42, border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px #E6E0D9", color: "#6B5C32", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {all ? "Show fewer" : `Show all ${list.length} workers`}
              </button>
            ) : null}

            {list.length > 0 ? (
              <section aria-label="Total" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", padding: "11px 12px", borderRadius: 12, background: "#F0ECE9" }}>
                <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "#6B5C32" }}>
                  TOTAL ({list.length} worker{list.length === 1 ? "" : "s"})
                </div>
                {stripCells(listTotals).map((c) => (
                  <div key={c.k} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{c.k}</div>
                    <div style={{ fontSize: 12.5, fontWeight: c.w, color: c.fg, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{c.v}</div>
                  </div>
                ))}
                {!listTotals.pcbComplete ? <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#9A3A2D" }}>Statutory excludes PCB that could not be computed.</div> : null}
              </section>
            ) : null}
          </>
        ) : null}
        <div style={{ height: 96 }} />
      </div>

      {payId && open ? <PayslipPage row={open} monthLabel={label} estimate={data.view.kind === "estimate"} onClose={closePayslip} /> : null}
      <MonthSheet open={monthOpen} month={month} today={today} onPick={(ym) => set({ pm: ym === today.slice(0, 7) ? "" : ym, pq: "", pst: "all", pdp: "all", pdd: "all" })} onClose={() => setMonthOpen(false)} />
      <FilterSheet
        open={filterOpen}
        value={{ st: f.st, dept: f.dept, ded: f.ded }}
        depts={deptOptions(rows, nameOf)}
        count={(d) => rows.filter((p) => matches(p, { ...f, ...d })).length}
        onApply={(d) => set({ pst: d.st, pdp: d.dept, pdd: d.ded })}
        onClose={() => setFilterOpen(false)}
      />
      <CardSheetView open={cardOpen !== null} sheet={sheet} onClose={() => setCardOpen(null)} />
    </>
  );
}
