// ===========================================================================
// Planning v2 — Schedule tab (CHANGES.md §1). Mirrors the desktop Department
// Schedule pages: the day of a job is the scheduler-assigned day from
// GET /api/planning/schedule/:dept (never a lead time, never a dept due date).
// Foam Cutting and Fibre have no live endpoint — like desktop they show the
// bundled (empty) snapshot. See ../../lib/planning-schedule.ts for the safe
// job → production-order matching (a card is tappable only when unambiguous).
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, CalendarCheck, CalendarX, ChevronLeft, ChevronRight, GitBranch } from "lucide-react";
import { M } from "../../theme";
import { CHIP_COUNT, CHIP_ROW, CHIP_ROW_CLASS, chip as chipStyle } from "../../lib/control-styles";
import { useScheduleSnapshots, useScopedOrders } from "../../lib/planning-data";
import {
  SCHEDULE_DEPTS, SCHEDULE_DEPT_BY_CODE, addDays, buildOrderIndex, commonValue, dayNum, groupByLane, isCustomerDdOverdue,
  jobsOnDay, longDate, mondayOf, parseSchedule, resolveJob, scopeTokens, shortDate, summarize, todayLocal, weekDays, weekdayOf, LANE_LABEL,
  type ScheduleJob,
} from "../../lib/planning-schedule";
import { sem, DL } from "../delivery/ui-tokens";
import { Cell, CardTitleRow, DashLabel, EmptyState, ErrorState, InlineSpinner, Panel, ProductLine, RailCard, RefChip, RefRow, SectionRow, SkeletonCards } from "./ui";
import { laneTone } from "./tones";

const UNSCHED = "UNSCHED" as const;

function initialDay(now: Date = new Date()): string {
  const t = todayLocal(now);
  return weekdayOf(t) === "SUN" ? addDays(t, 1) : t;
}

export function ScheduleTab({ deptCode, onDeptChange }: { deptCode: string; onDeptChange: (code: string) => void }) {
  const navigate = useNavigate();
  const today = todayLocal();
  const homeDay = initialDay();
  const homeWeek = mondayOf(homeDay);
  const [week, setWeek] = useState(homeWeek);
  const [day, setDay] = useState<string>(homeDay);

  const cfg = SCHEDULE_DEPT_BY_CODE[deptCode] ?? SCHEDULE_DEPTS[0];
  const { entries, reload } = useScheduleSnapshots(cfg.code);
  const entry = entries[cfg.code];

  // Parse every loaded department once (chip counts) — pure, memoised by snapshot identity.
  const jobsByDept = useMemo(() => {
    const m: Record<string, ScheduleJob[]> = {};
    for (const d of SCHEDULE_DEPTS) m[d.code] = parseSchedule(entries[d.code]?.snap, d);
    return m;
  }, [entries]);
  const jobs = useMemo(() => jobsByDept[cfg.code] ?? [], [jobsByDept, cfg.code]);
  const days = weekDays(week);

  const countFor = (code: string): string | null => {
    const e = entries[code];
    if (!e || (e.status !== "ok" && e.status !== "static")) return null;
    return String((jobsByDept[code] ?? []).filter((j) => j.day !== null && days.includes(j.day)).length);
  };

  // Keep the selected department chip in view (the user’s own department can be far along the row).
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipsRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (row && el) row.scrollTo({ left: Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2) });
  }, [cfg.code]);

  const unsched = jobsOnDay(jobs, UNSCHED);
  // Unscheduled selected but this department has none -> back to today (CHANGES §7).
  useEffect(() => {
    if (day === UNSCHED && entry && (entry.status === "ok" || entry.status === "static") && unsched.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived reset once the department's snapshot is known
      setDay(homeDay);
      setWeek(homeWeek);
    }
  }, [day, entry, unsched.length, homeDay, homeWeek]);

  const dayJobs = useMemo(() => jobsOnDay(jobs, day === UNSCHED ? UNSCHED : day), [jobs, day]);
  const tokens = useMemo(() => scopeTokens(dayJobs), [dayJobs]);
  const { orders, loading: ordersLoading } = useScopedOrders(tokens);
  const index = useMemo(() => buildOrderIndex(orders), [orders]);

  const lanes = useMemo(() => groupByLane(dayJobs), [dayJobs]);
  const resolved = useMemo(() => new Map(dayJobs.map((j) => [j.id, resolveJob(j, index)])), [dayJobs, index]);
  const hasUnmatched = !ordersLoading && dayJobs.some((j) => !resolved.get(j.id)?.order);

  const ready = entry && (entry.status === "ok" || entry.status === "static");
  const upstream = cfg.upstream.length === 1 ? SCHEDULE_DEPT_BY_CODE[cfg.upstream[0]] : null;
  const dayLabel = day === UNSCHED ? "UNSCHEDULED · NO SCHEDULER DAY" : `${day === today ? "TODAY · " : ""}${weekdayOf(day)} ${shortDate(day).toUpperCase()}`;

  const changeDept = (code: string) => {
    onDeptChange(code);
    if (day === UNSCHED) {
      setDay(homeDay);
      setWeek(homeWeek);
    }
  };
  const go = (w: string) => {
    setWeek(w);
    setDay(w);
  };

  return (
    <div>
      {/* Department chips — this week's job count */}
      <div ref={chipsRef} className={CHIP_ROW_CLASS} style={{ ...CHIP_ROW, position: "relative" }} role="tablist" aria-label="Departments">
        {SCHEDULE_DEPTS.map((d) => {
          const on = d.code === cfg.code;
          const n = countFor(d.code);
          return (
            <button key={d.code} type="button" role="tab" aria-selected={on} onClick={() => changeDept(d.code)} style={chipStyle(on)}>
              {d.name}
              {n !== null ? <span style={CHIP_COUNT}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Week card */}
      <Panel ariaLabel="Week" style={{ margin: "12px 18px 0", padding: "14px 12px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <DashLabel>{cfg.name.toUpperCase()}</DashLabel>
            <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 4, whiteSpace: "nowrap" }}>
              {shortDate(days[0])} – {shortDate(days[5])} {days[5].slice(0, 4)}
            </div>
          </div>
          {week !== homeWeek ? (
            <button
              type="button"
              onClick={() => {
                setWeek(homeWeek);
                setDay(homeDay);
              }}
              style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "none", background: "var(--pl-round-btn)", color: M.taupe, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              Today
            </button>
          ) : null}
          {[
            { label: "Previous week", to: addDays(week, -7), Icon: ChevronLeft },
            { label: "Next week", to: addDays(week, 7), Icon: ChevronRight },
          ].map(({ label, to, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => go(to)}
              aria-label={label}
              style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: M.paper, color: M.taupe, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
            >
              <Icon size={18} strokeWidth={2} />
            </button>
          ))}
        </div>

        <div role="tablist" aria-label="Working days" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 5, marginTop: 12 }}>
          {days.map((d) => {
            const on = d === day;
            const n = jobsOnDay(jobs, d).length;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={`${longDate(d)}, ${n} jobs`}
                onClick={() => setDay(d)}
                style={{
                  minWidth: 0, height: 72, borderRadius: 14, border: "none", padding: 0, fontFamily: "inherit", cursor: "pointer",
                  background: on ? M.taupe : d === today ? "var(--pl-today)" : M.paper,
                  color: on ? "var(--m-text-on-accent)" : M.raisin,
                  boxShadow: on ? "0 8px 18px -10px rgba(107,92,50,.7)" : "none",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, WebkitTapHighlightColor: "transparent",
                }}
              >
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, opacity: 0.85 }}>{weekdayOf(d)}</span>
                <span style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{dayNum(d)}</span>
                <span
                  style={{
                    minWidth: 20, height: 18, boxSizing: "border-box", padding: "0 6px", borderRadius: 999,
                    background: on ? "rgba(255,255,255,.2)" : n ? M.card : "transparent", color: on ? "var(--m-text-on-accent)" : n ? M.taupe : M.ink,
                    fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {ready ? n : "–"}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, padding: "9px 4px 0", boxShadow: `inset 0 1px 0 ${DL.track}`, minWidth: 0 }}>
          <GitBranch size={13} strokeWidth={2} color={DL.icon} aria-hidden style={{ flexShrink: 0 }} />
          {upstream ? (
            <button
              type="button"
              onClick={() => changeDept(upstream.code)}
              aria-label={`${cfg.note}. Show ${upstream.name}`}
              style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", fontFamily: "inherit", fontSize: 12, color: M.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
            >
              {cfg.note}
            </button>
          ) : (
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: M.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg.note}</span>
          )}
          {unsched.length > 0 ? (
            <button
              type="button"
              onClick={() => setDay(UNSCHED)}
              aria-pressed={day === UNSCHED}
              style={{
                flex: "none", height: 30, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px", border: "none", borderRadius: 999,
                background: day === UNSCHED ? M.taupe : M.paper, color: day === UNSCHED ? "var(--m-text-on-accent)" : M.raisin,
                fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              Unscheduled
              <span style={{ minWidth: 18, height: 18, boxSizing: "border-box", padding: "0 5px", borderRadius: 999, background: day === UNSCHED ? "rgba(255,255,255,.2)" : M.card, color: day === UNSCHED ? "var(--m-text-on-accent)" : M.taupe, fontSize: 10.5, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {unsched.length}
              </span>
            </button>
          ) : null}
        </div>
      </Panel>

      <SectionRow left={dayLabel} right={ready && dayJobs.length ? summarize(dayJobs, cfg) : ""} />

      <div style={{ padding: "0 18px 24px" }}>
        {!entry || entry.status === "idle" || (entry.status === "loading" && !entry.snap) ? (
          <SkeletonCards n={3} />
        ) : entry.status === "error" && !entry.snap ? (
          <ErrorState title="Could not load the schedule" text={entry.error} onRetry={reload} />
        ) : dayJobs.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck size={22} strokeWidth={1.9} />}
            title="Nothing scheduled"
            text={
              entry.status === "static"
                ? `${cfg.name} has no capacity-planned schedule yet — desktop shows the same empty snapshot.`
                : day === UNSCHED
                  ? `Every ${cfg.name} job has a scheduler day.`
                  : `No ${cfg.name} jobs scheduled on ${shortDate(day)}.`
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {lanes.map((g) => (
              <div key={g.label}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 8px" }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: sem(laneTone(g.lane)) }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>{g.label}</span>
                  <span style={{ fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{summarize(g.jobs, cfg)}</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {g.jobs.map((j) => (
                    <JobCard key={j.id} job={j} cfg={cfg} res={resolved.get(j.id)} today={today} onOpen={(id) => navigate(`/m/production/${encodeURIComponent(id)}`)} />
                  ))}
                </div>
              </div>
            ))}
            {hasUnmatched ? (
              <div style={{ fontSize: 12, color: M.muted, lineHeight: 1.5, padding: "0 4px" }}>
                Cards without an arrow cannot be matched to a single production order, so they are not opened from here. Find them in Production Orders.
              </div>
            ) : null}
          </div>
        )}
        {ready && entry.status === "ok" && entry.snap?.generatedAt ? (
          <div style={{ marginTop: 14, textAlign: "center", fontSize: 11.5, color: M.muted }}>Live schedule · generated {longDate(entry.snap.generatedAt)}</div>
        ) : null}
        {entry?.status === "loading" && entry.snap ? <InlineSpinner label="Refreshing…" /> : null}
        {entry?.status === "error" && entry.snap ? (
          <div role="alert" style={{ marginTop: 12, fontSize: 12, color: "var(--dl-pill-danger-fg)", textAlign: "center" }}>Could not refresh — showing the last loaded schedule.</div>
        ) : null}
      </div>
    </div>
  );
}

function JobCard({
  job,
  cfg,
  res,
  today,
  onOpen,
}: {
  job: ScheduleJob;
  cfg: (typeof SCHEDULE_DEPTS)[number];
  res: ReturnType<typeof resolveJob> | undefined;
  today: string;
  onOpen: (orderId: string) => void;
}) {
  const order = res?.order ?? null;
  const dueRaw = (res?.jobCard?.dueDate ?? "").slice(0, 10);
  const dueLate = !!dueRaw && dueRaw < today;
  const customer = job.customer || commonValue(res?.soOrders ?? [], (o) => o.customerName);
  const fabric = job.fabric || (order?.fabricCode ?? "");
  const cddRaw = job.cdd ?? (commonValue(res?.soOrders ?? [], (o) => (o.customerDeliveryDate ?? "").slice(0, 10)) || null);
  const cddOver = isCustomerDdOverdue(cddRaw);
  const code = order?.poNo || job.soPo || job.soKey || "—";
  const product = job.label || job.model || "—";
  const lane = job.lane ? LANE_LABEL[job.lane] : "";
  const aria = `${code}, ${product}${lane ? `, ${lane}` : ""}${dueRaw ? `, dept due ${shortDate(dueRaw)}` : ""}${cddRaw ? `, customer DD ${shortDate(cddRaw)}${cddOver ? " overdue" : ""}` : ""}`;
  return (
    <RailCard tone={laneTone(job.lane)} onClick={order ? () => onOpen(order.id) : undefined} ariaLabel={aria}>
      <CardTitleRow code={code} chevron={!!order} />
      <ProductLine>{product}</ProductLine>
      <RefRow>
        <RefChip k={cfg.groupKind === "cut" ? "Cut" : "SO"} v={job.groupKey === "—" ? job.soKey || "—" : job.groupKey} />
        {job.model && job.model !== product ? <RefChip k="Model" v={job.model} /> : null}
        {customer ? <RefChip k="Customer" v={customer} /> : null}
        {fabric ? <RefChip k="Fabric" v={fabric} /> : null}
      </RefRow>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 0.9fr)", gap: 6, marginTop: 10 }}>
        <Cell
          label="DEPT DUE"
          value={dueRaw ? shortDate(dueRaw) : "—"}
          tone={dueLate ? "danger" : undefined}
          icon={dueLate ? <CalendarX size={11} strokeWidth={2} aria-hidden /> : <Calendar size={11} strokeWidth={2} aria-hidden />}
        />
        <Cell label={cddOver ? "CUST DD · OVERDUE" : "CUSTOMER DD"} value={cddRaw ? shortDate(cddRaw) : "—"} tone={cddOver ? "danger" : undefined} />
        <Cell label={cfg.minsCol != null ? "QTY · MIN" : "QTY"} value={cfg.minsCol != null ? `${job.qty} · ${job.mins ?? "—"}` : String(job.qty)} qty align="right" />
      </div>
    </RailCard>
  );
}

