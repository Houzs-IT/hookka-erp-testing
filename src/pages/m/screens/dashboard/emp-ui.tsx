// Shared pieces of the /m Home Employees view, built to the approved Home Employees 2 HTML
// (list row, section card + header, pills, segments, legend chips). Neutral text and surfaces use the M.* tokens (they
// equal the HTML's hexes in light mode and follow the dark theme); status and series colours are the HTML's own.
import type { ReactNode } from "react";
import { ChevronRight, X, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { SHADOW_SMALL, TNUM } from "./home-style";
import { C, SHADOW_ACTIVE, sheetCard as sheetPanel } from "./ops-style";

/** HTML section card: radius 16, padding 16. */
export function ECard({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return <section id={id} aria-label={label} style={{ ...sheetPanel, padding: 16, minWidth: 0 }}>{children}</section>;
}

/** Card header: 32 px icon tile + 15 / 700 title (+ optional right-hand text). */
export function EHead({ icon: Icon, bg, fg, title, right, sub }: { icon: LucideIcon; bg: string; fg: string; title: string; right?: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 32, height: 32, flex: "none", borderRadius: 10, backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={17} strokeWidth={1.9} color={fg} /></span>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>{title}</div>
        </div>
        {right}
      </div>
      {sub ? <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 3 }}>{sub}</div> : null}
    </>
  );
}

export const Chv = ({ size = 16 }: { size?: number }) => <ChevronRight size={size} strokeWidth={2} color={C.chevronGold} aria-hidden="true" style={{ flex: "none" }} />;

// ---------------------------------------------------------------------------
// List row (HTML `row`): avatar / rank / icon, title + lines, effort bar, right value + pill, chevron
// ---------------------------------------------------------------------------
export type RowSpec = {
  key: string; title: string; lines?: string[]; right?: string; rc?: string; tc?: string; icon?: LucideIcon; rank?: string;
  av?: { ini: string; avBg: string; avFg: string }; bar?: { w: string; t: string; c: string } | null; pill?: { l: string; bg: string; fg: string } | null;
  bg?: string; rad?: number; onTap?: () => void; aria?: string;
};
export function ERow({ r, first }: { r: RowSpec; first: boolean }) {
  const Icon = r.icon;
  const tap = !!r.onTap;
  return (
    <button type="button" onClick={r.onTap} aria-label={r.aria ?? r.title} disabled={!tap}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "9px 8px", margin: "0 -8px", boxSizing: "content-box", border: "none", borderTop: first ? "none" : `1px solid ${M.divider}`, borderRadius: r.rad ?? 0, backgroundColor: r.bg ?? "transparent", fontFamily: "inherit", textAlign: "left", cursor: tap ? "pointer" : "default", WebkitTapHighlightColor: "transparent", color: "inherit" }}>
      {Icon ? <Icon size={18} strokeWidth={1.9} color={M.taupe} aria-hidden="true" /> : null}
      {r.rank ? <span style={{ flex: "none", width: 22, fontSize: 12, fontWeight: 700, color: M.muted, ...TNUM }}>{r.rank}</span> : null}
      {r.av ? <span aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", backgroundColor: r.av.avBg, color: r.av.avFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, letterSpacing: 0.2 }}>{r.av.ini}</span> : null}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: r.tc ?? M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
        {(r.lines ?? []).map((l, i) => <span key={i} style={{ display: "block", fontSize: 11.5, lineHeight: 1.4, color: M.ink, marginTop: 2, overflowWrap: "anywhere", ...TNUM }}>{l}</span>)}
        {r.bar ? (
          <span aria-hidden="true" style={{ position: "relative", display: "block", height: 6, marginTop: 7, borderRadius: 999, backgroundColor: M.divider }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: r.bar.w, borderRadius: 999, backgroundColor: r.bar.c }} />
            <span style={{ position: "absolute", top: -2, bottom: -2, left: r.bar.t, width: 2, borderRadius: 1, backgroundColor: M.raisin, opacity: 0.45 }} />
          </span>
        ) : null}
      </span>
      {r.right || r.pill ? (
        <span style={{ flex: "none", textAlign: "right" }}>
          {r.right ? <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: r.rc ?? M.raisin, whiteSpace: "nowrap", ...TNUM }}>{r.right}</span> : null}
          {r.pill ? <span style={{ display: "inline-flex", alignItems: "center", height: 22, marginTop: 2, padding: "0 8px", borderRadius: 999, backgroundColor: r.pill.bg, color: r.pill.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{r.pill.l}</span> : null}
        </span>
      ) : null}
      {tap ? <Chv /> : null}
    </button>
  );
}
export function RowList({ rows }: { rows: RowSpec[] }) {
  return <div style={{ marginTop: 6 }}>{rows.map((r, i) => <ERow key={r.key} r={r} first={i === 0} />)}</div>;
}

/** Full-width text button under a list ("All N departments …", "Chart and full list"). */
export function MoreBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", height: 44, margin: "6px 0 -6px", border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
      {label}<ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "14px 0 4px", textAlign: "center", fontSize: 13, color: M.muted }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------
/** HTML segment: track #F0ECE9, white lit option. h = 44 (window switch) or 36 (sheet switch). */
export function Segment<K extends string>({ options, value, onChange, aria, h = 44 }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; aria: string; h?: 44 | 36 }) {
  const big = h === 44;
  return (
    <div role="tablist" aria-label={aria} style={{ display: "grid", gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))`, gap: big ? 4 : 3, height: h, boxSizing: "border-box", padding: big ? 4 : 3, borderRadius: big ? 12 : 10, backgroundColor: M.divider }}>
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onChange(k)}
            style={{ minWidth: 0, border: "none", borderRadius: big ? 9 : 8, backgroundColor: on ? M.card : "transparent", boxShadow: on ? SHADOW_ACTIVE : "none", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: big ? 13 : 12, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 4px", WebkitTapHighlightColor: "transparent" }}>{l}</button>
        );
      })}
    </div>
  );
}
/** Pills (Upper / Lower half, By person / By department): active taupe + white text, inactive #F0ECE9. */
export function Pills<K extends string>({ options, value, onChange, aria }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; aria: string }) {
  return (
    <div role="tablist" aria-label={aria} style={{ display: "flex", gap: 8, marginTop: 12 }}>
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onChange(k)}
            style={{ height: 32, padding: "0 13px", border: "none", borderRadius: 999, backgroundColor: on ? M.taupe : M.divider, color: on ? "#FFFFFF" : "#3A352C", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>{l}</button>
        );
      })}
    </div>
  );
}
/** Chart legend chip (28 px): white with shadow when on, #F0ECE9 and faded swatch when off. */
export function LegendChip({ label, color, h, on, onToggle }: { label: string; color: string; h: number; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle}
      style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px", border: "none", borderRadius: 999, backgroundColor: on ? M.card : M.divider, color: on ? M.raisin : M.muted, boxShadow: on ? SHADOW_SMALL : "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ width: 10, height: h, borderRadius: 2, backgroundColor: color, opacity: on ? 1 : 0.3 }} />{label}
    </button>
  );
}
/** Plain legend toggle (Non-production card): no pill, faded when off. */
export function LegendText({ label, color, h, on, onToggle }: { label: string; color: string; h: number; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "none", padding: 0, fontFamily: "inherit", fontSize: 12, color: "#3A352C", cursor: "pointer", opacity: on ? 1 : 0.35 }}>
      <span style={{ width: 10, height: h, borderRadius: 2, backgroundColor: color }} />{label}
    </button>
  );
}
/** Tooltip card under a chart with a clear button (HTML ch.tip / np.npTip). */
export function TipCard({ head, rows, onClear }: { head: string; rows: { k: string; v: string; c: string }[]; onClear: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
      <div style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 12, backgroundColor: M.card, boxShadow: "0 1px 2px rgba(31,29,27,.06),0 6px 16px -8px rgba(31,29,27,.22)", ...TNUM }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin }}>{head}</div>
        {rows.map((t) => <div key={t.k} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 5, fontSize: 12 }}><span style={{ color: t.c }}>{t.k}</span><span style={{ fontWeight: 600, color: t.c }}>{t.v}</span></div>)}
      </div>
      <button type="button" onClick={onClear} aria-label="Clear selection" style={{ flex: "none", width: 28, height: 28, border: "none", borderRadius: "50%", backgroundColor: "#F4EFE6", color: M.taupe, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><X size={14} strokeWidth={2.2} aria-hidden="true" /></button>
    </div>
  );
}
