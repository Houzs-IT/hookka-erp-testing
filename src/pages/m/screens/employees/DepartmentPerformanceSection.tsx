// DepartmentPerformanceSection — Employees → Department Performance (Employees 3.dc.html `sec.isDP`), VIEW-ONLY (HK-0125 Phase 5a).
//
// Four equal summary tiles (Workers, Hours worked, Earned time, Avg Efficiency), then "Daily Breakdown": the period button, the scope line, the ⇅ filter (department + category, with a count badge) and one card per day
// (Hours worked / Earned time / Efficiency %). Tapping a day opens its detail page: the department / scope as the title, the date
// under it, the day's workers and their job cards. The list reads the API's SUMMARY view; the tapped day is fetched on its own with
// the same filters. Every figure is the server's (the efficiency is never recomputed here); the filters and the period are in the
// URL (`dpd`, `dpc`, `from`, `to`) so the same view can be opened on desktop. Nothing is written.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpDown, CalendarDays, ChevronRight, Lock } from "lucide-react";
import { M } from "../../theme";
import DeptPerfDayPage from "./DeptPerfDayPage";
import DeptPerfFilterSheet from "./DeptPerfFilterSheet";
import { dayCards, filterCount, kpiCells, parseCategory, scopeTitle } from "./department-performance-model";
import { thisMonthRange } from "./employees-dates";
import { efficiencyReportUrl } from "./employees-menu";
import { CARD, SHEET_CARD } from "./employees-styles";
import { useMenuBridge } from "./menu-context";
import { departmentPerformancePrint } from "./menu-prints";
import { printDocInto, showInWindow } from "./run-print";
import { PeriodSheet } from "./PeriodSheet";
import { useDepartmentPerformance } from "./use-department-performance";
import { useEmployeesPeriod } from "./use-employees-period";

const Status = ({ children }: { children: string }) => (
  <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
    {children}
  </div>
);

export default function DepartmentPerformanceSection() {
  const { range, label, today, setRange } = useEmployeesPeriod();
  const [params, setParams] = useSearchParams();
  const dept = params.get("dpd") ?? "";
  const cat = parseCategory(params.get("dpc"));
  const [day, setDay] = useState<string | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  // The printed report lists every day's workers, which the summary list does not carry. That full payload (large for a long period) is
  // requested ONLY when "Print Report" is tapped — never to draw the list and not when the "..." menu opens — and only for the scope
  // (period + filters) that was tapped. The tap opens the print window itself (a phone blocks one opened after the fetch); the data
  // fills it when it arrives.
  const scopeKey = `${range.from}|${range.to}|${dept}|${cat}`;
  const [wantKey, setWantKey] = useState<string | null>(null);
  const pendingWin = useRef<Window | null>(null);
  const data = useDepartmentPerformance(range, dept, cat, day, wantKey === scopeKey);
  const deptOptions = [...(data.depts ?? [])]
    .sort((a, b) => {
      if (!!a.isProduction !== !!b.isProduction) return a.isProduction ? -1 : 1;
      const sa = a.sequence ?? 999;
      const sb = b.sequence ?? 999;
      return sa !== sb ? sa - sb : a.code.localeCompare(b.code);
    })
    .map((d) => ({ code: d.code, name: d.shortName || d.name || d.code }));
  const deptName = dept ? (deptOptions.find((d) => d.code === dept)?.name ?? dept) : null;
  const scope = scopeTitle(deptName, cat);
  const totals = data.list.data?.totals ?? null;
  const cards = dayCards(data.list.data?.daily ?? []);

  // "..." → Print Report (this tab's filters, every day with its workers — desktop's report) and Daily Efficiency (A4): the
  // all-departments single-day report for the "To" date, ignoring these filters (desktop opens the same URL). Both need workers:read.
  const bridge = useMenuBridge();
  const fullData = data.full.data;
  const fullError = data.full.error;
  const printArgs = { range, deptLabel: deptName ?? "All departments", category: cat };
  const printArgsRef = useRef(printArgs);
  printArgsRef.current = printArgs; // eslint-disable-line react-hooks/refs -- latest scope for the late fill below
  // The data arrived (or failed) for a tap: fill the window that tap opened.
  useEffect(() => {
    const w = pendingWin.current;
    if (!w || wantKey !== scopeKey) return;
    if (fullData) {
      pendingWin.current = null;
      printDocInto(w, departmentPerformancePrint({ totals: fullData.totals, daily: fullData.daily, ...printArgsRef.current }));
    } else if (fullError) {
      pendingWin.current = null;
      showInWindow(w, "Couldn't load the Department Performance report. Close this window and try again.");
    }
  }, [fullData, fullError, wantKey, scopeKey]);
  useEffect(() => {
    if (!bridge || !data.allowed) return;
    bridge.set({
      print: {
        run: () => {
          const w = window.open("", "_blank"); // inside the tap
          if (!w) return;
          showInWindow(w, "Preparing the report…");
          pendingWin.current = w;
          setWantKey(scopeKey); // starts the fetch; an already-cached full payload fills the window straight away
          if (fullData && wantKey === scopeKey) {
            pendingWin.current = null;
            printDocInto(w, departmentPerformancePrint({ totals: fullData.totals, daily: fullData.daily, ...printArgsRef.current }));
          }
        },
      },
      "efficiency-a4": { run: () => window.open(efficiencyReportUrl(range.to), "_blank", "noopener") },
    });
    return () => bridge.set(null);
  }, [bridge, data.allowed, fullData, wantKey, scopeKey, range.to]);
  const n = filterCount(dept, cat);
  const base = thisMonthRange(today);
  const isDefaultPeriod = range.from === base.from && range.to === base.to;
  const roundBtn = (on: boolean): CSSProperties => ({
    position: "relative",
    flex: "none",
    width: 38,
    height: 38,
    borderRadius: "50%",
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

  function setFilters(nextDept: string, nextCat: typeof cat) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextDept) next.set("dpd", nextDept);
        else next.delete("dpd");
        if (nextCat) next.set("dpc", nextCat);
        else next.delete("dpc");
        return next;
      },
      { replace: true },
    );
    setDay(null);
  }

  if (!data.permLoading && !data.allowed) {
    return (
      <div role="status" style={{ margin: "16px 18px", background: "#FFFFFF", borderRadius: 16, padding: "26px 20px", textAlign: "center", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)" }}>
        <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", background: "#F0ECE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={20} strokeWidth={1.9} color="#6B5C32" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>No access to Department Performance</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4 }}>Needs workers:read.</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: "12px 18px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <section aria-label="Summary" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {kpiCells(totals).map((k) => (
            <div key={k.l} style={{ minWidth: 0, minHeight: 66, boxSizing: "border-box", padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6, background: "#FFFFFF", borderRadius: 14, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 10px 24px -16px rgba(31,29,27,.24)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.3, color: "#6B5C32", textTransform: "uppercase", whiteSpace: "nowrap" }}>{k.l}</div>
              <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1, color: k.fg, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{k.v}</div>
            </div>
          ))}
        </section>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 0" }}>
          <button type="button" onClick={() => setPeriodOpen(true)} aria-label={`Period: ${label}`} aria-haspopup="dialog" style={roundBtn(!isDefaultPeriod)}>
            <CalendarDays size={16} strokeWidth={2} />
          </button>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>Daily Breakdown</span>
            <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {scope} · {label}
            </span>
          </span>
          <button type="button" onClick={() => setFilterOpen(true)} aria-label="Filter by department and category" aria-haspopup="dialog" style={roundBtn(n > 0)}>
            <ArrowUpDown size={16} strokeWidth={2} />
            {n > 0 ? (
              <span style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: "#9A3A2D", color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #FAF8F4" }}>{n}</span>
            ) : null}
          </button>
        </div>

        {data.permLoading || (data.list.loading && !data.list.data) ? <Status>Loading department performance…</Status> : null}
        {data.list.error && !data.list.data && !data.list.loading ? <Status>Couldn't load department performance for this period.</Status> : null}
        {data.list.data && cards.length === 0 ? <Status>No working hours in the selected period.</Status> : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          {cards.map((d) => (
            <section key={d.date} style={{ ...SHEET_CARD, overflow: "hidden" }}>
              <button type="button" onClick={() => setDay(d.date)} aria-label={`Open ${d.label}`} aria-haspopup="dialog" style={{ width: "100%", display: "block", padding: "12px 14px", border: "none", background: "#FFFFFF", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{d.label}</span>
                  <span style={{ display: "flex", color: "#8B7A4E" }}>
                    <ChevronRight size={17} strokeWidth={2} />
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", marginTop: 9, padding: "9px 10px", borderRadius: 10, background: "#FAF8F4" }}>
                  {[
                    { k: "Hours worked", v: d.hours, fg: M.raisin, w: 600 },
                    { k: "Earned time", v: d.earned, fg: M.raisin, w: 600 },
                    { k: "Efficiency %", v: d.eff, fg: d.fg, w: 700 },
                  ].map((t) => (
                    <div key={t.k} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{t.k}</div>
                      <div style={{ fontSize: 12.5, fontWeight: t.w, color: t.fg, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                    </div>
                  ))}
                </div>
              </button>
            </section>
          ))}
        </div>
        <div style={{ height: 96 }} />
      </div>

      {day ? (
        <DeptPerfDayPage
          date={day}
          title={scope}
          day={data.detail.data?.daily.find((x) => x.date === day) ?? null}
          loading={data.detail.loading}
          error={data.detail.error}
          onClose={() => setDay(null)}
        />
      ) : null}
      <PeriodSheet open={periodOpen} onClose={() => setPeriodOpen(false)} range={range} today={today} onApply={(r) => setRange(r)} />
      <DeptPerfFilterSheet open={filterOpen} dept={dept} cat={cat} depts={deptOptions} onApply={setFilters} onClose={() => setFilterOpen(false)} />
    </>
  );
}

