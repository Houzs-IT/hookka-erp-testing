// Home Operations v3 (Overview) — glass primitives. Visual source: the approved "Home Operations v3" design, built on the
// Home Sales v12 glass system (sales-glass.tsx: G.card / G.panel / G.rule). Only the Operations Overview imports this file;
// Output & Cost keeps ops-ui.tsx until its own step. Surfaces come from the M.* theme vars, so dark mode keeps working.
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Info, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { TNUM } from "./home-style";
import { G } from "./sales-glass";

const TILE_BG = "linear-gradient(145deg,#A08C5B,#6B5C32)";

/** Glass section card: 36 px taupe icon tile + title / subtitle (+ right slot), optional divider, then the body. */
export function OGCard({
  icon: Icon, title, sub, right, children, id, label, divider = true,
}: { icon: LucideIcon; title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; id?: string; label: string; divider?: boolean }) {
  return (
    <section id={id} aria-label={label} style={G.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: TILE_BG, boxShadow: "inset 0 1px 0 rgba(255,255,255,.28),0 8px 16px -8px rgba(107,92,50,.75)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2, lineHeight: 1.25 }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.35 }}>{sub}</div> : null}
        </div>
        {right}
      </div>
      {divider ? <div aria-hidden="true" style={{ height: 1, background: G.rule, margin: "14px 0 12px" }} /> : null}
      {children}
    </section>
  );
}

/** LIVE tag with its dot (design: 18 px, green on pale green). */
export function LiveTag({ children = "LIVE", bg = "#EEF3EE", fg = "#4B7A52" }: { children?: ReactNode; bg?: string; fg?: string }) {
  return (
    <span style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 7px", borderRadius: 999, background: bg, color: fg, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: fg }} />{children}
    </span>
  );
}

/** Stat tile (design): 3 px left rail in the tone colour, 20 px icon chip, 10.5 uppercase label, 15/800 value, 11 px sub. */
export function StatTile({
  icon: Icon, label, value, sub, color, valueColor,
}: { icon: LucideIcon; label: string; value: ReactNode; sub?: ReactNode; color: string; valueColor?: string }) {
  // The wash and the icon chip are the tone colour mixed into the card surface, so they follow dark mode.
  const tint = `color-mix(in srgb, ${color} 9%, ${M.card})`;
  const chip = `color-mix(in srgb, ${color} 16%, ${M.card})`;
  return (
    <div style={{ position: "relative", overflow: "hidden", minWidth: 0, padding: "10px 11px 10px 14px", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 45%,${tint})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -12px rgba(107,92,50,.35)` }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span aria-hidden="true" style={{ width: 20, height: 20, flex: "none", borderRadius: 6, background: chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={11} strokeWidth={2.2} color={color} />
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: valueColor ?? M.raisin, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: M.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
    </div>
  );
}

/** Pill button under a list: "Show all 10", "View all 8 ›" (design: 42 px, glass white, taupe 13/700). */
export function PillButton({ label, onClick, chevron = "down", expanded, aria }: { label: ReactNode; onClick: () => void; chevron?: "down" | "right" | "none"; expanded?: boolean; aria?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} aria-label={aria}
      style={{ width: "100%", height: 42, marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", borderRadius: 999, background: `linear-gradient(180deg,color-mix(in srgb, ${M.card} 95%, transparent),color-mix(in srgb, ${M.card} 72%, transparent))`, boxShadow: `inset 0 1px 0 ${M.card}, 0 0 0 1px rgba(201,169,97,.25), 0 6px 14px -8px rgba(107,92,50,.45)`, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}
      {chevron === "none" ? null : chevron === "down"
        ? <span style={{ display: "flex", transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s ease" }}><ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" /></span>
        : <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  );
}

/** Ochre info note under a card (design: Info 14 px, 12 px / 1.5, #9C6F1E). */
export function ONote({ children, top = 12 }: { children: ReactNode; top?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: top, fontSize: 12, lineHeight: 1.5, color: G.hint }}>
      <span style={{ flex: "none", display: "flex", height: 18, alignItems: "center" }}><Info size={14} strokeWidth={2} aria-hidden="true" /></span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}



/** Stage steps of a production order: done = dark green, the stage it waits at = teal, the rest = pale. */
export function StageSteps({ done, total, finished, label }: { done: number; total: number; finished: boolean; label: string }) {
  const n = Math.max(1, Math.min(total, 24));
  return (
    <span role="img" aria-label={label} style={{ flex: 1, minWidth: 0, display: "flex", gap: 2 }}>
      {Array.from({ length: n }, (_, i) => {
        const d = i < done;
        const cur = i === done && !finished;
        return <span key={i} style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 3, background: d ? "#2D5A54" : cur ? "#3E6570" : "#E6E0D7" }} />;
      })}
    </span>
  );
}

/** Horizontally scrolling filter chips (design: 32 px, taupe when on, card surface with shadow when off). Dark-mode safe. */
export function OChipScroll<K extends string>({ options, value, onChange, aria }: { options: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void; aria: string }) {
  return (
    <div role="group" aria-label={aria} className="ops-chip-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "10px -16px 0", padding: "0 16px 2px", scrollbarWidth: "none" }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
            style={{ flex: "none", height: 32, padding: "0 12px", border: "none", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", background: on ? M.taupe : M.card, color: on ? "#FFFFFF" : M.raisin, boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, WebkitTapHighlightColor: "transparent" }}>{o.label}</button>
        );
      })}
    </div>
  );
}
