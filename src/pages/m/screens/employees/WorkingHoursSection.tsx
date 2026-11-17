// WorkingHoursSection — Employees → Working Hours (Employees 3.dc.html), VIEW-ONLY (HK-0125 Phase 2).
//
// Top: Time adjustment requests (AdjustmentRequests). Below: Daily working hours — one card per worker per day
// (name, the day's total tag, punch in / out) with the Department / Category / Hours / Notes table inline under the punch
// times, as in the approved HTML (minus its Edit / Delete buttons). Only the first 5 show here; "View all N" opens a full page
// (HoursPage) like the Approved / Rejected adjustments. Opens on the whole current Malaysia month; the date button narrows to one
// work day, the search finds a name or employee number, a chip filters by department. Edit, Delete and the desktop-only
// actions are not offered. "..." offers Print and (with attendance:create) Copy yesterday / Copy from another date: drafts are built
// from another day and reviewed in CopySheet, and only its Save writes (working-hours-copy.ts). Data: the existing working-hour-entries,
// attendance, workers and departments endpoints.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronRight, Clock, Search } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { printReport, type PrintColumn } from "@/lib/print-report";
import { usePermissions } from "@/lib/use-permission";
import { todayYmdMYForReads } from "@/lib/staging-today";
import { M } from "../../theme";
import { AdjustmentRequests } from "./AdjustmentRequests";
import DatePickButton from "./DatePickButton";
import { MIN_DATE } from "./employees-dates";
import { dayHeading } from "./employees-format";
import { CARD, CARD_HEAD, CARD_TITLE, COUNT_PILL, LINK_BUTTON, SEARCH_BOX, SEARCH_INPUT } from "./employees-styles";
import HoursCard from "./HoursCard";
import CopySheet from "./CopySheet";
import { useMenuBridge } from "./menu-context";
import HoursPage from "./HoursPage";
import { rowsOf } from "./time-adjustments-model";
import { buildWorkingHoursPrint } from "./working-hours-print";
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
  const [pageOpen, setPageOpen] = useState(false);
  const [copyMode, setCopyMode] = useState<"yesterday" | "from" | null>(null);

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
  const visible = limitGroups(groups, PREVIEW_ROWS);

  // "..." menu → Print: registers while at least one entry matches the filters. It prints EVERY matching entry (not just the
  // first five cards) with the shared print engine desktop's Working Hours tab uses. Built from primitives so this effect
  // runs when the data or a filter changes, not on every render.
  const bridge = useMenuBridge();
  const printable = filtered.length > 0;
  const { hasPermission } = usePermissions();
  const canCopy = hasPermission("attendance", "create"); // the gate the server enforces on POST /api/working-hour-entries
  useEffect(() => {
    if (!bridge || (!printable && !canCopy)) return;
    bridge.set({
      ...(canCopy ? { "copy-yesterday": { run: () => setCopyMode("yesterday") }, "copy-from": { run: () => setCopyMode("from") } } : {}),
      ...(!printable ? {} : { print: { run: () => {
      const spec = buildWorkingHoursPrint({
        rows,
        filters: { q, date: wdate, dept },
        window: { from: win.from, to: win.to },
        deptName: (code) => depts.find((d) => d.code === code)?.name || code,
      });
      if (spec.entries === 0) return;
      const columns: PrintColumn[] = spec.columns.map((c, i) => ({ header: c.header, align: c.align, value: (r: unknown) => (r as string[])[i] }));
      printReport({ title: spec.title, filterSummary: spec.filterSummary, orientation: spec.orientation, cards: spec.cards, sections: [{ columns, rows: spec.rows }] });
    } } }),
    });
    return () => bridge.set(null);
  }, [bridge, printable, canCopy, rows, q, wdate, dept, win.from, win.to, depts]);
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
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, padding: "0 10px 10px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={SEARCH_BOX}>
              <Search size={16} strokeWidth={1.9} color={M.muted} />
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setParam("q", e.target.value);
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

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, padding: "0 10px 10px" }}>
          {visible.map((g) => (
            <div key={g.date} style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "2px 4px 6px" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: M.taupe, textTransform: "uppercase" }}>{g.title}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
                {g.rows.map((r) => (
                  <HoursCard key={r.key} r={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
        {filtered.length > PREVIEW_ROWS ? (
          <button type="button" onClick={() => setPageOpen(true)} style={{ ...LINK_BUTTON, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            View all {filtered.length}
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        ) : null}
      </section>

      {pageOpen ? <HoursPage rows={filtered} onClose={() => setPageOpen(false)} /> : null}
      {copyMode ? (
        <CopySheet
          open
          mode={copyMode}
          selectedDate={wdate}
          today={today}
          nameOf={(id) => rowsOf<WhWorker>(workersRes.data).find((w) => w.id === id)?.name || id}
          deptName={deptName}
          onClose={() => setCopyMode(null)}
        />
      ) : null}
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "0 14px 12px", fontSize: 12.5, color: M.ink }}>{children}</div>;
}
