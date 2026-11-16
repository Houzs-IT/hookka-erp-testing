// WorkingHoursSection — Employees → Working Hours (Employees 3.dc.html), VIEW-ONLY (HK-0125 Phase 2).
//
// Top: Time adjustment requests (AdjustmentRequests). Below: Daily working hours — one card per worker per day
// (name, the day's total tag, punch in / out) with the Department / Category / Hours / Notes table inline under the punch
// times, as in the approved HTML (minus its Edit / Delete buttons). Opens on the whole current Malaysia month; the date button narrows to one
// work day, the search finds a name or employee number, a chip filters by department. Edit, Delete and the desktop-only
// "Copy / Print" actions are not offered. Data: the existing working-hour-entries, attendance, workers and departments
// endpoints; nothing is written.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Clock, Search } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMYForReads } from "@/lib/staging-today";
import { M } from "../../theme";
import { AdjustmentRequests } from "./AdjustmentRequests";
import DatePickButton from "./DatePickButton";
import { MIN_DATE } from "./employees-dates";
import { dayHeading, fmtHours } from "./employees-format";
import { CARD, CARD_HEAD, CARD_TITLE, COUNT_PILL, INNER, LINK_BUTTON, SEARCH_BOX, SEARCH_INPUT, TAG_TONE } from "./employees-styles";
import { rowsOf } from "./time-adjustments-model";
import { useCanReadAttendance, type AdjustmentList } from "./use-time-adjustments";
import {
  WH_PARAMS,
  applyFilters,
  buildRows,
  deptOptions,
  groupByDate,
  limitGroups,
  windowFor,
  type WhDept,
  type WhEntry,
  type WhPunch,
  type WhRow,
  type WhWorker,
} from "./working-hours-model";

const PREVIEW_ROWS = 5;

export default function WorkingHoursSection({ pending }: { pending: AdjustmentList & { allowed: boolean } }) {
  const [params, setParams] = useSearchParams();
  const today = todayYmdMYForReads();
  const q = params.get("q") ?? "";
  const wdate = /^\d{4}-\d{2}-\d{2}$/.test(params.get("wdate") ?? "") ? (params.get("wdate") as string) : "";
  const dept = params.get("wdept") ?? "";
  const [showAll, setShowAll] = useState(false);

  const setParam = (key: (typeof WH_PARAMS)[number], value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const win = windowFor(wdate, today);
  const canReadPunches = useCanReadAttendance();
  const entriesRes = useCachedJson<unknown>(`/api/working-hour-entries?from=${win.from}&to=${win.to}`, 120);
  const punchRes = useCachedJson<unknown>(canReadPunches ? `/api/attendance?from=${win.from}&to=${win.to}` : null, 120);
  const workersRes = useCachedJson<unknown>("/api/workers", 300);
  const deptsRes = useCachedJson<unknown>("/api/departments", 300);

  const depts = useMemo(() => rowsOf<WhDept>(deptsRes.data), [deptsRes.data]);
  const deptName = (code: string) => depts.find((d) => d.code === code)?.name || code;

  const rows: WhRow[] = useMemo(
    () => buildRows(rowsOf<WhEntry>(entriesRes.data), rowsOf<WhPunch>(punchRes.data), rowsOf<WhWorker>(workersRes.data), depts),
    [entriesRes.data, punchRes.data, workersRes.data, depts],
  );

  const filters = { q, date: wdate, dept };
  const filtered = useMemo(() => applyFilters(rows, filters), [rows, q, wdate, dept]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => deptOptions(rows, filters), [rows, q, wdate, dept]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupByDate(filtered), [filtered]);
  const visible = showAll ? groups : limitGroups(groups, PREVIEW_ROWS);
  const loadingFirst = entriesRes.data === null && entriesRes.loading;
  const failed = entriesRes.data === null && !entriesRes.loading && !!entriesRes.error;

  return (
    <>
      <AdjustmentRequests pending={pending} deptName={deptName} />

      <section aria-label="Daily working hours" style={{ ...CARD, margin: "12px 18px 0" }}>
        <div style={CARD_HEAD}>
          <Clock size={16} strokeWidth={2} color="#6B5C32" />
          <span style={CARD_TITLE}>Daily working hours</span>
          <span style={COUNT_PILL}>{filtered.length}</span>
        </div>
        <div style={{ display: "grid", gap: 8, padding: "0 10px 10px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={SEARCH_BOX}>
              <Search size={16} strokeWidth={1.9} color={M.muted} />
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setParam("q", e.target.value);
                  setShowAll(false);
                }}
                placeholder="Name or employee no…"
                className="emp-ph"
                aria-label="Search by employee name or number"
                style={SEARCH_INPUT}
              />
            </label>
            <DatePickButton
              value={wdate}
              min={MIN_DATE}
              max={today}
              onPick={(d) => {
                setParam("wdate", d);
                setShowAll(false);
              }}
              ariaLabel={wdate ? `Work date ${dayHeading(wdate)}. Change date` : "Filter by work date"}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: wdate ? M.taupe : M.card,
                boxShadow: wdate ? "0 6px 14px -6px rgba(107,92,50,.6)" : "inset 0 0 0 1px #E6E0D9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: wdate ? "#FFFFFF" : M.taupe,
              }}
            >
              <CalendarDays size={17} strokeWidth={2} />
            </DatePickButton>
          </div>

          <div role="group" aria-label="Department" style={{ display: "flex", gap: 8, overflowX: "auto", margin: "0 -10px", padding: "2px 10px 4px", scrollbarWidth: "none" }}>
            {options.map((o) => {
              const on = dept === o.code;
              return (
                <button
                  key={o.code || "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setParam("wdept", o.code);
                    setShowAll(false);
                  }}
                  style={{
                    flex: "none",
                    height: 34,
                    padding: "0 13px",
                    borderRadius: 999,
                    border: "none",
                    background: on ? M.taupe : M.card,
                    color: on ? "#FFFFFF" : M.ink,
                    boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)",
                    fontFamily: "inherit",
                    fontSize: 12.5,
                    fontWeight: on ? 700 : 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {o.name}
                  <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>{o.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadingFirst ? <Note>Loading working hours…</Note> : null}
        {failed ? <Note>Couldn't load working hours.</Note> : null}
        {!loadingFirst && !failed && rows.length === 0 ? <Note>No working hours recorded in this period.</Note> : null}
        {!loadingFirst && !failed && rows.length > 0 && filtered.length === 0 ? <Note>No entries match these filters.</Note> : null}

        <div style={{ display: "grid", gap: 12, padding: "0 10px 10px" }}>
          {visible.map((g) => (
            <div key={g.date}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "2px 4px 6px" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: M.taupe, textTransform: "uppercase" }}>{g.title}</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {g.rows.map((r) => (
                  <HoursCard key={r.key} r={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
        {filtered.length > PREVIEW_ROWS ? (
          <button type="button" onClick={() => setShowAll((v) => !v)} style={LINK_BUTTON}>
            {showAll ? "Show fewer" : `Show all ${filtered.length}`}
          </button>
        ) : null}
      </section>

    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "0 14px 12px", fontSize: 12.5, color: M.ink }}>{children}</div>;
}

/** One worker's day, as in the HTML: name + day-total tag, punch in / out, then the department table. Read-only. */
function HoursCard({ r }: { r: WhRow }) {
  const tone = TAG_TONE[r.tag.tone];
  return (
    <div style={INNER}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.name}
        </span>
        <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {r.tag.label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
        <Clock size={13} strokeWidth={2} color="#8B7A4E" />
        <span>Punch in / out</span>
        <span style={{ fontWeight: 700, color: M.raisin }}>
          {r.punchIn ?? "—"} → {r.punchOut ?? "—"}
        </span>
      </div>
      {r.segs.length > 1 ? <div style={{ fontSize: 11, color: M.muted, marginTop: 3 }}>Split the day’s hours across the departments</div> : null}

      <div style={{ marginTop: 8, borderRadius: 9, background: M.card, boxShadow: "inset 0 0 0 1px #EEE9E4", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 46px", gap: 6, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: M.muted, textTransform: "uppercase" }}>
          <span>Department</span>
          <span>Category</span>
          <span style={{ textAlign: "right" }}>Hours</span>
        </div>
        {r.segs.map((s, i) => (
          <div key={`${s.deptCode}-${s.category}-${i}`} style={{ padding: "6px 10px", borderTop: "1px solid #F0ECE9" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 46px", gap: 6, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ minWidth: 0, color: M.raisin, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.deptName}</span>
              <span style={{ minWidth: 0, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.category ? s.category.charAt(0) + s.category.slice(1).toLowerCase() : "n/a"}</span>
              <span style={{ textAlign: "right", fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtHours(s.hours)} h</span>
            </div>
            <div style={{ fontSize: 11.5, color: s.notes ? M.raisin : M.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: M.muted }}>Notes:</span> {s.notes || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
