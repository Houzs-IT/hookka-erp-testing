// ===========================================================================
// Planning v2 — Capacity tab (CHANGES.md §2). Desktop Capacity Overview:
// there is no capacity API, so the numbers are computed from the same
// production-orders read the desktop page makes (../../lib/planning-capacity.ts
// is a port with parity tests). Backlog pressure = queued work (overdue
// included) ÷ one scope of rolling capacity — not worker utilisation.
// ===========================================================================
import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Info } from "lucide-react";
import { M } from "../../theme";
import { segmentTrack, segmentButton } from "../../lib/control-styles";
import { buildCapacity, hoursLabel, pressureBand, type CapacityScope, type DeptCapacity } from "../../lib/planning-capacity";
import { useHolidays, usePendingProposalCount, usePlanningOrders, useProductionDepartments } from "../../lib/planning-data";
import { DL, sem, type Tone } from "../delivery/ui-tokens";
import { DashLabel, EmptyState, ErrorState, InlineSpinner, Panel, Pill, RailCard, SectionRow, SkeletonCards } from "./ui";
import { BAND_LABEL, bandTone } from "./tones";

const SCOPES: { key: CapacityScope; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

type Row = { d: DeptCapacity; hasCap: boolean; pct: number; tone: Tone; band: string };

export function CapacityTab({
  canReadProposals,
  onOpenProposals,
  onOpenLoading,
}: {
  canReadProposals: boolean;
  onOpenProposals: () => void;
  onOpenLoading: (deptCode: string) => void;
}) {
  const [scope, setScope] = useState<CapacityScope>("week");
  const [help, setHelp] = useState(false);
  const { orders, loading, error, hasData, refresh } = usePlanningOrders();
  const holidays = useHolidays();
  const pendingCount = usePendingProposalCount(canReadProposals);
  // Desktop lists a department in Capacity Loading only when it is a live production department.
  const prodDepts = useProductionDepartments();

  const summary = useMemo(() => buildCapacity(orders, scope, holidays), [orders, scope, holidays]);
  const rows: Row[] = useMemo(() => {
    const out = summary.depts.map((d): Row => {
      const hasCap = d.scopeCapacity > 0;
      const pct = d.totalScopeUtilization;
      const band = pressureBand(pct);
      return { d, hasCap, pct, tone: hasCap ? bandTone(band) : "neutral", band: hasCap ? BAND_LABEL[band] : "No data" };
    });
    // Highest pressure first; departments with no measurable capacity last.
    return out.sort((a, b) => (a.hasCap === b.hasCap ? b.pct - a.pct : a.hasCap ? -1 : 1));
  }, [summary]);

  if (loading && !hasData) {
    return (
      <div style={{ padding: "12px 18px 24px" }}>
        <SkeletonCards n={4} h={150} />
      </div>
    );
  }
  if (error && !hasData) {
    return (
      <div style={{ padding: "12px 18px 24px" }}>
        <ErrorState title="Could not load capacity" text="The production orders could not be read." onRetry={refresh} />
      </div>
    );
  }
  if (!orders.length) {
    return (
      <div style={{ padding: "12px 18px 24px" }}>
        <EmptyState title="No active production orders" text="Capacity is calculated from open production orders and recent completions." />
      </div>
    );
  }

  const overall = summary.totalScopeCapacity > 0;
  const overallTone: Tone = overall ? bandTone(pressureBand(summary.totalScopeUtilization)) : "neutral";
  const counts = (["high", "busy", "normal"] as const).map((b) => ({ b, n: rows.filter((r) => r.hasCap && pressureBand(r.pct) === b).length }));

  return (
    <div>
      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={onOpenProposals}
          style={{
            margin: "12px 18px 0", width: "calc(100% - 36px)", display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "8px 12px", border: "none",
            borderRadius: 14, background: "var(--pl-note)", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
          }}
        >
          <CalendarClock size={16} strokeWidth={2} color="var(--pl-note-icon)" aria-hidden />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: DL.body }}>
            <b style={{ color: M.raisin }}>
              {pendingCount} schedule proposal{pendingCount === 1 ? "" : "s"}
            </b>{" "}
            pending · review on desktop
          </span>
          <ChevronRight size={16} strokeWidth={2} color={DL.icon} aria-hidden />
        </button>
      ) : null}

      <div style={{ padding: "12px 18px 0" }}>
        <div role="group" aria-label="Capacity scope" style={{ ...segmentTrack(3), height: 44, borderRadius: 12 }}>
          {SCOPES.map((s) => (
            <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => setScope(s.key)} style={{ ...segmentButton(scope === s.key), borderRadius: 9 }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Panel ariaLabel="Capacity summary" style={{ margin: "12px 18px 0", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <DashLabel>{`${summary.scope.label.toUpperCase()}’S BACKLOG PRESSURE`}</DashLabel>
            <div style={{ marginTop: 8, fontSize: 27, lineHeight: 1.1, fontWeight: 700, letterSpacing: -0.6, color: overall ? sem(overallTone) : M.muted, fontVariantNumeric: "tabular-nums" }}>
              {overall ? `${summary.totalScopeUtilization}%` : "—"}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>
              <span>
                <b style={{ color: sem("warning") }}>Sofa</b> {overall ? `${summary.sofaScopeUtilization}%` : "—"}
              </span>
              <span>
                <b style={{ color: sem("info") }}>Bedframe</b> {overall ? `${summary.bfScopeUtilization}%` : "—"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHelp((v) => !v)}
            aria-expanded={help}
            aria-label="What backlog pressure means"
            style={{ flex: "none", width: 34, height: 34, borderRadius: "50%", border: "none", background: M.paper, color: M.taupe, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <Info size={16} strokeWidth={2} />
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {counts.map(({ b, n }) => (
            <Pill key={b} tone={bandTone(b)} label={`${n} ${BAND_LABEL[b].toLowerCase()}`} />
          ))}
        </div>
        {help ? (
          <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "var(--pl-note)", fontSize: 12.5, lineHeight: 1.5, color: DL.body }}>
            Queued work (overdue included) ÷ one scope of rolling capacity. Over 100% means more than one scope’s worth of work is queued — it is not worker utilisation.
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 14, paddingTop: 12, boxShadow: `inset 0 1px 0 ${DL.track}` }}>
          {[
            { label: "Daily capacity", value: summary.totalCapacity > 0 ? `${hoursLabel(summary.totalCapacity)}/day` : "—", sub: "14-day actual avg" },
            { label: "Queued", value: hoursLabel(summary.totalScopeLoad), sub: "Overdue included" },
            { label: "Working days", value: String(summary.scope.workingDays), sub: "Mon–Sat" },
          ].map((k, i) => (
            <div key={k.label} style={{ minWidth: 0, padding: "0 10px", boxShadow: i ? `inset 1px 0 0 ${DL.track}` : "none" }}>
              <div style={{ fontSize: 11, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 4, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
              <div style={{ fontSize: 11, color: M.ink, marginTop: 2, whiteSpace: "nowrap" }}>{k.sub}</div>
            </div>
          ))}
        </div>
      </Panel>

      <SectionRow left={`${rows.length} DEPARTMENTS`} right="Highest pressure first" />
      <div style={{ display: "grid", gap: 10, padding: "0 18px 24px" }}>
        {rows.map((r) => (
          <DeptCard key={r.d.code} r={r} onOpen={!prodDepts || prodDepts.some((d) => d.code === r.d.code) ? () => onOpenLoading(r.d.code) : undefined} />
        ))}
        {loading ? <InlineSpinner label="Refreshing…" /> : null}
      </div>
    </div>
  );
}

function DeptCard({ r, onOpen }: { r: Row; onOpen?: () => void }) {
  const { d, hasCap, pct, tone, band } = r;
  const color = sem(tone);
  const pctLabel = hasCap ? `${pct}%` : "—";
  return (
    <RailCard tone={tone} onClick={onOpen} ariaLabel={`${d.name}, ${hasCap ? `${pct}% backlog pressure` : "no capacity data"}${onOpen ? ". Open loading" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
        <Pill tone={tone} label={band} />
        {onOpen ? <ChevronRight size={18} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flexShrink: 0 }} /> : null}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 22, lineHeight: 1.1, fontWeight: 700, letterSpacing: -0.4, color: hasCap ? color : M.muted, fontVariantNumeric: "tabular-nums" }}>{pctLabel}</span>
          <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>backlog pressure</span>
        </div>
        <span style={{ flex: "none", fontSize: 12, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          <b style={{ color: M.raisin }}>{hoursLabel(d.totalScopeLoad)}</b> of {hasCap ? hoursLabel(d.scopeCapacity) : "—"}
        </span>
      </div>
      {/* Bar: 150% full scale, the 100% marker sits at two thirds. */}
      <div aria-hidden="true" style={{ position: "relative", marginTop: 8, height: 8, borderRadius: 999, background: "var(--pl-bar-track)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: hasCap ? `${(Math.min(pct, 150) / 150) * 100}%` : 0, borderRadius: 999, background: color }} />
        <span style={{ position: "absolute", top: -2, bottom: -2, left: "66.6%", width: 2, background: M.raisin, opacity: 0.35 }} />
      </div>
      <div aria-hidden="true" style={{ position: "relative", height: 14, marginTop: 3 }}>
        <span style={{ position: "absolute", left: "66.6%", transform: "translateX(-50%)", fontSize: 10, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>100%</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginTop: 8, paddingTop: 10, boxShadow: `inset 0 1px 0 ${DL.track}` }}>
        {[
          { k: "DAILY CAP", v: hasCap ? hoursLabel(d.dailyCapacity) : "—", red: false },
          { k: "JOBS", v: String(d.jobsInScope), red: false },
          { k: "OVERDUE", v: String(d.overdueCount), red: d.overdueCount > 0 },
          { k: "BACKLOG", v: d.dailyCapacity > 0 ? `${d.totalBacklogDays}d` : "—", red: false },
        ].map((s) => (
          <div key={s.k} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, whiteSpace: "nowrap" }}>{s.k}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: s.red ? sem("danger") : M.raisin, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <SplitChip name="Sofa" tone="warning" hours={hoursLabel(d.sofaScopeLoad)} pct={hasCap ? `${d.sofaScopeUtilization}%` : "—"} />
        <SplitChip name="Bedframe" tone="info" hours={hoursLabel(d.bfScopeLoad)} pct={hasCap ? `${d.bfScopeUtilization}%` : "—"} />
      </div>
    </RailCard>
  );
}

function SplitChip({ name, tone, hours, pct }: { name: string; tone: Tone; hours: string; pct: string }) {
  return (
    <span
      style={{
        flex: 1, minWidth: 0, height: 24, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 7,
        background: `var(--dl-pill-${tone}-bg)`, fontSize: 11.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: `var(--dl-pill-${tone}-fg)` }}>{name}</span>
      {hours} · {pct}
    </span>
  );
}
