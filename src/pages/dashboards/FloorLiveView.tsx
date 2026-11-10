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
import { floorLiveLayout, type FloorLiveResponse, type FloorLiveRow } from "./floor-live-lib";

const ROW_LIMIT = 6;
const REFRESH_MS = 5 * 60 * 1000;

// Owner 2026-11-10: efficiency turns red only below 80% (the number, not the
// row). A whole red row is reserved for the non-production 1-hour rule.
function effClass(e: number | null): string {
  if (e == null) return "text-[#6B7280]";
  if (e < 80) return "text-[#9A3A2D]";
  return "text-[#1F1D1B]";
}

/** Last department check-in (scan) today, else the punch-in time. */
const lastIn = (p: FloorLiveRow) => p.scannedAt ?? p.clockIn ?? "—";

function Row({ p, production }: { p: FloorLiveRow; production: boolean }) {
  const red = !production && p.overHourNonProd;
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-[#F3F0EC] px-3 py-1.5 text-xs ${red ? "bg-[#FBF3F1]" : "bg-white"}`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${p.clockOut ? "bg-[#9CA3AF]" : "bg-[#3E7A4F]"}`} aria-hidden="true" />
        <span className="truncate" title={p.name}>{p.name}</span>
      </span>
      {production ? (
        <span className="flex items-center gap-3 tabular-nums">
          <span className="text-[#6B7280]" title="Last check-in to this department today">{lastIn(p)}</span>
          <span className="font-semibold">{p.done}</span>
          <span className={`w-11 text-right font-semibold ${effClass(p.effPct)}`}>{p.effPct == null ? "—" : `${p.effPct}%`}</span>
        </span>
      ) : (
        // Non-production still shows the day's pieces and efficiency so far
        // (owner 2026-11-10) — the efficiency sinks while they stay here.
        <span className="flex items-center gap-3 tabular-nums">
          <span className={p.overHourNonProd ? "font-semibold text-[#9A3A2D]" : "text-[#4B5563]"}>
            {p.scannedAt ? `since ${p.scannedAt}` : p.clockIn ? `in ${p.clockIn}` : "—"}
          </span>
          <span className="font-semibold">{p.done}</span>
          <span className={`w-11 text-right font-semibold ${effClass(p.effPct)}`}>{p.effPct == null ? "—" : `${p.effPct}%`}</span>
        </span>
      )}
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
          <div className="grid grid-cols-[minmax(0,1fr)_auto] px-3 py-1 text-[11px] text-[#9CA3AF]">
            <span>Worker</span>
            <span>{production ? "Check-in · Done · Eff." : "Scanned in · Done · Eff."}</span>
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

export function FloorLiveView() {
  const { data, loading, error, refresh } = useCachedJson<FloorLiveResponse>("/api/dashboard/floor-live", 0);
  const [q, setQ] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);

  // Every 5 minutes, paused while the tab is hidden.
  useInterval(() => refresh(), REFRESH_MS);

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
          LIVE · as of {data?.asOf} · refreshes every 5 min
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
