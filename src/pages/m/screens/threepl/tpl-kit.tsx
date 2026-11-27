// ===========================================================================
// 3PL Providers — the prototype's building blocks: status pill, state card,
// full-page form layer, bottom sheet, alert dialog and the form fields.
// Layers render into document.body (above the tab bar) and close on Escape.
// ===========================================================================
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, CircleAlert, Info, Plus, X as XIcon, type LucideIcon } from "lucide-react";
import "../xops/xops-theme.css";
import { DASHED_BTN, LABEL, SEG_BTN, ST, X } from "./tpl-style";
import type { ProviderStatus } from "./tpl-lib";

const portal = (n: ReactNode) => (typeof document === "undefined" ? n : createPortal(n, document.body));
const KEYFRAMES =
  "@keyframes tpl-sheet{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}" +
  "@keyframes tpl-pop{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}" +
  "@keyframes tpl-pulse{0%,100%{opacity:.5}50%{opacity:1}}" +
  "@keyframes tpl-spin{to{transform:rotate(360deg)}}" +
  "@keyframes tpl-page{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}" +
  ".tpl-scroll::-webkit-scrollbar{display:none}" +
  ".tpl-in::placeholder{color:#9A9082}" +
  "@media (prefers-reduced-motion:reduce){.tpl-anim{animation:none!important}}";

/** The kit's keyframes; render once per screen. */
export function TplStyles() {
  return <style>{KEYFRAMES}</style>;
}

function useLayer(active: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  useEffect(() => {
    cb.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cb.current();
      }
    };
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [active]);
}

// ---- small pieces -------------------------------------------------------------------
export function StatusPill({ status, size = "md" }: { status: ProviderStatus; size?: "sm" | "md" | "lg" }) {
  const s = ST[status];
  const h = size === "sm" ? 20 : size === "lg" ? 24 : 22;
  return (
    <span
      style={{
        flex: "none", height: h, display: "inline-flex", alignItems: "center", gap: size === "sm" ? 4 : 5, padding: `0 ${size === "lg" ? 10 : size === "sm" ? 8 : 9}px`,
        borderRadius: 999, background: s.b, color: s.c, fontSize: size === "sm" ? 10.5 : size === "lg" ? 11.5 : 11, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: size === "sm" ? 5 : 6, height: size === "sm" ? 5 : 6, borderRadius: "50%", background: s.c }} />
      {s.l}
    </span>
  );
}

export function SectionLabel({ children, pad = "12px 20px 6px" }: { children: ReactNode; pad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: pad }}>
      <span style={LABEL}>{children}</span>
      <span style={{ flex: 1, height: 1, background: X.ln }} />
    </div>
  );
}

/** Empty / error / no-match card (prototype `st`). */
export function StateCard({ icon: Icon, tone = "brand", title, sub, btn, onTap, role = "note" }: {
  icon: LucideIcon; tone?: "brand" | "bad"; title: string; sub: string; btn?: string; onTap?: () => void; role?: "note" | "alert";
}) {
  return (
    <div
      role={role}
      style={{
        margin: 16, padding: "30px 20px", borderRadius: 20, background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 12px 24px -12px ${X.shd}`,
        textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: X.ink,
      }}
    >
      <span style={{ width: 50, height: 50, borderRadius: 16, background: tone === "bad" ? X.badb : X.tint, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={22} strokeWidth={1.8} color={tone === "bad" ? X.bad : X.br} />
      </span>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 13, color: X.sub, lineHeight: 1.45 }}>{sub}</div>
      {btn && onTap ? (
        <button type="button" onClick={onTap} style={{ marginTop: 4, height: 44, padding: "0 20px", borderRadius: 999, border: "none", background: X.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
          {btn}
        </button>
      ) : null}
    </div>
  );
}

/** Neutral / warning / error strip (View only, inactive, notes, errors). */
export function Banner({ icon: Icon, tone, children }: { icon: LucideIcon; tone: "neu" | "warn" | "bad"; children: ReactNode }) {
  const bg = tone === "bad" ? X.badb : tone === "warn" ? X.warnb : X.neub;
  const fg = tone === "bad" ? X.bad : tone === "warn" ? X.note : X.sub;
  const small = tone === "warn";
  return (
    <div role={tone === "bad" ? "alert" : undefined} style={{ display: "flex", alignItems: "flex-start", gap: small ? 6 : 8, padding: small ? "9px 11px" : "10px 12px", borderRadius: 12, background: bg, color: fg, fontSize: small ? 11.5 : 12.5, lineHeight: 1.45 }}>
      <span style={{ flex: "none", display: "flex", height: small ? 17 : 18, alignItems: "center" }}>
        <Icon size={small ? 14 : 15} strokeWidth={2} />
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
export const NoteBox = ({ children }: { children: ReactNode }) => <Banner icon={Info} tone="warn">{children}</Banner>;

export function Spinner({ light = true }: { light?: boolean }) {
  return (
    <span
      className="tpl-anim"
      aria-hidden
      style={{
        width: 14, height: 14, borderRadius: "50%", border: `2px solid ${light ? "rgba(255,255,255,.4)" : X.ln}`,
        borderTopColor: light ? "#FFFFFF" : X.br, animation: "tpl-spin .8s linear infinite", flex: "none",
      }}
    />
  );
}

export function DashedButton({ icon: Icon, label, onTap }: { icon: LucideIcon; label: string; onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} style={DASHED_BTN}>
      <Icon size={15} strokeWidth={2.2} />
      {label}
    </button>
  );
}

// ---- full-page form ----------------------------------------------------------------
export function TplPage({ title, sub, dirty, err, active, onCancel, saveL, busy, disabled = false, onSave, children }: {
  title: string; sub?: string; dirty: boolean; err?: string; active: boolean; onCancel: () => void;
  saveL: string; busy: boolean; disabled?: boolean; onSave: () => void; children: ReactNode;
}) {
  const off = busy || disabled;
  useLayer(active, onCancel);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return portal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="tpl-anim"
      style={{
        position: "fixed", inset: 0, zIndex: 70, display: "flex", flexDirection: "column", background: X.bg, color: X.ink, outline: "none",
        animation: "tpl-sheet .22s ease-out", paddingTop: "env(safe-area-inset-top)", fontFamily: "inherit",
      }}
    >
      <TplStyles />
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 16px", borderBottom: `1px solid ${X.ln}` }}>
        <button type="button" onClick={onCancel} style={{ height: 44, marginLeft: -6, padding: "0 6px", background: "none", border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: X.mut, cursor: "pointer", flex: "none" }}>
          Cancel
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {sub ? <div style={{ fontSize: 11.5, color: X.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
        </div>
        <span style={{ width: 56, flex: "none", textAlign: "right", fontSize: 11, fontWeight: 700, color: X.warn }}>{dirty ? "Unsaved" : ""}</span>
      </div>
      <div className="tpl-scroll" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
        <div style={{ padding: "14px 16px 20px", width: "100%", maxWidth: 640, margin: "0 auto", boxSizing: "border-box", display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
          {err ? <Banner icon={CircleAlert} tone="bad">{err}</Banner> : null}
          {children}
        </div>
      </div>
      <div style={{ flex: "none", padding: "10px 16px calc(24px + env(safe-area-inset-bottom))", background: X.bg, boxShadow: `0 -1px 0 ${X.ln}` }}>
        <button
          type="button"
          onClick={onSave}
          disabled={off}
          style={{
            display: "flex", width: "100%", maxWidth: 640, margin: "0 auto", height: 50, borderRadius: 14, border: "none", background: X.grad, color: "#FFFFFF",
            fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: off ? "default" : "pointer", opacity: busy ? 0.7 : disabled ? 0.5 : 1, alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {busy ? <Spinner /> : null}
          {busy ? "Saving…" : saveL}
        </button>
      </div>
    </div>,
  );
}

// ---- bottom sheet --------------------------------------------------------------------
export type SheetRow = {
  key: string; l: string; s?: string; icon?: LucideIcon; tone?: "brand" | "bad" | "ok"; check?: boolean; pressed?: boolean; onTap: () => void;
};

export function TplSheet({ open, title, sub, onClose, groups, foot }: {
  open: boolean; title: string; sub?: string; onClose: () => void; groups: { t?: string; rows: SheetRow[] }[]; foot?: ReactNode;
}) {
  useLayer(open, onClose);
  if (!open) return null;
  return portal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 75, background: X.scrim, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
      <TplStyles />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="tpl-anim"
        style={{
          width: "100%", maxWidth: 560, background: X.bg, color: X.ink, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "86%",
          display: "flex", flexDirection: "column", animation: "tpl-sheet .22s ease-out",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: X.ln }} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{title}</div>
            {sub ? <div style={{ fontSize: 12, color: X.mut, marginTop: 2 }}>{sub}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 40, height: 40, margin: "-6px -8px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.mut, flex: "none" }}>
            <XIcon size={20} strokeWidth={1.9} />
          </button>
        </div>
        <div className="tpl-scroll" style={{ overflowY: "auto", padding: "4px 16px calc(26px + env(safe-area-inset-bottom))", scrollbarWidth: "none", display: "grid", gap: 12 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.t ? <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{g.t}</div> : null}
              <div style={{ borderRadius: 14, background: X.card, boxShadow: `0 0 0 1px ${X.ln}`, overflow: "hidden" }}>
                {g.rows.map((r, i) => {
                  const bad = r.tone === "bad";
                  const ok = r.tone === "ok";
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={r.onTap}
                      aria-pressed={r.pressed}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "6px 12px", border: "none",
                        borderTop: i ? `1px solid ${X.ln}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink,
                      }}
                    >
                      {r.icon ? (
                        <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: bad ? X.badb : ok ? X.okb : X.tint, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <r.icon size={15} strokeWidth={2} color={bad ? X.bad : ok ? X.ok : X.br} />
                        </span>
                      ) : null}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: bad ? X.bad : X.ink }}>{r.l}</span>
                        {r.s ? <span style={{ display: "block", fontSize: 11.5, color: X.mut, marginTop: 1 }}>{r.s}</span> : null}
                      </span>
                      {r.check ? <Check size={17} strokeWidth={2.6} color={X.pri} style={{ flex: "none" }} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {foot}
        </div>
      </div>
    </div>,
  );
}

// ---- alert dialog --------------------------------------------------------------------
export type DialogSpec = { title: string; body: string; okL: string; danger?: boolean; icon: LucideIcon; onOk: () => void | Promise<void> };

export function TplDialog({ spec, busy, err, onCancel, onOk }: { spec: DialogSpec | null; busy?: boolean; err?: string; onCancel: () => void; onOk: () => void }) {
  useLayer(!!spec, () => {
    if (!busy) onCancel();
  });
  if (!spec) return null;
  const Icon = spec.icon;
  return portal(
    <div style={{ position: "fixed", inset: 0, zIndex: 85, background: X.scrim, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <TplStyles />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={spec.title}
        className="tpl-anim"
        style={{ width: "100%", maxWidth: 340, borderRadius: 20, background: X.bg, color: X.ink, padding: "20px 18px 16px", boxShadow: "0 30px 60px -20px rgba(0,0,0,.5)", animation: "tpl-pop .18s ease-out", boxSizing: "border-box" }}
      >
        <span style={{ width: 44, height: 44, borderRadius: 14, background: spec.danger ? X.badb : X.tint, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} strokeWidth={2} color={spec.danger ? X.bad : X.br} />
        </span>
        <div style={{ marginTop: 12, fontSize: 17, fontWeight: 700, overflowWrap: "anywhere" }}>{spec.title}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5, color: X.sub }}>{spec.body}</div>
        {err ? <div style={{ marginTop: 10 }}><Banner icon={CircleAlert} tone="bad">{err}</Banner></div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ height: 46, borderRadius: 12, border: "none", background: X.card, color: X.sub, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: `0 0 0 1px ${X.ln}` }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onOk}
            disabled={busy}
            style={{ height: 46, borderRadius: 12, border: "none", background: spec.danger ? X.bad : X.pri, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.75 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {busy ? <Spinner /> : null}
            {spec.okL}
          </button>
        </div>
      </div>
    </div>,
  );
}

// ---- form fields ----------------------------------------------------------------------
const fieldSh = (bad?: boolean) => (bad ? `0 0 0 1.5px ${X.bad}` : `0 0 0 1px ${X.ln}`);
const inputS: CSSProperties = {
  flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16,
  color: X.ink, padding: 0, fontVariantNumeric: "tabular-nums",
};

export function TextField({ l, hint, v, on, ph, mode = "text", pre, suf, right, err, help, maxLength }: {
  l: string; hint?: string; v: string; on: (v: string) => void; ph?: string; mode?: "text" | "tel" | "decimal";
  pre?: string; suf?: string; right?: boolean; err?: string; help?: string; maxLength?: number;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>
        {l}
        {hint ? <span style={{ fontWeight: 500, color: X.mut }}>{hint}</span> : null}
      </span>
      <span style={{ display: "flex", alignItems: "center", height: 46, padding: "0 13px", borderRadius: 12, background: X.inp, boxShadow: fieldSh(!!err) }}>
        {pre ? <span style={{ fontSize: 14, fontWeight: 600, color: X.mut, marginRight: 6 }}>{pre}</span> : null}
        <input
          className="tpl-in"
          type={mode === "tel" ? "tel" : "text"}
          inputMode={mode}
          value={v}
          maxLength={maxLength}
          onChange={(e) => on(e.target.value)}
          placeholder={ph}
          aria-invalid={err ? true : undefined}
          style={{ ...inputS, textAlign: right ? "right" : "left" }}
        />
        {suf ? <span style={{ fontSize: 13, color: X.mut, marginLeft: 6 }}>{suf}</span> : null}
      </span>
      {err ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: X.bad }}>{err}</span> : null}
      {help ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: X.mut, lineHeight: 1.4 }}>{help}</span> : null}
    </label>
  );
}

export function AreaField({ l, v, on, ph }: { l: string; v: string; on: (v: string) => void; ph?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>{l}</span>
      <textarea
        className="tpl-in"
        value={v}
        onChange={(e) => on(e.target.value)}
        rows={3}
        placeholder={ph}
        style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 12, border: "none", background: X.inp, boxShadow: fieldSh(), fontFamily: "inherit", fontSize: 16, lineHeight: 1.45, color: X.ink, outline: "none", resize: "vertical" }}
      />
    </label>
  );
}

export function SegField<K extends ProviderStatus>({ l, v, on, opts }: { l: string; v: K; on: (v: K) => void; opts: K[] }) {
  return (
    <div>
      <div style={{ marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>{l}</div>
      <div role="radiogroup" aria-label={l} style={{ display: "grid", gridTemplateColumns: `repeat(${opts.length},minmax(0,1fr))`, gap: 4, height: 44, boxSizing: "border-box", padding: 4, borderRadius: 12, background: X.chip }}>
        {opts.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={v === o} onClick={() => on(o)} style={SEG_BTN(v === o)}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ST[o].c, flex: "none" }} />
            {ST[o].l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HeadRow({ children }: { children: ReactNode }) {
  return <SectionLabel pad="4px 0 0">{children}</SectionLabel>;
}

/** The provider form's link groups (STATE RATE CARD / VEHICLES / DRIVERS). */
export type LinkRow = { key: string; l: string; s: string; icon: LucideIcon; status?: ProviderStatus; onTap: () => void };
export function LinkGroup({ t, rows, add, note }: { t: string; rows: LinkRow[]; add?: { l: string; onTap: () => void } | null; note?: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={LABEL}>{t}</span>
        <span style={{ flex: 1, height: 1, background: X.ln }} />
      </div>
      {rows.length ? (
        <div style={{ borderRadius: 14, background: X.card, boxShadow: `0 0 0 1px ${X.ln}`, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onTap}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", border: "none", borderTop: i ? `1px solid ${X.ln}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink }}
            >
              <r.icon size={16} strokeWidth={2} color={X.br} style={{ flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, overflowWrap: "anywhere" }}>{r.l}</span>
                <span style={{ display: "block", fontSize: 11.5, color: X.mut, marginTop: 1 }}>{r.s}</span>
              </span>
              {r.status ? <StatusPill status={r.status} size="sm" /> : null}
              <ChevronRight size={16} strokeWidth={2} color={X.chev} style={{ flex: "none" }} />
            </button>
          ))}
        </div>
      ) : note ? (
        <div style={{ padding: "12px 8px", textAlign: "center", fontSize: 12.5, color: X.mut, borderRadius: 14, background: X.card, boxShadow: `0 0 0 1px ${X.ln}` }}>{note}</div>
      ) : null}
      {add ? (
        <button type="button" onClick={add.onTap} style={{ ...DASHED_BTN, height: 42, marginTop: 8 }}>
          <Plus size={15} strokeWidth={2.2} />
          {add.l}
        </button>
      ) : null}
    </div>
  );
}
