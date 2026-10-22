// ===========================================================================
// Pieces of the phone / tablet Invoice Detail (InvoiceDetailScreen.tsx).
//
// Visuals: the Invoice Detail of Claude Design `Invoices v2.dc.html` (cards,
// radii, shadows, tiles, lifecycle, chain, collapsibles). Typography: the
// sibling /m detail screens (Procurement / Delivery) — owner rule. Colours:
// M.* + --m-inv-* tokens (theme-vars.css; light = the prototype's hex).
// ===========================================================================
import { useState, type CSSProperties, type ReactNode } from "react";
import { Banknote, Check, ChevronDown, ChevronRight, CreditCard, Download, Eye, FileText, Landmark, LoaderCircle, Wallet, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import type { InvTone, LifeStep, PaymentRowVM } from "../../lib/invoices-mobile";
import { longDate } from "../../lib/invoices-mobile";
import { T } from "../delivery/ui-tokens";
import { downloadInvoicePdf, viewInvoicePdf } from "../../lib/invoice-pdf";
import type { RawRow } from "../../config/types";

const SHADOW_SECTION = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const SHADOW_BLOCK = "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.2)";
const SHADOW_BUTTON = "0 1px 2px rgba(31,29,27,.05),0 6px 16px -10px rgba(31,29,27,.18)";

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

/** Status pill with a dot (HTML: 26px on the header, 22px in lists). */
export function StatusTag({ tone, label, size = "sm" }: { tone: InvTone; label: string; size?: "sm" | "md" }) {
  const md = size === "md";
  return (
    <span
      style={{
        flexShrink: 0, height: md ? 26 : 22, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: md ? 6 : 5,
        padding: md ? "0 11px" : "0 9px", borderRadius: 999, background: toneBg(tone), color: toneFg(tone),
        fontSize: md ? 12 : 11, fontWeight: 600, whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: md ? 7 : 6, height: md ? 7 : 6, borderRadius: "50%", background: toneHex(tone) }} />
      {label}
    </span>
  );
}

/** White section card (HTML: radius 18 / 20, soft shadow, no border). */
export function SectionCard({
  label,
  radius = 18,
  big,
  style,
  children,
}: {
  label: string;
  radius?: number;
  big?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} style={{ marginTop: 12, background: M.card, borderRadius: radius, boxShadow: big ? SHADOW_SECTION : SHADOW_BLOCK, overflow: "hidden", ...style }}>
      {children}
    </section>
  );
}

/** Icon + title row inside a card. */
export function CardHead({ icon: Icon, title, trailing, pad = "15px 15px 6px" }: { icon: LucideIcon; title: string; trailing?: ReactNode; pad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: pad }}>
      <Icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
      <span style={{ flex: 1, minWidth: 0, ...T.cardTitle, color: M.raisin }}>{title}</span>
      {trailing}
    </div>
  );
}

/** Banner under the header title (past due / cancelled / edit lock). */
export function NoticeBanner({ tone, icon: Icon, text }: { tone: "danger" | "neutral"; icon: LucideIcon; text: string }) {
  const bg = tone === "danger" ? "var(--m-inv-danger-bg)" : "var(--m-inv-neutral-bg)";
  const fg = tone === "danger" ? "var(--m-inv-danger-fg)" : "var(--m-inv-neutral-fg)";
  return (
    <div role="status" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, padding: "11px 13px", borderRadius: 12, background: bg, fontSize: 12.5, lineHeight: 1.45, fontWeight: 600, color: fg }}>
      <Icon size={16} strokeWidth={2} aria-hidden style={{ flex: "none", marginTop: 1 }} />
      <span style={{ minWidth: 0, wordBreak: "break-word" }}>{text}</span>
    </div>
  );
}

/** Overview money tile (Amount paid / Balance due). */
export function MoneyTile({ label, value, bg, fg }: { label: string; value: string; bg: string; fg: string }) {
  return (
    <div style={{ minWidth: 0, padding: "10px 12px", borderRadius: 12, background: bg }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: fg }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 3, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

/** Overview fact with its leading icon (Invoice Date / Due Date). */
export function IconFact({ icon: Icon, label, value, warn }: { icon: LucideIcon; label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: M.ink }}>
        <Icon size={14} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />
        {label}
      </div>
      <div style={{ ...T.cardTitle, color: warn ? "var(--m-inv-past-fg)" : M.raisin, marginTop: 4, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle (HTML: 3 steps, 28px dots, connector lines, label + state line).
// ---------------------------------------------------------------------------
export function LifecycleSteps({ steps }: { steps: LifeStep[] }) {
  return (
    <ol aria-label="Invoice lifecycle" style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((st, i) => {
        const done = st.state === "done";
        const cur = st.state === "current";
        const pend = st.state === "pending";
        const lineL = i === 0 ? "transparent" : !pend ? "var(--m-inv-success)" : "var(--m-inv-line)";
        const lineR = i === steps.length - 1 ? "transparent" : done && steps[i + 1].state !== "pending" ? "var(--m-inv-success)" : "var(--m-inv-line)";
        return (
          <li key={st.label} aria-current={cur ? "step" : undefined} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
            <span aria-hidden style={{ position: "absolute", top: 13, left: 0, width: "50%", height: 2, background: lineL }} />
            <span aria-hidden style={{ position: "absolute", top: 13, right: 0, width: "50%", height: 2, background: lineR }} />
            <span
              style={{
                position: "relative", width: 28, height: 28, boxSizing: "border-box", borderRadius: "50%",
                background: done ? "var(--m-inv-success)" : cur ? M.taupe : M.card,
                boxShadow: cur ? "0 0 0 4px rgba(201,169,97,.35)" : pend ? "inset 0 0 0 1.5px var(--m-inv-dot-ring)" : "none",
                display: "flex", alignItems: "center", justifyContent: "center", color: pend ? M.ink : "#FFFFFF", fontSize: 11.5, fontWeight: 700,
              }}
            >
              {done ? <Check size={14} strokeWidth={3} aria-hidden /> : cur ? <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FFFFFF" }} /> : i + 1}
            </span>
            <span style={{ marginTop: 7, fontSize: 12, fontWeight: cur ? 700 : 600, color: M.raisin, whiteSpace: "nowrap" }}>{st.label}</span>
            <span style={{ marginTop: 2, minHeight: 14, fontSize: 10.5, fontWeight: 700, color: cur ? M.taupe : "var(--m-inv-success)", whiteSpace: "nowrap" }}>{st.stateText}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Off-flow note (Overdue / Cancelled): status dot + text on paper. */
export function FlowNote({ tone, text }: { tone: InvTone; text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, padding: "11px 13px", borderRadius: 12, background: "var(--m-inv-note-bg)", fontSize: 12.5, lineHeight: 1.45, color: "var(--m-inv-body)" }}>
      <span aria-hidden style={{ width: 9, height: 9, flex: "none", borderRadius: "50%", background: toneHex(tone), marginTop: 4 }} />
      <span>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line item (HTML: expandable card; rows from real fields only).
// ---------------------------------------------------------------------------
export function LineItemCard({
  name,
  sku,
  spec,
  total,
  qty,
  rowsList,
  onDetails,
}: {
  name: string;
  sku: string;
  spec: string;
  total: string;
  qty: number;
  rowsList: { k: string; v: string }[];
  onDetails?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: M.card, borderRadius: 16, boxShadow: SHADOW_BLOCK, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", background: "none", border: "none", padding: "14px 14px 13px 15px", fontFamily: "inherit", cursor: "pointer", color: "inherit", WebkitTapHighlightColor: "transparent" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{name || "—"}</div>
          {sku ? <div style={{ fontSize: 12, fontWeight: 600, color: M.taupe, marginTop: 3, wordBreak: "break-all" }}>{sku}</div> : null}
          {spec ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spec}</div> : null}
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{total}</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>Qty {qty}</div>
          <span aria-hidden style={{ display: "inline-flex", marginTop: 4, transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: "var(--m-inv-icon)" }}>
            <ChevronDown size={18} strokeWidth={1.9} />
          </span>
        </div>
      </button>
      {open ? (
        <div style={{ padding: "0 15px 12px" }}>
          <div style={{ height: 1, background: "var(--m-segment-track)", marginBottom: 6 }} />
          {rowsList.map((r) => (
            <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 12.5 }}>
              <span style={{ color: M.ink }}>{r.k}</span>
              <span style={{ fontWeight: 600, color: M.raisin, textAlign: "right", fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>{r.v}</span>
            </div>
          ))}
          {onDetails ? (
            <button
              type="button"
              onClick={onDetails}
              style={{ marginTop: 6, width: "100%", minHeight: 40, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 12px", borderRadius: 10, border: "none", background: "var(--m-inv-tile-bg)", color: M.taupe, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              Line details &amp; files
              <ChevronRight size={16} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ marginTop: 10, width: "100%", height: 44, borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: SHADOW_BUTTON }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Payment history row.
// ---------------------------------------------------------------------------
const METHOD_ICON: Record<string, LucideIcon> = { BANK_TRANSFER: Landmark, CHEQUE: FileText, CASH: Banknote, CREDIT_CARD: CreditCard };

export function PaymentRow({ p }: { p: PaymentRowVM }) {
  const Icon = METHOD_ICON[p.methodCode] ?? Wallet;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "8px 15px", borderTop: "1px solid var(--m-segment-track)" }}>
      <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", background: "var(--m-inv-success-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} strokeWidth={1.9} color="var(--m-inv-success)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{p.method}</div>
        <div style={{ fontSize: 12, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[longDate(p.date), p.reference].filter((x) => x && x !== "—").join(" · ") || "—"}
        </div>
      </div>
      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: "var(--m-inv-success)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(p.amountSen)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section (Additional information / Files / Audit history).
// ---------------------------------------------------------------------------
export function Collapsible({
  icon: Icon,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <SectionCard label={title}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 15px", background: "none", border: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}
      >
        <Icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
        <span style={{ flex: 1, minWidth: 0, ...T.cardTitle, color: M.raisin }}>{title}</span>
        {summary ? <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{summary}</span> : null}
        <span aria-hidden style={{ display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: "var(--m-inv-icon)" }}>
          <ChevronDown size={18} strokeWidth={1.9} />
        </span>
      </button>
      {open ? <div style={{ padding: "0 15px 10px" }}>{children}</div> : null}
    </SectionCard>
  );
}

/** Key / value row inside Additional information (optionally tappable). */
export function InfoRow({ k, v, onClick }: { k: string; v: string; onClick?: () => void }) {
  const inner = (
    <>
      <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{k}</span>
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: onClick ? M.taupe : M.raisin, textAlign: "right", wordBreak: "break-word", whiteSpace: "pre-line" }}>
        {v || "—"}
        {onClick ? <ChevronRight size={15} strokeWidth={2} aria-hidden style={{ flex: "none" }} /> : null}
      </span>
    </>
  );
  const base: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, minHeight: 42, borderTop: "1px solid var(--m-segment-track)" };
  return onClick ? (
    <button type="button" onClick={onClick} style={{ ...base, width: "100%", padding: 0, background: "none", borderLeft: "none", borderRight: "none", borderBottom: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
      {inner}
    </button>
  ) : (
    <div style={base}>{inner}</div>
  );
}

// ---------------------------------------------------------------------------
// Invoice PDF card (owner spec 2026-10-21; moved here from the generic detail).
// View opens its window inside the tap (iOS); one action at a time; failures
// go to the screen's toast. Read-only.
// ---------------------------------------------------------------------------
export function InvoicePdfCard({ doc, id, fileName, onError }: { doc: RawRow; id: string; fileName: string; onError: (message: string) => void }) {
  const [busy, setBusy] = useState<null | "view" | "download">(null);
  const run = (kind: "view" | "download") => {
    if (busy) return;
    setBusy(kind);
    // Synchronous call inside the tap: viewInvoicePdf opens its window first.
    const p = kind === "view" ? viewInvoicePdf(doc, id) : downloadInvoicePdf(doc, id);
    void p
      .then((res) => {
        if (!res.ok) onError(res.error);
      })
      .catch(() => onError("Something went wrong. Please try again."))
      .finally(() => setBusy(null));
  };
  const spin = <LoaderCircle size={16} strokeWidth={2} aria-hidden className="animate-spin" />;
  return (
    <section
      aria-label="Invoice PDF"
      aria-busy={busy != null}
      style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, padding: "12px 12px 12px 14px", background: M.card, borderRadius: 18, boxShadow: SHADOW_SECTION }}
    >
      <span aria-hidden style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: "var(--m-inv-danger-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <FileText size={19} strokeWidth={1.9} color="var(--m-inv-danger)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fileName}</div>
        <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>Invoice PDF</div>
      </div>
      <button
        type="button"
        onClick={() => run("view")}
        disabled={busy != null}
        aria-label={busy === "view" ? "Opening invoice PDF" : "View invoice PDF"}
        style={{
          flex: "none", height: 40, padding: "0 13px", borderRadius: 11, border: "none", background: "var(--m-inv-tile-bg)", color: M.taupe,
          fontFamily: "inherit", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6,
          cursor: busy ? "default" : "pointer", opacity: busy && busy !== "view" ? 0.55 : 1, WebkitTapHighlightColor: "transparent",
        }}
      >
        {busy === "view" ? spin : <Eye size={15} strokeWidth={2} aria-hidden />}
        View
      </button>
      <button
        type="button"
        onClick={() => run("download")}
        disabled={busy != null}
        aria-label={busy === "download" ? "Downloading invoice PDF" : "Download invoice PDF"}
        style={{
          flex: "none", width: 40, height: 40, padding: 0, borderRadius: 11, border: "none", background: M.taupe, color: "var(--m-text-on-accent)",
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -8px rgba(107,92,50,.7)",
          cursor: busy ? "default" : "pointer", opacity: busy && busy !== "download" ? 0.55 : 1, WebkitTapHighlightColor: "transparent",
        }}
      >
        {busy === "download" ? spin : <Download size={17} strokeWidth={2} aria-hidden />}
      </button>
    </section>
  );
}
