// ===========================================================================
// Delivery list cards — production order, delivery order, packing list, 3PL
// provider. Layout + colours: Claude Design `Delivery.dc.html` (code + pill →
// title → sub → metas, 3px status rail, taupe meta labels, no meta icons).
// Type: Sales. Every value is a real API field; nothing is invented.
// ===========================================================================
import { ChevronRight, CircleCheck, Send } from "lucide-react";
import { M } from "../../theme";
import { money, resolveStatus, STATUS_MAPS } from "../../config/helpers";
import {
  doStatusLabel, fmtShort, m3, n, overdueBadgeDays, plStatusCounts, providerStatusLabel, s, salesOrderNos, setStatusLabel, totalM3, totalQty,
  type RawRow,
} from "../../lib/do-mobile";
import { CheckBox, FlagPill, Metric, Rail, TilePill } from "./ui";
import { DL, SHADOW_CARD, SHADOW_SELECTED, T, toneOf, type Tone } from "./ui-tokens";

const cardBase = {
  position: "relative" as const,
  overflow: "hidden" as const,
  display: "flex",
  gap: 12,
  background: M.card,
  borderRadius: 16,
  padding: "13px 14px 12px 17px",
  WebkitTapHighlightColor: "transparent",
};

function MetaRow({ cols = 3, children }: { cols?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10, marginTop: 10, paddingTop: 9,
        boxShadow: `inset 0 1px 0 ${DL.track}`,
      }}
    >
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 5, lineHeight: 1.35, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {children}
    </div>
  );
}

function Chevron() {
  return <ChevronRight size={18} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flexShrink: 0 }} />;
}

function onKey(fn?: () => void) {
  return (e: React.KeyboardEvent) => {
    if (!fn) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

// ---------------------------------------------------------------------------
// Production order (Planning / Pending Delivery) — a /ready-planning row.
// ---------------------------------------------------------------------------
export function PoCard({
  po,
  mode,
  selectable,
  checked,
  onToggle,
}: {
  po: RawRow;
  mode: "planning" | "pending";
  selectable: boolean;
  checked: boolean;
  onToggle?: () => void;
}) {
  const pending = mode === "pending";
  const blocked = pending && po.setComplete === false;
  const set = pending ? setStatusLabel(po) : "";
  const qty = n(po, "quantity");
  const unit = n(po, "unitM3");
  const pillSpec: { label: string; tone: Tone } | null = pending
    ? set
      ? { label: set, tone: po.setComplete === false ? "warning" : "success" }
      : null
    : { label: `${s(po, "currentDepartment") || "In production"} · ${Math.round(n(po, "progress"))}%`, tone: "info" };
  const rail: Tone = blocked ? "warning" : pending ? "success" : "info";
  const tap = selectable ? onToggle : undefined;
  return (
    <div
      role={selectable ? "checkbox" : "article"}
      aria-checked={selectable ? checked : undefined}
      aria-disabled={blocked ? true : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={tap}
      onKeyDown={onKey(tap)}
      style={{
        ...cardBase,
        cursor: selectable ? (blocked ? "not-allowed" : "pointer") : "default",
        opacity: blocked && selectable ? 0.6 : 1,
        boxShadow: checked ? SHADOW_SELECTED : SHADOW_CARD,
      }}
    >
      <Rail tone={rail} />
      {selectable ? <CheckBox on={checked} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Code>{s(po, "poNo") || "—"}</Code>
          {pillSpec ? <TilePill tone={pillSpec.tone} label={pillSpec.label} /> : null}
        </div>
        <Title>{s(po, "productName") || s(po, "productCode") || "—"}</Title>
        <Sub>{[s(po, "customerName"), s(po, "customerState")].filter(Boolean).join(" · ") || "—"}</Sub>
        <MetaRow>
          <Metric label="SIZE" value={s(po, "sizeLabel") || "—"} />
          <Metric label="QTY · M³" value={`${qty} · ${m3(unit * qty)}`} />
          <Metric label="EXPECTED DD" value={fmtShort(s(po, "hookkaExpectedDD")) || "—"} />
        </MetaRow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delivery order — a GET /api/delivery-orders list row.
// ---------------------------------------------------------------------------
export function DoCard({
  d,
  selecting,
  checked,
  current,
  onClick,
}: {
  d: RawRow;
  selecting: boolean;
  checked: boolean;
  /** Open in the tablet detail pane. */
  current?: boolean;
  onClick: () => void;
}) {
  const status = s(d, "status");
  const tone = toneOf(resolveStatus(status, STATUS_MAPS.delivery).style);
  const incomplete = d.deliveryIncomplete === true && status === "DELIVERED";
  const overdue = overdueBadgeDays(d);
  const flag: { text: string; tone: Tone } | null = incomplete
    ? { text: "Docs incomplete", tone: "warning" }
    : overdue
      ? { text: `${overdue}d overdue`, tone: "danger" }
      : null;
  const where = [s(d, "hubName"), s(d, "hubState", "customerState")].filter(Boolean).join(" · ");
  const sos = salesOrderNos(d);
  const provider = s(d, "driverName");
  return (
    <div
      role={selecting ? "checkbox" : "button"}
      aria-checked={selecting ? checked : undefined}
      aria-current={current ? "true" : undefined}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey(onClick)}
      style={{ ...cardBase, cursor: "pointer", boxShadow: (selecting ? checked : current) ? SHADOW_SELECTED : SHADOW_CARD }}
    >
      <Rail tone={tone} />
      {selecting ? <CheckBox on={checked} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Code>{s(d, "doNo") || "—"}</Code>
          <TilePill tone={tone} label={doStatusLabel(status)} />
          {flag ? <FlagPill tone={flag.tone} label={flag.text} /> : null}
          <span style={{ flex: 1 }} />
          {!selecting ? <Chevron /> : null}
        </div>
        <Title>{s(d, "customerName") || "—"}</Title>
        <Sub>{[where, sos].filter(Boolean).join(" · ") || "—"}</Sub>
        <MetaRow>
          <Metric label="DELIVERY" value={fmtShort(s(d, "deliveryDate")) || "—"} />
          <Metric label="QTY · M³" value={`${totalQty(d)} · ${m3(totalM3(d))}`} />
          {/* driverName holds the 3PL company (delivery-orders/_helpers.ts), so the label says 3PL. */}
          <Metric label="3PL" value={provider || "Not assigned"} muted={!provider} />
        </MetaRow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packing list — a GET /api/packing-lists row (live doStatusCounts).
// ---------------------------------------------------------------------------
export function PlCard({
  pl,
  canAct,
  busy,
  onDispatch,
  onDeliver,
}: {
  pl: RawRow;
  canAct: boolean;
  busy: boolean;
  onDispatch: () => void;
  onDeliver: () => void;
}) {
  const c = plStatusCounts(pl);
  const doCount = pl.doCount != null ? n(pl, "doCount") : Array.isArray(pl.doIds) ? (pl.doIds as unknown[]).length : 0;
  const stops = pl.stops != null ? n(pl, "stops") : n(pl, "stopCount");
  const states = Array.isArray(pl.states) ? (pl.states as string[]).filter(Boolean).join(", ") : "";
  const statusLine = [c.pending && `${c.pending} pending`, c.dispatched && `${c.dispatched} dispatched`, c.delivered && `${c.delivered} delivered`]
    .filter(Boolean)
    .join(" · ");
  const btn = (enabled: boolean) => ({
    height: 40, borderRadius: 11, border: "none", background: M.paper, color: enabled ? M.taupe : DL.disabled, fontFamily: "inherit",
    fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    gap: 6, opacity: busy ? 0.6 : 1, WebkitTapHighlightColor: "transparent",
  });
  return (
    <div style={{ background: M.card, borderRadius: 16, padding: "13px 14px 12px", boxShadow: SHADOW_CARD }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Code>{s(pl, "packingNo") || "—"}</Code>
        {statusLine ? <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statusLine}</span> : null}
      </div>
      <Title>{states ? `Packing List · ${states}` : "Packing List"}</Title>
      <Sub>
        {doCount} DO{doCount === 1 ? "" : "s"} · {stops} stop{stops === 1 ? "" : "s"} · {n(pl, "totalUnits")} units
      </Sub>
      <MetaRow cols={2}>
        <Metric label="M³" value={m3(n(pl, "totalM3"))} />
        <Metric label="REVENUE" value={money(n(pl, "revenueSen"))} align="right" />
      </MetaRow>
      {canAct ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onDispatch} disabled={busy} aria-disabled={!c.pending} style={btn(c.pending > 0)}>
            <Send size={15} strokeWidth={2} aria-hidden />
            Dispatch · {c.pending}
          </button>
          <button type="button" onClick={onDeliver} disabled={busy} aria-disabled={!c.dispatched} style={btn(c.dispatched > 0)}>
            <CircleCheck size={15} strokeWidth={2} aria-hidden />
            Delivered · {c.dispatched}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3PL provider — a GET /api/drivers row. No single rate: pricing is per state
// (State Rate Card) and per vehicle, so the card shows counts only.
// ---------------------------------------------------------------------------
export function ProviderCard({ p, onClick }: { p: RawRow; onClick: () => void }) {
  const tone: Tone = s(p, "status") === "ACTIVE" ? "success" : "neutral";
  const states = Array.isArray(p.ratedStates) ? (p.ratedStates as unknown[]).length : null;
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={onKey(onClick)} style={{ ...cardBase, display: "block", cursor: "pointer", boxShadow: SHADOW_CARD }}>
      <Rail tone={tone} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <TilePill tone={tone} label={providerStatusLabel(s(p, "status"))} />
        <span style={{ flex: 1 }} />
        <Chevron />
      </div>
      <Title>{s(p, "name") || "—"}</Title>
      <Sub>{[s(p, "contactPerson"), s(p, "phone")].filter(Boolean).join(" · ") || "—"}</Sub>
      <MetaRow>
        <Metric label="STATES" value={states == null ? "—" : String(states)} />
        <Metric label="VEHICLES" value={p.vehicleCount == null ? "—" : String(n(p, "vehicleCount"))} />
        <Metric label="DRIVERS" value={p.driverCount == null ? "—" : String(n(p, "driverCount"))} />
      </MetaRow>
    </div>
  );
}

export function EmptyCard({ text }: { text: string }) {
  return (
    <div
      role="status"
      style={{ margin: "12px 0", padding: "28px 18px", textAlign: "center", background: M.card, borderRadius: 16, ...T.body, color: M.ink, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.2)" }}
    >
      {text}
    </div>
  );
}
