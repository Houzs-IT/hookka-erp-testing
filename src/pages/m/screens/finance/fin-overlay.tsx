// ---------------------------------------------------------------------------
// The two full-screen layers of the Finance / Receivable kit (Batch 3
// prototypes): the full-page form ("Edit voucher", "Scan to create" with its
// step bar and sticky footer) and the centred confirm dialog (optional reason
// box or account picker). Both render into document.body, above the tab bar,
// and close on Escape. Field controls drawn to the prototype sit here too.
// ---------------------------------------------------------------------------
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, CircleAlert, FileText, Plus, Trash2, type LucideIcon } from "lucide-react";
import { F } from "./fin-format";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [open, onClose]);
}

const portal = (n: ReactNode) => (typeof document === "undefined" ? n : createPortal(n, document.body));

// ---- full page -----------------------------------------------------------------
/**
 * The prototype's full-page form: Cancel / title bar, optional step bar,
 * scrolling body (error strip first), optional sticky footer button.
 */
export function FinPage({ open, title, cancelL = "Cancel", onCancel, steps, err, foot, children }: {
  open: boolean; title: string; cancelL?: string; onCancel: () => void;
  steps?: boolean[] | null; err?: string; foot?: { l: string; onTap: () => void; disabled?: boolean } | null; children: ReactNode;
}) {
  useEscape(open, onCancel);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return null;
  return portal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "center", background: "rgba(31,29,27,.45)", outline: "none" }}>
      <style>{"@keyframes fin-sheet{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}"}</style>
      <div style={{ width: "100%", maxWidth: 640, height: "100%", display: "flex", flexDirection: "column", background: F.paper, color: F.ink, animation: "fin-sheet .22s ease-out", paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, minHeight: 52, padding: "0 16px", borderBottom: `1px solid ${F.hair}` }}>
          <button type="button" onClick={onCancel} style={{ height: 44, marginLeft: -6, padding: "0 6px", background: "none", border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: F.muted, cursor: "pointer" }}>{cancelL}</button>
          <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          <span style={{ width: 56 }} />
        </div>
        {steps ? (
          <div style={{ flex: "none", display: "flex", gap: 4, padding: "10px 16px 0" }}>
            {steps.map((on, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: on ? F.gold : F.line }} />)}
          </div>
        ) : null}
        <div className="so-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 16px 20px", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: 14 }}>
          {err ? (
            <div role="alert" style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 12, background: "#FBE7E3", color: F.neg, fontSize: 12.5, lineHeight: 1.45 }}>
              <CircleAlert size={16} strokeWidth={2} style={{ flex: "none" }} /><span>{err}</span>
            </div>
          ) : null}
          {children}
        </div>
        {foot ? (
          <div style={{ flex: "none", padding: "12px 16px calc(30px + env(safe-area-inset-bottom))", background: F.paper, boxShadow: `0 -1px 0 ${F.line}` }}>
            <button type="button" onClick={foot.onTap} disabled={foot.disabled}
              style={{ width: "100%", height: 50, borderRadius: 14, border: "none", background: F.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: foot.disabled ? "default" : "pointer", opacity: foot.disabled ? 0.55 : 1, boxShadow: "0 10px 20px -10px rgba(107,92,50,.7)" }}>
              {foot.l}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
  );
}

// ---- page fields ---------------------------------------------------------------------
const labelS: CSSProperties = { display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700 };
const fieldSh = (bad?: boolean) => (bad ? `0 0 0 1.5px ${F.neg}` : `0 0 0 1px ${F.line}`);
const Req = () => <span style={{ color: F.neg }}> *</span>;

export function PageBanner({ icon: Icon, t, bg, fg }: { icon: LucideIcon; t: ReactNode; bg: string; fg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 12, background: bg, color: fg, fontSize: 12.5, lineHeight: 1.45 }}>
      <Icon size={16} strokeWidth={2} style={{ flex: "none" }} /><span>{t}</span>
    </div>
  );
}

export function PageText({ l, v, on, req, bad, err, type = "text", mode, ph }: {
  l: string; v: string; on: (v: string) => void; req?: boolean; bad?: boolean; err?: string; type?: string; mode?: "text" | "decimal" | "none"; ph?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelS}>{l}{req ? <Req /> : null}</span>
      <input type={type} inputMode={mode} value={v} onChange={(e) => on(e.target.value)} placeholder={ph}
        style={{ width: "100%", boxSizing: "border-box", height: 46, padding: "0 13px", borderRadius: 12, border: "none", background: "#FFFFFF", boxShadow: fieldSh(bad), fontFamily: "inherit", fontSize: 16, color: F.ink, outline: "none" }} />
      {err ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: F.neg }}>{err}</span> : null}
    </label>
  );
}

export function PageArea({ l, v, on, ph }: { l: string; v: string; on: (v: string) => void; ph?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelS}>{l}</span>
      <textarea value={v} onChange={(e) => on(e.target.value)} rows={3} placeholder={ph}
        style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 12, border: "none", background: "#FFFFFF", boxShadow: fieldSh(), fontFamily: "inherit", fontSize: 16, lineHeight: 1.45, color: F.ink, outline: "none", resize: "vertical" }} />
    </label>
  );
}

export function PageSelect({ l, v, on, opts, req, bad }: { l: string; v: string; on: (v: string) => void; opts: { v: string; l: string }[]; req?: boolean; bad?: boolean }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelS}>{l}{req ? <Req /> : null}</span>
      <span style={{ position: "relative", display: "block" }}>
        <select value={v} onChange={(e) => on(e.target.value)}
          style={{ width: "100%", height: 46, boxSizing: "border-box", padding: "0 40px 0 13px", borderRadius: 12, border: "none", background: "#FFFFFF", boxShadow: fieldSh(bad), fontFamily: "inherit", fontSize: 15, color: F.ink, appearance: "none", WebkitAppearance: "none" }}>
          {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <span style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none", color: F.goldMid }}><ChevronDown size={18} strokeWidth={2} /></span>
      </span>
    </label>
  );
}

/** A select-looking button that opens a picker (the searchable account list). */
export function PagePickField({ l, value, placeholder, onOpen, req, bad, compact }: { l?: string; value: string; placeholder: string; onOpen: () => void; req?: boolean; bad?: boolean; compact?: boolean }) {
  const btn = (
    <button type="button" onClick={onOpen} aria-label={l ?? "Account"}
      style={{ width: "100%", height: compact ? 42 : 46, boxSizing: "border-box", padding: compact ? "0 30px 0 10px" : "0 40px 0 13px", borderRadius: compact ? 10 : 12, border: "none", background: compact ? F.paper : "#FFFFFF", boxShadow: fieldSh(bad), fontFamily: "inherit", fontSize: compact ? 14 : 15, color: value ? F.ink : F.faint, textAlign: "left", position: "relative", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {value || placeholder}
      <span style={{ position: "absolute", right: compact ? 8 : 12, top: compact ? 12 : 13, pointerEvents: "none", color: F.goldMid }}><ChevronDown size={compact ? 16 : 18} strokeWidth={2} /></span>
    </button>
  );
  if (!l) return btn;
  return (
    <div>
      <span style={labelS}>{l}{req ? <Req /> : null}</span>
      {btn}
    </div>
  );
}

export function PageSwitch({ l, s, on, onToggle }: { l: string; s: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle}
      style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "0 14px", borderRadius: 14, border: "none", background: "#FFFFFF", boxShadow: fieldSh(), fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{l}</span>
        <span style={{ display: "block", fontSize: 11.5, color: F.muted, marginTop: 1 }}>{s}</span>
      </span>
      <span style={{ width: 44, height: 26, flex: "none", borderRadius: 999, background: on ? F.gold : "#D9D2C7", position: "relative" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(31,29,27,.3)", transition: "left .15s" }} />
      </span>
    </button>
  );
}

export type PageLine = { key: string; account: string; desc: string; amt: string; hint?: string; err?: string; amtBad?: boolean; accBad?: boolean };

/** The prototype's "Expense lines" editor: account picker + remove, description
 *  + amount, per-line error, dashed "Add line". */
export function PageLines({ title = "Expense lines", total, lines, onAccount, onDesc, onAmt, onRemove, onAdd }: {
  title?: string; total: string; lines: PageLine[];
  onAccount: (i: number) => void; onDesc: (i: number, v: string) => void; onAmt: (i: number, v: string) => void; onRemove: (i: number) => void; onAdd: () => void;
}) {
  const inp: CSSProperties = { minWidth: 0, height: 42, boxSizing: "border-box", padding: "0 10px", borderRadius: 10, border: "none", background: F.paper, fontFamily: "inherit", fontSize: 16, color: F.ink, outline: "none" };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>Total {total}</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {lines.map((x, i) => (
          <div key={x.key} style={{ padding: 10, borderRadius: 14, background: "#FFFFFF", boxShadow: fieldSh() }}>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0 }}><PagePickField value={x.account} placeholder="Pick an account" onOpen={() => onAccount(i)} bad={x.accBad} compact /></span>
              <button type="button" onClick={() => onRemove(i)} aria-label="Remove line"
                style={{ width: 42, height: 42, flex: "none", border: "none", background: "none", color: F.faint, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Trash2 size={16} strokeWidth={2} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 6, marginTop: 6 }}>
              <input value={x.desc} onChange={(e) => onDesc(i, e.target.value)} placeholder="Description" aria-label="Line description" style={{ ...inp, boxShadow: fieldSh() }} />
              <input inputMode="decimal" value={x.amt} onChange={(e) => onAmt(i, e.target.value)} placeholder="RM 0.00" aria-label="Amount in RM"
                style={{ ...inp, boxShadow: fieldSh(x.amtBad), fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
            </div>
            {x.hint ? <div style={{ marginTop: 5, fontSize: 11.5, color: F.teal }}>{x.hint}</div> : null}
            {x.err ? <div style={{ marginTop: 5, fontSize: 11.5, color: F.neg }}>{x.err}</div> : null}
          </div>
        ))}
        <button type="button" onClick={onAdd}
          style={{ height: 42, borderRadius: 12, border: "1.5px dashed #CDBE98", background: "rgba(244,239,230,.6)", color: F.gold, fontFamily: "inherit", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" }}>
          <Plus size={15} strokeWidth={2.2} />Add line
        </button>
      </div>
    </div>
  );
}

export type PickOpt = { key: string; l: string; s?: string; icon: LucideIcon; bg: string; c: string; onTap?: () => void; disabled?: boolean };
/** Big tappable options (Take a photo / Upload a file / pick a bill). */
export function PagePick({ opts }: { opts: PickOpt[] }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {opts.map((o) => {
        const Icon = o.icon;
        return (
          <button key={o.key} type="button" onClick={o.onTap} disabled={o.disabled || !o.onTap}
            style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 64, padding: "10px 14px", border: "none", borderRadius: 16, background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(31,29,27,.06),0 2px 4px rgba(31,29,27,.06),0 12px 24px -12px rgba(31,29,27,.30)", fontFamily: "inherit", textAlign: "left", cursor: o.disabled ? "default" : "pointer", opacity: o.disabled ? 0.55 : 1, color: "inherit" }}>
            <span style={{ width: 42, height: 42, flex: "none", borderRadius: 13, background: o.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={19} strokeWidth={2} color={o.c} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{o.l}</span>
              {o.s ? <span style={{ display: "block", fontSize: 12, color: F.body, marginTop: 2 }}>{o.s}</span> : null}
            </span>
            <ChevronRight size={17} strokeWidth={2} color={F.chev} />
          </button>
        );
      })}
    </div>
  );
}

/** The spinner state ("Reading the bill…"). */
export function PageBusy({ t, s }: { t: string; s?: ReactNode }) {
  return (
    <div role="status" style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
      <style>{"@keyframes fin-spin{to{transform:rotate(360deg)}}"}</style>
      <span style={{ width: 52, height: 52, borderRadius: "50%", border: `4px solid ${F.line}`, borderTopColor: F.gold, animation: "fin-spin .9s linear infinite", boxSizing: "border-box" }} />
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t}</div>
      {s ? <div style={{ fontSize: 12.5, color: F.body }}>{s}</div> : null}
    </div>
  );
}

/** The attached-file chip ("tnb-bill.jpg · Supporting document"). */
export function PageDoc({ n, s, onTap }: { n: string; s: ReactNode; onTap?: () => void }) {
  return (
    <button type="button" onClick={onTap} disabled={!onTap}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "#FFFFFF", boxShadow: fieldSh(), border: "none", fontFamily: "inherit", textAlign: "left", cursor: onTap ? "pointer" : "default", color: "inherit" }}>
      <span style={{ width: 44, height: 56, flex: "none", borderRadius: 8, background: "linear-gradient(160deg,#F4EFE6,#E6DCC7)", display: "flex", alignItems: "center", justifyContent: "center" }}><FileText size={20} strokeWidth={1.8} color={F.gold} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
        <span style={{ display: "block", fontSize: 11.5, color: F.muted, marginTop: 2 }}>{s}</span>
      </span>
    </button>
  );
}

// ---- dialog ---------------------------------------------------------------------------------
export type DialogSpec = {
  title: string;
  body: ReactNode;
  icon: LucideIcon;
  okL: string;
  danger?: boolean;
  /** A reason box that must be filled before OK. */
  reason?: boolean;
  /** An account picker that must be chosen before OK. */
  accounts?: { v: string; l: string }[];
};

/** The prototype's centred alert dialog. `value` / `onValue` carry the reason
 *  text or the chosen account; OK stays dimmed until it is given. */
export function FinDialog({ spec, value, onValue, tried, onCancel, onOk, busy }: {
  spec: DialogSpec | null; value: string; onValue: (v: string) => void; tried: boolean; onCancel: () => void; onOk: () => void; busy?: boolean;
}) {
  useEscape(!!spec, onCancel);
  if (!spec) return null;
  const Icon = spec.icon;
  const need = (spec.reason || spec.accounts) && !value.trim();
  return portal(
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(31,29,27,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{"@keyframes fin-pop{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}"}</style>
      <div role="alertdialog" aria-modal="true" aria-label={spec.title}
        style={{ width: "100%", maxWidth: 330, borderRadius: 20, background: F.paper, color: F.ink, padding: "20px 18px 16px", boxShadow: "0 30px 60px -20px rgba(31,29,27,.5)", animation: "fin-pop .18s ease-out", boxSizing: "border-box" }}>
        <span style={{ width: 44, height: 44, borderRadius: 14, background: spec.danger ? "#FBE7E3" : F.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} strokeWidth={2} color={spec.danger ? F.neg : F.gold} />
        </span>
        <div style={{ marginTop: 12, fontSize: 17, fontWeight: 700, letterSpacing: "-.2px" }}>{spec.title}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5, color: F.body, whiteSpace: "pre-line" }}>{spec.body}</div>
        {spec.reason ? (
          <textarea value={value} onChange={(e) => onValue(e.target.value)} rows={3} placeholder="Reason (required)" aria-label="Reason"
            style={{ marginTop: 12, width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 12, border: "none", background: "#FFFFFF", boxShadow: fieldSh(tried && !value.trim()), fontFamily: "inherit", fontSize: 16, color: F.ink, outline: "none", resize: "none" }} />
        ) : null}
        {spec.accounts ? (
          <span style={{ position: "relative", display: "block", marginTop: 12 }}>
            <select value={value} onChange={(e) => onValue(e.target.value)} aria-label="Bank or cash account"
              style={{ width: "100%", height: 46, boxSizing: "border-box", padding: "0 36px 0 12px", borderRadius: 12, border: "none", background: "#FFFFFF", boxShadow: fieldSh(tried && !value), fontFamily: "inherit", fontSize: 15, color: F.ink, appearance: "none", WebkitAppearance: "none" }}>
              <option value="">Pick an account</option>
              {spec.accounts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <span style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none", color: F.goldMid }}><ChevronDown size={18} strokeWidth={2} /></span>
          </span>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onCancel} disabled={busy}
            style={{ height: 46, borderRadius: 12, border: "none", background: "#FFFFFF", color: F.body, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: `0 0 0 1px ${F.line}` }}>Cancel</button>
          <button type="button" onClick={onOk} disabled={busy}
            style={{ height: 46, borderRadius: 12, border: "none", background: spec.danger ? F.neg : F.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: need || busy ? 0.5 : 1 }}>
            {busy ? "Working…" : spec.okL}
          </button>
        </div>
      </div>
    </div>,
  );
}
