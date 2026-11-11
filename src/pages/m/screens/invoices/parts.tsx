// ===========================================================================
// Pieces of the phone Invoices list v2 (InvoicesScreen.tsx).
//
// Visuals (layout, colours, shadows, radii): Claude Design `Invoices v2.dc.html`.
// Typography: the sibling /m screens already built from Claude Design
// (Procurement / Delivery cards) — owner rule: design owns visuals, the repo
// owns type. Colours: M.* tokens + the --m-inv-* tokens in theme-vars.css
// (light = the prototype's hex, dark = lifted for the dark card).
// ===========================================================================
import type { CSSProperties, ReactNode } from "react";
import { Calendar, CircleAlert, CircleCheck, ScanLine, Search, Wallet, X, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { ListCardShell } from "../../components/ListCardShell";
import { money } from "../../config/helpers";
import { fmtShort, s } from "../../lib/do-mobile";
import { useStickyBelowHeader } from "../../lib/header-geometry";
import { CHIP_COUNT, CHIP_ROW, CHIP_ROW_CLASS, SEGMENT_ICON, chip as chipStyle, chipDot, segmentButton, segmentTrack } from "../../lib/control-styles";
import {
  amountBox, dueChip, invoiceTone, payProgress, refChips, statusLabel, statusOf,
  type InvTone, type InvoiceSummary, type RawRow, type RecordCard,
} from "../../lib/invoices-mobile";

// Prototype shadows (Invoices v2.dc.html).
const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";

const TONE_VAR: Record<InvTone, string> = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  warningHigh: "warning-high",
  danger: "danger",
};
const toneHex = (t: InvTone) => `var(--m-inv-${TONE_VAR[t]})`;
const toneBg = (t: InvTone) => `var(--m-inv-${TONE_VAR[t]}-bg)`;
const toneFg = (t: InvTone) => `var(--m-inv-${TONE_VAR[t]}-fg)`;

const LABEL: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: 0.5, whiteSpace: "nowrap" };
/** A tile label that may wrap to a second line (icon stays on the first). */
const WRAP_LABEL: CSSProperties = { whiteSpace: "normal", lineHeight: 1.3, display: "flex", alignItems: "flex-start", gap: 6 };
const SECTION_LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap" };

// ---------------------------------------------------------------------------
// Module tabs — underline tabs, sticky under the header (prototype).
// ---------------------------------------------------------------------------
/**
 * Two-option module switch (two-tab handoff): the shared segmented track
 * (lib/control-styles — the Delivery / Procurement switch), sticky under the
 * glass header and in the same glass block (wrapper padding 2px 18px 10px).
 */
export function ModuleSwitch({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; icon: LucideIcon }[];
  active: string;
  onChange: (k: string) => void;
}) {
  const top = useStickyBelowHeader();
  return (
    <div style={{ position: "sticky", top, zIndex: 30, padding: "2px 18px 10px", background: "var(--m-header-glass)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      <div role="tablist" aria-label="Invoices module" style={segmentTrack(tabs.length)}>
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)} style={segmentButton(on)}>
              <t.icon {...SEGMENT_ICON} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status chips (+ the separate, removable Past Due filter chip).
// ---------------------------------------------------------------------------
export function StatusChips({
  chips,
  value,
  counts,
  onPick,
  pastDue,
  onClearPastDue,
}: {
  chips: { key: string; label: string; tone?: InvTone }[];
  value: string;
  counts: Record<string, number> | null;
  onPick: (k: string) => void;
  pastDue: boolean;
  onClearPastDue: () => void;
}) {
  return (
    <div role="group" aria-label="Status" className={CHIP_ROW_CLASS} style={CHIP_ROW}>
      {pastDue ? (
        <button type="button" onClick={onClearPastDue} aria-label="Remove Past Due filter" style={{ ...chipStyle(true), background: "var(--m-inv-past-fg)" }}>
          Past Due
          <X size={14} strokeWidth={2.4} aria-hidden />
        </button>
      ) : null}
      {chips.map((c) => {
        const on = c.key === value;
        return (
          <button key={c.key || "all"} type="button" aria-pressed={on} onClick={() => onPick(c.key)} style={chipStyle(on)}>
            {c.tone ? <span aria-hidden style={chipDot(toneHex(c.tone))} /> : null}
            {c.label}
            {counts ? <span style={CHIP_COUNT}>{counts[c.key] ?? 0}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary card (Invoices tab only).
// ---------------------------------------------------------------------------
export function SummaryCard({
  title,
  sum,
  ready,
  pastDueOn,
  onPastDue,
}: {
  title: string;
  /** null while the list is loading / incomplete — figures show "—". */
  sum: InvoiceSummary | null;
  ready: boolean;
  pastDueOn: boolean;
  onPastDue: () => void;
}) {
  const v = (sen: number) => (ready && sum ? money(sen) : "—");
  const totalNum = ready && sum ? money(sum.invoicedSen).replace(/^RM\s*/, "") : "—";
  return (
    <section aria-label="Invoice summary" style={{ margin: "10px 18px 2px", background: M.card, borderRadius: 18, padding: "12px 14px", boxShadow: SHADOW_CARD }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ ...SECTION_LABEL, display: "flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
          {title}
        </span>
        <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {ready && sum ? `${sum.count} invoice${sum.count === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>RM</span>
        <span style={{ fontSize: 28, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.6px", color: M.raisin, fontVariantNumeric: "tabular-nums", minWidth: 0, overflowWrap: "anywhere" }}>
          {totalNum}
        </span>
      </div>
      <div style={{ fontSize: 12, color: M.ink, marginTop: 1 }}>Invoiced total</div>
      {/* Two tiles side by side while there is room, stacked in a narrow pane;
          labels wrap and money wraps — never clipped (owner Q1, 2026-10-22). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 10 }}>
        <div style={{ minWidth: 0, padding: "8px 10px", borderRadius: 12, background: "var(--m-inv-gold-box)" }}>
          <div style={{ ...LABEL, ...WRAP_LABEL, fontWeight: 700, color: M.taupe }}>
            <Wallet size={13} strokeWidth={2} aria-hidden style={{ flex: "none", marginTop: 1 }} />
            OUTSTANDING
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 2, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>
            {v(sum?.outstandingSen ?? 0)}
          </div>
        </div>
        <button
          type="button"
          onClick={onPastDue}
          disabled={!ready}
          aria-pressed={pastDueOn}
          aria-label={`Past Due${ready && sum ? `: ${money(sum.pastDueSen)}, ${sum.pastDueCount} invoice${sum.pastDueCount === 1 ? "" : "s"}` : ""}. ${pastDueOn ? "Remove" : "Show"} the Past Due filter`}
          style={{
            minWidth: 0, textAlign: "left", padding: "8px 10px", borderRadius: 12, border: "none", fontFamily: "inherit",
            cursor: ready ? "pointer" : "default", background: "var(--m-inv-past-bg)",
            boxShadow: pastDueOn ? "inset 0 0 0 1.5px var(--m-inv-past-fg)" : "none", WebkitTapHighlightColor: "transparent",
          }}
        >
          <div style={{ ...LABEL, ...WRAP_LABEL, fontWeight: 700, color: "var(--m-inv-past-fg)" }}>
            <CircleAlert size={13} strokeWidth={2} aria-hidden style={{ flex: "none", marginTop: 1 }} />
            PAST DUE
          </div>
          {/* Amount only; the count stays in the aria-label and the Past Due filter. */}
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--m-inv-past-fg)", marginTop: 2, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>
            {v(sum?.pastDueSen ?? 0)}
          </div>
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Invoice card (Invoices tab).
// ---------------------------------------------------------------------------
export function InvoiceCard({
  r,
  today,
  current,
  onOpen,
}: {
  r: RawRow;
  today: string;
  current?: boolean;
  onOpen: () => void;
}) {
  const st = statusOf(r);
  const tone = invoiceTone(st);
  const refs = refChips(r);
  const pay = payProgress(r);
  const due = dueChip(r, today);
  const amt = amountBox(r);
  const code = s(r, "invoiceNo", "invoice_no") || "—";
  const party = s(r, "customerName", "customer_name") || "—";

  let dueKey: ReactNode;
  let dueBody: ReactNode = null;
  let dueBg: string = M.paper;
  if (due.kind === "paid") {
    dueBg = "var(--m-inv-success-bg)";
    dueKey = (
      <span style={{ ...LABEL, fontWeight: 700, color: "var(--m-inv-success)", display: "flex", alignItems: "center", gap: 5 }}>
        <CircleCheck size={12} strokeWidth={2} aria-hidden />
        PAID IN FULL
      </span>
    );
  } else {
    const color = due.tone === "past" ? "var(--m-inv-past-fg)" : due.tone === "soon" ? "var(--m-inv-soon-fg)" : M.taupe;
    if (due.tone === "past") dueBg = "var(--m-inv-past-bg)";
    const Icon = due.tone === "past" ? CircleAlert : Calendar;
    dueKey = (
      <span style={{ ...LABEL, fontWeight: 700, color, display: "flex", alignItems: "center", gap: 5 }}>
        <Icon size={12} strokeWidth={2} aria-hidden />
        DUE
      </span>
    );
    dueBody = (
      <div style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>
        {fmtShort(due.date) || "—"}
        {due.countdown ? <span style={{ fontWeight: 600, color }}> · {due.countdown}</span> : null}
      </div>
    );
  }

  return (
    <ListCardShell
      rail={toneHex(tone)}
      code={code}
      pill={<InvPill tone={tone} label={statusLabel(st)} />}
      party={party}
      refs={refs}
      middle={
        pay ? (
          <div style={{ marginTop: 10 }}>
            <div
              role="progressbar"
              aria-label="Paid"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pay.pct}
              style={{ height: 6, borderRadius: 999, background: "var(--m-segment-track)", overflow: "hidden" }}
            >
              <div style={{ width: `${pay.pct}%`, height: "100%", borderRadius: 999, background: "var(--m-inv-success)" }} />
            </div>
            {/* Wraps onto two lines when the amounts are long — never clipped (owner Q3). */}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", columnGap: 8, rowGap: 2, marginTop: 5, fontSize: 11.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ whiteSpace: "nowrap" }}>
                Paid <span style={{ fontWeight: 700, color: "var(--m-inv-success)" }}>{money(pay.paidSen)}</span>
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                {pay.pct}% of {money(pay.totalSen)}
              </span>
            </div>
          </div>
        ) : null
      }
      left={{ bg: dueBg, children: <>{dueKey}{dueBody}</> }}
      right={{ label: amt.key, value: money(amt.sen) }}
      current={current}
      ariaLabel={`${code}, ${party}, ${statusLabel(st)}`}
      onOpen={onOpen}
    />
  );
}

export function InvPill({ tone, label }: { tone: InvTone; label: string }) {
  return (
    <span
      style={{
        flexShrink: 0, height: 22, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px",
        borderRadius: 999, background: toneBg(tone), color: toneFg(tone), fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: toneHex(tone) }} />
      {label}
    </span>
  );
}

export function CountLine({ text, trailing }: { text: string; trailing?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 20px 8px", minHeight: 24 }}>
      <span style={{ ...SECTION_LABEL, fontVariantNumeric: "tabular-nums" }}>{text}</span>
      {trailing}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search pill with its trailing actions inside (the HTML pill; Scan QR and
// Filter & sort are kept from the existing list — owner 2026-10-21).
// ---------------------------------------------------------------------------
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";

export function SearchPill({
  q,
  setQ,
  placeholder,
  onScan,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  /** Omitted = no Scan QR button (AR Aging tab). No Filter & sort (owner 2026-10-22). */
  onScan?: () => void;
}) {
  const iconBtn: CSSProperties = {
    width: 36, height: 44, flexShrink: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
    background: "none", border: "none", color: M.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent", position: "relative",
  };
  return (
    <div style={{ padding: "14px 18px 0" }}>
      <div style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 6, padding: onScan ? "0 4px 0 13px" : "0 13px", background: M.card, borderRadius: 14, boxShadow: SHADOW_CONTROL, minWidth: 0 }}>
        <Search size={18} strokeWidth={1.75} color={M.faint} style={{ flexShrink: 0, marginRight: 3 }} aria-hidden />
        <input
          className="dl-input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label="Search"
          style={{ flex: 1, minWidth: 0, padding: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: M.raisin, textOverflow: "ellipsis" }}
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ ...iconBtn, width: 32, color: M.faint }}>
            <X size={16} strokeWidth={2} />
          </button>
        ) : null}
        {onScan ? (
          <>
            <span aria-hidden style={{ width: 1, height: 20, background: "var(--m-inv-line)", flexShrink: 0 }} />
            <button type="button" onClick={onScan} aria-label="Scan QR code" style={iconBtn}>
              <ScanLine size={18} strokeWidth={1.75} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record card — Payments / Supplier Pay / Credit Notes / Debit Notes / e-Invoice
// (the HTML's non-invoice card). Not tappable: these rows have no detail route.
// ---------------------------------------------------------------------------
export function RecordCardView({ c }: { c: RecordCard }) {
  const rail = c.rail === "taupe" ? M.taupe : toneHex(c.rail);
  return (
    <article
      aria-label={[c.code, c.title, c.status?.label].filter(Boolean).join(", ")}
      style={{ position: "relative", overflow: "hidden", minWidth: 0, background: M.card, borderRadius: 16, padding: "13px 14px 12px 17px", boxShadow: SHADOW_CARD }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flexShrink: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{c.code}</span>
        {c.status ? <InvPill tone={c.status.tone} label={c.status.label} /> : null}
      </div>
      <div
        style={{
          fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 5, lineHeight: 1.35, letterSpacing: "-0.2px",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word",
        }}
      >
        {c.title}
      </div>
      {c.sub ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, marginTop: 11, paddingTop: 10, boxShadow: "inset 0 1px 0 var(--m-segment-track)" }}>
        {c.metas.map((m) => (
          <div key={m.k} style={{ minWidth: 0, textAlign: m.align ?? "left" }}>
            <div style={{ ...LABEL, color: M.taupe }}>{m.k}</div>
            <div
              style={{
                fontSize: 13, fontWeight: m.align === "right" ? 700 : 600, marginTop: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                // Left (date) may ellipsize; the right column is money and sizes to fit.
                ...(m.align === "right" ? {} : { overflow: "hidden", textOverflow: "ellipsis" }),
                color: m.tone === "danger" ? "var(--m-inv-danger)" : m.tone === "muted" ? M.muted : M.raisin,
              }}
            >
              {m.v}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
