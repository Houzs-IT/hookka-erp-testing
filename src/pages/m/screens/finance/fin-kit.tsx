// ---------------------------------------------------------------------------
// The Finance / Receivable phone kit (Batch 3, approved Claude Design
// prototypes "Finance (standalone)" and "Receivable (standalone)", 2026-11-26).
// One set of blocks, drawn to the prototype's own sizes and colours, shared by
// both modules: the screen frame + header, section label, menu card, period
// stepper, segmented control, chip rail, search (+ select), banner, hero, card
// (title / segment / chips / value / bars / stack / tiles / rows / note / button),
// document card, state card, skeleton, action dock, bottom sheet and toast.
// The full-page form and the confirm dialog live in fin-overlay.tsx.
//
// The kit draws; it never computes a figure. Every number passed in comes from
// the server or from the repo's own helpers (m-finance-lib, finance-dashboard-
// calc, …) — the prototype's demo data is not used anywhere.
// ---------------------------------------------------------------------------
import {
  useCallback, useLayoutEffect, useRef,
  type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Info, Menu, X, type LucideIcon } from "lucide-react";
import { Sheet } from "../../components";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";
import { useNavDrawer } from "../../lib/nav-drawer";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { F, type DocAmt, type Tile } from "./fin-format";
export type { DocAmt, Tile } from "./fin-format";


const CARD_SH = "0 0 0 1px rgba(31,29,27,.04),0 2px 4px rgba(31,29,27,.06),0 14px 30px -14px rgba(31,29,27,.30)";
const FIELD_SH = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };



const chipStyle = (on: boolean) => ({
  bg: on ? F.gold : "#FFFFFF",
  fg: on ? "#FFFFFF" : "#3A352C",
  sh: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)",
  w: on ? 700 : 600,
});
const segStyle = (on: boolean) => ({
  bg: on ? "#FFFFFF" : "transparent",
  fg: on ? F.ink : F.body,
  sh: on ? "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)" : "none",
  w: on ? 700 : 600,
});

// ---- horizontal rails: wheel scrolls sideways, a mouse can drag ---------------
function useRail() {
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  }, []);
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const x0 = e.clientX;
    const s0 = el.scrollLeft;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4) moved = true;
      el.scrollLeft = s0 - dx;
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      if (moved) {
        const kill = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); el.removeEventListener("click", kill, true); };
        el.addEventListener("click", kill, true);
        // eslint-disable-next-line no-restricted-syntax -- drop the click guard if no click follows the drag
        window.setTimeout(() => el.removeEventListener("click", kill, true), 50);
      }
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }, []);
  return { onWheel, onPointerDown };
}

// ---- screen frame ------------------------------------------------------------
export type HeaderAction = { icon: LucideIcon; aria: string; onTap: () => void; gold?: boolean; disabled?: boolean };

/**
 * A Finance / Receivable screen: the prototype's 52px header (back chevron, or
 * the drawer's menu on a top-level screen; the title; round actions on the
 * right) and the 16px column of blocks with 12px gaps. `dock` leaves room for
 * the bottom action dock.
 */
export function FinScreen({ title, onBack, menu, actions, dock, children }: {
  title: string;
  onBack?: () => void;
  menu?: boolean;
  actions?: HeaderAction[];
  dock?: boolean;
  children: ReactNode;
}) {
  const drawer = useNavDrawer();
  const { mode } = useResponsiveLayout();
  // A top-level screen opens the drawer on a phone; a tablet keeps its rail and the back button.
  const showMenu = !!menu && mode === "phone" && drawer !== null;
  const left = showMenu ? drawer!.open : onBack;
  // A new screen opens at its top (the prototype's go()): the shell's scroller
  // is shared by every /m route, so it would otherwise keep the last screen's offset.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Whichever ancestor really scrolls (a phone scrolls the page; a pane its own box).
    for (let el = rootRef.current?.parentElement ?? null; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
    if (typeof window !== "undefined" && window.scrollY > 0) window.scrollTo(0, 0);
  }, []);
  return (
    <div ref={rootRef} style={{ minHeight: "100%", background: F.paper, color: F.ink }}>
      <header style={{ display: "flex", alignItems: "center", gap: 6, height: 52, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
        {left ? (
          <button type="button" onClick={left} aria-label={showMenu ? "Open menu" : "Back"}
            style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer", color: F.ink }}>
            {showMenu ? <Menu size={22} strokeWidth={1.9} /> : <ChevronLeft size={22} strokeWidth={1.9} />}
          </button>
        ) : <span style={{ width: 4 }} />}
        <h1 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.2px", lineHeight: "24px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h1>
        {(actions ?? []).map((a) => {
          const Icon = a.icon;
          return (
            <button key={a.aria} type="button" onClick={a.onTap} aria-label={a.aria} disabled={a.disabled}
              style={{
                width: 42, height: 42, borderRadius: "50%", border: "none", flex: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: a.disabled ? "default" : "pointer", opacity: a.disabled ? 0.5 : 1,
                background: a.gold ? F.grad : "#FFFFFF", color: a.gold ? "#FFFFFF" : F.gold,
                boxShadow: a.gold ? "0 8px 18px -8px rgba(107,92,50,.65)" : "0 1px 2px rgba(31,29,27,.06),0 6px 16px -8px rgba(31,29,27,.22)",
              }}>
              <Icon size={a.gold ? 20 : 18} strokeWidth={2} />
            </button>
          );
        })}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: `4px 16px ${dock ? 120 : 28}px` }}>{children}</div>
    </div>
  );
}

// ---- small blocks -------------------------------------------------------------
/** "REPORTS ———— right text". */
export function FinLabel({ l, r }: { l: string; r?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px 0" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: F.gold, whiteSpace: "nowrap" }}>{l}</span>
      <span style={{ flex: 1, height: 1, background: "rgba(31,29,27,.08)" }} />
      {r ? <span style={{ fontSize: 11.5, color: F.muted, whiteSpace: "nowrap" }}>{r}</span> : null}
    </div>
  );
}

export type MenuItem = { key: string; l: string; s: string; icon: LucideIcon; c: string; bg: string; tag?: string; onTap: () => void };
/** A white menu card of rows: tinted icon tile, title, one-line note, chevron. */
export function FinMenu({ items }: { items: MenuItem[] }) {
  return (
    <div style={{ borderRadius: 18, background: "#FFFFFF", boxShadow: CARD_SH, overflow: "hidden" }}>
      {items.map((i, n) => {
        const Icon = i.icon;
        return (
          <button key={i.key} type="button" onClick={i.onTap}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 62, padding: "10px 14px", border: "none", borderTop: n ? `1px solid ${F.hair}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
            <span style={{ width: 38, height: 38, flex: "none", borderRadius: 12, background: i.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={18} strokeWidth={2} color={i.c} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: F.ink }}>{i.l}</span>
              <span style={{ display: "block", fontSize: 12, color: F.body, marginTop: 2 }}>{i.s}</span>
            </span>
            {i.tag ? <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, background: "#FAEFCB", color: "#85600F", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>{i.tag}</span> : null}
            <ChevronRight size={17} strokeWidth={2} color={F.chev} />
          </button>
        );
      })}
    </div>
  );
}

/** ‹ label / note › — a side with no handler is disabled. */
export function FinStep({ l, s, tone, onPrev, onNext }: { l: string; s?: string; tone?: "run" | "plain"; onPrev?: () => void; onNext?: () => void }) {
  const btn = (fn: (() => void) | undefined, aria: string, icon: ReactNode) => (
    <button type="button" onClick={fn} aria-label={aria} disabled={!fn}
      style={{ width: 40, height: 40, flex: "none", border: "none", borderRadius: 12, background: F.cream, color: F.gold, display: "flex", alignItems: "center", justifyContent: "center", cursor: fn ? "pointer" : "default", opacity: fn ? 1 : 0.4 }}>
      {icon}
    </button>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 6, borderRadius: 16, background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(31,29,27,.05),0 8px 18px -12px rgba(31,29,27,.28)" }}>
      {btn(onPrev, "Previous", <ChevronLeft size={18} strokeWidth={2.2} />)}
      <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
        {s ? <div style={{ fontSize: 11, color: tone === "run" ? "#85600F" : F.muted, marginTop: 1, fontWeight: 600 }}>{s}</div> : null}
      </div>
      {btn(onNext, "Next", <ChevronRight size={18} strokeWidth={2.2} />)}
    </div>
  );
}

export type Opt<K extends string> = { k: K; l: string; n?: number | string; dot?: string };

/** The page-level segmented control (44px, or `h`). */
export function FinSeg<K extends string>({ opts, cur, set, aria, h = 44 }: { opts: Opt<K>[]; cur: K; set: (k: K) => void; aria: string; h?: number }) {
  return (
    <div role="group" aria-label={aria} style={{ display: "grid", gridTemplateColumns: `repeat(${opts.length},minmax(0,1fr))`, gap: 4, height: h, boxSizing: "border-box", padding: 4, borderRadius: 14, background: F.track }}>
      {opts.map((o) => {
        const on = o.k === cur;
        const st = segStyle(on);
        return (
          <button key={o.k} type="button" aria-pressed={on} onClick={() => set(o.k)}
            style={{ minWidth: 0, height: "100%", borderRadius: 10, border: "none", background: st.bg, color: st.fg, fontWeight: st.w, boxShadow: st.sh, fontFamily: "inherit", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", padding: "0 4px" }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

/** The page-level chip rail (full-bleed, scrolls sideways). `on` overrides the
 *  single-choice highlight for toggle chips. */
export function FinChips<K extends string>({ opts, cur, set, on }: { opts: Opt<K>[]; cur: K | null; set: (k: K) => void; on?: (k: K) => boolean }) {
  const rail = useRail();
  return (
    <div className="so-scroll" {...rail}
      style={{ display: "flex", gap: 8, overflowX: "auto", margin: "0 -16px", padding: "2px 16px 4px", scrollbarWidth: "none", cursor: "grab", touchAction: "pan-x pan-y", WebkitOverflowScrolling: "touch" }}>
      {opts.map((o) => {
        const sel = on ? on(o.k) : o.k === cur;
        const st = chipStyle(sel);
        return (
          <button key={o.k} type="button" aria-pressed={sel} onClick={() => set(o.k)}
            style={{ flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", background: st.bg, color: st.fg, fontFamily: "inherit", fontSize: 12.5, fontWeight: st.w, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer", boxShadow: st.sh }}>
            {o.dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: o.dot }} /> : null}
            {o.l}
            {o.n != null && o.n !== "" ? <span style={{ opacity: 0.8, ...NUM }}>{o.n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export type SelectSpec = { v: string; on: (v: string) => void; aria: string; opts: { v: string; l: string }[] };

/** The prototype's native select, styled (used beside search and on its own). */
export function FinSelect({ sel, flex }: { sel: SelectSpec; flex?: boolean }) {
  return (
    <div style={{ position: "relative", flex: flex ? 1 : "none", maxWidth: flex ? undefined : "44%", minWidth: 0 }}>
      <select value={sel.v} onChange={(e) => sel.on(e.target.value)} aria-label={sel.aria}
        style={{ height: 44, width: flex ? "100%" : undefined, maxWidth: "100%", boxSizing: "border-box", padding: "0 30px 0 12px", borderRadius: 14, border: "none", background: "#FFFFFF", boxShadow: FIELD_SH, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, color: F.ink, appearance: "none", WebkitAppearance: "none" }}>
        {sel.opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <span style={{ position: "absolute", right: 10, top: 13, pointerEvents: "none", color: F.goldMid }}><ChevronDown size={16} strokeWidth={2} /></span>
    </div>
  );
}

/** Search field, with an optional select beside it (company, customer). */
export function FinSearch({ v, on, ph, sel }: { v: string; on: (v: string) => void; ph: string; sel?: SelectSpec }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 13px", background: "#FFFFFF", borderRadius: 14, boxShadow: FIELD_SH }}>
        <SearchIcon />
        <input type="text" inputMode="search" value={v} onChange={(e) => on(e.target.value)} placeholder={ph} aria-label={ph}
          style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: F.ink, padding: 0 }} />
      </label>
      {sel ? <FinSelect sel={sel} /> : null}
    </div>
  );
}
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={F.faint} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

const TONES = {
  warn: ["#FAEFCB", "#85600F", "#EAD9AE"],
  info: ["#E0EDF0", "#1F4654", "#C9DDE2"],
  ok: ["#EEF3E4", "#2F5E3C", "#CFE0C3"],
  bad: ["#FBE7E3", "#7A2318", "#F0D4CD"],
} as const;
export type Tone = keyof typeof TONES;

/** A tinted note: bold lead + text. */
export function FinBanner({ tone, icon: Icon, t, s }: { tone: Tone; icon: LucideIcon; t: string; s?: ReactNode }) {
  const [bg, fg, ring] = TONES[tone];
  return (
    <div role={tone === "bad" ? "alert" : "note"} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 12px", borderRadius: 14, background: bg, color: fg, fontSize: 12.5, lineHeight: 1.45, boxShadow: `inset 0 0 0 1px ${ring}` }}>
      <span style={{ flex: "none", display: "flex", height: 18, alignItems: "center" }}><Icon size={16} strokeWidth={2} /></span>
      <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 700 }}>{t}</b> {s}</span>
    </div>
  );
}

export type StackPart = { w: number; c: string };
/** A stacked share bar (widths in %). */
export function FinStack({ parts, h = 10, mt = 10 }: { parts: StackPart[]; h?: number; mt?: number }) {
  return (
    <div style={{ display: "flex", height: h, borderRadius: 999, overflow: "hidden", marginTop: mt, background: F.track }}>
      {parts.map((x, i) => <span key={i} style={{ width: `${Math.max(0, x.w)}%`, background: x.c, transition: "width .4s ease" }} />)}
    </div>
  );
}

export type HeroTile = { k: string; v: string; s?: string; dot?: string; vc?: string };
/** The hero: gold rail, uppercase key + tag, big value, line, optional stack + tiles. */
export function FinHero({ k, tag, v, vc, s, stack, tiles, cols = 2 }: { k: string; tag?: string; v: string; vc?: string; s?: ReactNode; stack?: StackPart[]; tiles?: HeroTile[]; cols?: number }) {
  const tfs = cols >= 3 ? 11.5 : 13.5;
  return (
    <section style={{ position: "relative", overflow: "hidden", borderRadius: 20, padding: 16, background: "#FFFFFF", color: F.ink, boxShadow: `inset 4px 0 0 ${F.gold},${CARD_SH}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: F.gold, textTransform: "uppercase" }}>{k}</span>
        <span style={{ flex: 1 }} />
        {tag ? <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: F.cream, color: F.gold, fontSize: 10.5, fontWeight: 700 }}>{tag}</span> : null}
      </div>
      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800, letterSpacing: "-.4px", lineHeight: 1.15, color: vc ?? F.ink, ...NUM }}>{v}</div>
      {s ? <div style={{ marginTop: 4, fontSize: 12.5, color: F.body }}>{s}</div> : null}
      {stack ? <FinStack parts={stack} h={8} mt={12} /> : null}
      {tiles && tiles.length ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 6, marginTop: 12 }}>
          {tiles.map((t) => (
            <div key={t.k} style={{ minWidth: 0, padding: "8px 10px", borderRadius: 12, background: F.paper, boxShadow: `inset 0 0 0 1px ${F.hair}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: F.goldMid, textTransform: "uppercase", lineHeight: 1.2 }}>
                {t.dot ? <span style={{ width: 7, height: 7, flex: "none", borderRadius: 2, background: t.dot }} /> : null}{t.k}
              </div>
              <div style={{ fontSize: tfs, fontWeight: 700, color: t.vc ?? (t.v.startsWith("−") ? F.neg : F.ink), marginTop: 3, whiteSpace: "nowrap", ...NUM }}>{t.v}</div>
              {t.s ? <div style={{ fontSize: 10.5, color: F.muted, marginTop: 1 }}>{t.s}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---- card ----------------------------------------------------------------------

export type Row = {
  key?: string;
  l: ReactNode; s?: ReactNode; sc?: string;
  tag?: string; tagBg?: string; tagFg?: string;
  c?: string; v?: ReactNode; vc?: string; v2?: string; v2c?: string;
  fs?: number; w?: number; lc?: string; vfs?: number; vw?: number;
  pl?: number; mh?: number; bg?: string; rail?: string;
  chev?: boolean; open?: boolean; go?: boolean; onTap?: () => void;
  bt?: string;
};

export type BarPoint = { l: string; sel: boolean; v: string; vneg?: boolean; h: number; fh?: number | null; c: string; aria: string; onTap?: () => void };

export type CardProps = {
  title?: string; icon?: LucideIcon; sub?: ReactNode;
  right?: string; rBg?: string; rFg?: string;
  seg?: { opts: Opt<string>[]; cur: string; set: (k: string) => void };
  chips?: { opts: Opt<string>[]; cur: string | null; set: (k: string) => void; on?: (k: string) => boolean };
  val?: { v: string; c?: string; s?: ReactNode; d?: string; dc?: string; di?: LucideIcon };
  bars?: BarPoint[]; barLegend?: boolean;
  stack?: StackPart[];
  tiles?: Tile[]; cols?: number;
  rows?: Row[]; head?: { a: string; b: string; c?: string };
  empty?: ReactNode;
  btn?: { l: string; onTap: () => void };
  note?: ReactNode;
  op?: number;
  children?: ReactNode;
  test?: string;
};

/** The prototype's card: header (gold icon tile, title, sub, pill) then any of
 *  segment, chips, value, bars, stack, tiles, rows, empty note, button, note. */
export function FinCard(p: CardProps) {
  const rail = useRail();
  const cols = p.cols ?? 2;
  const tfs = cols >= 3 ? 11.5 : 13.5;
  const Icon = p.icon;
  return (
    <section data-m-fin={p.test} style={{ borderRadius: 20, padding: 14, background: "#FFFFFF", boxShadow: CARD_SH, opacity: p.op ?? 1 }}>
      {p.title ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: "linear-gradient(145deg,#A08C5B,#6B5C32)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {Icon ? <Icon size={16} strokeWidth={2} color="#FFFFFF" /> : null}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.2px" }}>{p.title}</div>
              {p.sub ? <div style={{ fontSize: 12, color: F.body, marginTop: 1 }}>{p.sub}</div> : null}
            </div>
            {p.right ? <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 999, background: p.rBg ?? F.track, color: p.rFg ?? F.body, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{p.right}</span> : null}
          </div>
          <div style={{ height: 1, background: "rgba(31,29,27,.07)", margin: "12px 0" }} />
        </>
      ) : null}
      {p.seg ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${p.seg.opts.length},minmax(0,1fr))`, gap: 3, height: 38, boxSizing: "border-box", padding: 3, borderRadius: 11, background: F.track, marginBottom: 10 }}>
          {p.seg.opts.map((o) => {
            const on = o.k === p.seg!.cur;
            const st = segStyle(on);
            return (
              <button key={o.k} type="button" aria-pressed={on} onClick={() => p.seg!.set(o.k)}
                style={{ minWidth: 0, height: "100%", borderRadius: 8, border: "none", background: st.bg, color: st.fg, fontWeight: st.w, boxShadow: st.sh, fontFamily: "inherit", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", padding: "0 3px" }}>
                {o.l}
              </button>
            );
          })}
        </div>
      ) : null}
      {p.chips ? (
        <div className="so-scroll" {...rail} style={{ display: "flex", gap: 6, overflowX: "auto", margin: "0 -14px 10px", padding: "0 14px 2px", scrollbarWidth: "none", cursor: "grab", touchAction: "pan-x pan-y" }}>
          {p.chips.opts.map((o) => {
            const sel = p.chips!.on ? p.chips!.on(o.k) : o.k === p.chips!.cur;
            const st = chipStyle(sel);
            return (
              <button key={o.k} type="button" aria-pressed={sel} onClick={() => p.chips!.set(o.k)}
                style={{ flex: "none", height: 32, padding: "0 12px", borderRadius: 999, border: "none", background: st.bg, color: st.fg, fontFamily: "inherit", fontSize: 12, fontWeight: st.w, whiteSpace: "nowrap", cursor: "pointer", boxShadow: st.sh }}>
                {o.l}
              </button>
            );
          })}
        </div>
      ) : null}
      {p.val ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span data-m-fin={p.test ? `${p.test}-val` : undefined} style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px", color: p.val.c ?? F.ink, ...NUM }}>{p.val.v}</span>
            {p.val.s ? <span style={{ fontSize: 12, color: F.body, fontWeight: 600 }}>{p.val.s}</span> : null}
          </div>
          {p.val.d ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, fontSize: 12, fontWeight: 700, color: p.val.dc ?? F.body }}>
              {p.val.di ? <p.val.di size={13} strokeWidth={2.4} /> : null}{p.val.d}
            </div>
          ) : null}
        </>
      ) : null}
      {p.bars ? <FinBars bars={p.bars} legend={p.barLegend} /> : null}
      {p.stack ? <FinStack parts={p.stack} /> : null}
      {p.tiles ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 6, marginTop: 10 }}>
          {p.tiles.map((t) => {
            const tap = !!t.onTap;
            const Tag = tap ? "button" : "div";
            return (
              <Tag key={t.k} {...(tap ? { type: "button" as const, onClick: t.onTap, "aria-pressed": !!t.on } : {})}
                style={{ minWidth: 0, padding: "9px 10px 9px 12px", border: "none", borderRadius: 13, background: `linear-gradient(150deg,#FFFFFF 45%,${t.tint ?? "rgba(244,239,230,.9)"})`, boxShadow: `inset 3px 0 0 ${t.rail ?? F.goldLight},inset 0 0 0 1px ${t.ring ?? "rgba(31,29,27,.06)"}`, fontFamily: "inherit", textAlign: "left", cursor: tap ? "pointer" : "default", gridColumn: t.span === 2 ? "span 2" : "auto", boxSizing: "border-box" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, letterSpacing: ".3px", color: F.gold, textTransform: "uppercase", lineHeight: 1.2 }}>
                  {t.dot ? <span style={{ width: 7, height: 7, flex: "none", borderRadius: 2, background: t.dot }} /> : null}{t.k}
                </span>
                <span style={{ display: "block", fontSize: tfs, fontWeight: 800, marginTop: 4, color: t.c ?? F.ink, whiteSpace: "nowrap", letterSpacing: "-.2px", overflow: "hidden", textOverflow: "ellipsis", ...NUM }}>{t.v}</span>
                {t.s ? <span style={{ display: "block", fontSize: 10.5, color: t.sc ?? F.muted, marginTop: 2, lineHeight: 1.3 }}>{t.s}</span> : null}
              </Tag>
            );
          })}
        </div>
      ) : null}
      {p.rows ? <FinRows rows={p.rows} head={p.head} /> : null}
      {p.children}
      {p.empty ? <div style={{ padding: "18px 8px", textAlign: "center", fontSize: 12.5, color: F.muted, lineHeight: 1.45 }}>{p.empty}</div> : null}
      {p.btn ? (
        <button type="button" onClick={p.btn.onTap}
          style={{ width: "100%", marginTop: 12, height: 42, borderRadius: 999, border: "none", background: "linear-gradient(180deg,rgba(255,255,255,.95),rgba(255,255,255,.72))", boxShadow: "inset 0 1px 0 #FFFFFF,0 0 0 1px rgba(201,169,97,.3),0 6px 14px -8px rgba(107,92,50,.45)", color: F.gold, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          {p.btn.l}<ChevronRight size={15} strokeWidth={2.2} />
        </button>
      ) : null}
      {p.note ? <FinNote>{p.note}</FinNote> : null}
    </section>
  );
}

/** The amber "i" note under a card. */
export function FinNote({ children, mt = 10 }: { children: ReactNode; mt?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: mt, fontSize: 11.5, lineHeight: 1.45, color: F.amber }}>
      <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} color={F.amber} /></span>
      <span>{children}</span>
    </div>
  );
}

/** The card's bar chart: one bar per period (selected full gold, others sand),
 *  a dashed forecast tick per bar, labels and values under it. */
export function FinBars({ bars, legend }: { bars: BarPoint[]; legend?: boolean }) {
  return (
    <div style={{ marginTop: 12, padding: "12px 8px 8px", borderRadius: 14, background: F.paper, boxShadow: `inset 0 0 0 1px ${F.hair}` }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 132 }}>
        {bars.map((r, i) => (
          <button key={i} type="button" onClick={r.onTap} aria-label={r.aria}
            style={{ flex: 1, minWidth: 0, height: "100%", border: "none", background: "none", padding: 0, cursor: r.onTap ? "pointer" : "default", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative" }}>
            <span style={{ position: "relative", width: "100%", maxWidth: 34, height: `${r.h}%`, borderRadius: "7px 7px 3px 3px", background: r.c, transition: "height .45s ease" }}>
              {r.fh != null ? <span style={{ position: "absolute", left: -4, right: -4, bottom: `${r.fh}%`, borderTop: `2px dashed ${F.teal}` }} /> : null}
            </span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {bars.map((r, i) => <span key={i} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, fontWeight: r.sel ? 800 : 600, color: r.sel ? F.ink : F.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.l}</span>)}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        {bars.map((r, i) => <span key={i} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: r.vneg ? F.neg : F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...NUM }}>{r.v}</span>)}
      </div>
      {legend ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, fontSize: 10.5, color: F.body }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}><span style={{ width: 12, height: 8, borderRadius: 2, background: F.gold }} />Actual</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}><span style={{ width: 12, height: 0, borderTop: `2px dashed ${F.teal}` }} />Forecast</span>
        </div>
      ) : null}
    </div>
  );
}


/** The card's table of rows (optional header strip). */
export function FinRows({ rows, head }: { rows: Row[]; head?: { a: string; b: string; c?: string } }) {
  return (
    <div style={{ marginTop: 10, borderRadius: 14, background: "#FFFFFF", boxShadow: `inset 0 0 0 1px ${F.line}`, overflow: "hidden" }}>
      {head ? (
        <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: F.cream, borderBottom: `1px solid ${F.line}`, fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: F.gold, textTransform: "uppercase" }}>
          <span style={{ flex: 1 }}>{head.a}</span>
          {head.c ? <span style={{ width: 52, textAlign: "right" }}>{head.c}</span> : null}
          <span style={{ width: 96, textAlign: "right" }}>{head.b}</span>
        </div>
      ) : null}
      {rows.map((r, i) => <FinRow key={r.key ?? i} r={r} first={i === 0} />)}
    </div>
  );
}

export function FinRow({ r, first }: { r: Row; first: boolean }) {
  const tap = !!r.onTap;
  return (
    <button type="button" onClick={r.onTap} aria-expanded={r.chev ? !!r.open : undefined} disabled={!tap}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: r.mh ?? 46, padding: `8px 12px 8px ${r.pl ?? 12}px`, border: "none", borderTop: r.bt ?? (first ? "none" : `1px solid ${F.hair}`), background: r.bg ?? "transparent", boxShadow: `inset 3px 0 0 ${r.rail ?? "transparent"}`, fontFamily: "inherit", textAlign: "left", cursor: tap ? "pointer" : "default", color: "inherit", opacity: 1 }}>
      {r.chev ? <span style={{ flex: "none", display: "flex", transform: r.open ? "rotate(90deg)" : "none", transition: "transform .15s" }}><ChevronRight size={14} strokeWidth={2.4} color={F.goldMid} /></span> : null}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: r.fs ?? 13, fontWeight: r.w ?? 600, color: r.lc ?? F.ink, lineHeight: 1.3 }}>{r.l}</span>
          {r.tag ? <span style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 999, background: r.tagBg ?? F.track, color: r.tagFg ?? F.muted, fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap" }}>{r.tag}</span> : null}
        </span>
        {r.s ? <span style={{ display: "block", fontSize: 11, color: r.sc ?? F.muted, marginTop: 2, lineHeight: 1.35 }}>{r.s}</span> : null}
      </span>
      {r.c ? <span style={{ width: 52, flex: "none", textAlign: "right", fontSize: 11.5, fontWeight: 600, color: F.muted, ...NUM }}>{r.c}</span> : null}
      <span style={{ flex: "0 1 auto", minWidth: 84, maxWidth: "62%", textAlign: "right" }}>
        {/* A figure stays on one line; a long text value (an account name) wraps instead of running over its label. */}
        <span style={{ display: "block", fontSize: r.vfs ?? 13, fontWeight: r.vw ?? 700, color: r.vc ?? F.ink, whiteSpace: typeof r.v === "string" && /^[−\-+]?(RM )?[\d,.()%—-]+$|^[−\-+]?RM /.test(r.v) ? "nowrap" : "normal", overflowWrap: "anywhere", ...NUM }}>{r.v}</span>
        {r.v2 ? <span style={{ display: "block", fontSize: 10.5, color: r.v2c ?? F.muted, marginTop: 1, whiteSpace: "nowrap", fontWeight: 600 }}>{r.v2}</span> : null}
      </span>
      {r.go ? <ChevronRight size={15} strokeWidth={2} color={F.chev} /> : null}
    </button>
  );
}

// ---- document card ---------------------------------------------------------------
export type DocRef = { k: string; v: string };
export type DocLine = { key?: string; l: ReactNode; s?: ReactNode; v: string; vc?: string; rail?: string; go?: boolean; onTap?: () => void };

/** The prototype's document card: rail, code + status pill + date, party,
 *  reference chips, optional stack, amount boxes, optional lines + toggle + note. */
export function FinDoc({ code, st, stFg, stBg, rail, date, party, refs, stack, amts, lines, toggle, note, op, aria, onTap, test }: {
  code: string; st?: string; stFg?: string; stBg?: string; rail?: string; date?: string; party: ReactNode;
  refs?: DocRef[]; stack?: StackPart[]; amts: DocAmt[]; lines?: DocLine[] | null;
  toggle?: { l: string; open: boolean; onTap: () => void }; note?: string; op?: number; aria: string; onTap?: () => void; test?: string;
}) {
  const fg = stFg ?? F.muted;
  return (
    <div role={onTap ? "button" : undefined} tabIndex={onTap ? 0 : undefined} aria-label={aria} data-m-fin={test}
      onClick={onTap} onKeyDown={onTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } } : undefined}
      style={{ position: "relative", overflow: "hidden", background: "#FFFFFF", borderRadius: 16, padding: "13px 14px 12px 17px", cursor: onTap ? "pointer" : "default", opacity: op ?? 1, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail ?? F.goldLight }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {/* The number stays whole; a long status pill gives way instead. */}
        <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: F.ink, whiteSpace: "nowrap", ...NUM }}>{code}</span>
        {st ? (
          <span title={st} style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 999, background: stBg ?? F.track, color: fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flex: "0 1 auto", minWidth: 0, overflow: "hidden" }}>
            <span style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: fg }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{st}</span>
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {date ? <span style={{ flex: "none", fontSize: 11.5, color: F.muted, whiteSpace: "nowrap" }}>{date}</span> : null}
        {onTap ? <ChevronRight size={18} strokeWidth={1.9} color={F.goldMid} style={{ flex: "none" }} /> : null}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: F.ink, marginTop: 6, lineHeight: 1.35, wordBreak: "break-word" }}>{party}</div>
      {refs && refs.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
          {refs.map((rf, i) => (
            <span key={i} style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7, background: F.cream, fontSize: 11, color: F.body, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", ...NUM }}>
              <span style={{ color: "#6B6252" }}>{rf.k}</span><span style={{ fontWeight: 700, color: F.ink, overflow: "hidden", textOverflow: "ellipsis" }}>{rf.v}</span>
            </span>
          ))}
        </div>
      ) : null}
      {stack ? <FinStack parts={stack} h={6} mt={10} /> : null}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, amts.length)},minmax(0,1fr))`, gap: 6, marginTop: 10 }}>
        {amts.map((a) => (
          <div key={a.k} style={{ minWidth: 0, padding: "7px 10px", borderRadius: 10, background: a.gold ? "#F7F1E3" : F.paper }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".5px", color: a.kc ?? F.goldMid, textTransform: "uppercase", whiteSpace: "nowrap" }}>{a.k}</div>
            <div style={{ fontSize: a.fs ?? 14, fontWeight: 700, color: a.c ?? F.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...NUM }}>{a.v}</div>
          </div>
        ))}
      </div>
      {lines ? (
        <div style={{ marginTop: 10, borderRadius: 12, background: F.paper, overflow: "hidden" }}>
          {lines.map((r, i) => (
            <button key={r.key ?? i} type="button" disabled={!r.onTap}
              onClick={(e: ReactMouseEvent) => { e.stopPropagation(); r.onTap?.(); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: 42, padding: "6px 10px", border: "none", borderTop: i ? `1px solid ${F.hair}` : "none", background: "none", boxShadow: `inset 3px 0 0 ${r.rail ?? "transparent"}`, fontFamily: "inherit", textAlign: "left", cursor: r.onTap ? "pointer" : "default", color: "inherit" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: F.ink }}>{r.l}</span>
                {r.s ? <span style={{ display: "block", fontSize: 11, color: F.muted, marginTop: 1 }}>{r.s}</span> : null}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: r.vc ?? F.ink, whiteSpace: "nowrap", ...NUM }}>{r.v}</span>
              {r.go ? <ChevronRight size={14} strokeWidth={2} color={F.chev} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {toggle ? (
        <button type="button" aria-expanded={toggle.open} onClick={(e) => { e.stopPropagation(); toggle.onTap(); }}
          style={{ marginTop: 8, height: 34, padding: "0 2px", border: "none", background: "none", color: F.gold, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          {toggle.l}<span style={{ display: "flex", transform: toggle.open ? "rotate(180deg)" : "none" }}><ChevronDown size={14} strokeWidth={2.2} /></span>
        </button>
      ) : null}
      {note ? <div style={{ marginTop: 6, fontSize: 11, color: F.amber }}>{note}</div> : null}
    </div>
  );
}

// ---- states ------------------------------------------------------------------------
/** The centred state card (no access, error, nothing to show). */
export function FinState({ icon: Icon, bg, c, t, s, btn }: { icon: LucideIcon; bg: string; c: string; t: string; s?: ReactNode; btn?: { l: string; onTap: () => void } }) {
  return (
    <div role={c === F.neg ? "alert" : undefined}
      style={{ padding: "32px 20px", borderRadius: 20, background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(31,29,27,.06),0 2px 4px rgba(31,29,27,.06),0 12px 24px -12px rgba(31,29,27,.30)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span style={{ width: 50, height: 50, borderRadius: 16, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={22} strokeWidth={1.8} color={c} /></span>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t}</div>
      {s ? <div style={{ fontSize: 13, color: F.body, lineHeight: 1.45, maxWidth: 290 }}>{s}</div> : null}
      {btn ? (
        <button type="button" onClick={btn.onTap}
          style={{ marginTop: 4, height: 44, padding: "0 20px", borderRadius: 999, border: "none", background: F.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{btn.l}</button>
      ) : null}
    </div>
  );
}

/** Loading placeholders (the prototype's pulsing cards). */
export function FinSkel({ n = 3, h = 108 }: { n?: number; h?: number }) {
  return (
    <>
      <style>{"@keyframes fin-pulse{0%,100%{opacity:.55}50%{opacity:1}}@media (prefers-reduced-motion:reduce){[data-fin-skel]{animation:none!important}}"}</style>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} data-fin-skel="" aria-hidden="true" style={{ height: h, borderRadius: 20, background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(31,29,27,.05)", animation: "fin-pulse 1.2s ease-in-out infinite" }} />
      ))}
      <span role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Loading…</span>
    </>
  );
}

// ---- dock ------------------------------------------------------------------------------
/** The voucher action bar: "…" more button + the gold primary, a solid bar sitting on the tab bar. */
export function FinDock({ primary, more }: { primary?: { l: string; icon?: LucideIcon; onTap: () => void; busy?: boolean } | null; more?: (() => void) | null }) {
  if (!primary && !more) return null;
  const PIcon = primary?.icon;
  return (
    <ResponsiveActionDock scope="auto" phoneBottom={56} zIndex={31}>
      {/* A solid bar attached to the tab bar (owner 2026-11-26: nothing floating over the content). */}
      <div style={{ pointerEvents: "auto", width: "100%", boxSizing: "border-box", display: "flex", gap: 8, padding: "10px 16px", background: F.paper, boxShadow: `0 -1px 0 ${F.line}` }}>
        {more ? (
          <button type="button" onClick={more} aria-label="More voucher actions"
            style={{ width: 50, height: 50, flex: "none", borderRadius: 14, border: "none", background: "#FFFFFF", color: F.gold, boxShadow: "0 0 0 1px rgba(201,169,97,.4),0 8px 18px -10px rgba(31,29,27,.3)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
          </button>
        ) : null}
        {primary ? (
          <button type="button" onClick={primary.onTap} disabled={primary.busy}
            style={{ flex: 1, height: 50, borderRadius: 14, border: "none", background: F.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: primary.busy ? "default" : "pointer", opacity: primary.busy ? 0.7 : 1, boxShadow: "0 10px 20px -10px rgba(107,92,50,.7)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {PIcon ? <PIcon size={17} strokeWidth={2.2} /> : null}{primary.busy ? "Working…" : primary.l}
          </button>
        ) : null}
      </div>
    </ResponsiveActionDock>
  );
}

// ---- bottom sheet ------------------------------------------------------------------------
export type SheetRow = { key?: string; l: ReactNode; s?: ReactNode; v?: string; vc?: string; icon?: LucideIcon; icBg?: string; icC?: string; lc?: string; w?: number; onTap?: () => void };

/** The prototype's sheet: handle, title + sub, close; then an optional text
 *  box, a list of rows and an amber note (or any children). */
export function FinSheet({ open, onClose, title, sub, text, rows, note, children }: {
  open: boolean; onClose: () => void; title: string; sub?: ReactNode; text?: ReactNode; rows?: SheetRow[] | null; note?: ReactNode; children?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bare portal panelStyle={{ background: F.paper, maxHeight: "86dvh", display: "flex", flexDirection: "column", overflowY: "hidden", animation: "fin-sheet .22s ease-out" }}>
      <style>{"@keyframes fin-sheet{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}"}</style>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><div style={{ width: 40, height: 4, borderRadius: 999, background: "#E2DDD8" }} /></div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: F.ink }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: F.body, marginTop: 2 }}>{sub}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          style={{ width: 40, height: 40, margin: "-6px -8px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: F.faint }}>
          <X size={20} strokeWidth={1.9} />
        </button>
      </div>
      <div className="so-scroll" style={{ overflowY: "auto", padding: "4px 16px 30px", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: 10 }}>
        {text ? <div style={{ padding: "12px 14px", borderRadius: 14, background: "#FFFFFF", boxShadow: `inset 0 0 0 1px ${F.line}`, fontSize: 13, lineHeight: 1.55, color: F.ink, whiteSpace: "pre-line" }}>{text}</div> : null}
        {rows && rows.length ? (
          <div style={{ borderRadius: 14, background: "#FFFFFF", boxShadow: `inset 0 0 0 1px ${F.line},0 10px 22px -14px rgba(31,29,27,.24)`, overflow: "hidden" }}>
            {rows.map((r, i) => {
              const Icon = r.icon;
              return (
                <button key={r.key ?? i} type="button" onClick={r.onTap} disabled={!r.onTap}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "8px 12px", border: "none", borderTop: i ? `1px solid ${F.hair}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: r.onTap ? "pointer" : "default", color: "inherit" }}>
                  {Icon ? <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: r.icBg ?? F.cream, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={15} strokeWidth={2} color={r.icC ?? F.gold} /></span> : null}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: r.w ?? 600, color: r.lc ?? F.ink }}>{r.l}</span>
                    {r.s ? <span style={{ display: "block", fontSize: 11.5, color: F.muted, marginTop: 1, lineHeight: 1.35 }}>{r.s}</span> : null}
                  </span>
                  {r.v ? <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: r.vc ?? F.ink, whiteSpace: "nowrap", ...NUM }}>{r.v}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {children}
        {note ? <FinNote mt={0}>{note}</FinNote> : null}
      </div>
    </Sheet>
  );
}
