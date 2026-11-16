// ===========================================================================
// Shared pieces for /m/procurement (list, details, forms).
//
// Visuals: Claude Design `Procurement.dc.html` — the same shell, chips,
// cards, sheets, action bar and timeline as `Delivery.dc.html`, so the
// Delivery primitives (../delivery/ui.tsx, ui-tokens.ts) are reused as is and
// only the Procurement-specific compositions live here. Typography: the /m
// Sales / Delivery screens (owner rule: design owns visuals, repo owns type).
// ===========================================================================
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatUnitPriceInput, roundUnitPriceSen } from "@/lib/unit-price";
import { createPortal } from "react-dom";
import { Check, ChevronRight, FileText, Package, ArrowDownUp, Truck, TriangleAlert, CloudOff, Ellipsis, Plus, Search, X, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { ResponsiveGrid, Sheet } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { segmentButton, segmentTrack, SEGMENT_ICON, CHIP_COUNT, CHIP_ROW, CHIP_ROW_CLASS, chip as chipStyle, chipDot } from "../../lib/control-styles";
import { DATE_FIELDS, DATE_RANGES, type DateField, type DateRangeKey, type FlowStep, type PoSummary, type SupplierOption, type Tone } from "../../lib/procurement-mobile";
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

// ---------------------------------------------------------------------------
// HK-0125 PO summary + filter sheet (design handoff).
// ---------------------------------------------------------------------------
const TILE_TONE = {
  red: { bg: "#FEF2F2", fg: "#B91C1C", tile: "#FEE2E2" },
  orange: { bg: "#FFF7ED", fg: "#C2410C", tile: "#FFEDD5" },
  yellow: { bg: "#FFFBEB", fg: "#B45309", tile: "#FEF3C7" },
} as const;

/** 2×2 on a phone, one row of four on a tablet. Overdue is a button (filter on / off). */
export function SummaryGrid({ summary, columns, overdueOn, onOverdue }: { summary: PoSummary; columns: 2 | 4; overdueOn: boolean; onOverdue: () => void }) {
  const tile = (key: string, label: string, value: string, Icon: LucideIcon, iconBg: string, iconFg: string, fg: string) => (
    <div key={key} style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", background: M.card, borderRadius: 14, boxShadow: SHADOW_CONTROL }}>
      <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={17} strokeWidth={1.9} color={iconFg} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 19, lineHeight: 1.15, fontWeight: 700, color: fg, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div style={{ fontSize: 11.5, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      </div>
    </div>
  );
  const od = summary.overdue;
  const has = od != null && od > 0;
  const tone = summary.bands.red ? TILE_TONE.red : summary.bands.orange ? TILE_TONE.orange : summary.bands.yellow ? TILE_TONE.yellow : null;
  const aria =
    od == null
      ? "Overdue POs unavailable right now"
      : `Overdue POs ${od}: ${summary.bands.yellow} 1–7 days, ${summary.bands.orange} 8–30 days, ${summary.bands.red} 31+ days. ${overdueOn ? "Filter on — tap to clear" : has ? "Tap to show overdue only" : ""}`.trim();
  return (
    <section aria-label="PO summary" style={{ padding: "12px 18px 0", display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8 }}>
      {tile("total", "Total POs", String(summary.total), FileText, "#F0ECE9", M.taupe, M.raisin)}
      {tile("pending", "Pending Delivery", String(summary.pending), Truck, "#E0EDF0", "#3E6570", "#3E6570")}
      <button
        type="button"
        onClick={has ? onOverdue : undefined}
        disabled={!has}
        aria-pressed={overdueOn}
        aria-label={aria}
        title={od == null ? "Overdue POs unavailable right now" : undefined}
        style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", border: "none", borderRadius: 14, background: has && tone ? tone.bg : M.card, boxShadow: overdueOn ? `inset 0 0 0 2px ${M.taupe}, 0 8px 20px -12px rgba(31,29,27,.25)` : SHADOW_CONTROL, fontFamily: "inherit", textAlign: "left", cursor: has ? "pointer" : "default", opacity: od == null ? 0.7 : 1 }}
      >
        <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: has && tone ? tone.tile : "#F0ECE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <TriangleAlert size={17} strokeWidth={1.9} color={has && tone ? tone.fg : M.faint} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 19, lineHeight: 1.15, fontWeight: 700, color: has && tone ? tone.fg : M.raisin, fontVariantNumeric: "tabular-nums" }}>{od == null ? "—" : od}</span>
          <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 2, whiteSpace: "nowrap" }}>{od == null ? "Overdue unavailable" : "Overdue POs"}</span>
        </span>
      </button>
      {tile("lines", "Outstanding lines", String(summary.outstandingLines), Package, "#FAEFCB", "#9C6F1E", summary.outstandingLines ? "#9C6F1E" : M.raisin)}
    </section>
  );
}

/** Round white Filter button at the right end of the count row (design handoff). Brown with a red
 *  count badge while any filter is active. */
export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={count ? `Filter, ${count} active` : "Filter"}
      title="Filter"
      style={{ position: "relative", width: 38, height: 38, flex: "none", borderRadius: "50%", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: count ? M.taupe : M.card, color: count ? "var(--m-text-on-accent)" : M.taupe, boxShadow: count ? "0 6px 14px -6px rgba(107,92,50,.6)" : SHADOW_ROUND }}
    >
      <ArrowDownUp size={16} strokeWidth={1.9} aria-hidden />
      {count ? (
        <span aria-hidden style={{ position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: "#9A3A2D", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 0 2px ${M.paper}`, fontVariantNumeric: "tabular-nums" }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Active-filter pills (removable) + Clear all. */
export function FilterPills({ pills, onClearAll }: { pills: { key: string; label: string; aria: string; clear: () => void }[]; onClearAll: () => void }) {
  if (!pills.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "0 18px 8px" }}>
      {pills.map((p) => (
        <span key={p.key} style={{ flex: "none", height: 28, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 4px 0 11px", borderRadius: 999, background: "#F4EFE6", boxShadow: "inset 0 0 0 1px #E2D6BC", color: M.ink, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", maxWidth: "100%" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
          <button type="button" onClick={p.clear} aria-label={p.aria} style={{ width: 24, height: 24, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.taupe }}>
            <X size={13} strokeWidth={2.4} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} style={{ height: 28, border: "none", background: "none", padding: "0 6px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: M.taupe, cursor: "pointer" }}>
        Clear all
      </button>
    </div>
  );
}

export type FilterDraft = { supplier: string; chip: string; field: DateField; range: DateRangeKey; from: string; to: string; overdue: boolean };
const FILTER_DEFAULT: FilterDraft = { supplier: "", chip: "", field: "exp", range: "any", from: "", to: "", overdue: false };

const SEC_LABEL = { margin: "0 2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe } as const;

function ChoicePill({ on, label, dot, onClick }: { on: boolean; label: string; dot?: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} style={chipStyle(on)}>
      {dot ? <span aria-hidden style={chipDot(dot)} /> : null}
      {label}
    </button>
  );
}

/** Drag handle + title + 44px close, as in the design's bottom sheets. */
function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "#E2DDD8" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 4px 18px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>{title}</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.faint }}>
          <X size={20} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
    </>
  );
}

/** Supplier, Status and Date in one bottom sheet, with Reset and "Show N POs". Changes are a draft:
 *  they apply only on "Show N POs" and are discarded when the sheet is closed. The supplier picker is
 *  a second sheet stacked above this one. */
export function FilterSheet({
  open, onClose, applied, supplierOptions, statusChips, countFor, onApply,
}: {
  open: boolean;
  onClose: () => void;
  applied: FilterDraft;
  supplierOptions: SupplierOption[];
  statusChips: { key: string; label: string; tone?: Tone }[];
  countFor: (d: FilterDraft) => number;
  onApply: (d: FilterDraft) => void;
}) {
  const [draft, setDraft] = useState<FilterDraft>(applied);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState("");
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setDraft(applied);
      setPicker(false);
      setQ("");
    }
  }
  // While the supplier picker is up, Esc / backdrop belong to it, not to this sheet.
  const guardedClose = useCallback(() => {
    if (!picker) onClose();
  }, [picker, onClose]);
  const set = (o: Partial<FilterDraft>) => setDraft((d) => ({ ...d, ...o }));
  const picked = supplierOptions.find((o) => o.key === draft.supplier);
  const count = countFor(draft);
  const t = q.trim().toLowerCase();
  const total = supplierOptions.reduce((a, o) => a + o.count, 0);
  const list: { key: string; label: string; count: number }[] = [
    ...(t ? [] : [{ key: "", label: "All suppliers", count: total }]),
    ...supplierOptions.filter((o) => !t || o.label.toLowerCase().includes(t)),
  ];

  const dateInput = (label: string, value: string, onChange: (v: string) => void) => (
    <label style={{ minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: M.ink, margin: "0 2px 5px" }}>{label}</span>
      <input type="date" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className="dl-input" style={{ width: "100%", boxSizing: "border-box", height: 44, padding: "0 10px", border: "none", borderRadius: 12, background: M.card, boxShadow: SHADOW_CONTROL, fontFamily: "inherit", fontSize: 15, color: M.raisin, outline: "none" }} />
    </label>
  );

  return (
    <>
      <Sheet open={open} onClose={guardedClose} title="Filter" bare>
        <SheetHeader title="Filter" onClose={onClose} />
        <div style={{ padding: "6px 16px 8px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20, alignContent: "start" }}>
          <section aria-label="Supplier">
            <div style={SEC_LABEL}>SUPPLIER</div>
            <button type="button" onClick={() => { setQ(""); setPicker(true); }} aria-haspopup="dialog" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 14px", border: "none", borderRadius: 14, background: M.card, boxShadow: SHADOW_CONTROL, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked ? picked.label : "All suppliers"}</span>
              <ChevronRight size={18} strokeWidth={2} color="#8B7A4E" aria-hidden />
            </button>
          </section>
          <section aria-label="Status">
            <div style={SEC_LABEL}>STATUS</div>
            <div role="radiogroup" aria-label="Status" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {statusChips.map((c) => (
                <ChoicePill key={c.key || "all"} on={draft.chip === c.key} label={c.label} dot={c.tone ? sem(c.tone) : undefined} onClick={() => set({ chip: c.key })} />
              ))}
            </div>
          </section>
          <section aria-label="Date">
            <div style={SEC_LABEL}>DATE</div>
            <div role="group" aria-label="Date field" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, height: 44, boxSizing: "border-box", padding: 4, borderRadius: 12, background: "#F0ECE9" }}>
              {DATE_FIELDS.map((f) => {
                const on = draft.field === f.key;
                return (
                  <button key={f.key} type="button" aria-pressed={on} onClick={() => set({ field: f.key, range: "any", from: "", to: "" })} style={{ border: "none", borderRadius: 9, background: on ? M.card : "transparent", boxShadow: on ? "0 1px 2px rgba(31,29,27,.08), 0 4px 10px -4px rgba(31,29,27,.18)" : "none", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, cursor: "pointer" }}>
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div role="radiogroup" aria-label="Date range" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {DATE_RANGES[draft.field].map((r) => (
                <ChoicePill key={r.key} on={draft.range === r.key} label={r.label} onClick={() => set({ range: r.key })} />
              ))}
            </div>
            {draft.range === "custom" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                {dateInput("From", draft.from, (v) => set({ from: v }))}
                {dateInput("To", draft.to, (v) => set({ to: v }))}
              </div>
            ) : null}
          </section>
        </div>
        <div style={{ position: "sticky", bottom: 0, display: "flex", gap: 10, padding: "12px 16px 14px", background: M.paper, borderTop: "1px solid #E6E0D9" }}>
          <button type="button" onClick={() => setDraft(FILTER_DEFAULT)} style={{ flex: "none", height: 48, padding: "0 18px", border: "none", borderRadius: 12, background: M.card, boxShadow: SHADOW_CONTROL, color: M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Reset
          </button>
          <button type="button" onClick={() => onApply(draft)} style={{ flex: 1, minWidth: 0, height: 48, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 18px -10px rgba(107,92,50,.7)" }}>
            {`Show ${count} PO${count === 1 ? "" : "s"}`}
          </button>
        </div>
      </Sheet>

      <Sheet open={open && picker} onClose={() => setPicker(false)} title="Supplier" bare>
        <SheetHeader title="Supplier" onClose={() => setPicker(false)} />
        <div style={{ padding: "4px 16px 10px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 9, height: 44, padding: "0 13px", boxSizing: "border-box", background: M.card, borderRadius: 12, boxShadow: SHADOW_CONTROL }}>
            <Search size={16} strokeWidth={1.9} color={M.faint} aria-hidden />
            <input className="dl-input" type="text" value={q} placeholder="Search supplier" aria-label="Search suppliers" onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0, padding: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: M.raisin }} />
          </label>
        </div>
        <div style={{ padding: "0 16px 30px" }}>
          <div role="listbox" aria-label="Suppliers" style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SHADOW_CONTROL }}>
            {list.map((o, i) => {
              const sel = o.key === draft.supplier;
              return (
                <button
                  key={o.key || "all"}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => {
                    set({ supplier: o.key });
                    setPicker(false);
                  }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "8px 14px", border: "none", borderTop: i ? `1px solid ${DL.track}` : "none", background: sel ? M.paper : M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: sel ? 700 : 500, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                  <span style={{ flex: "none", fontSize: 12, color: M.faint, fontVariantNumeric: "tabular-nums" }}>{o.count}</span>
                  <span style={{ flex: "none", width: 18, display: "flex" }}>{sel ? <Check size={17} strokeWidth={2.4} color={M.taupe} aria-hidden /> : null}</span>
                </button>
              );
            })}
            {!list.length ? <div style={{ padding: "16px 14px", fontSize: 13, color: M.ink }}>No suppliers match.</div> : null}
          </div>
        </div>
      </Sheet>
    </>
  );
}

export function Chips({
  label,
  chips,
  value,
  counts,
  onPick,
  leading,
}: {
  leading?: ReactNode;
  label: string;
  chips: { key: string; label: string; tone?: Tone }[];
  value: string;
  counts: Record<string, number> | null;
  onPick: (k: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className={CHIP_ROW_CLASS} style={CHIP_ROW}>
      {leading}
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
