// ===========================================================================
// Shared components for the Delivery screens (phone + tablet).
//
// Visuals: Claude Design `Delivery.dc.html` (colours, shadows, radii, spacing,
// icons). Typography: the /m Sales screens. Constants in ./ui-tokens.ts, the
// promise-based hooks in ./ui-hooks.tsx.
// ===========================================================================
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Check, ChevronDown, ClipboardList, Info, Mail, Receipt, TriangleAlert, Truck, Users, type LucideIcon,
} from "lucide-react";
import { useTimeout } from "@/lib/scheduler";
import { ResponsiveActionDock, Sheet } from "../../components";
import { M, M_MAX_WIDTH } from "../../theme";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { money } from "../../config/helpers";
import type { CreditBlockBody } from "@/pages/delivery/credit-override";
import type { ConfirmIcon } from "../../lib/do-mobile";
import {
  DL, INPUT, SHADOW_BAR_TOP, SHADOW_CONTROL, SHADOW_FIELD, SHADOW_MENU, SHADOW_PRIMARY, SHADOW_RADIO_ON,
  SHADOW_SEGMENT_ON, SHADOW_SHEET_PRIMARY, pill, sem, type Tone,
} from "./ui-tokens";

/** Prototype pill: height 22 (sm) / 26 (md), pill colours, optional dot. */
export function TilePill({ tone, label, size = "sm", dot }: { tone: Tone; label: string; size?: "sm" | "md"; dot?: boolean }) {
  const c = pill(tone);
  return (
    <span
      style={{
        flexShrink: 0,
        height: size === "sm" ? 22 : 26,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: size === "sm" ? "0 9px" : "0 11px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {dot ? <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: sem(tone) }} /> : null}
      {label}
    </span>
  );
}

/** Warning-triangle flag pill ("Docs incomplete" / "Nd overdue"). */
export function FlagPill({ tone, label, size = "sm" }: { tone: Tone; label: string; size?: "sm" | "md" }) {
  const c = pill(tone);
  return (
    <span
      style={{
        minWidth: 0,
        overflow: "hidden",
        height: size === "sm" ? 22 : 26,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        gap: size === "sm" ? 4 : 5,
        padding: size === "sm" ? "0 8px" : "0 10px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <TriangleAlert size={size === "sm" ? 11 : 13} strokeWidth={2.2} aria-hidden style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  );
}

export function Rail({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: sem(tone) }} />;
}

export function CheckBox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 22, height: 22, flex: "none", marginTop: 1, boxSizing: "border-box", borderRadius: 7,
        background: on ? M.taupe : M.card, boxShadow: on ? "none" : `inset 0 0 0 1.5px ${DL.ring}`,
        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--m-text-on-accent)",
      }}
    >
      {on ? <Check size={14} strokeWidth={3} /> : null}
    </span>
  );
}

export function Surface({
  children,
  style,
  ariaLabel,
  radius = 18,
  shadow = "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.2)",
}: {
  children: ReactNode;
  style?: CSSProperties;
  ariaLabel?: string;
  radius?: number;
  shadow?: string;
}) {
  return (
    <section aria-label={ariaLabel} style={{ background: M.card, borderRadius: radius, boxShadow: shadow, ...style }}>
      {children}
    </section>
  );
}

/** Prototype meta cell: taupe label (no icon), value below. Sales type sizes. */
export function Metric({ label, value, align, muted }: { label: string; value: string; align?: "right"; muted?: boolean }) {
  return (
    <div style={{ minWidth: 0, textAlign: align }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: M.taupe, whiteSpace: "nowrap" }}>{label}</div>
      <div
        style={{
          marginTop: 3, fontSize: 13, fontWeight: 600, color: muted ? M.ink : M.raisin, fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Deliveries | 3PL Providers (prototype segmented control, with icons). */
export function SectionSwitch({ value, onChange }: { value: "deliveries" | "3pl"; onChange: (k: "deliveries" | "3pl") => void }) {
  const opts: { key: "deliveries" | "3pl"; label: string; icon: LucideIcon }[] = [
    { key: "deliveries", label: "Deliveries", icon: Truck },
    { key: "3pl", label: "3PL Providers", icon: Users },
  ];
  return (
    <div
      role="group"
      aria-label="Delivery section"
      style={{
        display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, height: 46, boxSizing: "border-box",
        padding: 4, borderRadius: 14, background: DL.track,
      }}
    >
      {opts.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            style={{
              minWidth: 0, height: "100%", borderRadius: 10, border: "none", background: on ? M.card : "transparent",
              boxShadow: on ? SHADOW_SEGMENT_ON : "none", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13,
              fontWeight: on ? 700 : 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              gap: 7, whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent",
            }}
          >
            <o.icon size={15} strokeWidth={1.9} aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  icon: Icon,
  iconSize = 18,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
  iconSize?: number;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1.2, minWidth: 0, height: 50, borderRadius: 14, border: "none", background: M.taupe, color: "var(--m-text-on-accent)",
        fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, whiteSpace: "nowrap",
        boxShadow: disabled ? "none" : SHADOW_PRIMARY, WebkitTapHighlightColor: "transparent", ...style,
      }}
    >
      {Icon ? <Icon size={iconSize} strokeWidth={2.1} aria-hidden /> : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, minWidth: 0, height: 50, borderRadius: 14, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit",
        fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: SHADOW_CONTROL, WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Fixed bottom action bar (prototype: pinned above the bottom nav). Built on
 * the shared ResponsiveActionDock so it sits above the phone tab bar and
 * inside its own pane on tablets (list pane / detail pane in split view).
 *   "list"   — gradient fade bar (prototype bulk bar)
 *   "detail" — solid paper bar with the hairline top edge (prototype DO bar)
 */
export function BottomDock({ variant, scope, children }: { variant: "list" | "detail"; scope: "content" | "list" | "detail"; children: ReactNode }) {
  const layout = useResponsiveLayout();
  const phone = layout.mode === "phone";
  return (
    <ResponsiveActionDock scope={scope} phoneBottom={72} zIndex={45}>
      <div
        style={{
          pointerEvents: "auto",
          width: "100%",
          maxWidth: phone ? M_MAX_WIDTH : scope === "content" ? 760 : undefined,
          boxSizing: "border-box",
          display: "flex",
          gap: 9,
          padding: variant === "list" ? "10px 16px" : `12px 16px ${phone ? "12px" : "calc(12px + env(safe-area-inset-bottom))"}`,
          background: variant === "list" ? `linear-gradient(180deg, transparent, ${M.paper} 30%)` : M.paper,
          boxShadow: variant === "detail" ? SHADOW_BAR_TOP : "none",
        }}
      >
        {children}
      </div>
    </ResponsiveActionDock>
  );
}

export function FieldLabel({ children, required, optional }: { children: ReactNode; required?: boolean; optional?: boolean }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: M.raisin, marginBottom: 6 }}>
      {children}
      {required ? <span style={{ color: sem("danger") }}> *</span> : null}
      {optional ? <span style={{ fontWeight: 500, color: M.ink }}> · optional</span> : null}
    </div>
  );
}

/** Prototype picker field: white, shadowed, value + ChevronDown (native list). */
export function SelectField({
  value,
  onChange,
  disabled,
  ariaLabel,
  children,
  bare,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  children: ReactNode;
  /** Inline text picker (destination hub row): taupe text, no surface. */
  bare?: boolean;
}) {
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={
          bare
            ? {
                width: "100%", height: 28, padding: "0 20px 0 0", border: "none", background: "transparent", appearance: "none",
                WebkitAppearance: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: M.taupe, outline: "none",
                textOverflow: "ellipsis", cursor: disabled ? "default" : "pointer",
              }
            : {
                ...INPUT, padding: "0 32px 0 12px", fontSize: 13.5, appearance: "none", WebkitAppearance: "none",
                color: disabled || !value ? M.muted : M.raisin, textOverflow: "ellipsis", cursor: disabled ? "default" : "pointer",
              }
        }
      >
        {children}
      </select>
      <ChevronDown
        size={bare ? 14 : 15}
        strokeWidth={2}
        aria-hidden
        color={bare ? M.taupe : DL.icon}
        style={{ position: "absolute", right: bare ? 0 : 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
      />
    </div>
  );
}

export function RadioRow({ on, label, sub, onClick }: { on: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: sub ? 54 : 44, padding: "8px 13px", border: "none",
        borderRadius: 12, background: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer",
        boxShadow: on ? SHADOW_RADIO_ON : SHADOW_FIELD, WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 18, height: 18, flex: "none", boxSizing: "border-box", borderRadius: "50%", border: on ? `5px solid ${M.taupe}` : `1.5px solid ${DL.ring}` }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: on ? 700 : 500, color: M.raisin }}>{label}</span>
        {sub ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span> : null}
      </span>
    </button>
  );
}

/** Sheet sub-title line (prototype: under the title, 12.5 ink). */
export function SheetSub({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12.5, lineHeight: 1.45, color: M.ink, marginTop: -11, marginBottom: 12 }}>{children}</div>;
}

/** Prototype sheet footer: hairline top edge, Cancel + taupe confirm. */
export function SheetFooter({
  onCancel,
  onConfirm,
  confirmLabel,
  busy,
  disabled,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  // Pinned to the bottom of the sheet's scroll area (the shared Sheet panel
  // scrolls as one), as the prototype's footer sits outside its scrolling body.
  return (
    <div
      style={{
        position: "sticky", bottom: -16, zIndex: 1, display: "flex", gap: 10, marginTop: 14, padding: "12px 0 16px",
        marginBottom: -16, background: M.paper, boxShadow: `0 -1px 0 ${DL.line}`,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{ flex: 1, height: 46, borderRadius: 12, border: "none", background: M.card, color: M.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SHADOW_CONTROL }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={off}
        style={{
          flex: 1.3, minWidth: 0, height: 46, borderRadius: 12, border: "none", background: M.taupe, color: "var(--m-text-on-accent)",
          fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: off ? "default" : "pointer", whiteSpace: "nowrap", opacity: off ? 0.5 : 1,
          overflow: "hidden", textOverflow: "ellipsis", padding: "0 10px", boxShadow: off ? "none" : SHADOW_SHEET_PRIMARY,
        }}
      >
        {busy ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}

/** Notes: info = prototype tab note (#FBF7EA / taupe); warning / danger = pill colours. */
export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: ReactNode }) {
  const c = tone === "info" ? { bg: DL.noteBg, fg: M.taupe } : pill(tone);
  return (
    <div role={tone === "danger" ? "alert" : undefined} style={{ padding: "10px 12px", borderRadius: 12, background: c.bg, color: c.fg, fontSize: 12, lineHeight: 1.45 }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm-line icons (prototype: Info / Mail / Receipt / TriangleAlert / ClipboardList).
// ---------------------------------------------------------------------------
const LINE_ICON: Record<ConfirmIcon, { icon: LucideIcon; tone: Tone }> = {
  info: { icon: Info, tone: "info" },
  mail: { icon: Mail, tone: "info" },
  receipt: { icon: Receipt, tone: "success" },
  warning: { icon: TriangleAlert, tone: "warning" },
  list: { icon: ClipboardList, tone: "info" },
};

export function ConfirmLines({ lines }: { lines: { icon: ConfirmIcon; text: string }[] }) {
  return (
    <div style={{ background: M.card, borderRadius: 14, padding: "12px 14px", boxShadow: SHADOW_MENU }}>
      {lines.map((l, i) => {
        const L = LINE_ICON[l.icon];
        return (
          <div key={i} style={{ display: "flex", gap: 9, padding: "5px 0", fontSize: 13, lineHeight: 1.45, color: DL.body }}>
            <L.icon size={15} strokeWidth={2} color={sem(L.tone)} aria-hidden style={{ flex: "none", marginTop: 2 }} />
            <span>{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Views rendered by the hooks in ./ui-hooks.tsx.
// ---------------------------------------------------------------------------
export type ToastTone = "success" | "error" | "warning" | "info";

/** One toast; keyed per message so each gets its own dismiss timer. */
export function ToastView({ text, tone, onDone }: { text: string; tone: ToastTone; onDone: () => void }) {
  const layout = useResponsiveLayout();
  useTimeout(onDone, tone === "error" ? 5200 : 3200);
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      onClick={onDone}
      style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)",
        bottom: layout.hasBottomNavigation ? "calc(104px + env(safe-area-inset-bottom))" : "calc(84px + env(safe-area-inset-bottom))",
        zIndex: 80, width: "max-content", maxWidth: "min(340px, calc(100vw - 32px))", boxSizing: "border-box", padding: "10px 14px",
        borderRadius: 12, background: M.raisin, color: M.paper, fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, textAlign: "center",
        boxShadow: "0 10px 30px -10px rgba(31,29,27,.5)",
      }}
    >
      {text}
    </div>
  );
}

export type ConfirmSpec = {
  title: string;
  sub?: string;
  lines: { icon: ConfirmIcon; text: string }[];
  confirmLabel: string;
};

export function ConfirmView({ spec, onCancel, onConfirm }: { spec: ConfirmSpec | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Sheet open={!!spec} onClose={onCancel} title={spec?.title}>
      {spec ? (
        <>
          {spec.sub ? <SheetSub>{spec.sub}</SheetSub> : null}
          <ConfirmLines lines={spec.lines} />
          <SheetFooter onCancel={onCancel} onConfirm={onConfirm} confirmLabel={spec.confirmLabel} />
        </>
      ) : null}
    </Sheet>
  );
}

/** The mobile half of src/pages/delivery/credit-override.tsx: OK-only when
 *  the server says no override; otherwise a required reason. */
export function CreditView({ body, onClose, onReason }: { body: CreditBlockBody | null; onClose: () => void; onReason: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [lastBody, setLastBody] = useState(body);
  if (body !== lastBody) {
    setLastBody(body);
    setReason("");
    setErr(null);
  }
  const d = body?.details ?? {};
  const title = body?.code === "PAYMENT_OVERDUE" ? "Customer has overdue invoices" : "Credit limit exceeded";
  const row = (k: string, v: number, bold?: boolean) => (
    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12.5, fontWeight: bold ? 700 : 400, color: M.raisin }}>
      <span>{k}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(v)}</span>
    </div>
  );
  return (
    <Sheet open={!!body} onClose={onClose} title={title}>
      {body ? (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.45, color: DL.body }}>{body.error || "Blocked by the customer's credit control."}</div>
          <div style={{ marginTop: 10, background: M.card, borderRadius: 14, padding: "10px 14px", boxShadow: SHADOW_MENU }}>
            {body.code === "PAYMENT_OVERDUE"
              ? (d.overdue ?? []).map((i) => (
                  <div key={i.invoiceNo} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontSize: 12.5, color: M.raisin }}>
                    <span>{i.invoiceNo}</span>
                    <span style={{ color: M.ink }}>due {i.dueDate}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(i.balanceSen)}</span>
                  </div>
                ))
              : [
                  row("Credit limit", d.limit ?? 0),
                  row("Outstanding", d.outstanding ?? 0),
                  row("Undelivered DOs", d.pendingDo ?? 0),
                  row("This delivery", d.doTotal ?? 0),
                  row("Total", d.projected ?? 0, true),
                ]}
          </div>
          {body.overrideAllowed ? (
            <>
              <label style={{ display: "block", marginTop: 14 }}>
                <FieldLabel required>Reason for override (recorded in the audit log)</FieldLabel>
                <textarea
                  value={reason}
                  rows={2}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setErr(null);
                  }}
                  style={{ ...INPUT, height: 64, padding: "11px 13px", resize: "none" }}
                />
              </label>
              {err ? <div role="alert" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: sem("danger") }}>{err}</div> : null}
              <SheetFooter
                onCancel={onClose}
                confirmLabel="Override and continue"
                onConfirm={() => {
                  if (!reason.trim()) {
                    setErr("A reason is required to override the credit block.");
                    return;
                  }
                  onReason(reason.trim());
                }}
              />
            </>
          ) : (
            <div style={{ display: "flex", marginTop: 16 }}>
              <PrimaryButton onClick={onClose} style={{ height: 46, borderRadius: 12 }}>
                OK
              </PrimaryButton>
            </div>
          )}
        </>
      ) : null}
    </Sheet>
  );
}
