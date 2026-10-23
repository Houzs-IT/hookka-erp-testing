// ===========================================================================
// Shared pieces for /m/procurement (list, details, forms).
//
// Visuals: Claude Design `Procurement.dc.html` — the same shell, chips,
// cards, sheets, action bar and timeline as `Delivery.dc.html`, so the
// Delivery primitives (../delivery/ui.tsx, ui-tokens.ts) are reused as is and
// only the Procurement-specific compositions live here. Typography: the /m
// Sales / Delivery screens (owner rule: design owns visuals, repo owns type).
// ===========================================================================
import { useEffect, useState, type ReactNode } from "react";
import { formatUnitPriceInput, roundUnitPriceSen } from "@/lib/unit-price";
import { createPortal } from "react-dom";
import { Check, ChevronRight, CloudOff, Ellipsis, Plus, Search, X, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { ResponsiveGrid } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { segmentButton, segmentTrack, SEGMENT_ICON, CHIP_COUNT, CHIP_ROW, CHIP_ROW_CLASS, chip as chipStyle, chipDot } from "../../lib/control-styles";
import type { FlowStep, Tone } from "../../lib/procurement-mobile";
import { CheckBox, FlagPill, Metric, Rail, TilePill } from "../delivery/ui";
import { DL, INPUT, SHADOW_BAR_TOP, SHADOW_BLOCK, SHADOW_CARD, SHADOW_CONTROL, SHADOW_MENU, SHADOW_PRIMARY, SHADOW_ROUND, SHADOW_SELECTED, T, pill, sem } from "../delivery/ui-tokens";

export { TilePill, FlagPill };

function onKey(fn?: () => void) {
  return (e: React.KeyboardEvent) => {
    if (!fn) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

// ---------------------------------------------------------------------------
// List controls.
// ---------------------------------------------------------------------------
export function SectionSwitch<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; full: string; icon: LucideIcon }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div role="group" aria-label="Section" style={segmentTrack(options.length)}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" aria-pressed={on} aria-label={o.full} onClick={() => onChange(o.key)} style={segmentButton(on)}>
            <o.icon {...SEGMENT_ICON} aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchRow({ q, setQ, placeholder }: { q: string; setQ: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ padding: "12px 18px 0" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 9, height: 44, padding: "0 13px", boxSizing: "border-box", background: M.card, borderRadius: 14, boxShadow: SHADOW_CONTROL }}>
        <Search size={18} strokeWidth={1.75} color={M.faint} style={{ flexShrink: 0 }} aria-hidden />
        <input
          className="dl-input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          placeholder={placeholder}
          aria-label="Search"
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: M.raisin, textOverflow: "ellipsis" }}
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 32, height: 32, marginRight: -6, flexShrink: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: M.faint, cursor: "pointer" }}>
            <X size={16} strokeWidth={2} />
          </button>
        ) : null}
      </label>
    </div>
  );
}

export function Chips({
  label,
  chips,
  value,
  counts,
  onPick,
}: {
  label: string;
  chips: { key: string; label: string; tone?: Tone }[];
  value: string;
  counts: Record<string, number> | null;
  onPick: (k: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className={CHIP_ROW_CLASS} style={CHIP_ROW}>
      {chips.map((c) => {
        const on = c.key === value;
        return (
          <button key={c.key || "all"} type="button" aria-pressed={on} onClick={() => onPick(c.key)} style={chipStyle(on)}>
            {c.tone ? <span aria-hidden style={chipDot(sem(c.tone))} /> : null}
            {c.label}
            {counts ? <span style={CHIP_COUNT}>{counts[c.key] ?? 0}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Round taupe "+" in the header (prototype). */
export function HeaderPlus({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{ width: 42, height: 42, borderRadius: "50%", background: M.taupe, border: "none", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: "var(--m-text-on-accent)", boxShadow: "0 8px 18px -8px rgba(107,92,50,.65)" }}
    >
      <Plus size={20} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

export function HeaderMore({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      style={{ width: 42, height: 42, borderRadius: "50%", background: M.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer", color: M.taupe, boxShadow: SHADOW_ROUND }}
    >
      <Ellipsis size={20} strokeWidth={2} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Document card (prototype list card: code + pill + flag → title → sub → 3 metas).
// ---------------------------------------------------------------------------
export type MetaCell = { k: string; v: string; warn?: boolean; bold?: boolean; align?: "right"; muted?: boolean };

export function DocCard({
  code,
  status,
  flag,
  title,
  sub,
  metas,
  rail,
  selectable,
  checked,
  current,
  chevron = true,
  onClick,
}: {
  code: string;
  status?: { label: string; tone: Tone } | null;
  flag?: { label: string; tone: Tone } | null;
  title: string;
  sub: string;
  metas: MetaCell[];
  rail: Tone;
  selectable?: boolean;
  checked?: boolean;
  current?: boolean;
  chevron?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role={selectable ? "checkbox" : onClick ? "button" : "article"}
      aria-checked={selectable ? !!checked : undefined}
      aria-current={current ? "true" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKey(onClick)}
      style={{
        position: "relative", overflow: "hidden", display: "flex", gap: 12, background: M.card, borderRadius: 16,
        padding: "13px 14px 12px 17px", cursor: onClick ? "pointer" : "default", WebkitTapHighlightColor: "transparent",
        boxShadow: (selectable ? checked : current) ? SHADOW_SELECTED : SHADOW_CARD,
      }}
    >
      <Rail tone={rail} />
      {selectable ? <CheckBox on={!!checked} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{code}</span>
          {status ? <TilePill tone={status.tone} label={status.label} /> : null}
          {flag ? <FlagPill tone={flag.tone} label={flag.label} /> : null}
          <span style={{ flex: 1 }} />
          {chevron && !selectable ? <ChevronRight size={18} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flexShrink: 0 }} /> : null}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 5, lineHeight: 1.35, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10, paddingTop: 9, boxShadow: `inset 0 1px 0 ${DL.track}` }}>
          {metas.map((m) => (
            <MetaValue key={m.k} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MetaValue({ m }: { m: MetaCell }) {
  if (!m.warn && !m.bold) return <Metric label={m.k} value={m.v} align={m.align} muted={m.muted} />;
  return (
    <div style={{ minWidth: 0, textAlign: m.align }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: M.taupe, whiteSpace: "nowrap" }}>{m.k}</div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: m.bold ? 700 : 600, color: m.warn ? sem("danger") : M.raisin, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.v}</div>
    </div>
  );
}

export function SkeletonCards({ maxColumns }: { maxColumns?: number }) {
  return (
    <ResponsiveGrid aria-busy="true" aria-label="Loading" maxColumns={maxColumns} gap={10}>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden style={{ height: 118, borderRadius: 16, background: M.card, opacity: 0.7, boxShadow: SHADOW_CARD }} />
      ))}
    </ResponsiveGrid>
  );
}

export function ErrorCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ margin: "12px 0", padding: "26px 20px", textAlign: "center", background: M.card, borderRadius: 16, boxShadow: SHADOW_CARD }}>
      <div style={{ width: 44, height: 44, margin: "0 auto", borderRadius: "50%", background: pill("danger").bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CloudOff size={20} strokeWidth={1.9} color={pill("danger").fg} />
      </div>
      <div style={{ ...T.cardTitle, color: M.raisin, marginTop: 12 }}>Something went wrong</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4 }}>{text}</div>
      <button type="button" onClick={onRetry} style={{ marginTop: 14, height: 44, padding: "0 20px", borderRadius: 12, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail pieces.
// ---------------------------------------------------------------------------
export function DetailColumn({ children }: { children: ReactNode }) {
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  return (
    <div style={{ padding: "2px 18px 28px", maxWidth: tablet && !layout.canSplitDetail ? 760 : undefined, margin: "0 auto", boxSizing: "border-box" }}>{children}</div>
  );
}

export function Banner({ tone, icon: Icon, title, children }: { tone: Tone; icon: LucideIcon; title: string; children?: ReactNode }) {
  const c = pill(tone);
  return (
    <div role="status" style={{ display: "flex", gap: 11, alignItems: "flex-start", marginTop: 12, padding: "12px 14px", borderRadius: 14, background: c.bg }}>
      <Icon size={17} strokeWidth={2} color={c.fg} aria-hidden style={{ flex: "none", marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45, color: DL.body, wordBreak: "break-word" }}>
        <span style={{ fontWeight: 700, color: c.fg }}>{title}</span>
        {children ? <> {children}</> : null}
      </div>
    </div>
  );
}

/** Prototype overview headline: gold tick + label, big total, hairline. */
export function TotalBlock({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>
        <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
        {k}
      </div>
      <div style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.5px", color: M.raisin, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{v}</div>
      <div style={{ height: 1, background: DL.track, margin: "14px -16px 14px" }} />
    </>
  );
}

export function Fact({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>{k}</div>
      <div style={{ ...T.cardTitle, color: warn ? sem("danger") : v ? M.raisin : M.muted, marginTop: 4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v || "—"}</div>
    </div>
  );
}

export function Timeline({ steps, label }: { steps: FlowStep[]; label: string }) {
  return (
    <ol aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((st, i) => {
        const done = st.state === "done";
        const cur = st.state === "current";
        const pend = st.state === "pending";
        const lineL = i === 0 ? "transparent" : !pend ? sem("success") : DL.line;
        const lineR = i === steps.length - 1 ? "transparent" : done ? sem("success") : DL.line;
        return (
          <li key={st.label} aria-current={cur ? "step" : undefined} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
            <span aria-hidden style={{ position: "absolute", top: 12, left: 0, width: "50%", height: 2, background: lineL }} />
            <span aria-hidden style={{ position: "absolute", top: 12, right: 0, width: "50%", height: 2, background: lineR }} />
            <span
              style={{
                position: "relative", width: 26, height: 26, boxSizing: "border-box", borderRadius: "50%",
                background: done ? sem("success") : cur ? M.taupe : M.card,
                boxShadow: cur ? "0 0 0 4px rgba(201,169,97,.35)" : pend ? `inset 0 0 0 1.5px ${DL.dotRing}` : "none",
                display: "flex", alignItems: "center", justifyContent: "center", color: pend ? DL.stepNum : "#FFFFFF", fontSize: 11, fontWeight: 700,
              }}
            >
              {done ? <Check size={13} strokeWidth={3} /> : cur ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} /> : i + 1}
            </span>
            <span style={{ marginTop: 7, maxWidth: "100%", textAlign: "center", fontSize: 10.5, lineHeight: 1.3, fontWeight: cur ? 700 : 600, color: pend ? M.ink : M.raisin }}>{st.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Prototype "off-flow" panel (a cancelled / voided document). */
export function OffFlow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 12px", borderRadius: 12, background: M.paper }}>
      <span aria-hidden style={{ width: 10, height: 10, flex: "none", borderRadius: "50%", background: sem("danger"), marginTop: 4 }} />
      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: DL.body }}>{children}</div>
    </div>
  );
}

export function Progress({ label, received, ordered }: { label: string; received: number; ordered: number }) {
  const pct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: M.ink }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>
          {received} / {ordered}
        </span>
      </div>
      <div aria-hidden style={{ marginTop: 6, height: 8, borderRadius: 999, background: DL.line, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: received >= ordered ? sem("success") : sem("warning") }} />
      </div>
    </div>
  );
}

export function SectionTitle({ icon: Icon, title, summary }: { icon: LucideIcon; title: string; summary?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 10px", flexWrap: "wrap" }}>
      <Icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
      <span style={{ ...T.cardTitle, color: M.raisin }}>{title}</span>
      {summary ? <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{summary}</span> : null}
    </div>
  );
}

export function LineCard({
  name,
  code,
  spec,
  right,
  rightSub,
  tag,
}: {
  name: string;
  code?: string;
  spec?: string;
  right: string;
  rightSub?: string;
  tag?: { label: string; tone: Tone } | null;
}) {
  return (
    <div style={{ background: M.card, borderRadius: 16, padding: "13px 14px", boxShadow: SHADOW_BLOCK }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{name || "—"}</div>
          {code ? <div style={{ fontSize: 12, fontWeight: 600, color: M.taupe, marginTop: 3 }}>{code}</div> : null}
          {spec ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 4 }}>{spec}</div> : null}
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{right}</div>
          {rightSub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{rightSub}</div> : null}
        </div>
      </div>
      {tag ? (
        <div style={{ marginTop: 9 }}>
          <TilePill tone={tag.tone} label={tag.label} />
        </div>
      ) : null}
    </div>
  );
}

export type KvRow = { k: string; v: string; sub?: string; bold?: boolean; tag?: { label: string; tone: Tone } | null };

/** Prototype "extra" section (PO vs GRN, Shipment, Landed cost): title, badge, note, rows. */
export function KvSection({
  icon: Icon,
  title,
  badge,
  note,
  rowsList,
}: {
  icon: LucideIcon;
  title: string;
  badge?: { label: string; tone: Tone } | null;
  note?: string;
  rowsList: KvRow[];
}) {
  return (
    <section aria-label={title} style={{ marginTop: 26, background: M.card, borderRadius: 18, padding: "14px 15px 6px", boxShadow: SHADOW_BLOCK }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
        <span style={{ flex: 1, minWidth: 0, ...T.cardTitle, color: M.raisin }}>{title}</span>
        {badge ? <TilePill tone={badge.tone} label={badge.label} /> : null}
      </div>
      {note ? <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 6 }}>{note}</div> : null}
      <div style={{ marginTop: 6 }}>
        {rowsList.map((r, i) => (
          <div key={`${r.k}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${DL.track}` : "none" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: r.bold ? 700 : 500, color: M.raisin, lineHeight: 1.4 }}>{r.k}</div>
              {r.sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{r.sub}</div> : null}
            </div>
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8 }}>
              {r.v ? <span style={{ fontSize: 13, fontWeight: r.bold ? 700 : 600, color: M.raisin, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.v}</span> : null}
              {r.tag ? <TilePill tone={r.tag.tone} label={r.tag.label} /> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function InfoRows({ list }: { list: { k: string; v: string }[] }) {
  return (
    <section style={{ marginTop: 12, background: M.card, borderRadius: 18, padding: "4px 15px", boxShadow: SHADOW_BLOCK }}>
      {list.map((r, i) => (
        <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, padding: "12px 0", borderTop: i ? `1px solid ${DL.track}` : "none" }}>
          <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{r.k}</span>
          <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin, textAlign: "right", lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-line" }}>{r.v || "—"}</span>
        </div>
      ))}
    </section>
  );
}

export type ChainNode = { label: string; doc: string; sub: string; state: "linked" | "current" | "pending"; onClick?: () => void };

/** Prototype document lineage row (same as the Delivery related-documents chain). */
export function ChainRow({ node, nextPending, last }: { node: ChainNode; nextPending: boolean; last: boolean }) {
  const linked = node.state === "linked";
  const current = node.state === "current";
  const dotBg = linked ? DL.linked : current ? M.taupe : M.card;
  const labelColor = linked ? DL.linked : current ? M.taupe : M.ink;
  const lineColor = last ? "transparent" : nextPending ? DL.line : DL.linkedLine;
  const content = (
    <>
      <span aria-hidden style={{ width: 24, height: 24, flex: "none", boxSizing: "border-box", borderRadius: "50%", background: dotBg, border: node.state === "pending" ? `1.5px dashed ${DL.disabled}` : "none", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {linked ? <Check size={13} strokeWidth={3} /> : current ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} /> : null}
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: labelColor }}>{node.label}</span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.doc}</span>
        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>{node.sub}</span>
      </span>
      {node.onClick ? <ChevronRight size={17} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flex: "none" }} /> : null}
    </>
  );
  const base = { position: "relative" as const, display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "6px 0" };
  return (
    <li style={{ position: "relative" }}>
      <span aria-hidden style={{ position: "absolute", left: 11, top: 34, bottom: -6, width: 2, background: lineColor }} />
      {node.onClick ? (
        <button type="button" onClick={node.onClick} style={{ ...base, background: "none", border: "none", fontFamily: "inherit", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          {content}
        </button>
      ) : (
        <div style={base}>{content}</div>
      )}
    </li>
  );
}

export function MenuRow({ icon: Icon, label, onClick, first, danger, disabled }: { icon: LucideIcon; label: string; onClick: () => void; first?: boolean; danger?: boolean; disabled?: boolean }) {
  const c = danger ? pill("danger") : null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "0 15px", background: "none", border: "none", borderTop: first ? "none" : `1px solid ${DL.track}`, fontFamily: "inherit", cursor: disabled ? "default" : "pointer", textAlign: "left", opacity: disabled ? 0.5 : 1 }}
    >
      <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: c ? c.bg : DL.tile, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={17} strokeWidth={1.9} color={c ? c.fg : M.taupe} />
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: c ? c.fg : M.raisin }}>{label}</span>
    </button>
  );
}

export function MenuGroup({ children }: { children: ReactNode }) {
  return <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SHADOW_MENU }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Full-screen form (prototype: complex create / edit flows open full screen).
// ---------------------------------------------------------------------------
export function FullScreenForm({
  open,
  title,
  onClose,
  submitLabel,
  onSubmit,
  busy,
  error,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  const layout = useResponsiveLayout();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  const narrow = layout.mode === "phone";
  return createPortal(
    // z 55: above the header (40), action dock (45) and tab bar (50); below the
    // shared Sheet (60) that pickers / confirms open on top of the form, and toasts (80).
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 55, background: M.paper, display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ width: "100%", maxWidth: narrow ? undefined : 760, margin: "0 auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, height: 52, padding: "0 18px 0 12px", boxSizing: "border-box" }}>
          <button type="button" onClick={busy ? undefined : onClose} aria-label="Close form" style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer", color: M.raisin }}>
            <X size={22} strokeWidth={1.9} />
          </button>
          <div style={{ flex: 1, minWidth: 0, fontSize: "var(--m-type-section-heading-size)", fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 18px 24px", display: "grid", gap: 16, alignContent: "start" }}>
          {children}
          {error ? (
            <div role="alert" style={{ padding: "10px 12px", borderRadius: 12, background: pill("danger").bg, fontSize: 12.5, fontWeight: 600, color: pill("danger").fg }}>
              {error}
            </div>
          ) : null}
        </div>
        <div style={{ flex: "none", display: "flex", gap: 10, padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", background: M.paper, boxShadow: SHADOW_BAR_TOP }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ flex: 1, height: 50, borderRadius: 14, border: "none", background: M.card, color: M.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SHADOW_CONTROL }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            style={{ flex: 1.4, height: 50, borderRadius: 14, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: busy ? "default" : "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1, boxShadow: busy ? "none" : SHADOW_PRIMARY }}
          >
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function FormIntro({ children }: { children: ReactNode }) {
  return <div style={{ padding: "10px 12px", borderRadius: 12, background: DL.noteBg, fontSize: 12, lineHeight: 1.45, color: M.taupe }}>{children}</div>;
}

export function TextInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  type = "text",
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
  type?: "text" | "date" | "tel" | "email";
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return <input className="dl-input" type={type} inputMode={inputMode} value={value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT, height: 46 }} />;
}

export function AreaInput({ value, onChange, ariaLabel, placeholder }: { value: string; onChange: (v: string) => void; ariaLabel: string; placeholder?: string }) {
  return (
    <textarea
      className="dl-input"
      value={value}
      rows={3}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...INPUT, height: "auto", padding: "11px 13px", lineHeight: 1.5, resize: "none" }}
    />
  );
}

/** Small inset number box used inside line cards (prototype). */
export function NumberBox({ value, onChange, ariaLabel, width = 96 }: { value: string; onChange: (v: string) => void; ariaLabel: string; width?: number }) {
  return (
    <input
      className="dl-input"
      type="text"
      inputMode="decimal"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      style={{ width, boxSizing: "border-box", height: 40, padding: "0 10px", border: "none", borderRadius: 10, background: M.paper, fontFamily: "inherit", fontSize: 16, color: M.raisin, outline: "none", boxShadow: `inset 0 0 0 1.5px ${M.hairline}` }}
    />
  );
}

/**
 * Number boxes that keep the TYPED text while editing (so "2." / "0.055"
 * survive the keystroke — BUG-2026-09-22-179 class) and report a parsed value.
 * The parent keys each line by a stable uid, so typed text never moves lines.
 */
export function QtyBox({ value, onChange, ariaLabel }: { value: number; onChange: (v: number) => void; ariaLabel: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <NumberBox
      value={text ?? String(value)}
      onChange={(v) => {
        setText(v);
        const x = parseFloat(v);
        onChange(Number.isFinite(x) ? x : 0);
      }}
      ariaLabel={ariaLabel}
    />
  );
}

/** Unit price (a RATE): RM text → sen with sub-cent digits kept (roundUnitPriceSen), as desktop. */
export function RateBox({ sen, onChange, ariaLabel }: { sen: number; onChange: (sen: number) => void; ariaLabel: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <NumberBox
      value={text ?? formatUnitPriceInput(sen)}
      onChange={(v) => {
        setText(v);
        const x = parseFloat(v);
        onChange(Number.isFinite(x) && x >= 0 ? roundUnitPriceSen(x * 100) : 0);
      }}
      ariaLabel={ariaLabel}
      width={110}
    />
  );
}

/** Whole-sen money (tax): RM text → Math.round(RM × 100). */
export function MoneyBox({ sen, onChange, ariaLabel }: { sen: number; onChange: (sen: number) => void; ariaLabel: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <NumberBox
      value={text ?? (sen / 100).toFixed(2)}
      onChange={(v) => {
        setText(v);
        const x = parseFloat(v);
        onChange(Number.isFinite(x) ? Math.round(x * 100) : 0);
      }}
      ariaLabel={ariaLabel}
      width={110}
    />
  );
}

export function FormLineCard({ children }: { children: ReactNode }) {
  return <div style={{ background: M.card, borderRadius: 14, padding: "12px 13px", boxShadow: "0 1px 2px rgba(31,29,27,.05),0 6px 18px -10px rgba(31,29,27,.18)" }}>{children}</div>;
}

export function GhostAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", height: 46, borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: `inset 0 0 0 1.5px ${M.hairline}` }}>
      <Plus size={16} strokeWidth={2.2} aria-hidden />
      {label}
    </button>
  );
}
