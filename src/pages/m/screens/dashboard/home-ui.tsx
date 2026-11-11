// Shared pieces of the /m Home dashboard (Home v10). Visual source of truth:
// design_handoff_home_v10/Home v10.dc.html. Colours come from the M.* tokens so
// dark mode works; the few fixed hexes below are DATA colours (series, status),
// like M_ACCENT / M_DELTA, and are the desktop's own.
import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Sheet } from "../../components/Sheet";
import { M } from "../../theme";
import { CHIP_TEXT, SHADOW_CARD, SHADOW_CHIP_ON, SHADOW_SMALL, TNUM } from "./home-style";

/** Section label: 11 / 700, 1px tracking, taupe, uppercase. */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, lineHeight: "14px", ...style }}>{children}</span>
  );
}

/** Card section: 16px radius, soft shadow, 15/700 title, 12px caption. */
export function HCard({
  label, title, sub, right, children, padBottom = 16, id,
}: { label: string; title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; padBottom?: number; id?: string }) {
  return (
    <section
      id={id}
      aria-label={label}
      style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_CARD, padding: `16px 16px ${padBottom}px`, minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 3, lineHeight: 1.4 }}>{sub}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** All / Bedframe / Sofa style filter chips: 34px, 12.5px, selected = taupe. */
export function ChipRow<K extends string>({
  options, value, onChange, aria,
}: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; aria: string }) {
  return (
    <div role="group" aria-label={aria} style={{ display: "flex", gap: 6 }}>
      {options.map(([k, label]) => {
        const on = k === value;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(k)}
            style={{
              flex: "none", height: 34, padding: "0 13px", border: "none", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
              backgroundColor: on ? M.taupe : M.card, color: on ? M.paper : CHIP_TEXT, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600,
              boxShadow: on ? SHADOW_CHIP_ON : SHADOW_SMALL, WebkitTapHighlightColor: "transparent",
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}

/** A legend entry that toggles its series (struck through when off). */
export function LegendToggle({
  label, swatch, on, onToggle, color,
}: { label: string; swatch: CSSProperties; on: boolean; onToggle: () => void; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: 0, border: "none", background: "none", fontFamily: "inherit",
        fontSize: 14, fontWeight: 600, color: color ?? M.raisin, opacity: on ? 1 : 0.45, textDecoration: on ? "none" : "line-through", cursor: "pointer",
        whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent",
      }}
    ><span aria-hidden="true" style={swatch} />{label}</button>
  );
}

/** Row with a trailing chevron (customer / state / category / seller rows). */
export function Chevron({ hidden }: { hidden?: boolean }) {
  return (
    <span style={{ flex: "none", width: 14, display: "flex", justifyContent: "flex-end", color: M.gold, visibility: hidden ? "hidden" : "visible" }}>
      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section states: loading / error / restricted / empty
// ---------------------------------------------------------------------------
export function SectionState({
  kind, text, onRetry, minHeight = 120,
}: { kind: "loading" | "error" | "restricted" | "empty"; text?: string; onRetry?: () => void; minHeight?: number }) {
  const msg =
    text ??
    (kind === "loading" ? "Loading…" : kind === "error" ? "Could not load this section." : kind === "restricted" ? "Not available for your role." : "No data for this period.");
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      style={{ minHeight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center", color: M.ink, fontSize: 13, padding: "12px 8px" }}
    >
      {kind === "loading" ? (
        <div aria-hidden="true" style={{ width: "100%", height: minHeight - 40, borderRadius: 12, backgroundColor: M.divider, opacity: 0.8 }} />
      ) : null}
      <span>{msg}</span>
      {kind === "error" && onRetry ? (
        <button type="button" onClick={onRetry} style={{ height: 36, padding: "0 16px", borderRadius: 999, border: "none", backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail sheet frame: grab handle, title + subtitle, back (when opened from
// another sheet), close. One <Sheet> stays mounted while its content changes,
// so Back / nested sheets never remount or lose focus.
// ---------------------------------------------------------------------------
export function SheetFrame({
  open, title, sub, onBack, onClose, children,
}: { open: boolean; title: string; sub?: ReactNode; onBack?: () => void; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bare>
      {/* Handle + title row stay pinned while a tall sheet scrolls (Home v10: header fixed, body scrolls),
          so Back and Close are always reachable. */}
      <div style={{ position: "sticky", top: 0, zIndex: 2, backgroundColor: M.paper }}>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 36, height: 4, borderRadius: 999, backgroundColor: M.hairline }} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 4, padding: "6px 12px 8px" }}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" style={iconBtn}>
            <ChevronLeft size={21} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        <div style={{ flex: 1, minWidth: 0, padding: "4px 4px 0" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, lineHeight: 1.3 }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.4 }}>{sub}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ ...iconBtn, color: M.ink }}>
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      </div>
      <div style={{ padding: "0 16px 6px" }}>{children}</div>
    </Sheet>
  );
}
const iconBtn: CSSProperties = {
  width: 40, height: 40, flex: "none", border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", color: M.raisin, WebkitTapHighlightColor: "transparent",
};

export function SheetCard({ children, pad = "2px 13px" }: { children: ReactNode; pad?: string }) {
  return <div style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_CARD, padding: pad, overflow: "hidden" }}>{children}</div>;
}
export function SheetNote({ children }: { children: ReactNode }) {
  return <div style={{ padding: "10px 2px 0", fontSize: 11.5, lineHeight: 1.45, color: M.ink }}>{children}</div>;
}

/** Table inside a sheet: header row + body rows on a CSS grid (v10 "generic table"). */
export function SheetTable({
  grid, head, rows, foot, empty = "Nothing here.",
}: { grid: string; head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; empty?: string }) {
  const align = (i: number): CSSProperties["textAlign"] => (i ? "right" : "left");
  const cell = (c: ReactNode, i: number, bold?: boolean) => (
    <span key={i} style={{ textAlign: align(i), fontWeight: bold ? 700 : 500, minWidth: 0, whiteSpace: "nowrap", ...(i === 0 ? { overflow: "hidden", textOverflow: "ellipsis" } : {}), ...TNUM }}>{c}</span>
  );
  return (
    <SheetCard pad="2px 12px">
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "10px 0 8px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.muted, textTransform: "uppercase" }}>
        {head.map((h, i) => <span key={h + i} style={{ textAlign: align(i), minWidth: 0 }}>{h}</span>)}
      </div>
      {rows.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>{empty}</div> : null}
      {rows.map((r, ri) => (
        <div key={ri} style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center", minHeight: 42, borderTop: `1px solid ${M.divider}`, fontSize: 12.5, color: M.raisin }}>
          {r.map((c, i) => cell(c, i, i === r.length - 1))}
        </div>
      ))}
      {foot && rows.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center", minHeight: 42, borderTop: `1px solid ${M.hairline}`, fontSize: 12.5, color: M.raisin, fontWeight: 700 }}>
          {foot.map((c, i) => cell(c, i, true))}
        </div>
      ) : null}
    </SheetCard>
  );
}

/** Full-width text row under a list ("Compare customers…", "All N states"). */
export function MoreRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", height: 46, border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
      {label}
    </button>
  );
}
