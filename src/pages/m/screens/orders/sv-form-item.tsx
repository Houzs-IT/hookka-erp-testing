// Full-screen item editor of the SV form (prototype Phase 3 "Add item" / "Edit item"): product + fabric rows,
// quantity stepper + unit price (RM text -> integer sen), customisation chips, REPAIR SCOPE chips, departments and
// — for Custom only — the damaged-component checklist from the product BOM (desktop repair-scope-picker.tsx:
// components are a CUSTOM-only control). Sticky bottom bar: Remove / Save item.
import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { canonicalizeComponentPicks } from "../../../../lib/repair-scope";
import { specialOrderOptions } from "../../../../lib/pricing-options";
import { M } from "../../theme";
import { Btn, Card, Chip, SectionLabel } from "../cases/case-ui";
import { ConfirmDialog, Overlay } from "../cases/case-overlay";
import { CC, fieldStyle } from "../cases/case-style";
import { repairComponentsUrl, type RepairComponentOption } from "../cases/repair-components";
import { REPAIR_SCOPE_PRESET_DEPTS } from "../../../../lib/repair-scope";
import { ALL_DEPTS, DEPT_LABEL, SCOPE_PRESETS, SCOPE_PRESET_LABEL, fmtRm, isLockedDept, lineProblem, lineTotalSen, rmTextToSen, scopeForPreset, senToRmText, sofaSizeOptions, sofaSizePatch, toggleScopeDept, type LineScope, type ScopePreset, type SvLine } from "./sv-form-model";
import { FabricPickerSheet, ProductPickerSheet, type PickedProduct } from "./sv-form-pickers";

// Secondary footer button as the design draws it: white, near-black label (the shared Btn secondary uses the taupe label).
export function FootBtn({ children, onClick, disabled, color, full = true }: { children: ReactNode; onClick: () => void; disabled?: boolean; color?: string; full?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ width: full ? "100%" : undefined, padding: full ? undefined : "0 16px", height: 48, border: "none", borderRadius: 12, background: M.card, color: color ?? M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", boxShadow: "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)", WebkitTapHighlightColor: "transparent" }}>{children}</button>;
}

// Component quantity stepper as the design draws it: two 32px tan tiles around the count (the shared Stepper is a flat pill).
function CompStepper({ value, label, onDec, onInc, decDisabled, incDisabled }: { value: number; label: string; onDec: () => void; onInc: () => void; decDisabled?: boolean; incDisabled?: boolean }) {
  const tile = (disabled: boolean | undefined, aria: string, fn: () => void, icon: ReactNode) => (
    <button type="button" aria-label={aria} onClick={fn} disabled={disabled} style={{ width: 32, height: 32, border: "none", borderRadius: 9, background: CC.tile, color: CC.brown, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>{icon}</button>
  );
  return (
    <div role="group" aria-label={label} style={{ flex: "none", display: "flex", alignItems: "center", gap: 4 }}>
      {tile(decDisabled, "Less", onDec, <Minus size={14} strokeWidth={2.2} aria-hidden />)}
      <span style={{ minWidth: 22, textAlign: "center", fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {tile(incDisabled, "More", onInc, <Plus size={14} strokeWidth={2.2} aria-hidden />)}
    </div>
  );
}

const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const splitSpecials = (s: string): string[] => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
const valueOf = (v: unknown): string => (v && typeof v === "object" && "value" in v ? String((v as { value: unknown }).value) : String(v));

function PickRow({ label, value, sub, placeholder, onClick, first }: { label?: string; value: string; sub?: string; placeholder?: string; onClick: () => void; first?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: first ? 60 : 52, padding: "10px 14px", border: "none", borderTop: first ? "none" : `1px solid ${CC.sep}`, background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        {label ? <span style={{ display: "block", fontSize: 11.5, color: M.ink }}>{label}</span> : null}
        <span style={{ display: "block", fontSize: 14, fontWeight: label ? 600 : value ? 700 : 500, color: value ? M.raisin : CC.hint, marginTop: label ? 2 : 0, overflowWrap: "anywhere" }}>{value || placeholder}</span>
        {sub ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{sub}</span> : null}
      </span>
      <ChevronRight size={17} strokeWidth={2} color={CC.brownSoft} aria-hidden />
    </button>
  );
}

export function SvItemEditor({ initial, isNew, onBack, onSave, onRemove }: { initial: SvLine; isNew: boolean; onBack: () => void; onSave: (l: SvLine) => void; onRemove?: () => void }) {
  const [l, setL] = useState<SvLine>(initial);
  const [priceText, setPriceText] = useState(() => senToRmText(initial.basePriceSen));
  const [prodOpen, setProdOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [err, setErr] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const dirty = JSON.stringify(l) !== JSON.stringify(initial);
  const sofa = l.itemCategory === "SOFA";
  const patch = (p: Partial<SvLine>) => { setL((x) => ({ ...x, ...p })); setErr(""); };
  const setScope = (p: Partial<LineScope>) => patch({ scope: { ...l.scope, ...p } });

  // Customisation chips = the maintenance config's special-order list for this category (desktop create.tsx ~3167),
  // plus anything already on the line. They are descriptive only: a service order's prices are all typed by hand.
  const cfg = useCachedJson<{ data?: Record<string, unknown[]> }>(l.productCode ? "/api/kv-config/variants-config" : null, 300);
  const specials = useMemo(() => {
    const fromCfg = cfg.data?.data?.[sofa ? "sofaSpecials" : "specials"];
    const base = Array.isArray(fromCfg) ? fromCfg.map(valueOf) : sofa ? [] : specialOrderOptions.map((o) => o.name);
    const cur = splitSpecials(l.specialOrder);
    return Array.from(new Set([...base, ...cur])).filter(Boolean);
  }, [cfg.data, sofa, l.specialOrder]);
  const chosen = splitSpecials(l.specialOrder);
  const toggleSpecial = (name: string) => patch({ specialOrder: (chosen.includes(name) ? chosen.filter((x) => x !== name) : [...chosen, name]).join(", ") });

  // Damaged components: the canonical BOM -> WIP breakdown (same query as desktop's picker).
  const compUrl = l.scope.preset === "CUSTOM" && l.productCode
    ? repairComponentsUrl({ productCode: l.productCode, sizeLabel: l.sizeLabel, sizeCode: l.sizeCode, fabricCode: l.fabricCode, gapInches: l.gapInches, divanHeightInches: l.divanHeightInches, legHeightInches: l.legHeightInches })
    : null;
  const comps = useCachedJson<{ data?: RepairComponentOption[] }>(compUrl, 60);
  const options = useMemo(() => (Array.isArray(comps.data?.data) ? comps.data.data : []), [comps.data]);

  const seatOptions = useMemo(() => {
    const base = sofaSizeOptions(cfg.data?.data?.sofaSizes);
    return l.sizeLabel && !base.includes(l.sizeLabel) ? [...base, l.sizeLabel] : base;
  }, [cfg.data, l.sizeLabel]);

  const pickProduct = (p: PickedProduct) => {
    patch({
      productId: p.id, productCode: p.code, productName: p.name, itemCategory: p.category || l.itemCategory, baseModel: p.baseModel,
      // Sofa: the size is the SEAT HEIGHT, chosen from the variants config (desktop selectProduct / selectSeatHeight); the
      // catalogue module size is not it. The product's default seat is pre-filled, otherwise the person must choose.
      ...(p.category === "SOFA" ? sofaSizePatch(p.defaultSeat) : { sizeCode: p.sizeCode, sizeLabel: p.sizeLabel }),
      // A different product is a different build: its variant fields and special orders do not carry over.
      ...(p.code !== l.productCode ? { gapInches: null, divanHeightInches: null, legHeightInches: null, specialOrder: "", customSpecials: [], divanPriceSen: 0, legPriceSen: 0, specialOrderPriceSen: 0, totalHeightPriceSen: 0, scope: { ...l.scope, components: [] } } : {}),
      ...(p.category === "SOFA" ? { quantity: 1 } : {}),
    });
  };

  // Desktop picker rules (sv-form-model scopeForPreset / toggleScopeDept): Custom starts with Upholstery + Packing, locked on.
  const setPreset = (preset: ScopePreset) => { if (preset !== l.scope.preset) patch({ scope: scopeForPreset(l.scope, preset) }); };
  const toggleDept = (d: (typeof ALL_DEPTS)[number]) => patch({ scope: toggleScopeDept(l.scope, d) });
  const togglePick = (o: RepairComponentOption) => {
    const has = l.scope.components.some((c) => c.key === o.key);
    setScope({ components: has ? l.scope.components.filter((c) => c.key !== o.key) : [...l.scope.components, { key: o.key, label: o.label, qty: 1 }] });
  };
  const pickQty = (o: RepairComponentOption, d: number) => {
    const max = Math.max(1, Math.floor(o.qty) || 1);
    setScope({ components: l.scope.components.map((c) => (c.key === o.key ? { ...c, qty: Math.min(max, Math.max(1, c.qty + d)) } : c)) });
  };

  const save = () => {
    const problem = lineProblem(l);
    if (problem) { setErr(problem); return; }
    let scope = l.scope;
    if (scope.preset === "CUSTOM" && scope.components.length && options.length) {
      // Re-canonicalize against the live BOM (desktop reconcile): stale keys drop, "everything at full qty" = no picks.
      scope = { ...scope, components: canonicalizeComponentPicks(options, scope.components) ?? [] };
    }
    onSave({ ...l, scope });
  };

  const presetDepts = l.scope.preset === "CUSTOM" ? l.scope.depts : l.scope.preset === "FULL" ? ALL_DEPTS : REPAIR_SCOPE_PRESET_DEPTS[l.scope.preset];
  const scopeNote = l.scope.preset === "FULL" ? "Every department, every component — same as a normal order." : l.scope.preset === "CUSTOM" ? "Upholstery and Packing always run. Add any other departments, and optionally the damaged components." : "Preset departments · all components.";

  return (
    <Overlay
      title={isNew ? "Add item" : "Edit item"}
      closeLabel="Back"
      onClose={() => (dirty ? setAskDiscard(true) : onBack())}
      footer={(
        <div>
          {err ? <div role="alert" style={{ fontSize: 12.5, color: CC.dangerDark, margin: "0 2px 8px", overflowWrap: "anywhere" }}>{err}</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            {onRemove ? <FootBtn full={false} color={CC.dangerDark} onClick={() => setAskRemove(true)}>Remove</FootBtn> : null}
            <div style={{ flex: 1, minWidth: 0 }}><Btn full h={48} onClick={save}>Save item</Btn></div>
          </div>
        </div>
      )}
    >
      <section>
        <SectionLabel>Product</SectionLabel>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <PickRow first value={l.productName || l.productCode} placeholder="Choose product" sub={l.productCode ? [l.productCode, titleCase(l.itemCategory), l.sizeLabel].filter(Boolean).join(" · ") : "Required"} onClick={() => setProdOpen(true)} />
          {l.productCode && sofa ? (
            <label style={{ display: "block", padding: "10px 14px", borderTop: `1px solid ${CC.sep}` }}>
              <span style={{ display: "block", fontSize: 11.5, color: M.ink }}>Seat size</span>
              <select aria-label="Seat size" value={l.sizeLabel} onChange={(e) => patch(sofaSizePatch(e.target.value))} style={fieldStyle({ height: 42, padding: "0 10px", fontSize: 15, borderRadius: 10, border: `1px solid ${M.hairline}`, boxShadow: "none", width: "100%", marginTop: 2 })}>
                <option value="">Choose seat size</option>
                {seatOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ) : null}
          {l.productCode ? <PickRow label="Fabric" value={l.fabricCode} placeholder="Choose fabric" onClick={() => setFabOpen(true)} /> : null}
        </Card>
      </section>

      <section>
        <SectionLabel>Quantity &amp; price</SectionLabel>
        <Card style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11.5, color: M.ink, marginBottom: 5 }}>Quantity{sofa ? " (one per sofa line)" : ""}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" aria-label="Decrease quantity" disabled={l.quantity <= 1} onClick={() => patch({ quantity: Math.max(1, l.quantity - 1) })} style={{ width: 40, height: 40, flex: "none", border: "none", borderRadius: 10, background: CC.tile, color: CC.brown, cursor: "pointer", opacity: l.quantity > 1 ? 1 : 0.4, display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={16} strokeWidth={2.2} aria-hidden /></button>
              <span style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{l.quantity}</span>
              <button type="button" aria-label="Increase quantity" disabled={sofa} onClick={() => patch({ quantity: l.quantity + 1 })} style={{ width: 40, height: 40, flex: "none", border: "none", borderRadius: 10, background: CC.tile, color: CC.brown, cursor: "pointer", opacity: sofa ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} strokeWidth={2.2} aria-hidden /></button>
            </div>
          </div>
          <label style={{ display: "block", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginBottom: 5 }}>Unit price (RM)</span>
            <input inputMode="decimal" aria-label="Unit price in RM" placeholder="0.00" value={priceText}
              onChange={(e) => { setPriceText(e.target.value); patch({ basePriceSen: rmTextToSen(e.target.value) }); }}
              style={fieldStyle({ height: 40, padding: "0 10px", fontSize: 15, borderRadius: 10, border: `1px solid ${M.hairline}`, boxShadow: "none", textAlign: "right", fontVariantNumeric: "tabular-nums" })} />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${CC.sep}` }}>
            <span style={{ fontSize: 13, color: M.ink }}>Line total</span>
            <b style={{ fontSize: 15, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtRm(lineTotalSen(l))}</b>
          </div>
        </Card>
      </section>

      {l.productCode && specials.length > 0 ? (
        <section>
          <SectionLabel>Customisation</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {specials.map((s) => <Chip key={s} label={s} on={chosen.includes(s)} onClick={() => toggleSpecial(s)} />)}
          </div>
        </section>
      ) : null}

      <section>
        <SectionLabel>Repair scope</SectionLabel>
        <div role="radiogroup" aria-label="Repair scope" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SCOPE_PRESETS.map((p) => <Chip key={p} role="radio" label={SCOPE_PRESET_LABEL[p]} on={l.scope.preset === p} onClick={() => setPreset(p)} />)}
        </div>
        <div style={{ fontSize: 12, color: M.ink, margin: "10px 2px 8px" }}>{scopeNote}</div>
        {(
          <Card style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: M.ink, marginBottom: 8 }}>Departments</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ALL_DEPTS.map((d) => {
                const custom = l.scope.preset === "CUSTOM";
                const locked = custom && isLockedDept(d);
                const on = locked || presetDepts.includes(d);
                if (locked) {
                  // Always on for a partial repair (desktop: ticked + disabled "(always)"): not a button, not toggleable.
                  return <span key={d} role="checkbox" aria-checked aria-disabled tabIndex={-1} aria-label={`${DEPT_LABEL[d]} (always included)`} style={{ flex: "none", height: 30, boxSizing: "border-box", padding: "0 11px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", background: CC.brown, color: "#FFFFFF", opacity: 0.6, cursor: "default" }}>{DEPT_LABEL[d]}<span style={{ fontWeight: 500, opacity: 0.85 }}>always</span></span>;
                }
                return !custom && !on ? null : <Chip key={d} role={custom ? "checkbox" : undefined} label={DEPT_LABEL[d]} on={on} onClick={() => (custom ? toggleDept(d) : undefined)} h={30} fs={12} pad={11} />;
              })}
            </div>
            {l.scope.preset === "CUSTOM" && l.productCode ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: M.ink, marginBottom: 4 }}>Damaged components <span style={{ fontWeight: 500, color: CC.hint }}>Optional · from the product BOM</span></div>
                {comps.loading && !comps.data ? <div aria-busy="true" style={{ fontSize: 12.5, color: M.ink }}>Loading components from the product’s BOM…</div> : null}
                {comps.error && !comps.data ? <div role="alert" style={{ fontSize: 12.5, color: CC.danger }}>Couldn’t load this product’s components. With none picked the whole product is repaired.</div> : null}
                {comps.data && options.length === 0 ? <div style={{ fontSize: 12.5, color: M.ink }}>This product has no BOM components to pick.</div> : null}
                <div style={{ display: "grid" }}>
                  {options.map((o) => {
                    const pick = l.scope.components.find((c) => c.key === o.key);
                    const max = Math.max(1, Math.floor(o.qty) || 1);
                    return (
                      <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, borderTop: `1px solid ${CC.sep}` }}>
                        <button type="button" role="checkbox" aria-checked={!!pick} onClick={() => togglePick(o)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "8px 0", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                          <span aria-hidden style={{ width: 20, height: 20, flex: "none", boxSizing: "border-box", borderRadius: 6, background: pick ? CC.brown : M.card, border: pick ? "none" : "1.5px solid #C9BFAE", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800 }}>{pick ? "✓" : ""}</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{o.label} <span style={{ fontWeight: 500, color: CC.hint }}>of {max}</span></span>
                            <span style={{ display: "block", fontSize: 11, color: CC.hint, overflowWrap: "anywhere" }}>{o.key}</span>
                          </span>
                        </button>
                        {pick && max > 1 ? <CompStepper label={`${o.label} quantity`} value={pick.qty} decDisabled={pick.qty <= 1} incDisabled={pick.qty >= max} onDec={() => pickQty(o, -1)} onInc={() => pickQty(o, 1)} /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </Card>
        )}
      </section>

      <ProductPickerSheet open={prodOpen} onClose={() => setProdOpen(false)} currentCode={l.productCode} onPick={pickProduct} />
      <FabricPickerSheet open={fabOpen} onClose={() => setFabOpen(false)} currentCode={l.fabricCode} onPick={(code) => patch({ fabricCode: code })} />
      <ConfirmDialog open={askDiscard} title="Discard changes?" text="Your changes to this item will be lost." danger={false} onKeep={() => setAskDiscard(false)} onGo={() => { setAskDiscard(false); onBack(); }} />
      <ConfirmDialog open={askRemove} title="Remove this item?" text="It leaves the order when you save the order." keepLabel="Keep" goLabel="Remove" onKeep={() => setAskRemove(false)} onGo={() => { setAskRemove(false); onRemove?.(); }} />
    </Overlay>
  );
}
