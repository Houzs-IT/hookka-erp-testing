// EmployeePerformanceSection — Employees → Employee Performance (Employees 3.dc.html `sec.isEP`), VIEW-ONLY (HK-0125 Phase 4, step 2).
//
// Period chips + calendar, the worker picker, an info card, six summary tiles and the Daily Breakdown (the worker's completed job
// cards: top 5, then "View all N items" on its own page). The worker and the range come from the URL, so a tap on the Efficiency
// Overview ranking lands here with the SAME worker and range, and the efficiency shown is the ranking's own: this screen builds
// the worker's row with the same `buildEfficiencyRows` from the same cached requests (see employee-performance-model.ts).
// Extra Production Time is a separate display-only tile that is shown only when it can be verified. Nothing is written.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft } from "lucide-react";
import { M } from "../../theme";
import BreakdownCard from "./BreakdownCard";
import BreakdownPage from "./BreakdownPage";
import { buildEfficiencyRows, efficiencyTone, fmtHM, statCells } from "./efficiency-model";
import {
  activeChip,
  backToEfficiency,
  breakdownRows,
  epChips,
  extraProduction,
  initialsOf,
  pickerWorkers,
  resolveWorker,
  statusTone,
  totalOtMinutes,
  workerLabel,
  type EpWorker,
} from "./employee-performance-model";
import { thisMonthRange } from "./employees-dates";
import { shortDate } from "./employees-format";
import { CARD, SHEET_CARD } from "./employees-styles";
import { useMenuBridge } from "./menu-context";
import { employeePerformancePrint } from "./menu-prints";
import { runPrintDoc } from "./run-print";
import { PeriodSheet } from "./PeriodSheet";
import { useEmployeeExtras } from "./use-employee-performance";
import { efficiencyState, useEfficiency } from "./use-efficiency";
import { useEmployeesPeriod } from "./use-employees-period";
import WorkerPickerSheet from "./WorkerPickerSheet";

const PREVIEW = 5;

const Status = ({ children }: { children: ReactNode }) => (
  <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
    {children}
  </div>
);

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

export default function EmployeePerformanceSection() {
  const { range, label, today, setRange } = useEmployeesPeriod();
  const [params, setParams] = useSearchParams();
  const fromRanking = params.get("ref") === "efficiency";
  const [periodOpen, setPeriodOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);

  const base = useEfficiency(range);
  const { loading, failed, earnedMissing, ready } = efficiencyState(base);
  const roster = (base.workers.rows ?? []) as EpWorker[];
  const worker = ready ? resolveWorker(params.get("worker"), roster) : null;
  const workerId = worker?.id ?? "";
  const extras = useEmployeeExtras(base, range, workerId);

  const deptName = (code: string) => {
    const d = base.depts.rows?.find((x) => x.code === code);
    return d?.shortName || d?.name || code;
  };

  // The worker's efficiency row: the SAME function and inputs as the ranking.
  const effRows = ready && base.workers.rows && base.hours.rows && base.depts.rows
    ? buildEfficiencyRows({ workers: base.workers.rows, hours: base.hours.rows, earned: earnedMissing ? null : base.earned.rows, depts: base.depts.rows })
    : null;
  const row = effRows?.find((r) => r.workerId === workerId) ?? null;
  const effText = row ? statCells(row)[4].v : "—";
  const tone = efficiencyTone(row?.eff ?? null);

  const cards = extras.cards.rows ? breakdownRows(extras.cards.rows, deptName) : null;
  const summaryMin = earnedMissing ? null : (row?.earnedMin ?? 0);
  const extra = extraProduction({ workerId, range, claims: extras.claims.rows, cards: extras.cards.rows, summaryMin });
  const otMin = extras.attendance.rows ? totalOtMinutes(extras.attendance.rows, workerId) : null;

  function setWorker(id: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("worker", id);
        return next;
      },
      { replace: true },
    );
    setPickerOpen(false);
    setPageOpen(false);
  }

  const base34 = thisMonthRange(today);
  const isDefaultPeriod = range.from === base34.from && range.to === base34.to;
  const chipOn = activeChip(range, today);
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

  const tiles: { l: string; v: string; fg: string }[] = row || ready
    ? [
        { l: "Hours worked", v: row && row.prodHours > 0 ? fmtHM(row.prodHours * 60) : "—", fg: M.raisin },
        { l: "Non-Production Hours", v: row && row.nonProdHours > 0 ? fmtHM(row.nonProdHours * 60) : "—", fg: M.raisin },
        { l: "Extra Production Time", v: extra.state === "ok" && extra.minutes > 0 ? fmtHM(extra.minutes) : "—", fg: M.raisin },
        { l: "Efficiency", v: effText, fg: tone.fg },
        { l: "Days Present", v: String(row?.days ?? 0), fg: M.raisin },
        { l: "Total OT", v: otMin !== null && otMin > 0 ? fmtHM(otMin) : "—", fg: M.raisin },
      ]
    : [];

  // "..." → Print Report for the SELECTED employee: the tiles + the Daily Breakdown rows, as desktop's Employee Performance prints.
  const bridge = useMenuBridge();
  const printable = !!worker && cards !== null;
  useEffect(() => {
    if (!bridge || !printable || !worker || !cards) return;
    bridge.set({ print: { run: () => runPrintDoc(employeePerformancePrint({ workerLabel: workerLabel(worker), range, tiles, effPct: row?.eff ?? null, rows: cards })) } });
    return () => bridge.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tiles` / `cards` derive from the loaded data; re-register when it changes
  }, [bridge, printable, worker?.id, row, extras.cards.rows, extras.claims.rows, extras.attendance.rows, range.from, range.to]);

  const info: { k: string; v: ReactNode; w: number }[] = worker
    ? [
        { k: "Name", v: worker.name || worker.id, w: 700 },
        { k: "Department", v: worker.departmentCode ? deptName(worker.departmentCode) : "—", w: 500 },
        { k: "Position", v: worker.position || "—", w: 500 },
        { k: "Join Date", v: worker.joinDate ? shortDate(worker.joinDate.slice(0, 10)) : "—", w: 500 },
        {
          k: "Status",
          w: 500,
          v: (() => {
            const t = statusTone(worker.status);
            return <span style={{ display: "inline-flex", alignItems: "center", height: 20, marginTop: 1, padding: "0 8px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: 11, fontWeight: 700 }}>{t.label}</span>;
          })(),
        },
      ]
    : [];

  return (
    <>
      {fromRanking ? (
        <div style={{ padding: "10px 12px 0" }}>
          <button
            type="button"
            onClick={() => setParams((prev) => backToEfficiency(prev), { replace: true })}
            style={{ height: 36, padding: "0 10px 0 4px", border: "none", background: "none", display: "inline-flex", alignItems: "center", gap: 2, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "#6B5C32", cursor: "pointer" }}
          >
            <ChevronLeft size={18} strokeWidth={2} />
            Efficiency Overview
          </button>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: fromRanking ? "4px 18px 4px" : "14px 18px 4px" }}>
        <button type="button" onClick={() => setPeriodOpen(true)} aria-label={`Period: ${label}`} title={label} aria-haspopup="dialog" style={dateBtn}>
          <CalendarDays size={16} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {epChips(today).map((c) => (
            <button key={c.key} type="button" aria-pressed={chipOn === c.key} onClick={() => setRange(c.range)} style={chipStyle(chipOn === c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 18px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        {loading ? <Status>Loading employee…</Status> : null}
        {!base.permLoading && !base.canWorkers ? <Status>Employee Performance needs access to employee records.</Status> : null}
        {failed ? <Status>Couldn't load this employee for the period.</Status> : null}
        {ready && !worker ? <Status>No employees available.</Status> : null}

        {worker ? (
          <>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
              aria-label={`Employee: ${workerLabel(worker)}. Change`}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "none", background: "#FFFFFF", borderRadius: 14, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 10px 24px -16px rgba(31,29,27,.24)", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              <span aria-hidden="true" style={{ width: 38, height: 38, flex: "none", borderRadius: "50%", background: "#F4EFE6", color: "#6B5C32", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {initialsOf(worker.name || worker.id)}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{workerLabel(worker)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#6B5C32" }}>Change</span>
            </button>

            <section aria-label="Employee info" style={{ ...SHEET_CARD, padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px 14px" }}>
              {info.map((t) => (
                <div key={t.k} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{t.k}</div>
                  <div style={{ fontSize: 13, fontWeight: t.w, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.v}</div>
                </div>
              ))}
            </section>

            {earnedMissing ? (
              <div role="status" style={{ ...CARD, padding: "11px 14px", fontSize: 12.5, lineHeight: 1.45, color: "#85600F", background: "#FAEFCB" }}>
                {base.canEarned ? "Couldn't load Earned time, so efficiency isn't shown for this period." : "Earned time needs access to production orders, so efficiency isn't shown."}
              </div>
            ) : null}

            <section aria-label="Summary" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {tiles.map((k) => (
                <div key={k.l} style={{ ...SHEET_CARD, borderRadius: 12, padding: 10, minWidth: 0, textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: k.fg, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{k.v}</div>
                  <div style={{ fontSize: 11, color: M.ink, marginTop: 2, lineHeight: 1.25 }}>{k.l}</div>
                </div>
              ))}
            </section>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 0" }}>
              <CalendarDays size={15} strokeWidth={2} color="#6B5C32" />
              <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin }}>Daily Breakdown</span>
              <span aria-hidden="true" style={{ flex: 1, minWidth: 8, height: 1, background: "#E6E0D9" }} />
              <span style={{ flex: "none", fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>{cards ? `${cards.length} item${cards.length === 1 ? "" : "s"}` : ""}</span>
            </div>

            {!base.canEarned ? <Status>Job cards need access to production orders.</Status> : null}
            {base.canEarned && cards === null ? <Status>{extras.cards.loading ? "Loading job cards…" : "Couldn't load job cards."}</Status> : null}
            {cards && cards.length === 0 ? <Status>No completed items found for this worker in the selected period.</Status> : null}
            {cards && cards.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
                {cards.slice(0, PREVIEW).map((r) => (
                  <BreakdownCard key={r.key} r={r} />
                ))}
              </div>
            ) : null}
            {cards && cards.length > PREVIEW ? (
              <button type="button" onClick={() => setPageOpen(true)} style={{ width: "100%", height: 42, border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#6B5C32", cursor: "pointer" }}>
                View all {cards.length} items ›
              </button>
            ) : null}
            <div style={{ height: 96 }} />
          </>
        ) : null}
      </div>

      <PeriodSheet open={periodOpen} onClose={() => setPeriodOpen(false)} range={range} today={today} onApply={(r) => setRange(r)} />
      <WorkerPickerSheet open={pickerOpen} workers={pickerWorkers(roster, workerId)} selectedId={workerId} deptName={deptName} onPick={setWorker} onClose={() => setPickerOpen(false)} />
      {pageOpen && cards && worker ? <BreakdownPage rows={cards} who={workerLabel(worker)} periodLabel={label} onClose={() => setPageOpen(false)} /> : null}
    </>
  );
}
