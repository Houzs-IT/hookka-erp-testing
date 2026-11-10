// ---------------------------------------------------------------------------
// Dashboard › Operations › Floor Live (owner 2026-11-10).
// Who is in which department right now, from department QR scans
// (GET /api/dashboard/floor-live; rules in src/api/lib/floor-live.ts).
// Production cards: pieces done today + live efficiency. Non-production
// cards: when the worker scanned in, red after an hour. Refreshes every 5 min.
// Cards keep their own height (3 people next to 8 leaves no gap) and show at
// most 6 rows until "+N more"; on a phone they stack one per row.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useInterval } from "@/lib/scheduler";
import { useCachedJson } from "@/lib/cached-fetch";
import {
  floorLiveLayout, periodRange, summaryLayout,
  type FloorLiveResponse, type FloorLiveRow, type FloorSummaryResponse, type FloorSummaryRow,
} from "./floor-live-lib";
import type { Period } from "./dashboard-shared-lib";

const ROW_LIMIT = 6;
const REFRESH_MS = 5 * 60 * 1000;

// Owner 2026-11-10: efficiency turns red only below 80% (the number, not the
// row). A whole red row is reserved for the non-production 1-hour rule.
function effClass(e: number | null): string {
  if (e == null) return "text-[#6B7280]";
  if (e < 80) return "text-[#DC2626]";
  return "text-[#1F1D1B]";
}

/** Last department check-in (scan) today, else the punch-in time. */
const lastIn = (p: FloorLiveRow) => p.scannedAt ?? p.clockIn ?? "—";

// One grid for the header and every row, so each heading sits over its own
// column (owner 2026-11-10: "Done" sat crooked over the numbers).
const COLS = "grid grid-cols-[minmax(0,1fr)_3rem_2.25rem_2.75rem] items-center gap-x-2";

function Row({ p, production }: { p: FloorLiveRow; production: boolean }) {
  // Pale red row: a production worker below 80% (owner 2026-11-10), or a
  // non-production stay over an hour.
  const red = production ? p.effPct != null && p.effPct < 80 : p.overHourNonProd;
  return (
    <div className={`${COLS} border-t border-[#F3F0EC] px-3 py-1.5 text-xs tabular-nums ${red ? "bg-[#FBF3F1]" : "bg-white"}`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${p.clockOut ? "bg-[#9CA3AF]" : "bg-[#3E7A4F]"}`} aria-hidden="true" />
        <span className="truncate" title={p.name}>{p.name}</span>
      </span>
      {/* Production: last check-in to the department. Non-production: the
          scan-in time, red after an hour (the day's pieces and efficiency
          still show — owner 2026-11-10). */}
      <span
        className={`text-right ${!production && p.overHourNonProd ? "font-semibold text-[#DC2626]" : "text-[#6B7280]"}`}
        title={production ? "Last check-in to this department" : "Scanned in at"}
      >
        {lastIn(p)}
      </span>
      <span className="text-right font-semibold">{p.done}</span>
      <span className={`text-right font-semibold ${effClass(p.effPct)}`}>{p.effPct == null ? "—" : `${p.effPct}%`}</span>
    </div>
  );
}

function DeptCard({ name, rows, production, effPct }: { name: string; rows: FloorLiveRow[]; production: boolean; effPct: number | null }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, ROW_LIMIT);
  return (
    <div className="self-start overflow-hidden rounded-[10px] border border-[#E5E0D8] bg-white">
      <div className="flex items-center justify-between border-b border-[#EEE9E4] bg-[#F7F5F3] px-3 py-2">
        <span className="text-[13px] font-bold">
          {name} <span className="font-medium text-[#6B7280]">· {rows.length}</span>
        </span>
        {production && <span className={`text-xs font-bold ${effClass(effPct)}`}>{effPct == null ? "—" : `${effPct}%`}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-2.5 text-xs text-[#9CA3AF]">Nobody here today</div>
      ) : (
        <>
          <div className={`${COLS} px-3 py-1 text-[11px] text-[#9CA3AF]`}>
            <span>Worker</span>
            <span className="text-right">{production ? "In" : "Since"}</span>
            <span className="text-right">Done</span>
            <span className="text-right">Eff.</span>
          </div>
          {shown.map((p) => <Row key={p.id} p={p} production={production} />)}
          {rows.length > ROW_LIMIT && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="h-9 w-full border-t border-[#F3F0EC] bg-white text-xs font-semibold text-[#6B5C32] hover:bg-[#FAF9F7]"
            >
              {open ? "Show fewer" : `+${rows.length - ROW_LIMIT} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Dashboard › Operations › Floor Live. Day picked = the cards (today live,
 *  a past day = its saved end-of-day snapshot). Month / Quarter / Year = the
 *  per-worker summary over the saved days (owner 2026-11-10). */
export function FloorLiveView({ period, today, onPeriodChange }: { period: Period; today: string; onPeriodChange: (p: Period) => void }) {
  if (!period.day) return <FloorSummaryView period={period} today={today} onLiveNow={() => onPeriodChange({ ...period, day: today })} />;
  return <FloorDayView day={period.day} today={today} />;
}

function FloorDayView({ day, today }: { day: string; today: string }) {
  const pastDay = day < today;
  const { data, loading, error, refresh } = useCachedJson<FloorLiveResponse>(
    pastDay ? `/api/dashboard/floor-live?date=${day}` : "/api/dashboard/floor-live",
    0,
  );
  const [q, setQ] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);

  // Every 5 minutes, paused while the tab is hidden.
  useInterval(() => refresh(), pastDay ? null : REFRESH_MS);

  const layout = useMemo(() => (data?.success ? floorLiveLayout(data, { q, issuesOnly }) : null), [data, q, issuesOnly]);

  if (loading && !data) return <div className="py-10 text-sm text-[#6B7280]">Loading the floor…</div>;
  if (error || (data && data.success === false)) {
    return (
      <div className="flex flex-col items-start gap-2 py-6">
        <div className="text-sm font-medium text-[#9A3A2D]">Floor Live could not load.</div>
        <div className="text-xs text-[#6B7280]">{String(error ?? data?.error ?? "")}</div>
        <button type="button" onClick={() => refresh()} className="rounded border border-[#E5E0D8] px-3 py-1.5 text-sm hover:bg-[#FAF9F7]">Retry</button>
      </div>
    );
  }
  if (!layout) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF3EC] px-2 py-0.5 text-[11px] font-semibold text-[#2F5E3C]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3E7A4F]" aria-hidden="true" />
          {pastDay
            ? `END OF DAY · ${data?.date ?? day}${data?.frozen ? " · saved copy" : " · recomputed (no saved copy for this day)"}`
            : `LIVE · as of ${data?.asOf} · refreshes every 5 min`}
        </span>
        <span className="flex-1" />
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E0D8] bg-white px-2.5 text-xs text-[#6B7280] max-md:w-full">
          <span>Find</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#1F1D1B] outline-none md:w-36"
          />
        </label>
        <button
          type="button"
          onClick={() => setIssuesOnly((v) => !v)}
          className={`h-9 rounded-lg border px-3 text-xs font-semibold ${issuesOnly ? "border-[#9A3A2D] bg-[#9A3A2D] text-white" : "border-[#E8B2A1] bg-white text-[#9A3A2D]"}`}
        >
          Issues only
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ["Punched in", `${layout.totals.punched}`],
          ["Still in", `${layout.totals.stillIn}`],
          ["Pcs done today", `${layout.totals.done}`],
          ["Floor efficiency", layout.totals.effPct == null ? "—" : `${layout.totals.effPct}%`],
          ["Non-prod 1h+", `${layout.totals.overHour}`],
        ].map(([label, value], i) => (
          <div key={label} className="rounded-[10px] border border-[#E5E0D8] bg-white px-3 py-2">
            <div className="text-[11px] text-[#6B7280]">{label}</div>
            <div className={`text-lg font-bold tabular-nums ${i === 4 && layout.totals.overHour > 0 ? "text-[#9A3A2D]" : ""}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#6B5C32]">Production</span>
        <span className="text-xs text-[#6B7280]">pieces done today · efficiency so far</span>
      </div>
      <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {layout.production.map((d) => <DeptCard key={d.code} name={d.name} rows={d.rows} production effPct={d.effPct} />)}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#6B5C32]">Non-production</span>
        <span className="text-xs text-[#6B7280]">time scanned in · red after 1 hour · day's pieces and efficiency still shown</span>
      </div>
      <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {layout.nonProduction.map((d) => <DeptCard key={d.code} name={d.name} rows={d.rows} production={false} effPct={null} />)}
      </div>
      <p className="text-[11px] text-[#6B7280]">
        Where = department of the last QR scan today (no scan = home department). Efficiency = earned job-card minutes ÷ production minutes worked so far, the same figure as the Employees dashboard.
      </p>
    </div>
  );
}

// ---- Month / Quarter / Year ------------------------------------------------
const SUM_COLS = "grid grid-cols-[minmax(0,1fr)_2.25rem_2.75rem_2.75rem_3rem_2.5rem] items-center gap-x-2";
const hrs = (m: number) => (m / 60).toFixed(1);

function SummaryRow({ r }: { r: FloorSummaryRow }) {
  return (
    <div className={`${SUM_COLS} border-t border-[#F3F0EC] px-3 py-1.5 text-xs tabular-nums ${r.overHourDays > 0 ? "bg-[#FBF3F1]" : "bg-white"}`}>
      <span className="truncate" title={r.name}>{r.name}</span>
      <span className="text-right text-[#6B7280]">{r.days}</span>
      <span className="text-right font-semibold">{r.done}</span>
      <span className={`text-right font-semibold ${effClass(r.effPct)}`}>{r.effPct == null ? "—" : `${r.effPct}%`}</span>
      <span className="text-right text-[#4B5563]">{hrs(r.nonProdMinutes)}</span>
      <span className={`text-right font-semibold ${r.overHourDays > 0 ? "text-[#DC2626]" : "text-[#9CA3AF]"}`}>{r.overHourDays}</span>
    </div>
  );
}

function SummaryCard({ name, rows }: { name: string; rows: FloorSummaryRow[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, ROW_LIMIT);
  return (
    <div className="self-start overflow-hidden rounded-[10px] border border-[#E5E0D8] bg-white">
      <div className="border-b border-[#EEE9E4] bg-[#F7F5F3] px-3 py-2 text-[13px] font-bold">
        {name} <span className="font-medium text-[#6B7280]">· {rows.length}</span>
      </div>
      <div className={`${SUM_COLS} px-3 py-1 text-[11px] text-[#9CA3AF]`}>
        <span>Worker</span>
        <span className="text-right">Days</span>
        <span className="text-right">Done</span>
        <span className="text-right">Eff.</span>
        <span className="text-right" title="Hours in non-production departments">NP hrs</span>
        <span className="text-right" title="Days in a non-production department for over an hour">1h+</span>
      </div>
      {shown.map((r) => <SummaryRow key={r.id} r={r} />)}
      {rows.length > ROW_LIMIT && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="h-9 w-full border-t border-[#F3F0EC] bg-white text-xs font-semibold text-[#6B5C32] hover:bg-[#FAF9F7]"
        >
          {open ? "Show fewer" : `+${rows.length - ROW_LIMIT} more`}
        </button>
      )}
    </div>
  );
}

function FloorSummaryView({ period, today, onLiveNow }: { period: Period; today: string; onLiveNow: () => void }) {
  const { from, to } = periodRange(period, today);
  const { data, loading, error, refresh } = useCachedJson<FloorSummaryResponse>(`/api/dashboard/floor-live/summary?from=${from}&to=${to}`, 0);
  const [q, setQ] = useState("");
  const cards = useMemo(() => (data?.success ? summaryLayout(data, q) : []), [data, q]);

  if (loading && !data) return <div className="py-10 text-sm text-[#6B7280]">Loading the summary…</div>;
  if (error || (data && data.success === false)) {
    return (
      <div className="flex flex-col items-start gap-2 py-6">
        <div className="text-sm font-medium text-[#9A3A2D]">The Floor Live summary could not load.</div>
        <div className="text-xs text-[#6B7280]">{String(error ?? data?.error ?? "")}</div>
        <button type="button" onClick={() => refresh()} className="rounded border border-[#E5E0D8] px-3 py-1.5 text-sm hover:bg-[#FAF9F7]">Retry</button>
      </div>
    );
  }
  const saved = data?.savedDays.length ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#6B7280]">
          {from} → {to} · from {saved} saved day{saved === 1 ? "" : "s"} (one copy a day, saved after midnight)
        </span>
        <span className="flex-1" />
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E0D8] bg-white px-2.5 text-xs text-[#6B7280] max-md:w-full">
          <span>Find</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#1F1D1B] outline-none md:w-36"
          />
        </label>
        <button type="button" onClick={onLiveNow} className="h-9 rounded-lg border border-[#3E7A4F] bg-white px-3 text-xs font-semibold text-[#2F5E3C]">
          Live now
        </button>
      </div>
      {saved === 0 ? (
        <div className="rounded-[10px] border border-[#E5E0D8] bg-white px-4 py-6 text-sm text-[#6B7280]">
          No saved days in this period yet. Each day is saved after midnight; pick a day (or Live now) to see the floor.
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => <SummaryCard key={c.code} name={c.name} rows={c.rows} />)}
        </div>
      )}
      <p className="text-[11px] text-[#6B7280]">
        Grouped by home department. Days = days punched in · Done = pieces · Eff. = earned ÷ worked minutes over the period (red below 80%) · NP hrs = hours in non-production departments · 1h+ = days in a non-production department for over an hour (red row).
      </p>
    </div>
  );
}

