// ---------------------------------------------------------------------------
// Phone › Home › Operations › Floor Live.
// Visual source of truth: Claude Design handoff "Hookka Floor Live" (Home
// Operations · Floor Live). DESIGN ONLY: the data, the layout rules and every
// business rule are the desktop's own and are imported, not copied —
//   useCachedJson + /api/dashboard/floor-live[/summary|/completed],
//   floorLiveLayout / summaryLayout / periodRange / isIssue (floor-live-lib),
//   DeptCompletedStrip (completed pcs, 12-day usual, RM value, monthly popup).
// The page chrome of the design (header, period bar, sub-tabs, bottom nav)
// already exists on /m Home, so only the content below the sub-tabs is here.
// The desktop FloorLiveView is untouched.
// ---------------------------------------------------------------------------
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { CloudOff, Gauge, LogIn, Clock, Package, Search, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import { useInterval } from "@/lib/scheduler";
import { useCachedJson } from "@/lib/cached-fetch";
import { DeptCompletedStrip } from "../../../dashboards/DeptCompletedStrip";
import {
  floorLiveLayout, periodRange, summaryLayout,
  type DeptCompletedResponse, type FloorLiveResponse, type FloorLiveRow, type FloorSummaryResponse, type FloorSummaryRow,
} from "../../../dashboards/floor-live-lib";
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import { M } from "../../theme";
import { SHADOW_CARD, DATA, TNUM, NOWRAP_ELLIPSIS } from "./home-style";

const ROW_LIMIT = 6;
const REFRESH_MS = 3 * 60 * 1000;

const SHADOW_PANEL = "0 0 0 1px rgba(31,29,27,.04),0 2px 4px rgba(31,29,27,.06),0 14px 30px -14px rgba(31,29,27,.30)";
const SHADOW_SEARCH = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const RED = "#DC2626";
const RED_ROW = `color-mix(in srgb, ${DATA.red} 8%, ${M.card})`;
const HEAD_BG = `color-mix(in srgb, ${M.raisin} 3%, ${M.card})`;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dLab = (d: string) => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

// Owner 2026-11-10 (same rule as desktop): efficiency is red only below 80%;
// a whole red row is the non-production 1-hour rule.
const effColor = (e: number | null) => (e == null ? M.body : e < 80 ? RED : M.raisin);
const fmtPcs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const lastIn = (p: FloorLiveRow) => p.scannedAt ?? p.clockIn ?? "—";
const hrs = (m: number) => (m / 60).toFixed(1);
const effText = (e: number | null) => (e == null ? "—" : `${e}%`);
const overallText = (overallPct: number | null, helperMinutes: number) =>
  helperMinutes > 0 && overallPct != null ? `Overall ${overallPct}% · helpers ${hrs(helperMinutes)} h` : "";

const CSS = `
.fl-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.fl-tiles>.fl-wide{grid-column:1 / -1}
.fl-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start}
@media (min-width:700px){.fl-tiles{grid-template-columns:repeat(5,minmax(0,1fr))}.fl-tiles>.fl-wide{grid-column:auto}.fl-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@keyframes fl-skel{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}
.fl-skel{animation:fl-skel 1.2s ease-in-out infinite}
`;

const panel: CSSProperties = { backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_PANEL };

function HelperPill() {
  return (
    <span
      title="Helper — assists others; no personal efficiency, no efficiency allowance"
      style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 999, backgroundColor: M.divider, color: M.ink, fontSize: 10, fontWeight: 700 }}
    >
      Helper
    </span>
  );
}

function MoreButton({ open, total, onClick }: { open: boolean; total: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: "100%", height: 40, border: "none", borderTop: `1px solid ${M.divider}`, backgroundColor: M.card, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: M.taupe, cursor: "pointer" }}
    >
      {open ? "Show fewer" : `+${total - ROW_LIMIT} more`}
    </button>
  );
}

// ---- shared bits ------------------------------------------------------------
function SearchBox({ q, onQ }: { q: string; onQ: (v: string) => void }) {
  return (
    <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 13px", borderRadius: 14, backgroundColor: M.card, boxShadow: SHADOW_SEARCH }}>
      <Search size={18} strokeWidth={1.9} color={M.muted} aria-hidden="true" />
      <input
        type="search"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder="Search name"
        aria-label="Search name"
        style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: M.raisin, padding: 0 }}
      />
    </label>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div aria-busy="true" style={{ display: "grid", gap: 10 }}>
      <div className="fl-skel" style={{ height: 24, width: 220, borderRadius: 999, backgroundColor: M.divider }} />
      <div className="fl-skel" style={{ height: 150, borderRadius: 16, backgroundColor: M.divider }} />
      <div className="fl-skel" style={{ height: 220, borderRadius: 16, backgroundColor: M.divider }} />
      <div style={{ textAlign: "center", fontSize: 12.5, color: M.ink }}>{text}</div>
    </div>
  );
}

function ErrorState({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ ...panel, padding: "22px 18px", textAlign: "center" }}>
      <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", backgroundColor: `color-mix(in srgb, ${DATA.red} 14%, ${M.card})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CloudOff size={22} strokeWidth={1.9} color={DATA.red} aria-hidden="true" />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: DATA.red, marginTop: 12 }}>{title}</div>
      {detail ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 4 }}>{detail}</div> : null}
      <button type="button" onClick={onRetry} style={{ marginTop: 14, height: 42, padding: "0 20px", border: "none", borderRadius: 12, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
        Retry
      </button>
    </div>
  );
}

// ---- Day view ---------------------------------------------------------------
const DAY_GRID = "minmax(0,1fr) 46px 40px 44px";

function WorkerRow({ p, production }: { p: FloorLiveRow; production: boolean }) {
  // Same rule as desktop: production < 80%, or a non-production stay over an hour.
  const red = production ? p.effPct != null && p.effPct < 80 : p.overHourNonProd;
  const hot = !production && p.overHourNonProd;
  return (
    <div style={{ display: "grid", gridTemplateColumns: DAY_GRID, gap: 8, alignItems: "center", minHeight: 38, padding: "4px 14px", borderTop: `1px solid ${M.divider}`, backgroundColor: red ? RED_ROW : M.card, fontSize: 13, ...TNUM }}>
      <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span aria-label={p.clockOut ? "Clocked out" : "Still in"} style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", backgroundColor: p.clockOut ? M.faint : DATA.moss }} />
        <span title={p.name} style={{ minWidth: 0, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{p.name}</span>
        {p.isHelper ? <HelperPill /> : null}
      </span>
      <span style={{ textAlign: "right", color: hot ? RED : M.ink, fontWeight: hot ? 700 : 500 }}>{lastIn(p)}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: M.raisin }}>{fmtPcs(p.done)}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: effColor(p.effPct) }}>{effText(p.effPct)}</span>
    </div>
  );
}

function DeptCard({ name, rows, production, effPct, overallPct = null, helperMinutes = 0, completed = null }: {
  name: string; rows: FloorLiveRow[]; production: boolean; effPct: number | null; overallPct?: number | null; helperMinutes?: number; completed?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, ROW_LIMIT);
  const overall = production ? overallText(overallPct, helperMinutes) : "";
  return (
    <div style={{ ...panel, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", backgroundColor: HEAD_BG, borderBottom: `1px solid ${M.divider}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>{name}</span>
          <span style={{ fontSize: 13, color: M.ink }}> · {rows.length}</span>
        </div>
        {production ? (
          <div style={{ flex: "none", textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: effColor(effPct), ...TNUM }}>{effText(effPct)}</div>
            {overall ? <div style={{ fontSize: 10.5, color: M.ink, marginTop: 1, whiteSpace: "nowrap" }}>{overall}</div> : null}
          </div>
        ) : null}
      </div>
      {completed}
      {rows.length === 0 ? (
        <div style={{ padding: "10px 14px 12px", fontSize: 12.5, color: M.muted }}>Nobody here today</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: DAY_GRID, gap: 8, padding: "6px 14px", backgroundColor: M.card, fontSize: 11.5, fontWeight: 600, color: M.muted }}>
            <span>Worker</span>
            <span style={{ textAlign: "right" }}>{production ? "In" : "Since"}</span>
            <span style={{ textAlign: "right" }}>Done</span>
            <span style={{ textAlign: "right" }}>Eff.</span>
          </div>
          {shown.map((p) => <WorkerRow key={p.id} p={p} production={production} />)}
          {rows.length > ROW_LIMIT ? <MoreButton open={open} total={rows.length} onClick={() => setOpen((v) => !v)} /> : null}
        </>
      )}
    </div>
  );
}

function GroupTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 8px", padding: "6px 2px 0" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{title}</span>
      <span style={{ fontSize: 12, color: M.ink }}>{sub}</span>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <div style={{ ...panel, padding: 18, textAlign: "center", fontSize: 13, color: M.ink }}>{text}</div>;
}

type Tile = { icon: LucideIcon; label: string; value: string; fg: string; sub: string; rail: string; tag: string; wide?: boolean };

function KpiTile({ k }: { k: Tile }) {
  const Icon = k.icon;
  return (
    <div className={k.wide ? "fl-wide" : undefined} style={{ position: "relative", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column", backgroundColor: M.card, borderRadius: 16, padding: 12, boxShadow: SHADOW_CARD }}>
      <span aria-hidden="true" style={{ position: "absolute", right: -26, top: -26, width: 76, height: 76, borderRadius: "50%", backgroundColor: `color-mix(in srgb, ${k.rail} 16%, ${M.card})`, opacity: 0.65 }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span aria-hidden="true" style={{ width: 30, height: 30, flex: "none", borderRadius: 10, backgroundColor: k.rail, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 10px -4px ${k.rail}` }}>
          <Icon size={15} strokeWidth={2} color="#FFFFFF" />
        </span>
        <span style={{ height: 20, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 7px", borderRadius: 999, backgroundColor: M.card, color: k.rail, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, whiteSpace: "nowrap", boxShadow: `0 0 0 1px color-mix(in srgb, ${k.rail} 25%, ${M.card})` }}>
          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: k.rail }} />
          {k.tag}
        </span>
      </div>
      <div style={{ position: "relative", fontSize: 12, fontWeight: 700, color: M.ink, marginTop: 10, ...NOWRAP_ELLIPSIS }}>{k.label}</div>
      <div style={{ position: "relative", fontSize: 17, fontWeight: 700, letterSpacing: -0.6, color: k.fg, marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{k.value}</div>
      {k.sub ? <div style={{ position: "relative", fontSize: 11.5, lineHeight: 1.35, color: M.ink, marginTop: 4 }}>{k.sub}</div> : null}
    </div>
  );
}

function Legend() {
  const item: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
  return (
    <div role="note" aria-label="Legend" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "0 2px", fontSize: 11.5, color: M.ink }}>
      <span style={item}><span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: DATA.moss }} />Still in</span>
      <span style={item}><span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: M.faint }} />Clocked out</span>
      <span style={item}><span style={{ width: 12, height: 10, borderRadius: 3, backgroundColor: RED_ROW, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${DATA.red} 22%, ${M.card})` }} />Below 80% / non-prod over 1 h</span>
    </div>
  );
}

function FloorDayView({ day, today }: { day: string; today: string }) {
  const pastDay = day < today;
  const { data, loading, error, refresh } = useCachedJson<FloorLiveResponse>(
    pastDay ? `/api/dashboard/floor-live?date=${day}` : "/api/dashboard/floor-live",
    0,
  );
  const [q, setQ] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);

  // What each department completed that day + its 12-working-day average.
  const completed = useCachedJson<DeptCompletedResponse>(`/api/dashboard/floor-live/completed?from=${day}&to=${day}`, 0);

  // Every 3 minutes, paused while the tab is hidden; a past day is a saved copy.
  useInterval(() => { refresh(); completed.refresh(); }, pastDay ? null : REFRESH_MS);

  const layout = useMemo(() => (data?.success ? floorLiveLayout(data, { q, issuesOnly }) : null), [data, q, issuesOnly]);
  // Badge: issue rows that match the search, counted before the 6-row limit.
  const issueCount = useMemo(() => {
    if (!data?.success) return 0;
    const l = floorLiveLayout(data, { q, issuesOnly: true });
    return [...l.production, ...l.nonProduction].reduce((s, c) => s + c.rows.length, 0);
  }, [data, q]);

  if (loading && !data) return <LoadingState text="Loading the floor…" />;
  if (error || (data && data.success === false)) {
    return <ErrorState title="Floor Live could not load." detail={String(error ?? data?.error ?? "")} onRetry={() => refresh()} />;
  }
  if (!layout) return null;

  const filtering = q.trim().length > 0 || issuesOnly;
  const t = layout.totals;
  const tiles: Tile[] = [
    { icon: LogIn, label: "Punched in", value: `${t.punched}`, fg: M.raisin, sub: "", rail: DATA.teal, tag: "TODAY" },
    { icon: UserCheck, label: "Still in", value: `${t.stillIn}`, fg: M.raisin, sub: "", rail: DATA.moss, tag: "LIVE" },
    { icon: Package, label: "Pcs done today", value: fmtPcs(t.done), fg: M.raisin, sub: "", rail: DATA.so, tag: "TODAY" },
    { icon: Gauge, label: "Floor efficiency", value: effText(t.effPct), fg: effColor(t.effPct), sub: overallText(t.overallPct, t.helperMinutes), rail: DATA.amber, tag: "SO FAR" },
    { icon: Clock, label: "Non-prod 1h+", value: `${t.overHour}`, fg: t.overHour > 0 ? DATA.red : M.raisin, sub: "", rail: DATA.red, tag: "LIVE", wide: true },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 }}>
      <style>{CSS}</style>
      <div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, maxWidth: "100%", padding: "0 10px", borderRadius: 999, backgroundColor: pastDay ? M.divider : "#EAF3EC", color: pastDay ? M.ink : "#2F5E3C", fontSize: 11, fontWeight: 700, letterSpacing: 0.2, whiteSpace: "nowrap", overflow: "hidden" }}>
          <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", backgroundColor: pastDay ? M.muted : "#3E7A4F" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {pastDay
              ? `END OF DAY · ${dLab(data?.date ?? day)}${data?.frozen ? " · saved copy" : " · recomputed (no saved copy)"}`
              : `LIVE · ${data?.asOf} · every 3 min`}
          </span>
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SearchBox q={q} onQ={setQ} />
        <button
          type="button"
          aria-pressed={issuesOnly}
          aria-label="Issues only"
          title="Issues only"
          onClick={() => setIssuesOnly((v) => !v)}
          style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", border: "none", padding: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backgroundColor: issuesOnly ? DATA.red : M.card, color: issuesOnly ? "#FFFFFF" : DATA.red, boxShadow: issuesOnly ? "0 6px 14px -6px rgba(154,58,45,.55)" : "inset 0 0 0 1.5px #E8B2A1" }}
        >
          <TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />
          {!issuesOnly ? (
            <span style={{ position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, boxSizing: "border-box", padding: "0 5px", borderRadius: 999, backgroundColor: DATA.red, color: "#FFFFFF", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 0 2px ${M.paper}` }}>
              {issueCount}
            </span>
          ) : null}
        </button>
      </div>

      <div role="group" aria-label="Floor totals" className="fl-tiles">
        {tiles.map((k) => <KpiTile key={k.label} k={k} />)}
      </div>

      <Legend />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
        <GroupTitle title="PRODUCTION" sub="pieces done today · efficiency so far" />
        {layout.production.length === 0 ? <EmptyNote text={filtering ? "No production workers match." : "Nobody on the floor yet."} /> : null}
        <div className="fl-cards">
          {layout.production.map((d) => (
            <DeptCard
              key={d.code}
              name={d.name}
              rows={d.rows}
              production
              effPct={d.effPct}
              overallPct={d.overallPct}
              helperMinutes={d.helperMinutes}
              completed={<DeptCompletedStrip code={d.code} name={d.name} data={completed.data} showUsual live={!pastDay} today={today} />}
            />
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
        <GroupTitle title="NON-PRODUCTION" sub="time scanned in · red after 1 hour · day’s pieces and efficiency still shown" />
        {layout.nonProduction.length === 0 ? <EmptyNote text={filtering ? "No non-production workers match." : "Nobody in non-production."} /> : null}
        <div className="fl-cards">
          {layout.nonProduction.map((d) => <DeptCard key={d.code} name={d.name} rows={d.rows} production={false} effPct={null} />)}
        </div>
      </div>
    </div>
  );
}

// ---- Month / Quarter / Year -------------------------------------------------
const SUM_GRID = "minmax(0,1fr) 32px 36px 40px 40px 30px";

function SummaryRow({ r }: { r: FloorSummaryRow }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: SUM_GRID, gap: 6, alignItems: "center", minHeight: 38, padding: "4px 14px", borderTop: `1px solid ${M.divider}`, backgroundColor: r.overHourDays > 0 ? RED_ROW : M.card, fontSize: 13, ...TNUM }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span title={r.name} style={{ minWidth: 0, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.name}</span>
        {r.isHelper ? <HelperPill /> : null}
      </span>
      <span style={{ textAlign: "right", color: M.ink }}>{r.days}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: M.raisin }}>{r.done}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: effColor(r.effPct) }}>{effText(r.effPct)}</span>
      <span style={{ textAlign: "right", color: M.ink }}>{hrs(r.nonProdMinutes)}</span>
      <span style={{ textAlign: "right", fontWeight: 700, color: r.overHourDays > 0 ? RED : M.faint }}>{r.overHourDays}</span>
    </div>
  );
}

function SummaryCard({ name, rows, completed = null }: { name: string; rows: FloorSummaryRow[]; completed?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, ROW_LIMIT);
  return (
    <div style={{ ...panel, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", backgroundColor: HEAD_BG, borderBottom: `1px solid ${M.divider}` }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>{name}</span>
        <span style={{ fontSize: 13, color: M.ink }}> · {rows.length}</span>
      </div>
      {completed}
      <div style={{ display: "grid", gridTemplateColumns: SUM_GRID, gap: 6, padding: "6px 14px", backgroundColor: M.card, fontSize: 11.5, fontWeight: 600, color: M.muted }}>
        <span>Worker</span>
        <span style={{ textAlign: "right" }}>Days</span>
        <span style={{ textAlign: "right" }}>Done</span>
        <span style={{ textAlign: "right" }}>Eff.</span>
        <span style={{ textAlign: "right" }} title="Hours in non-production departments">NP h</span>
        <span style={{ textAlign: "right" }} title="Days in a non-production department for over an hour">1h+</span>
      </div>
      {shown.map((r) => <SummaryRow key={r.id} r={r} />)}
      {rows.length > ROW_LIMIT ? <MoreButton open={open} total={rows.length} onClick={() => setOpen((v) => !v)} /> : null}
    </div>
  );
}

function FloorSummaryView({ period, today, onLiveNow }: { period: Period; today: string; onLiveNow: () => void }) {
  const { from, to } = periodRange(period, today);
  const { data, loading, error, refresh } = useCachedJson<FloorSummaryResponse>(`/api/dashboard/floor-live/summary?from=${from}&to=${to}`, 0);
  const completed = useCachedJson<DeptCompletedResponse>(`/api/dashboard/floor-live/completed?from=${from}&to=${to}`, 0);
  const [q, setQ] = useState("");
  const cards = useMemo(() => (data?.success ? summaryLayout(data, q) : []), [data, q]);

  if (loading && !data) return <LoadingState text="Loading the summary…" />;
  if (error || (data && data.success === false)) {
    return <ErrorState title="The Floor Live summary could not load." detail={String(error ?? data?.error ?? "")} onRetry={() => refresh()} />;
  }
  const saved = data?.savedDays.length ?? 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 }}>
      <style>{CSS}</style>
      <div style={{ fontSize: 12.5, color: M.ink }}>
        {dLab(from)} → {dLab(to)} · from {saved} saved day{saved === 1 ? "" : "s"} (one copy a day, saved after midnight)
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SearchBox q={q} onQ={setQ} />
        <button
          type="button"
          onClick={onLiveNow}
          style={{ flex: "none", height: 44, padding: "0 14px", borderRadius: 14, border: "none", backgroundColor: M.card, color: "#2F5E3C", boxShadow: "inset 0 0 0 1.5px #4F7C3A", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#4F7C3A" }} />
          Live now
        </button>
      </div>
      {saved === 0 ? (
        <div style={{ ...panel, padding: "20px 18px", fontSize: 13, lineHeight: 1.5, color: M.ink }}>
          No saved days in this period yet. Each day is saved after midnight; pick a day (or Live now) to see the floor.
        </div>
      ) : (
        <div className="fl-cards">
          {cards.map((c) => (
            <SummaryCard
              key={c.code}
              name={c.name}
              rows={c.rows}
              completed={<DeptCompletedStrip code={c.code} name={c.name} data={completed.data} showUsual={false} live={false} today={today} />}
            />
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: M.ink, padding: "0 2px" }}>
        Grouped by home department. Days = days punched in · Done = pieces · Eff. = earned ÷ worked minutes over the period (red below 80%) · NP h = hours in non-production departments · 1h+ = days in a non-production department for over an hour (red row).
      </div>
    </div>
  );
}

/** Day picked = the cards (today live, a past day = its saved end-of-day copy).
 *  Month / Quarter / Year = the per-worker summary over the saved days. */
export function FloorLivePhone({ period, today, onPeriodChange }: { period: Period; today: string; onPeriodChange: (p: Period) => void }) {
  if (!period.day) return <FloorSummaryView period={period} today={today} onLiveNow={() => onPeriodChange({ ...period, day: today })} />;
  return <FloorDayView day={period.day} today={today} />;
}
