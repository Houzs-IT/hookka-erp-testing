// Shared pieces of the Sales Order phone sheets: the scan review (dashboard/ScanSoSheet) and the
// order editor (so/SoEditSheet). One line editor, so a scanned draft and a saved order show — and
// keep — the same fields. Colours are the M.* tokens (dark mode comes with them).
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { M, M_ACCENT } from "../../theme";
import { ghost, input, miniLabel, small } from "./so-style";
import {
  SCAN_CATEGORIES, droppedSpecials, itemFlags,
  type EditExtra, type ReviewItem, type ScanCatalog,
} from "../../lib/scan-so";

export function Tag({ kind, children }: { kind: "missing" | "check"; children: ReactNode }) {
  const a = kind === "missing" ? M_ACCENT.danger : M_ACCENT.warning;
  return <span style={{ height: 18, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, backgroundColor: a.bg, color: a.fg, fontSize: 10.5, fontWeight: 700 }}>{children}</span>;
}

export function Field({ label, flag, hint, children, first }: { label: string; flag?: "missing" | "check"; hint?: string; children: ReactNode; first?: boolean }) {
  return (
    <label style={{ display: "block", padding: "10px 0", borderTop: first ? "none" : `1px solid ${M.divider}` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: M.ink }}>
        {label}
        {flag ? <Tag kind={flag}>{flag === "missing" ? "Not found" : "Check"}</Tag> : null}
      </span>
      {children}
      {hint ? <span style={{ display: "block", fontSize: 11, color: M.muted, marginTop: 4, overflowWrap: "anywhere" }}>{hint}</span> : null}
    </label>
  );
}

/** A small labelled input used in the line grid. */
function Mini({ label, value, onChange, aria, mode, align = "right", disabled, flag }: {
  label: string; value: string; onChange: (v: string) => void; aria: string; mode?: "decimal"; align?: "left" | "right"; disabled?: boolean; flag?: "missing" | "check";
}) {
  return (
    <label style={{ minWidth: 0 }}>
      <span style={miniLabel}>{label}</span>
      <input
        value={value}
        disabled={disabled}
        inputMode={mode}
        onChange={(e) => onChange(e.target.value)}
        aria-label={aria}
        style={{ ...small, ...(flag ? input(flag) : {}), marginTop: 3, height: 36, textAlign: align, fontSize: 13.5 }}
      />
    </label>
  );
}

/**
 * One order line. `item.edit` present = a line of a SAVED order (adds the surcharge and discount fields
 * and hides the scan-only "No leg" box); absent = a scanned line. Catalog flags only appear when a
 * catalog is supplied (the scan review has one).
 */
export function SoLineEditor({ item, index, catalog, onChange, onChangeEdit, onRemove, onSplit }: {
  item: ReviewItem;
  index: number;
  catalog: ScanCatalog | null;
  onChange: (patch: Partial<ReviewItem>) => void;
  onChangeEdit?: (patch: Partial<EditExtra>) => void;
  onRemove: () => void;
  /** Sofa lines are one unit each: offered when a sofa line has qty > 1. */
  onSplit?: () => void;
}) {
  const n = index + 1;
  const saved = !!item.edit;
  const flags = itemFlags(item, catalog).filter((f) => !(saved && f.field === "price"));
  const bad = (k: string) => flags.find((x) => x.field === k);
  const dropped = droppedSpecials(item, catalog);
  const sofa = item.category === "SOFA";
  const bed = item.category === "BEDFRAME";
  const qty = Number(item.qty);
  return (
    <div style={{ padding: "10px 0", borderTop: index ? `1px solid ${M.divider}` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.muted }}>ITEM {n}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onRemove} aria-label={`Remove item ${n}`} style={{ width: 32, height: 32, border: "none", background: "none", color: M.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={1.9} aria-hidden="true" /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 8 }}>
        <label style={{ minWidth: 0 }}>
          <span style={miniLabel}>PRODUCT CODE</span>
          <input value={item.productCode} onChange={(e) => onChange({ productCode: e.target.value })} aria-label={`Item ${n} product code`} style={{ ...input(bad("productCode")?.kind), marginTop: 3, height: 38, fontWeight: 600, fontSize: 13.5 }} />
        </label>
        <label style={{ minWidth: 0 }}>
          <span style={miniLabel}>CATEGORY</span>
          <select value={item.category} onChange={(e) => onChange({ category: e.target.value as ReviewItem["category"] })} aria-label={`Item ${n} category`} style={{ ...input(bad("category")?.kind), marginTop: 3, height: 38, fontSize: 13 }}>
            <option value="">Choose…</option>
            {SCAN_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 8, marginTop: 6 }}>
        <Mini label="QTY" value={item.qty} onChange={(v) => onChange({ qty: v })} aria={`Item ${n} quantity`} mode="decimal" flag={bad("qty") ? "missing" : undefined} />
        <Mini label="UNIT PRICE (RM)" value={item.priceRm} onChange={(v) => onChange({ priceRm: v })} aria={`Item ${n} unit price`} mode="decimal" flag={bad("price") ? "check" : undefined} />
      </div>
      <label style={{ display: "block", marginTop: 6 }}>
        <span style={miniLabel}>FABRIC CODE</span>
        <input value={item.fabricCode} onChange={(e) => onChange({ fabricCode: e.target.value })} aria-label={`Item ${n} fabric code`} style={{ ...input(), marginTop: 3, height: 36, fontSize: 13.5 }} />
      </label>
      {sofa ? <div style={{ marginTop: 6 }}><Mini label="SEAT HEIGHT (IN)" value={item.seatHeight} onChange={(v) => onChange({ seatHeight: v })} aria={`Item ${n} seat height`} mode="decimal" align="left" /></div> : null}
      {bed ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 6 }}>
          <Mini label="DIVAN (IN)" value={item.divan} onChange={(v) => onChange({ divan: v })} aria={`Item ${n} divan (in)`} mode="decimal" />
          <Mini label="LEG (IN)" value={item.noLeg ? "" : item.leg} disabled={item.noLeg} onChange={(v) => onChange({ leg: v })} aria={`Item ${n} leg (in)`} mode="decimal" />
          <Mini label="GAP (IN)" value={item.gap} onChange={(v) => onChange({ gap: v })} aria={`Item ${n} gap (in)`} mode="decimal" />
        </div>
      ) : null}
      {bed && !saved ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12.5, color: M.raisin }}>
          <input type="checkbox" checked={item.noLeg} onChange={(e) => onChange({ noLeg: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--m-taupe)" }} /> No leg
        </label>
      ) : null}
      {bed && item.edit && onChangeEdit ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 6 }}>
          <Mini label="DIVAN SURCHARGE (RM)" value={item.edit.divanPriceRm} onChange={(v) => onChangeEdit({ divanPriceRm: v })} aria={`Item ${n} divan surcharge`} mode="decimal" />
          <Mini label="LEG SURCHARGE (RM)" value={item.edit.legPriceRm} onChange={(v) => onChangeEdit({ legPriceRm: v })} aria={`Item ${n} leg surcharge`} mode="decimal" />
        </div>
      ) : null}
      {sofa || bed ? (
        <label style={{ display: "block", marginTop: 6 }}>
          <span style={miniLabel}>SPECIAL ORDER</span>
          <input value={item.specialOrder} onChange={(e) => onChange({ specialOrder: e.target.value })} aria-label={`Item ${n} special order`} style={{ ...input(dropped.length ? "check" : undefined), marginTop: 3, height: 36, fontSize: 13.5 }} />
        </label>
      ) : null}
      {(sofa || bed) && item.edit && onChangeEdit ? (
        <div style={{ marginTop: 6 }}><Mini label="SPECIAL ORDER SURCHARGE (RM)" value={item.edit.specialPriceRm} onChange={(v) => onChangeEdit({ specialPriceRm: v })} aria={`Item ${n} special order surcharge`} mode="decimal" /></div>
      ) : null}
      {item.edit && onChangeEdit ? (
        <div style={{ marginTop: 6 }}><Mini label="LINE DISCOUNT (RM)" value={item.edit.discountRm} onChange={(v) => onChangeEdit({ discountRm: v })} aria={`Item ${n} line discount`} mode="decimal" /></div>
      ) : null}
      <label style={{ display: "block", marginTop: 6 }}>
        <span style={miniLabel}>NOTES</span>
        <input value={item.notes} onChange={(e) => onChange({ notes: e.target.value })} aria-label={`Item ${n} notes`} style={{ ...input(), marginTop: 3, height: 36, fontSize: 13.5 }} />
      </label>
      {sofa && qty > 1 && onSplit ? (
        <button type="button" onClick={onSplit} style={{ ...ghost, height: 36, padding: "0 14px", marginTop: 8, fontSize: 12.5 }}>Split into {qty} lines of 1</button>
      ) : null}
      {flags.map((x) => <div key={x.field} style={{ fontSize: 11.5, color: x.kind === "missing" ? M_ACCENT.danger.fg : M_ACCENT.warning.fg, marginTop: 5 }}>{x.text}</div>)}
      {dropped.length ? <div style={{ fontSize: 11.5, color: M_ACCENT.warning.fg, marginTop: 5 }}>Not in the specials list and left off the order: {dropped.join(", ")}.</div> : null}
      {item.transferredSO ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 5 }}>Transferred from {item.transferredSO}.</div> : null}
      {item.customSpecials.length ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 5 }}>Custom specials kept: {item.customSpecials.map((c) => c.description).join(", ")}.</div> : null}
    </div>
  );
}
