// EfficiencySection — Employees → Efficiency Overview (Employees 3.dc.html `sec.isEFF`), VIEW-ONLY (HK-0125 Phase 4, step 1).
//
// A search box + the period button, then "N WORKERS · {period}" and one ranked card per worker: rank badge (only when the worker
// has a valid personal efficiency), "EMP-001 — Name", six stats (Total, Earned time, Hours worked, Non-Prod Hrs, Efficiency %,
// Days) and the department-hours chips. Top 5, then "Show all N". Every figure follows the shared period (URL from / to).
// A card opens Employee Performance for that worker with the same range and the search carried along (a pushed history entry,
// so Back returns here). Nothing is written. Rules and numbers: efficiency-model.ts; data: use-efficiency.ts.
import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronRight, Search } from "lucide-react";
import { M } from "../../theme";
import { EFF_PREVIEW, buildEfficiencyRows, efficiencyTone, filterEfficiencyRows, rankTone, statCells, whyNoEfficiency, type EffRow } from "./efficiency-model";
import { toEmployeePerformance } from "./employee-performance-model";
import { thisMonthRange } from "./employees-dates";
import { CARD, SHEET_CARD } from "./employees-styles";
import { useMenuBridge } from "./menu-context";
import { efficiencyPrint } from "./menu-prints";
import { runPrintDoc } from "./run-print";
import { PeriodSheet } from "./PeriodSheet";
import { efficiencyState, useEfficiency } from "./use-efficiency";
import { useEmployeesPeriod } from "./use-employees-period";

const Status = ({ children }: { children: React.ReactNode }) => (
  <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
    {children}
  </div>
);

const STAT_COLOR = { plain: M.raisin, muted: "#9A9082" } as const;

function WorkerCard({ r, onOpen }: { r: EffRow; onOpen: () => void }) {
  const tone = efficiencyTone(r.eff);
  const badge = r.rank !== null ? rankTone(r.rank) : null;
  const why = whyNoEfficiency(r);
  return (
    <button
      type="button"
      className="eff-card"
      onClick={onOpen}
      aria-label={`${r.name}, ${r.rank !== null ? `rank ${r.rank}, ` : ""}efficiency ${r.eff === null ? "none" : `${(Math.round(r.eff * 10) / 10).toFixed(1)} percent`}. Open Employee Performance`}
      style={{ ...SHEET_CARD, width: "100%", display: "block", padding: "12px 14px", border: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {badge && r.rank !== null ? (
          <span
            aria-label={`Rank ${r.rank}`}
            style={{ flex: "none", minWidth: 26, height: 26, padding: "0 6px", boxSizing: "border-box", borderRadius: 8, background: badge.bg, color: badge.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          >
            {r.rank}
          </span>
        ) : null}
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.empNo ? `${r.empNo} — ${r.name}` : r.name}
        </span>
        <ChevronRight size={16} strokeWidth={2} color="#B5AC9C" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", marginTop: 10, padding: "9px 10px", borderRadius: 10, background: "#FAF8F4" }}>
        {statCells(r).map((c) => (
          <div key={c.k} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{c.k}</div>
            <div style={{ fontSize: 12.5, fontWeight: c.kind === "eff" ? 700 : 600, color: c.kind === "eff" ? tone.fg : STAT_COLOR[c.kind], marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{c.v}</div>
          </div>
        ))}
      </div>
      {r.chips.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {r.chips.map((c) => (
            <span
              key={c.label}
              style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 6, background: c.production ? "#EEF3E4" : "#FAEFCB", color: c.production ? "#4F7C3A" : "#9C6F1E", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
            >
              {c.label} {(Math.round(c.hours * 10) / 10).toFixed(1)}h
            </span>
          ))}
        </div>
      ) : null}
      {why ? <div style={{ fontSize: 11.5, color: "#9A9082", marginTop: 6 }}>{why}</div> : null}
    </button>
  );
}

export default function EfficiencySection() {
  const { range, label, today, setRange } = useEmployeesPeriod();
  const [params, setParams] = useSearchParams();
  const q = params.get("eq") ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [all, setAll] = useState(false);
  const data = useEfficiency(range);

  function setQ(value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("eq", value);
        else next.delete("eq");
        return next;
      },
      { replace: true },
    );
  }

  // What is still to come / what failed decides the body. The cards only draw once every source they need has answered, so the
  // ranking never flashes in one order and settles in another.
  const base = thisMonthRange(today);
  const isDefaultPeriod = range.from === base.from && range.to === base.to;
  const { loading, failed, earnedMissing, ready } = efficiencyState(data);

  const rows =
    ready && data.workers.rows && data.hours.rows && data.depts.rows
      ? buildEfficiencyRows({ workers: data.workers.rows, hours: data.hours.rows, earned: earnedMissing ? null : data.earned.rows, depts: data.depts.rows })
      : null;
  const found = rows ? filterEfficiencyRows(rows, q) : [];
  const shown = all ? found : found.slice(0, EFF_PREVIEW);
  const count = `${found.length} worker${found.length === 1 ? "" : "s"}`;

  // "..." → Print report: the rows on screen (the search applied), as desktop's Efficiency Overview prints its grid.
  const bridge = useMenuBridge();
  const printable = found.length > 0;
  useEffect(() => {
    if (!bridge || !printable) return;
    bridge.set({ print: { run: () => runPrintDoc(efficiencyPrint(found, range)) } });
    return () => bridge.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `found` is derived from `rows` + `q`; re-register when those change
  }, [bridge, printable, rows, q, range.from, range.to]);

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

  return (
    <>
      <style>{".eff-card:active{background:#FAF8F4!important}"}</style>
      <div style={{ padding: "14px 18px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ flex: 1, minWidth: 0, height: 40, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: "#FFFFFF", borderRadius: 12, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 8px 22px -10px rgba(31,29,27,.18)" }}>
          <Search size={17} strokeWidth={1.75} color="#9CA3AF" />
          <input
            className="emp-ph"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employee name or no."
            aria-label="Search employees"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: M.raisin, padding: 0 }}
          />
        </label>
        <button type="button" onClick={() => setPickerOpen(true)} aria-label={`Period: ${label}`} aria-haspopup="dialog" style={dateBtn}>
          <CalendarDays size={16} strokeWidth={2} />
        </button>
      </div>

      <div style={{ padding: "12px 18px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "2px 4px 8px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32", textTransform: "uppercase" }}>{rows ? count : "Workers"}</span>
          <span style={{ minWidth: 0, fontSize: 12, fontWeight: 600, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{label}</span>
        </div>

        {data.permLoading || loading ? <Status>Loading efficiency…</Status> : null}
        {!data.permLoading && !data.canWorkers ? <Status>Efficiency needs access to employee records.</Status> : null}
        {failed ? <Status>Couldn't load efficiency for this period.</Status> : null}
        {earnedMissing ? (
          <div role="status" style={{ ...CARD, padding: "11px 14px", marginBottom: 10, fontSize: 12.5, lineHeight: 1.45, color: "#85600F", background: "#FAEFCB" }}>
            {data.canEarned
              ? "Couldn't load Earned time, so efficiency isn't shown for this period."
              : "Earned time needs access to production orders, so efficiency isn't shown."}
          </div>
        ) : null}

        {rows && found.length === 0 ? (
          <Status>{q.trim() ? `No employees match “${q.trim()}”.` : "No hours or production recorded in this period."}</Status>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          {shown.map((r) => (
            <WorkerCard key={r.workerId} r={r} onOpen={() => setParams((prev) => toEmployeePerformance(prev, r.workerId))} />
          ))}
        </div>
        {rows && found.length > EFF_PREVIEW ? (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            style={{ width: "100%", height: 42, marginTop: 10, border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#6B5C32", cursor: "pointer" }}
          >
            {all ? "Show less" : `Show all ${found.length}`}
          </button>
        ) : null}
        {rows ? (
          <div style={{ fontSize: 11.5, lineHeight: 1.45, color: M.ink, margin: "12px 4px 0" }}>
            Efficiency % = Earned time ÷ Hours worked. Non-Prod Hrs aren’t counted. Tap a worker for Employee Performance.
          </div>
        ) : null}
        <div style={{ height: 96 }} />
      </div>

      <PeriodSheet open={pickerOpen} onClose={() => setPickerOpen(false)} range={range} today={today} onApply={(r) => setRange(r)} />
    </>
  );
}
