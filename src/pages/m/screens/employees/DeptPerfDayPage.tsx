// DeptPerfDayPage — the full-page day detail of Department Performance (Employees 3.dc.html `dpd`): Back, the department / scope as the
// TITLE with the date underneath, the day's three figures, then "Workers" — each expandable to the job cards that earned the time.
// The data is that single date from the same endpoint with the same department and category filters (use-department-performance.ts).
// A helper worker carries a "Helper" tag and "—" for efficiency, as the API flags it. Read-only.
import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft } from "lucide-react";
import { M } from "../../theme";
import { dayWorkers, dmy, effColor, type DpDaily } from "./department-performance-model";
import { fmtHM } from "./efficiency-model";
import { initialsOf } from "./employee-performance-model";
import { CARD, SHEET_CARD } from "./employees-styles";

const Status = ({ children }: { children: string }) => (
  <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
    {children}
  </div>
);

export default function DeptPerfDayPage({
  date,
  title,
  day,
  loading,
  error,
  onClose,
}: {
  date: string;
  title: string;
  day: DpDaily | null;
  loading: boolean;
  error: boolean;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const workers = dayWorkers(day);
  const has = !!day && day.workingMinutes > 0;
  const stats = day
    ? [
        { k: "Hours worked", v: day.workingMinutes > 0 ? fmtHM(day.workingMinutes) : "—", fg: M.raisin, w: 600 },
        { k: "Earned time", v: day.productionMinutes > 0 ? fmtHM(day.productionMinutes) : "—", fg: M.raisin, w: 600 },
        { k: "Efficiency %", v: has ? `${day.efficiencyPct.toFixed(1)}%` : "—", fg: effColor(day.efficiencyPct, has), w: 700 },
      ]
    : [];

  return (
    <div role="dialog" aria-modal="true" aria-label={`${title}, ${dmy(date)}`} style={{ position: "fixed", inset: 0, zIndex: 70, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, minHeight: 52, padding: "env(safe-area-inset-top, 0px) 14px 0 8px", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={24} strokeWidth={1.9} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
            <CalendarDays size={13} strokeWidth={2} color="#8B7A4E" />
            {dmy(date)}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 18px 40px" }}>
        {loading && !day ? <Status>Loading this day…</Status> : null}
        {error && !day ? <Status>Couldn't load this day.</Status> : null}
        {!loading && !error && !day ? <Status>No working hours logged on this date.</Status> : null}
        {day ? (
          <>
            <div style={{ ...SHEET_CARD, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", padding: "12px 14px", marginBottom: 14 }}>
              {stats.map((t) => (
                <div key={t.k} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{t.k}</div>
                  <div style={{ fontSize: 14, fontWeight: t.w, color: t.fg, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 8px" }}>
              <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32", textTransform: "uppercase" }}>Workers</span>
              <span aria-hidden="true" style={{ flex: 1, height: 1, background: "#E6E0D9" }} />
              <span style={{ flex: "none", fontSize: 12, color: M.ink }}>
                {workers.length} worker{workers.length === 1 ? "" : "s"}
              </span>
            </div>
            {workers.length === 0 ? <Status>No working hours logged on this date.</Status> : null}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
              {workers.map((w) => {
                const on = !!open[w.id];
                return (
                  <section key={w.id} style={{ ...SHEET_CARD, overflow: "hidden" }}>
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [w.id]: !o[w.id] }))} aria-expanded={on} style={{ width: "100%", display: "block", padding: "12px 14px", border: "none", background: "#FFFFFF", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span aria-hidden="true" style={{ width: 30, height: 30, flex: "none", borderRadius: "50%", background: "#F4EFE6", color: "#6B5C32", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{initialsOf(w.name)}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</span>
                          {w.isHelper ? (
                            <span title="Helper — assists others; no personal efficiency, no efficiency allowance" style={{ flex: "none", display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, background: "#F1ECE4", color: "#6B5C32", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>Helper</span>
                          ) : null}
                        </span>
                        <span style={{ display: "flex", transform: on ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: "#8B7A4E" }}>
                          <ChevronDown size={16} strokeWidth={2} />
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", marginTop: 10, padding: "9px 10px", borderRadius: 10, background: "#FAF8F4" }}>
                        {[
                          { k: "Hours worked", v: w.hours, fg: M.raisin, wt: 600 },
                          { k: "Earned time", v: w.earned, fg: M.raisin, wt: 600 },
                          { k: "Efficiency %", v: w.eff, fg: w.fg, wt: 700 },
                        ].map((t) => (
                          <div key={t.k} style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{t.k}</div>
                            <div style={{ fontSize: 12.5, fontWeight: t.wt, color: t.fg, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                          </div>
                        ))}
                      </div>
                    </button>
                    {on ? (
                      <div style={{ padding: "0 14px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 10px", borderRadius: "8px 8px 0 0", background: "#F4EFE6", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#6B5C32" }}>
                          <span>Job card · {w.jobs.length}</span>
                          <span>Earned time</span>
                        </div>
                        <div style={{ borderRadius: "0 0 8px 8px", boxShadow: "inset 0 0 0 1px #EEE9E4", overflow: "hidden" }}>
                          {w.jobs.length === 0 ? <div style={{ padding: "9px 10px", fontSize: 12, color: "#9A9082" }}>No completed job cards on this date.</div> : null}
                          {w.jobs.map((j, i) => (
                            <div key={j.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 10px", borderTop: i ? "1px solid #EEE9E4" : "none", background: "#FFFFFF" }}>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{j.title}</span>
                                <span style={{ display: "block", fontSize: 11, color: "#6B7280", marginTop: 2 }}>{[j.code, j.po].filter(Boolean).join(" · ")}</span>
                              </span>
                              <span style={{ flex: "none", fontSize: 12.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{j.earned}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
