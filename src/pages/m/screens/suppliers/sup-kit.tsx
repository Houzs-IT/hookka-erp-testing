// ---------------------------------------------------------------------------
// Suppliers kit (Batch 4, Claude Design "Suppliers (standalone)", approved).
// The prototype's blocks drawn to its own sizes, radii, shadows and --xo-*
// colours (light + dark): screen frame and header, KPI tiles, search + sort,
// chip rail, supplier card, state / skeleton cards, detail header, tab bar,
// scorecard, info section, document card, segmented control, selects, bottom
// sheet, discard dialog and the full-page form. The kit draws; it never
// computes a figure.
// ---------------------------------------------------------------------------
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownUp, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Ellipsis, Info, Menu, Phone, Plus, Search, Star, Trash2, UserRound, X,
  type LucideIcon,
} from "lucide-react";
import { useNavDrawer } from "../../lib/nav-drawer";
import "../xops/xops-theme.css";
import "./suppliers.css";
import { C, chipS, segS } from "./sup-style";

const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };
const SH_CTRL = `0 0 0 1px ${C.ring},0 8px 22px -12px ${C.shd}`;
const SH_SEC = `0 0 0 1px ${C.ring},0 2px 4px ${C.ring},0 14px 30px -14px ${C.shd}`;
const portal = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));


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

// ---- frame ----------------------------------------------------------------------
/** The screen frame: --xo-bg page, ink text; scrolls the shell's scroller back to the top on open. */
export function SupFrame({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    for (let el = ref.current?.parentElement ?? null; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
  }, []);
  return (
    <section ref={ref} aria-label={label} className="sup-root" style={{ minHeight: "100%", background: C.bg, color: C.ink, fontFamily: "inherit", overflowX: "hidden", WebkitFontSmoothing: "antialiased" }}>
      {children}
    </section>
  );
}

/** The 56px header: menu (phone top level) or back chevron, the title, right-hand actions. */
export function TopBar({ title, menu, onBack, backLabel = "Back", right, numeric }: {
  title: string; menu?: boolean; onBack?: (() => void) | null; backLabel?: string; right?: ReactNode; numeric?: boolean;
}) {
  const drawer = useNavDrawer();
  const showMenu = !!menu && drawer !== null;
  const btn: CSSProperties = { width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer", color: C.ink };
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 6, height: 56, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
      {showMenu ? (
        <button type="button" onClick={drawer!.open} aria-label="Open menu" style={btn}><Menu size={22} strokeWidth={1.9} /></button>
      ) : onBack ? (
        <button type="button" onClick={onBack} aria-label={backLabel} style={btn}><ChevronLeft size={22} strokeWidth={2} /></button>
      ) : <span style={{ width: 4 }} />}
      <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.2px", lineHeight: "24px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...(numeric ? NUM : null) }}>{title}</div>
      {right}
    </header>
  );
}

export function PlusButton({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} aria-label={label}
      style={{ width: 42, height: 42, borderRadius: "50%", background: C.grad, border: "none", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: "#FFFFFF", boxShadow: "0 8px 18px -8px rgba(107,92,50,.65)" }}>
      <Plus size={20} strokeWidth={2.2} />
    </button>
  );
}
export function MoreButton({ onTap }: { onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} aria-label="More actions"
      style={{ width: 42, height: 42, borderRadius: "50%", background: C.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: C.br, boxShadow: `0 0 0 1px ${C.ring},0 6px 16px -8px ${C.shd}` }}>
      <Ellipsis size={19} strokeWidth={2} />
    </button>
  );
}

// ---- list blocks -----------------------------------------------------------------------
export type Kpi = { l: string; v: string; icon: LucideIcon; c: string; t: string };
export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, padding: "4px 16px 0" }}>
      {items.map((k) => (
        <div key={k.l} style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: C.card, boxShadow: `0 0 0 1px ${C.ring},0 6px 14px -10px ${C.shd}` }}>
          <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: k.t, display: "flex", alignItems: "center", justifyContent: "center" }}><k.icon size={15} strokeWidth={2} color={k.c} aria-hidden /></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 17, fontWeight: 800, lineHeight: 1.1, ...NUM }}>{k.v}</span>
            <span style={{ display: "block", fontSize: 11.5, color: C.mut, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.l}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function SearchSort({ q, onQ, placeholder, ariaLabel, onSort, count }: { q: string; onQ: (v: string) => void; placeholder: string; ariaLabel: string; onSort: () => void; count: number }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
      <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: C.card, borderRadius: 14, boxShadow: SH_CTRL }}>
        <Search size={18} strokeWidth={1.75} color={C.faint} aria-hidden style={{ flex: "none" }} />
        <input type="text" inputMode="search" enterKeyHint="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} aria-label={ariaLabel}
          style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: C.ink, padding: 0 }} />
        {q ? (
          <button type="button" onClick={() => onQ("")} aria-label="Clear search" style={{ width: 36, height: 36, flex: "none", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.mut }}>
            <X size={15} strokeWidth={2.2} />
          </button>
        ) : null}
      </label>
      <button type="button" onClick={onSort} aria-label={count ? `Sort and filter, ${count} on` : "Sort and filter"}
        style={{ position: "relative", width: 44, height: 44, flex: "none", borderRadius: "50%", border: "none", background: C.card, color: C.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: SH_CTRL }}>
        <ArrowDownUp size={17} strokeWidth={1.9} />
        {count ? <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: "#6B5C32", color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{count}</span> : null}
      </button>
    </div>
  );
}

export type ChipItem = { k: string; l: string; n: number | string; dot?: string | null; on: boolean; onTap: () => void };
export function ChipRail({ items, label }: { items: ChipItem[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="sup-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 4px", scrollbarWidth: "none" }}>
      {items.map((c) => {
        const st = chipS(c.on);
        return (
          <button key={c.k} type="button" aria-pressed={c.on} onClick={c.onTap}
            style={{ flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", ...st, fontFamily: "inherit", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer" }}>
            {c.dot ? <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot }} /> : null}
            {c.l}<span style={{ opacity: 0.8, ...NUM }}>{c.n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "8 SUPPLIERS ———" (list) / "LAST 10 PURCHASE ORDERS ——— 4 of 18" (detail). */
export function SectionLabel({ t, r, pad = "12px 20px 6px" }: { t: string; r?: string; pad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: pad }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.br, whiteSpace: "nowrap" }}>{t}</span>
      <span style={{ flex: 1, height: 1, background: C.ln }} />
      {r ? <span style={{ fontSize: 11.5, color: C.mut, whiteSpace: "nowrap" }}>{r}</span> : null}
    </div>
  );
}

export type SupCardV = { code: string; name: string; contact: string; phone: string; terms: string; org: string; rating: number; st: { l: string; c: string; b: string }; dim: boolean; selected: boolean; onTap: () => void };
export function SupplierCard({ p }: { p: SupCardV }) {
  return (
    <div role="button" tabIndex={0} onClick={p.onTap} aria-current={p.selected ? "true" : undefined}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onTap(); } }}
      aria-label={`${p.code} ${p.name}, ${p.st.l}`}
      style={{ position: "relative", overflow: "hidden", background: C.card, borderRadius: 16, padding: "12px 14px 12px 17px", cursor: "pointer", opacity: p.dim ? 0.78 : 1, WebkitTapHighlightColor: "transparent",
        boxShadow: p.selected ? `0 0 0 2px #6B5C32,0 12px 28px -16px ${C.shd}` : `0 0 0 1px ${C.ring},0 12px 28px -16px ${C.shd}` }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: p.st.c }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.br, whiteSpace: "nowrap", ...NUM }}>{p.code}</span>
        <Pill st={p.st} />
        <span style={{ flex: 1 }} />
        <span aria-label={`Rating ${p.rating} of 5`} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, ...NUM }}>
          <Star size={13} strokeWidth={2} color={C.star} fill={C.star} aria-hidden />{p.rating.toFixed(1)}
        </span>
        <ChevronRight size={18} strokeWidth={1.9} color={C.gold} aria-hidden style={{ flex: "none" }} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 5, lineHeight: 1.3, overflowWrap: "anywhere" }}>{p.name}</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", marginTop: 5, fontSize: 12.5, color: C.sub }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflowWrap: "anywhere" }}><UserRound size={13} strokeWidth={2} color={C.gold} aria-hidden style={{ flex: "none" }} />{p.contact}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", ...NUM }}><Phone size={13} strokeWidth={2} color={C.gold} aria-hidden />{p.phone}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.ln}` }}>
        <MetaTag k="Terms" v={p.terms} />
        <MetaTag k="Purchase Co." v={p.org} />
      </div>
    </div>
  );
}
function MetaTag({ k, v }: { k: string; v: string }) {
  return (
    <span style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7, background: C.tint, fontSize: 11, whiteSpace: "nowrap" }}>
      <span style={{ color: C.mut }}>{k}</span><b style={{ fontWeight: 700 }}>{v}</b>
    </span>
  );
}
export function Pill({ st, size = "sm" }: { st: { l: string; c: string; b: string }; size?: "sm" | "lg" | "xs" }) {
  const lg = size === "lg", xs = size === "xs";
  return (
    <span style={{ height: lg ? 26 : xs ? 21 : 22, display: "inline-flex", alignItems: "center", gap: lg ? 6 : xs ? 4 : 5, padding: lg ? "0 11px" : xs ? "0 8px" : "0 9px", borderRadius: 999, background: st.b, color: st.c, fontSize: lg ? 12.5 : xs ? 10.5 : 11, fontWeight: 700, whiteSpace: "nowrap", flex: "none" }}>
      <span aria-hidden style={{ width: lg ? 7 : xs ? 5 : 6, height: lg ? 7 : xs ? 5 : 6, borderRadius: "50%", background: st.c }} />{st.l}
    </span>
  );
}

export function ShowMore({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <div style={{ padding: "10px 16px 0" }}>
      <button type="button" onClick={onTap}
        style={{ width: "100%", height: 44, borderRadius: 999, border: "none", background: C.card, boxShadow: `0 0 0 1px ${C.ring},0 6px 14px -8px ${C.shd}`, color: C.br, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        {label}
      </button>
    </div>
  );
}

export function Skeleton({ n = 4, h = 108, pad = "12px 16px" }: { n?: number; h?: number; pad?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 8, padding: pad }}>
      {Array.from({ length: n }, (_, i) => <div key={i} style={{ height: h, borderRadius: 16, background: C.card, animation: "sup-pulse 1.2s ease-in-out infinite" }} />)}
    </div>
  );
}

export type StateV = { icon: LucideIcon; t: string; s: string; c: string; bg: string; btn?: string; onTap?: () => void; alert?: boolean };
/** The list's big state card (error / empty / no match). */
export function StateCard({ v }: { v: StateV }) {
  return (
    <div role={v.alert ? "alert" : "note"} style={{ margin: 16, padding: "30px 20px", borderRadius: 20, background: C.card, boxShadow: `0 0 0 1px ${C.ring},0 12px 24px -12px ${C.shd}`, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span style={{ width: 50, height: 50, borderRadius: 16, background: v.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><v.icon size={22} strokeWidth={1.8} color={v.c} aria-hidden /></span>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{v.t}</div>
      <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.45 }}>{v.s}</div>
      {v.btn && v.onTap ? (
        <button type="button" onClick={v.onTap} style={{ marginTop: 4, height: 44, padding: "0 20px", borderRadius: 999, border: "none", background: C.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{v.btn}</button>
      ) : null}
    </div>
  );
}
/** The detail tabs' smaller state block (empty / restricted / no match / error). */
export function StateBlock({ v }: { v: StateV }) {
  return (
    <div role={v.alert ? "alert" : undefined} style={{ padding: "24px 18px", borderRadius: 16, background: C.card, boxShadow: `0 0 0 1px ${C.ring}`, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <span style={{ width: 44, height: 44, borderRadius: 14, background: v.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><v.icon size={20} strokeWidth={1.9} color={v.c} aria-hidden /></span>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{v.t}</div>
      <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.45 }}>{v.s}</div>
      {v.btn && v.onTap ? (
        <button type="button" onClick={v.onTap} style={{ marginTop: 2, height: 40, padding: "0 18px", borderRadius: 999, border: "none", background: C.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{v.btn}</button>
      ) : null}
    </div>
  );
}

// ---- detail blocks -------------------------------------------------------------------
export function DetailBody({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "2px 16px 32px", display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gridAutoRows: "max-content", gap: 12, maxWidth: 760, margin: "0 auto", boxSizing: "border-box" }}>
      {children}
    </div>
  );
}

export function Card({ children, label, pad = 14 }: { children: ReactNode; label?: string; pad?: number }) {
  return <section aria-label={label} style={{ borderRadius: 20, padding: pad, background: C.card, boxShadow: SH_SEC, minWidth: 0 }}>{children}</section>;
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span role="img" aria-label={`Rating ${rating} of 5`} style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={14} strokeWidth={2} color={C.star} fill={i <= Math.round(rating) ? C.star : "none"} aria-hidden />)}
    </span>
  );
}

export type TabItem<K extends string> = { k: K; l: string };
export function Tabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(${items.length},minmax(0,1fr))`, gap: 4, height: 44, boxSizing: "border-box", padding: 4, borderRadius: 12, background: C.chip }}>
      {items.map((t) => (
        <button key={t.k} type="button" role="tab" aria-selected={value === t.k} onClick={() => onChange(t.k)}
          style={{ minWidth: 0, height: "100%", borderRadius: 9, border: "none", ...segS(value === t.k), fontFamily: "inherit", fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer" }}>{t.l}</button>
      ))}
    </div>
  );
}
export function Seg<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(${items.length},minmax(0,1fr))`, gap: 4, height: 42, boxSizing: "border-box", padding: 4, borderRadius: 12, background: C.chip }}>
      {items.map((o) => (
        <button key={o.k} type="button" aria-pressed={value === o.k} onClick={() => onChange(o.k)}
          style={{ height: "100%", borderRadius: 9, border: "none", ...segS(value === o.k), fontFamily: "inherit", fontSize: 12.5, cursor: "pointer" }}>{o.l}</button>
      ))}
    </div>
  );
}

export type ScoreCardV = { l: string; v: string; u: string; c: string; icon: LucideIcon; icC: string };
export function ScoreCards({ cards }: { cards: ScoreCardV[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
      {cards.map((k) => (
        <div key={k.l} style={{ position: "relative", overflow: "hidden", minWidth: 0, padding: "11px 10px 10px", borderRadius: 16, background: C.card, boxShadow: `0 0 0 1px ${C.ring},0 10px 22px -14px ${C.shd}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4, height: 26 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: C.mut, textTransform: "uppercase", lineHeight: 1.25 }}>{k.l}</span>
            <k.icon size={14} strokeWidth={2.2} color={k.icC} aria-hidden style={{ flex: "none" }} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginTop: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.5px", lineHeight: 1, color: k.c, ...NUM }}>{k.v}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: k.c }}>{k.u}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export type InfoRow = { k: string; v: string; icon: LucideIcon; href?: string; act?: LucideIcon; aria?: string };
/** The Info tab's section card: icon + title, hairline, icon rows with an optional round action. */
export function InfoSection({ title, icon: Icon, rows }: { title: string; icon: LucideIcon; rows: InfoRow[] }) {
  return (
    <Card label={title}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={16} strokeWidth={1.9} color={C.br} aria-hidden />
        <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-.2px" }}>{title}</div>
      </div>
      <div style={{ height: 1, background: C.ln, margin: "12px 0 4px" }} />
      {rows.map((r, i) => {
        const has = !!r.v;
        const Act = r.act;
        return (
          <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? `1px solid ${C.ln}` : "none" }}>
            <span style={{ width: 28, height: 28, flex: "none", borderRadius: 8, background: C.tint, display: "flex", alignItems: "center", justifyContent: "center" }}><r.icon size={14} strokeWidth={2} color={C.br} aria-hidden /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11, color: C.mut }}>{r.k}</span>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere", color: has ? C.ink : C.mut, marginTop: 1 }}>{has ? r.v : "—"}</span>
            </span>
            {has && r.href && Act ? (
              <a href={r.href} aria-label={r.aria} style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", background: C.prit, color: C.br, display: "flex", alignItems: "center", justifyContent: "center" }}><Act size={15} strokeWidth={2.2} /></a>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}

export function SmallSearch({ v, on, ph }: { v: string; on: (v: string) => void; ph: string }) {
  return (
    <label style={{ height: 42, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: C.card, borderRadius: 12, boxShadow: `0 0 0 1px ${C.ln}` }}>
      <Search size={16} strokeWidth={1.9} color={C.faint} aria-hidden style={{ flex: "none" }} />
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={ph} aria-label={ph}
        style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: C.ink, padding: 0 }} />
    </label>
  );
}

export type SelV = { v: string; on: (v: string) => void; aria: string; opts: { v: string; l: string }[] };
export function SelectRow({ sels }: { sels: SelV[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
      {sels.map((x) => (
        <span key={x.aria} style={{ position: "relative", display: "block", minWidth: 0 }}>
          <select value={x.v} onChange={(e) => x.on(e.target.value)} aria-label={x.aria}
            style={{ width: "100%", height: 42, boxSizing: "border-box", padding: "0 30px 0 11px", borderRadius: 12, border: "none", background: C.card, boxShadow: `0 0 0 1px ${C.ln}`, fontFamily: "inherit", fontSize: 14, color: C.ink, appearance: "none", WebkitAppearance: "none", textOverflow: "ellipsis" }}>
            {x.opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <span style={{ position: "absolute", right: 10, top: 12, pointerEvents: "none", color: C.gold }}><ChevronDown size={16} strokeWidth={2} /></span>
        </span>
      ))}
    </div>
  );
}

export type DocTag = { k: string; v: string; bg: string; c: string };
export type DocAmt = { k: string; v: string; bg: string; c: string };
export type DocV = {
  code: string; st?: { l: string; c: string; b: string } | null; date?: string; title: string; sub?: string; tags?: DocTag[] | null;
  amts: DocAmt[]; rail: string; onTap?: () => void; aria?: string;
};
/** The detail's document card: rail, code + pill + date (+ chevron), title, sub, tags, amount tiles. */
export function DocCard({ d }: { d: DocV }) {
  const tap = d.onTap;
  return (
    <div role={tap ? "button" : "group"} tabIndex={tap ? 0 : undefined} onClick={tap} aria-label={d.aria}
      onKeyDown={tap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(); } } : undefined}
      style={{ position: "relative", overflow: "hidden", background: C.card, borderRadius: 16, padding: "12px 14px 11px 17px", cursor: tap ? "pointer" : "default", boxShadow: `0 0 0 1px ${C.ring},0 12px 28px -16px ${C.shd}`, minWidth: 0 }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: d.rail }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, ...NUM }}>{d.code}</span>
        {d.st ? <Pill st={d.st} size="xs" /> : null}
        <span style={{ flex: 1 }} />
        {d.date ? <span style={{ fontSize: 11.5, color: C.mut, whiteSpace: "nowrap" }}>{d.date}</span> : null}
        {tap ? <ChevronRight size={17} strokeWidth={1.9} color={C.gold} aria-hidden style={{ flex: "none" }} /> : null}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 5, lineHeight: 1.35, overflowWrap: "anywhere" }}>{d.title}</div>
      {d.sub ? <div style={{ fontSize: 12, color: C.sub, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{d.sub}</div> : null}
      {d.tags && d.tags.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
          {d.tags.map((g, i) => (
            <span key={i} style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7, background: g.bg, fontSize: 11, whiteSpace: "nowrap", color: g.c, ...NUM }}>
              {g.k ? <span style={{ opacity: 0.75 }}>{g.k}</span> : null}<b style={{ fontWeight: 700 }}>{g.v}</b>
            </span>
          ))}
        </div>
      ) : null}
      {d.amts.length ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.amts.length},minmax(0,1fr))`, gap: 6, marginTop: 9 }}>
          {d.amts.map((a) => (
            <div key={a.k} style={{ minWidth: 0, padding: "6px 9px", borderRadius: 10, background: a.bg }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: C.gold, textTransform: "uppercase", whiteSpace: "nowrap" }}>{a.k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: a.c, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...NUM }} title={a.v}>{a.v}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Note({ t }: { t: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "0 4px", fontSize: 11.5, lineHeight: 1.45, color: C.note }}>
      <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} aria-hidden /></span><span>{t}</span>
    </div>
  );
}

// ---- overlays --------------------------------------------------------------------------
/** The prototype's bottom sheet: scrim, 560px panel, handle, title row with ✕. */
export function BottomSheet({ open, onClose, title, sub, children, label }: { open: boolean; onClose: () => void; title: string; sub?: string; label: string; children: ReactNode }) {
  useEscape(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return null;
  return portal(
    <div className="sup-root" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: C.scrim, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
      <div ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={label}
        style={{ width: "100%", maxWidth: 560, background: C.bg, color: C.ink, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "86%", display: "flex", flexDirection: "column", animation: "sup-sheet .22s ease-out", outline: "none", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><div style={{ width: 40, height: 4, borderRadius: 999, background: C.ln }} /></div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{title}</div>
            {sub ? <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>{sub}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 40, height: 40, margin: sub ? "-6px -8px 0 0" : "-8px -8px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.mut, flex: "none" }}>
            <X size={20} strokeWidth={1.9} />
          </button>
        </div>
        <div className="sup-scroll" style={{ overflowY: "auto", padding: "4px 16px 26px", scrollbarWidth: "none" }}>{children}</div>
      </div>
    </div>,
  );
}

export type OptRow = { k: string; l: string; on: boolean; onTap: () => void };
export function OptGroup({ t, rows, first }: { t: string; rows: OptRow[]; first?: boolean }) {
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.br, margin: `${first ? 0 : 18}px 2px 8px` }}>{t}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {rows.map((r) => {
          const st = chipS(r.on);
          return (
            <button key={r.k} type="button" onClick={r.onTap} aria-pressed={r.on}
              style={{ height: 36, padding: "0 14px", borderRadius: 999, border: "none", ...st, fontFamily: "inherit", fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              {r.on ? <Check size={13} strokeWidth={2.8} aria-hidden /> : null}{r.l}
            </button>
          );
        })}
      </div>
    </>
  );
}
export function SheetButtons({ onReset, onApply, applyL = "Show results" }: { onReset: () => void; onApply: () => void; applyL?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 8, marginTop: 20 }}>
      <button type="button" onClick={onReset} style={{ height: 48, borderRadius: 14, border: "none", background: C.card, color: C.sub, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: `0 0 0 1px ${C.ln}` }}>Reset</button>
      <button type="button" onClick={onApply} style={{ height: 48, borderRadius: 14, border: "none", background: C.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{applyL}</button>
    </div>
  );
}
export type MenuItemV = { k: string; l: string; icon: LucideIcon; onTap: () => void };
export function MenuList({ items }: { items: MenuItemV[] }) {
  return (
    <div style={{ borderRadius: 14, background: C.card, boxShadow: `0 0 0 1px ${C.ln}`, overflow: "hidden" }}>
      {items.map((m, i) => (
        <button key={m.k} type="button" onClick={m.onTap}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "6px 12px", border: "none", borderTop: i ? `1px solid ${C.ln}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: C.ink }}>
          <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: C.tint, display: "flex", alignItems: "center", justifyContent: "center" }}><m.icon size={15} strokeWidth={2} color={C.br} aria-hidden /></span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{m.l}</span>
          <ChevronRight size={16} strokeWidth={2} color="#B5AC9C" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** "Discard changes?" — Keep editing / Discard. */
export function DiscardDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  useEscape(open, onKeep);
  if (!open) return null;
  return portal(
    <div className="sup-root" style={{ position: "fixed", inset: 0, zIndex: 95, background: C.scrim, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div role="alertdialog" aria-modal="true" aria-label="Discard changes?"
        style={{ width: "100%", maxWidth: 340, borderRadius: 20, background: C.bg, color: C.ink, padding: "20px 18px 16px", boxShadow: "0 30px 60px -20px rgba(0,0,0,.5)", animation: "sup-pop .18s ease-out", boxSizing: "border-box" }}>
        <span style={{ width: 44, height: 44, borderRadius: 14, background: C.badb, display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={20} strokeWidth={2} color={C.bad} aria-hidden /></span>
        <div style={{ marginTop: 12, fontSize: 17, fontWeight: 700 }}>Discard changes?</div>
        <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5, color: C.sub }}>What you&apos;ve changed won&apos;t be saved.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onKeep} autoFocus style={{ height: 46, borderRadius: 12, border: "none", background: C.card, color: C.sub, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: `0 0 0 1px ${C.ln}` }}>Keep editing</button>
          <button type="button" onClick={onDiscard} style={{ height: 46, borderRadius: 12, border: "none", background: C.bad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Discard</button>
        </div>
      </div>
    </div>,
  );
}

/** The full-page form: Cancel · title · "Unsaved"; scrolling 640px column; solid save bar. */
export function FormPage({ open, title, dirty, onCancel, err, errTone, children, saveL, onSave, busy, attempt = 0 }: {
  /** Bumped on each refused / failed save, to bring the error strip into view. */
  attempt?: number;
  open: boolean; title: string; dirty: boolean; onCancel: () => void; err?: string; errTone?: "warn" | "bad"; children: ReactNode; saveL: string; onSave: () => void; busy: boolean;
}) {
  useEscape(open, onCancel);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  // A new error strip sits at the top of the column: bring it into view.
  useEffect(() => { if (attempt) bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [attempt]);
  if (!open) return null;
  return portal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="sup-root"
      style={{ position: "fixed", inset: 0, zIndex: 85, display: "flex", flexDirection: "column", background: C.bg, color: C.ink, animation: "sup-sheet .22s ease-out", outline: "none", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 16px", borderBottom: `1px solid ${C.ln}` }}>
        <button type="button" onClick={onCancel} style={{ width: 56, height: 44, marginLeft: -6, padding: "0 6px", background: "none", border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: C.mut, cursor: "pointer", textAlign: "left" }}>Cancel</button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <span style={{ width: 56, textAlign: "right", fontSize: 11, fontWeight: 700, color: C.warn }}>{dirty ? "Unsaved" : ""}</span>
      </div>
      <div ref={bodyRef} className="sup-scroll" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "14px 16px 20px", width: "100%", maxWidth: 640, margin: "0 auto", boxSizing: "border-box", display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gridAutoRows: "max-content", gap: 14 }}>
        {err ? (
          <div role="alert" style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 12, background: errTone === "bad" ? C.badb : C.warnb, color: errTone === "bad" ? C.bad : C.warn, fontSize: 12.5, lineHeight: 1.45 }}>
            <CircleAlert size={16} strokeWidth={2} style={{ flex: "none" }} aria-hidden /><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{err}</span>
          </div>
        ) : null}
        {children}
      </div>
      <div style={{ flex: "none", padding: "10px 16px calc(24px + env(safe-area-inset-bottom))", background: C.bg, boxShadow: `0 -1px 0 ${C.ln}` }}>
        <button type="button" onClick={onSave} disabled={busy} aria-busy={busy}
          style={{ display: "flex", width: "100%", maxWidth: 640, margin: "0 auto", height: 50, borderRadius: 14, border: "none", background: C.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          {busy ? <span aria-hidden style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#FFFFFF", animation: "sup-spin .8s linear infinite", boxSizing: "border-box" }} /> : null}
          {saveL}
        </button>
      </div>
    </div>,
  );
}

export function FormHead({ t }: { t: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.br }}>{t}</span>
      <span style={{ flex: 1, height: 1, background: C.ln }} />
    </div>
  );
}
const labelS: CSSProperties = { display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700 };
export function FormInput({ l, v, on, ph, mode, err, help, auto }: {
  l: string; v: string; on: (v: string) => void; ph?: string; mode?: "text" | "tel" | "email"; err?: string; help?: string; auto?: string;
}) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <span style={labelS}>{l}</span>
      <input type="text" inputMode={mode} autoComplete={auto ?? "off"} value={v} onChange={(e) => on(e.target.value)} placeholder={ph} aria-invalid={err ? true : undefined}
        style={{ width: "100%", boxSizing: "border-box", height: 46, padding: "0 13px", borderRadius: 12, border: "none", background: C.inp, boxShadow: err ? `0 0 0 1.5px ${C.bad}` : `0 0 0 1px ${C.ln}`, fontFamily: "inherit", fontSize: 16, color: C.ink, outline: "none" }} />
      {err ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: C.bad, lineHeight: 1.4 }}>{err}</span> : null}
      {help ? <span style={{ display: "flex", gap: 5, marginTop: 5, fontSize: 11.5, color: C.note, lineHeight: 1.4 }}><Info size={13} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} aria-hidden />{help}</span> : null}
    </label>
  );
}
export function FormArea({ l, v, on, ph }: { l: string; v: string; on: (v: string) => void; ph?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelS}>{l}</span>
      <textarea value={v} onChange={(e) => on(e.target.value)} rows={3} placeholder={ph}
        style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 12, border: "none", background: C.inp, boxShadow: `0 0 0 1px ${C.ln}`, fontFamily: "inherit", fontSize: 16, lineHeight: 1.45, color: C.ink, outline: "none", resize: "vertical" }} />
    </label>
  );
}
export function FormSelect({ l, v, on, opts, help }: { l: string; v: string; on: (v: string) => void; opts: { v: string; l: string }[]; help?: string }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <span style={labelS}>{l}</span>
      <span style={{ position: "relative", display: "block" }}>
        <select value={v} onChange={(e) => on(e.target.value)}
          style={{ width: "100%", height: 46, boxSizing: "border-box", padding: "0 40px 0 13px", borderRadius: 12, border: "none", background: C.inp, boxShadow: `0 0 0 1px ${C.ln}`, fontFamily: "inherit", fontSize: 15, color: C.ink, appearance: "none", WebkitAppearance: "none", textOverflow: "ellipsis" }}>
          {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <span style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none", color: C.gold }}><ChevronDown size={18} strokeWidth={2} /></span>
      </span>
      {help ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: C.mut, lineHeight: 1.4 }}>{help}</span> : null}
    </label>
  );
}
