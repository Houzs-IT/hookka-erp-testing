// ===========================================================================
// Planning v2 — Tracker tab (CHANGES.md §3). Desktop Master Tracker: the same
// production-orders read, the desktop's search fields, department-cell rules and
// Late logic (getOverdueDisplay) — see ../../lib/planning-tracker.ts. Mobile
// additions from the design: the "Late only" chip and the Target End sort.
// ===========================================================================
import { useMemo, useState } from "react";
import { Calendar, CalendarX, Search, X } from "lucide-react";
import { M, titleCaseStatus } from "../../theme";
import { CHIP_COUNT, CHIP_ROW, CHIP_ROW_CLASS, chip as chipStyle, chipDot } from "../../lib/control-styles";
import { useDebounced } from "../../lib/use-debounced";
import { useHookkaDd, usePlanningOrders } from "../../lib/planning-data";
import { shortDate } from "../../lib/planning-schedule";
import type { PlanOrder } from "../../lib/planning-capacity";
import { deptLabel, filterTracker, progressOf, segments, targetState, trackerCount, type SegState, type TrackerCategory } from "../../lib/planning-tracker";
import { INPUT, SHADOW_FIELD, sem, type Tone } from "../delivery/ui-tokens";
import { Cell, CardTitleRow, EmptyState, ErrorState, InlineSpinner, Pill, ProductLine, RailCard, RefChip, RefRow, SectionRow, SkeletonCards } from "./ui";

const CHIPS: { key: TrackerCategory; label: string; dot?: Tone }[] = [
  { key: "ALL", label: "All" },
  { key: "BEDFRAME", label: "Bedframe", dot: "info" },
  { key: "SOFA", label: "Sofa", dot: "warning" },
  { key: "LATE", label: "Late only", dot: "danger" },
];

const STATUS_TONE: Record<string, Tone> = {
  IN_PROGRESS: "info",
  PENDING: "neutral",
  ON_HOLD: "warning",
  COMPLETED: "success",
  CANCELLED: "danger",
};
const SEG_BG: Record<SegState, string> = {
  none: "var(--pl-seg-none)",
  done: "var(--pl-seg-done)",
  current: "",
  pending: "var(--pl-seg-pending)",
};

export function TrackerTab({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<TrackerCategory>("ALL");
  const dq = useDebounced(q);
  const { orders, loading, error, hasData, refresh } = usePlanningOrders();
  const hookkaDd = useHookkaDd();

  const rows = useMemo(() => filterTracker(orders, dq, cat), [orders, dq, cat]);

  return (
    <div>
      <div style={{ padding: "12px 18px 0" }}>
        <label style={{ ...INPUT, display: "flex", alignItems: "center", gap: 9, padding: "0 13px", boxShadow: SHADOW_FIELD }}>
          <Search size={18} strokeWidth={1.75} color="var(--dl-icon)" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search PO, SO, customer, product"
            aria-label="Search master tracker"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: M.raisin, padding: 0 }}
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 32, height: 32, marginRight: -6, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--dl-icon)" }}>
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
        </label>
      </div>

      <div className={CHIP_ROW_CLASS} style={CHIP_ROW} role="group" aria-label="Tracker filter">
        {CHIPS.map((c) => {
          const on = cat === c.key;
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => setCat(c.key)} style={chipStyle(on)}>
              {c.dot ? <span aria-hidden="true" style={chipDot(sem(c.dot))} /> : null}
              {c.label}
              <span style={CHIP_COUNT}>{trackerCount(orders, dq, c.key)}</span>
            </button>
          );
        })}
      </div>

      <SectionRow left={`${rows.length} PRODUCTION ORDER${rows.length === 1 ? "" : "S"}`} right="By Target End" />

      <div style={{ padding: "0 18px 24px" }}>
        {loading && !hasData ? (
          <SkeletonCards n={4} h={190} />
        ) : error && !hasData ? (
          <ErrorState title="Could not load the tracker" text="The production orders could not be read." onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState title={cat === "LATE" && !dq.trim() ? "No late orders" : "No production orders match."} text={cat === "LATE" && !dq.trim() ? "Every open order is on or ahead of its Target End." : undefined} />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((o) => (
              <TrackerCard key={o.id} o={o} hookkaDd={hookkaDd.get(o.id)} onOpen={() => onOpenOrder(o.id)} />
            ))}
          </div>
        )}
        {loading && hasData ? <InlineSpinner label="Refreshing…" /> : null}
      </div>
    </div>
  );
}

function TrackerCard({ o, hookkaDd, onOpen }: { o: PlanOrder; hookkaDd?: string; onOpen: () => void }) {
  const tone = STATUS_TONE[o.status] ?? "neutral";
  const segs = segments(o);
  const prog = progressOf(o);
  const t = targetState(o);
  const dueTone: Tone | undefined = t.kind === "late" ? "danger" : t.kind === "left" ? "warning" : undefined;
  const suffix = t.kind === "late" ? ` · ${t.days}d overdue` : t.kind === "left" ? ` · ${t.days}d left` : "";
  const so = o.salesOrderNo || o.companySOId || "";
  const product = o.productName || o.productCode || "—";
  return (
    <RailCard tone={tone} onClick={onOpen} ariaLabel={`${o.poNo}, ${product}, ${titleCaseStatus(o.status)}`}>
      <CardTitleRow code={o.poNo} pill={<Pill tone={tone} label={titleCaseStatus(o.status)} />} />
      <ProductLine>{product}</ProductLine>
      <RefRow>
        {so ? <RefChip k="SO" v={so} /> : null}
        {o.customerName ? <RefChip k="Customer" v={o.customerName} /> : null}
      </RefRow>
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 3, marginTop: 10 }}>
        {segs.map((s) => (
          <span
            key={s.code}
            style={{ height: 6, borderRadius: 999, background: s.state === "current" ? sem(o.status === "ON_HOLD" ? "warning" : "info") : SEG_BG[s.state] }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6, fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          Dept <b style={{ color: sem(tone) }}>{deptLabel(o)}</b>
        </span>
        <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>
          {prog.done} of {prog.total} depts
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 10 }}>
        <Cell
          grow
          label="TARGET END"
          value={shortDate(o.targetEndDate)}
          suffix={suffix}
          tone={dueTone}
          icon={t.kind === "late" ? <CalendarX size={12} strokeWidth={2} aria-hidden /> : <Calendar size={12} strokeWidth={2} aria-hidden />}
        />
        <div style={{ flex: "none" }}>
          <Cell label="HOOKKA DD" value={hookkaDd ? shortDate(hookkaDd) : "—"} qty align="right" />
        </div>
      </div>
    </RailCard>
  );
}
