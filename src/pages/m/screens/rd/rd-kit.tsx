// ===========================================================================
// R&D Projects — the prototype's building blocks: badges, section labels,
// doc rows, info rows, tiles, notes, states, the cover thumbnail, the stage
// bar, form fields (date / segmented / chips / stepper), the bottom sheet with
// free content (milestone sheet) and the full-screen photo viewer.
// Layers render into document.body (above the tab bar) and close on Escape.
// Full-page forms, plain row sheets and dialogs reuse the 3PL kit (tpl-kit).
// ===========================================================================
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BedDouble, Check, ChevronRight, Info, Lamp, Minus, Plus, Sofa, TriangleAlert, X as XIcon, type LucideIcon } from "lucide-react";
import "../xops/xops-theme.css";
import { SEG_BTN } from "../threepl/tpl-style";
import { STAGE_COLOR, STAGES, type Category, type Chip, type Stage, type Tone } from "./rd-lib";
import { CARD, LABEL, R, TONE } from "./rd-style";

const portal = (n: ReactNode) => (typeof document === "undefined" ? n : createPortal(n, document.body));

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

// ---- small pieces ------------------------------------------------------------------------
export function Badge({ c, size = "md" }: { c: Chip; size?: "sm" | "md" }) {
  const [fg, bg] = TONE[c.t];
  return (
    <span
      style={{
        flex: "none", height: size === "sm" ? 20 : 22, display: "inline-flex", alignItems: "center", gap: 5, padding: size === "sm" ? "0 8px" : "0 9px",
        borderRadius: 999, background: bg, color: fg, fontSize: size === "sm" ? 10.5 : 11, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: fg }} />
      {c.l}
    </span>
  );
}

export function Label({ t, r, pad = "14px 4px 8px" }: { t: string; r?: string; pad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: pad }}>
      <span style={LABEL}>{t}</span>
      <span style={{ flex: 1, height: 1, background: R.ln }} />
      {r ? <span style={{ fontSize: 11.5, color: R.mut, whiteSpace: "nowrap" }}>{r}</span> : null}
    </div>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "bad"; children: ReactNode }) {
  const [fg, bg] = TONE[tone];
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div role={tone === "bad" ? "alert" : undefined} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 14, background: bg, color: R.ink, boxShadow: `inset 3px 0 0 ${fg}`, fontSize: 12.5, lineHeight: 1.45 }}>
      <Icon size={16} strokeWidth={2} color={fg} style={{ flex: "none", marginTop: 1 }} aria-hidden />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** Key / value rows inside one card (prototype `isRows`). */
export type RowSpec = { k: string; v: ReactNode; strong?: boolean; muted?: boolean; tag?: ReactNode };
export function Rows({ rows }: { rows: RowSpec[] }) {
  return (
    <div style={{ ...CARD, padding: "0 16px" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderTop: i ? `1px solid ${R.ln}` : "none" }}>
          <span style={{ flex: "none", maxWidth: "45%", fontSize: 13, color: R.mut }}>{r.k}</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: r.strong ? 14.5 : 13.5, fontWeight: r.strong ? 800 : 600, color: r.muted ? R.mut : R.ink, overflowWrap: "anywhere", whiteSpace: "pre-wrap", fontVariantNumeric: "tabular-nums", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {r.tag}
            {r.v}
          </span>
        </div>
      ))}
    </div>
  );
}

export type TileSpec = { l: string; v: string; vc?: string; icon?: LucideIcon; tone?: Tone };
export function Tiles({ tiles }: { tiles: TileSpec[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(150px,100%),1fr))", gap: 8 }}>
      {tiles.map((t) => {
        const [fg, bg] = TONE[t.tone ?? "br"];
        return (
          <div key={t.l} style={{ ...CARD, borderRadius: 14, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: R.mut }}>
              {t.icon ? (
                <span style={{ width: 24, height: 24, borderRadius: 8, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <t.icon size={13} strokeWidth={2.2} color={fg} />
                </span>
              ) : null}
              {t.l}
            </span>
            <span style={{ fontSize: 17, fontWeight: 800, color: t.vc ?? R.ink, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{t.v}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Bar({ l, r, pct, color }: { l: string; r: string; pct: number; color: string }) {
  return (
    <div style={{ ...CARD, borderRadius: 14, padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: R.sub }}>
        <span>{l}</span>
        <span style={{ fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{r}</span>
      </div>
      <div style={{ marginTop: 8, height: 8, borderRadius: 999, background: R.chip, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", borderRadius: 999, background: color }} />
      </div>
    </div>
  );
}

/** Row card used by milestones / prototypes / issuances / labour / files / history (prototype `isDoc`). */
export type DocSpec = {
  code: string; badges?: Chip[]; date?: string; title?: string; sub?: string; amts?: { k: string; v: string; c?: string }[];
  lines?: { k: string; v: string }[] | null; rail?: string; onTap?: (() => void) | null; aria?: string;
};
export function DocCard({ d }: { d: DocSpec }) {
  const tap = d.onTap ?? null;
  const body = (
    <>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: d.rail ?? R.ln }} />
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: R.ink, overflowWrap: "anywhere" }}>{d.code}</span>
          {(d.badges ?? []).map((b) => <Badge key={b.l} c={b} size="sm" />)}
        </span>
        {d.date ? <span style={{ flex: "none", fontSize: 11.5, color: R.mut, fontVariantNumeric: "tabular-nums" }}>{d.date}</span> : null}
        {tap ? <ChevronRight size={16} strokeWidth={2} color={R.chev} style={{ flex: "none" }} aria-hidden /> : null}
      </span>
      {d.title ? <span style={{ display: "block", marginTop: 4, fontSize: 14.5, fontWeight: 700, color: R.ink, overflowWrap: "anywhere" }}>{d.title}</span> : null}
      {d.sub ? <span style={{ display: "block", marginTop: 2, fontSize: 12, color: R.sub, lineHeight: 1.45, overflowWrap: "anywhere" }}>{d.sub}</span> : null}
      {d.amts && d.amts.length ? (
        <span style={{ display: "grid", gridTemplateColumns: `repeat(${d.amts.length},minmax(0,1fr))`, gap: 6, marginTop: 9 }}>
          {d.amts.map((a) => (
            <span key={a.k} style={{ background: R.tint, borderRadius: 10, padding: "7px 9px", minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: R.mut, textTransform: "uppercase" }}>{a.k}</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 13, fontWeight: 700, color: a.c ?? R.ink, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{a.v}</span>
            </span>
          ))}
        </span>
      ) : null}
      {d.lines && d.lines.length ? (
        <span style={{ display: "block", marginTop: 9, paddingTop: 8, borderTop: `1px solid ${R.ln}` }}>
          {d.lines.map((l, i) => (
            <span key={i} style={{ display: "grid", gridTemplateColumns: l.k ? "minmax(84px,auto) minmax(0,1fr)" : "minmax(0,1fr)", gap: 10, padding: "2px 0", fontSize: 12, lineHeight: 1.45 }}>
              {l.k ? <span style={{ color: R.mut }}>{l.k}</span> : null}
              <span style={{ color: R.ink, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{l.v}</span>
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
  const style: CSSProperties = {
    ...CARD, position: "relative", overflow: "hidden", display: "block", width: "100%", boxSizing: "border-box", padding: "12px 14px 12px 18px",
    textAlign: "left", border: "none", fontFamily: "inherit", cursor: tap ? "pointer" : "default", WebkitTapHighlightColor: "transparent",
  };
  return tap ? (
    <button type="button" onClick={tap} aria-label={d.aria} style={style}>{body}</button>
  ) : (
    <div style={style}>{body}</div>
  );
}

/** Inline empty / state block inside a section (prototype `isState`). */
export function InlineState({ icon: Icon, tone = "br", h, t, btn, onTap, role = "note" }: {
  icon?: LucideIcon; tone?: Tone; h?: string; t: string; btn?: string; onTap?: () => void; role?: "note" | "alert";
}) {
  const [fg, bg] = TONE[tone];
  return (
    <div role={role} style={{ ...CARD, padding: h ? "22px 18px" : "14px 16px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      {Icon ? (
        <span style={{ width: 44, height: 44, borderRadius: 14, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} strokeWidth={1.9} color={fg} />
        </span>
      ) : null}
      {h ? <div style={{ fontSize: 14.5, fontWeight: 700 }}>{h}</div> : null}
      <div style={{ fontSize: 12.5, color: h ? R.sub : R.mut, lineHeight: 1.45 }}>{t}</div>
      {btn && onTap ? (
        <button type="button" onClick={onTap} style={{ marginTop: 2, height: 40, padding: "0 18px", borderRadius: 999, border: "none", background: R.tint, color: R.br, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {btn}
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ h, r = 16 }: { h: number; r?: number }) {
  return <div className="tpl-anim" style={{ height: h, borderRadius: r, background: R.card, animation: "tpl-pulse 1.2s ease-in-out infinite" }} />;
}

const CAT_ICON: Record<Category, LucideIcon> = { SOFA: Sofa, BEDFRAME: BedDouble, ACCESSORY: Lamp };
/** Cover thumbnail: the project's photo (cover, else first milestone photo) or the category icon. */
export function Thumb({ src, cat, size = 64, radius = 14 }: { src: string; cat: Category; size?: number; radius?: number }) {
  const Icon = CAT_ICON[cat];
  return (
    <span style={{ width: size, height: size, flex: "none", borderRadius: radius, background: R.tint, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon size={Math.round(size * 0.36)} strokeWidth={1.7} color={R.br} aria-hidden />}
    </span>
  );
}

/** Six-segment stage bar: reached stages in their stage colour. */
export function StageBar({ stage, done }: { stage: Stage; done: boolean }) {
  const cur = STAGES.indexOf(stage);
  return (
    <span aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 4 }}>
      {STAGES.map((s, k) => <span key={s} style={{ height: 5, borderRadius: 999, background: done || k <= cur ? STAGE_COLOR[s] : R.chip }} />)}
    </span>
  );
}

// ---- form fields ---------------------------------------------------------------------------
const fieldSh = (bad?: boolean) => (bad ? `0 0 0 1.5px ${R.bad}` : `0 0 0 1px ${R.ln}`);
export function FieldLabel({ l, err, children }: { l: string; err?: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>{l}</div>
      {children}
      {err ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: R.bad }}>{err}</span> : null}
    </div>
  );
}
export function DateField({ l, v, on, err, help, clearable }: { l: string; v: string; on: (v: string) => void; err?: string; help?: string; clearable?: boolean }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>{l}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, height: 46, padding: "0 6px 0 13px", borderRadius: 12, background: R.inp, boxShadow: fieldSh(!!err) }}>
        <input
          type="date"
          value={v}
          onChange={(e) => on(e.target.value)}
          aria-invalid={err ? true : undefined}
          style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: R.ink, colorScheme: "light dark" }}
        />
        {clearable && v ? (
          <button type="button" onClick={() => on("")} aria-label={`Clear ${l}`} style={{ width: 36, height: 36, border: "none", background: "none", color: R.mut, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <XIcon size={15} strokeWidth={2.2} />
          </button>
        ) : null}
      </span>
      {err ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: R.bad }}>{err}</span> : null}
      {help ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: R.mut, lineHeight: 1.4 }}>{help}</span> : null}
    </label>
  );
}
export function Seg<K extends string>({ l, v, on, opts, err }: { l: string; v: K | ""; on: (v: K) => void; opts: { k: K; l: string }[]; err?: string }) {
  return (
    <FieldLabel l={l} err={err}>
      <div role="radiogroup" aria-label={l} style={{ display: "grid", gridTemplateColumns: `repeat(${opts.length},minmax(0,1fr))`, gap: 4, height: 44, boxSizing: "border-box", padding: 4, borderRadius: 12, background: R.chip, boxShadow: err ? `0 0 0 1.5px ${R.bad}` : "none" }}>
        {opts.map((o) => (
          <button key={o.k} type="button" role="radio" aria-checked={v === o.k} onClick={() => on(o.k)} style={SEG_BTN(v === o.k)}>
            {o.l}
          </button>
        ))}
      </div>
    </FieldLabel>
  );
}
export function ChipPick({ l, opts, err, empty }: { l: string; opts: { k: string; l: string; on: boolean; tap: () => void }[]; err?: string; empty?: string }) {
  return (
    <FieldLabel l={l} err={err}>
      {opts.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {opts.map((o) => (
            <button
              key={o.k}
              type="button"
              aria-pressed={o.on}
              onClick={o.tap}
              style={{
                minHeight: 40, padding: "0 13px", borderRadius: 999, border: "none", fontFamily: "inherit", fontSize: 13, fontWeight: o.on ? 700 : 600,
                background: o.on ? "#6B5C32" : R.card, color: o.on ? "#FFFFFF" : R.ink, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                boxShadow: o.on ? "0 6px 14px -6px rgba(107,92,50,.6)" : `0 0 0 1px ${R.ln}`,
              }}
            >
              {o.on ? <Check size={14} strokeWidth={2.6} /> : null}
              {o.l}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: R.mut, lineHeight: 1.45 }}>{empty}</div>
      )}
    </FieldLabel>
  );
}
export function Stepper({ l, v, onDec, onInc, help, decDisabled }: { l: string; v: string; onDec: () => void; onInc: () => void; help?: string; decDisabled?: boolean }) {
  const btn: CSSProperties = { width: 44, height: 44, borderRadius: 12, border: "none", background: R.tint, color: R.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" };
  return (
    <FieldLabel l={l}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" aria-label="Fewer hours" onClick={onDec} disabled={decDisabled} style={{ ...btn, opacity: decDisabled ? 0.4 : 1 }}>
          <Minus size={18} strokeWidth={2.2} />
        </button>
        <span aria-live="polite" style={{ flex: 1, height: 46, borderRadius: 12, background: R.inp, boxShadow: fieldSh(), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{v}</span>
        <button type="button" aria-label="More hours" onClick={onInc} style={btn}>
          <Plus size={18} strokeWidth={2.2} />
        </button>
      </div>
      {help ? <div style={{ marginTop: 6, fontSize: 11.5, color: R.mut, lineHeight: 1.4 }}>{help}</div> : null}
    </FieldLabel>
  );
}

// ---- bottom sheet with free content -------------------------------------------------------
export function RdSheet({ open, title, sub, badges, onClose, children }: { open: boolean; title: string; sub?: string; badges?: Chip[]; onClose: () => void; children: ReactNode }) {
  useLayer(open, onClose);
  if (!open) return null;
  return portal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 75, background: R.scrim, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="tpl-anim"
        style={{ width: "100%", maxWidth: 560, background: R.bg, color: R.ink, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%", display: "flex", flexDirection: "column", animation: "tpl-sheet .22s ease-out" }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: R.ln }} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{title}</span>
              {(badges ?? []).map((b) => <Badge key={b.l} c={b} size="sm" />)}
            </div>
            {sub ? <div style={{ fontSize: 12, color: R.mut, marginTop: 2, overflowWrap: "anywhere" }}>{sub}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, margin: "-8px -10px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: R.mut, flex: "none" }}>
            <XIcon size={20} strokeWidth={1.9} />
          </button>
        </div>
        <div className="tpl-scroll" style={{ overflowY: "auto", padding: "4px 16px calc(24px + env(safe-area-inset-bottom))", scrollbarWidth: "none", display: "grid", gap: 12 }}>
          {children}
        </div>
      </div>
    </div>,
  );
}

// ---- full-screen photo viewer --------------------------------------------------------------
export function PhotoViewer({ src, title, onClose }: { src: string | null; title: string; onClose: () => void }) {
  useLayer(!!src, onClose);
  if (!src) return null;
  return portal(
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(14,13,11,.96)", color: "#FFFFFF", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 8px 0 16px" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <button type="button" onClick={onClose} aria-label="Close photo" style={{ width: 44, height: 44, border: "none", background: "rgba(255,255,255,.12)", borderRadius: "50%", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <XIcon size={20} strokeWidth={2} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <img src={src} alt={title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
      </div>
    </div>,
  );
}
