// ===========================================================================
// sv-form-model — pure helpers behind the mobile SV service-order create / edit form.
// No React, no fetch, relative imports only (loaded directly by tests/sv-order-form.test.mjs).
//
// Rules are the DESKTOP's, not the prototype's:
//   create body       src/pages/sales/create.tsx handleSubmit  (isServiceOrder:true, caseId, deliveryHubId, status)
//   edit body         src/pages/sales/edit.tsx  PUT { header…, items }   (+ hubId, which PUT /:id accepts)
//   copy / case hydr. src/pages/sales/create.tsx buildLinesFromCopyDraft + the ?fromCase effect
//   repair scope      src/lib/repair-scope.ts (validateRepairScopeInput is the shared write-side validator)
//   money             integer SEN everywhere; the RM text field converts with Math.round(rm * 100)
// A service-order line is priced at exactly what is typed (0 is allowed): every surcharge is sent as it was
// stored (0 on a new line), because the server trusts a supplied number and only derives an omitted one.
// ===========================================================================
import {
  REPAIR_DEPT_CODES,
  REPAIR_SCOPE_PRESET_DEPTS,
  canonicalizeComponentPicks,
  parseRepairScope,
  validateRepairScopeInput,
  type RepairDeptCode,
} from "../../../../lib/repair-scope";
import { calculateLineTotal, calculateUnitPrice } from "../../../../lib/pricing";
import { sofaSeatHeights } from "../../../../lib/sofa-seat-heights";
import { findInvalidSofaQty, formatSofaQtyError, hasMixedSofaBedframe, SO_MIXED_CATEGORY_ERROR } from "../../../../lib/so-category";

type Raw = Record<string, unknown>;

export type ScopePreset = "FULL" | "FABRIC" | "FRAME" | "FOAM" | "CUSTOM";
export type ScopePick = { key: string; label: string; qty: number };
export type LineScope = { preset: ScopePreset; depts: RepairDeptCode[]; components: ScopePick[] };
export type CustomSpecial = { description: string; surchargeSen: number };

/** One order line as the form holds it. `extra` carries the stored price fields so an edit round-trips them. */
export type SvLine = {
  key: string;
  /** Saved row id ("" for a line that has no row yet). */
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  itemCategory: string;
  baseModel: string;
  sizeCode: string;
  sizeLabel: string;
  fabricCode: string;
  quantity: number;
  basePriceSen: number;
  gapInches: number | null;
  divanHeightInches: number | null;
  legHeightInches: number | null;
  specialOrder: string;
  customSpecials: CustomSpecial[];
  notes: string;
  discountSen: number;
  divanPriceSen: number;
  legPriceSen: number;
  specialOrderPriceSen: number;
  totalHeightPriceSen: number;
  scope: LineScope;
  /** Came from a source order / service case: shown as "Prefilled · review". */
  prefilled?: boolean;
};

export type SvHeader = {
  customerId: string;
  customerName: string;
  hubId: string;
  hubName: string;
  customerPOId: string;
  customerSOId: string;
  reference: string;
  companySODate: string;
  customerDeliveryDate: string;
  hookkaExpectedDD: string;
  notes: string;
  /** Company the SO is booked under (desktop create.tsx salesOrgCode, default HOOKKA). Sent on create only. */
  salesOrgCode: string;
};

export const SCOPE_PRESET_LABEL: Record<ScopePreset, string> = {
  FULL: "Full remake",
  FABRIC: "Fabric replacement",
  FRAME: "Frame repair",
  FOAM: "Foam replacement",
  CUSTOM: "Custom",
};
export const SCOPE_PRESETS: ScopePreset[] = ["FULL", "FABRIC", "FRAME", "FOAM", "CUSTOM"];
export const DEPT_LABEL: Record<RepairDeptCode, string> = {
  FAB_CUT: "Fabric Cutting",
  FAB_SEW: "Fabric Sewing",
  WOOD_CUT: "Wood Cutting",
  FOAM_CUTTING: "Foam Cutting",
  FOAM: "Foam Bonding",
  FIBRE: "Fibre",
  FRAMING: "Framing",
  WEBBING: "Webbing",
  UPHOLSTERY: "Upholstery",
  PACKING: "Packing",
};
export const ALL_DEPTS: readonly RepairDeptCode[] = REPAIR_DEPT_CODES;

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const numOrNull = (v: unknown): number | null => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sen = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

let seq = 0;
export const newLineKey = (): string => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export const FULL_SCOPE = (): LineScope => ({ preset: "FULL", depts: [], components: [] });

// ---- custom repair scope: the desktop picker's seeding / locking (repair-scope-picker.tsx handleScopePresetChange /
// toggleScopeDept) --------------------------------------------------------------------------------------------------
/** Upholstery + Packing are on every partial repair (Wei Siang 2026-06-15): a new Custom scope starts with both ticked and they cannot be unticked. */
export const LOCKED_SCOPE_DEPTS: readonly RepairDeptCode[] = ["UPHOLSTERY", "PACKING"];
export const isLockedDept = (d: RepairDeptCode): boolean => LOCKED_SCOPE_DEPTS.includes(d);

/**
 * Choosing a preset in the picker (desktop handleScopePresetChange): FULL clears the scope; a named preset takes its
 * table (components dropped); CUSTOM starts as exactly [Upholstery, Packing] with no component picks. Going Custom ->
 * other -> Custom therefore resets, like desktop. Re-choosing the current preset is a no-op.
 */
export function scopeForPreset(current: LineScope, preset: ScopePreset): LineScope {
  if (preset === current.preset) return current;
  if (preset === "CUSTOM") return { preset: "CUSTOM", depts: ALL_DEPTS.filter((d) => isLockedDept(d)), components: [] };
  return { preset, depts: [], components: [] };
}

/** Ticking / unticking a dept on a Custom scope (desktop toggleScopeDept): locked depts ignore the tap; chain order is kept; component picks are kept. */
export function toggleScopeDept(scope: LineScope, d: RepairDeptCode): LineScope {
  if (scope.preset !== "CUSTOM" || isLockedDept(d)) return scope;
  const on = scope.depts.includes(d);
  const next = on ? scope.depts.filter((x) => x !== d) : [...scope.depts, d];
  return { ...scope, depts: ALL_DEPTS.filter((x) => next.includes(x)) };
}

// ---- money ---------------------------------------------------------------------------------------
/** "12.50" / "1,200" -> integer sen. Blank / invalid / negative -> 0. Never floats in the result. */
export function rmTextToSen(text: string): number {
  const n = Number(String(text ?? "").replace(/[,\s]|^RM/gi, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}
/** Integer sen -> "12.50"; 0 -> "" so the field shows its placeholder. */
export function senToRmText(s: number): string {
  return s > 0 ? (Math.round(s) / 100).toFixed(2) : "";
}
export const fmtRm = (s: number): string =>
  `RM ${(Math.round(s) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- scope <-> stored JSON string -------------------------------------------------------------------
/** The line's stored repairScope string (or a parsed object) as the editor state. FULL / absent / unreadable = FULL. */
export function scopeFromStored(raw: unknown): LineScope {
  const text = raw == null ? null : typeof raw === "string" ? raw : JSON.stringify(raw);
  const p = parseRepairScope(text);
  if (!p) return FULL_SCOPE();
  return { preset: p.preset, depts: [...p.depts], components: (p.components ?? []).map((c) => ({ ...c })) };
}

/**
 * The editor state -> the string the API takes. FULL -> null. Presets never carry picks (desktop's picker is
 * CUSTOM-only for components). `options` (the live BOM breakdown) re-canonicalizes the picks exactly like
 * repair-scope-picker.tsx: every piece at full qty collapses to "no components" = all of them.
 */
export function scopeToStored(scope: LineScope, options?: readonly ScopePick[] | null): string | null {
  if (scope.preset === "FULL") return null;
  if (scope.preset !== "CUSTOM") return JSON.stringify({ preset: scope.preset, depts: [...REPAIR_SCOPE_PRESET_DEPTS[scope.preset]] });
  const depts = ALL_DEPTS.filter((d) => scope.depts.includes(d));
  let picks: ScopePick[] | undefined = scope.components.length ? scope.components : undefined;
  if (picks && options && options.length) picks = canonicalizeComponentPicks(options, picks);
  return JSON.stringify({ preset: "CUSTOM", depts, ...(picks && picks.length ? { components: picks.map((c) => ({ key: c.key, label: c.label, qty: c.qty })) } : {}) });
}

// ---- lines ----------------------------------------------------------------------------------------------
export function blankLine(): SvLine {
  return {
    key: newLineKey(), id: "", productId: "", productCode: "", productName: "", itemCategory: "", baseModel: "",
    sizeCode: "", sizeLabel: "", fabricCode: "", quantity: 1, basePriceSen: 0,
    gapInches: null, divanHeightInches: null, legHeightInches: null,
    specialOrder: "", customSpecials: [], notes: "",
    discountSen: 0, divanPriceSen: 0, legPriceSen: 0, specialOrderPriceSen: 0, totalHeightPriceSen: 0,
    scope: FULL_SCOPE(),
  };
}

function customSpecialsOf(v: unknown): CustomSpecial[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try { list = JSON.parse(v); } catch { list = []; }
  }
  return Array.isArray(list)
    ? (list as Raw[]).filter((c) => c && str(c.description)).map((c) => ({ description: str(c.description), surchargeSen: sen(c.surchargeSen) }))
    : [];
}

/** A saved line (GET /api/sales-orders/:id -> items[]). Stored prices are kept so the PUT sends them back. */
export function lineFromServer(raw: Raw, idx: number): SvLine {
  return {
    ...blankLine(),
    key: str(raw.id) || `i${idx}`,
    id: str(raw.id),
    productId: str(raw.productId),
    productCode: str(raw.productCode),
    productName: str(raw.productName),
    itemCategory: str(raw.itemCategory),
    sizeCode: str(raw.sizeCode),
    sizeLabel: str(raw.sizeLabel),
    fabricCode: str(raw.fabricCode),
    quantity: Number(raw.quantity) > 0 ? Math.floor(Number(raw.quantity)) : 1,
    basePriceSen: Math.max(0, sen(raw.basePriceSen)),
    gapInches: numOrNull(raw.gapInches),
    divanHeightInches: numOrNull(raw.divanHeightInches),
    legHeightInches: numOrNull(raw.legHeightInches),
    specialOrder: str(raw.specialOrder),
    customSpecials: customSpecialsOf(raw.customSpecials),
    notes: str(raw.notes),
    discountSen: Math.max(0, sen(raw.discountSen)),
    divanPriceSen: Math.max(0, sen(raw.divanPriceSen)),
    legPriceSen: Math.max(0, sen(raw.legPriceSen)),
    specialOrderPriceSen: sen(raw.specialOrderPriceSen),
    totalHeightPriceSen: Math.max(0, sen(raw.totalHeightPriceSen)),
    scope: scopeFromStored(raw.repairScope ?? raw.repairscope),
  };
}

/** Shape of POST /api/sales-orders/copy-for-service-order -> data (create.tsx CopyDraft). */
export type CopyDraftItem = {
  productId?: string; productCode?: string; productName?: string; itemCategory?: string;
  sizeCode?: string; sizeLabel?: string; fabricCode?: string; quantity: number;
  gapInches?: number | null; divanHeightInches?: number | null; legHeightInches?: number | null;
  specialOrder?: string; notes?: string; customSpecials?: { description: string; surchargeSen: number }[];
};
export type CopyDraft = {
  customerId: string; customerName?: string; hubId: string | null; hubName?: string;
  customerPOId?: string; customerSOId?: string; reference?: string; companySODate?: string; customerDeliveryDate?: string;
  items: CopyDraftItem[]; sourceType: "SO" | "CO"; sourceId: string; sourceNo: string;
};

/** buildLinesFromCopyDraft: every price 0 (a service order is priced by the operator). */
export function linesFromCopyDraft(items: CopyDraftItem[]): SvLine[] {
  return (items || []).map((it) => ({
    ...blankLine(),
    productId: it.productId || "",
    productCode: it.productCode || "",
    productName: it.productName || "",
    itemCategory: it.itemCategory || "BEDFRAME",
    sizeCode: it.sizeCode || "",
    sizeLabel: it.sizeLabel || "",
    fabricCode: it.fabricCode || "",
    quantity: Math.max(1, Math.floor(Number(it.quantity)) || 1),
    gapInches: it.gapInches ?? null,
    divanHeightInches: it.divanHeightInches ?? null,
    legHeightInches: it.legHeightInches ?? null,
    specialOrder: it.specialOrder || "",
    customSpecials: Array.isArray(it.customSpecials) ? it.customSpecials.map((c) => ({ description: c.description, surchargeSen: 0 })) : [],
    notes: it.notes || "",
    prefilled: true,
  }));
}

/** Header fields a copy draft seeds (applyCopyDraftHeader). Blank dates keep what the form already has. */
export function headerFromCopyDraft(base: SvHeader, d: CopyDraft): SvHeader {
  return {
    ...base,
    customerId: d.customerId || "",
    customerName: d.customerName || base.customerName,
    customerPOId: d.customerPOId || "",
    customerSOId: d.customerSOId || "",
    reference: d.reference || "",
    hubId: d.hubId || base.hubId,
    hubName: d.hubId ? d.hubName || "" : base.hubName,
    companySODate: base.companySODate || d.companySODate || "",
    customerDeliveryDate: base.customerDeliveryDate || d.customerDeliveryDate || "",
  };
}

export type CaseAffected = { productId?: string; code?: string; qty?: number | null; components?: ScopePick[] };
export type CaseForSv = {
  id: string; caseNo: string; sourceType: "SO" | "CO" | "EXTERNAL"; sourceId: string;
  affectedProducts?: CaseAffected[]; coveredProductIds?: string[];
};

/**
 * ?fromCase narrowing (create.tsx ~620-670): keep only the lines the case flagged (NEW ones when a previous
 * service order already covers some), set the case qty, and turn damaged-part picks into a CUSTOM scope over the
 * full department chain. No flagged lines / zero overlap -> every source line is kept.
 */
export function linesFromCase(sc: CaseForSv, draftItems: CopyDraftItem[]): { lines: SvLine[]; alreadyCovered: number } {
  const affected = Array.isArray(sc.affectedProducts) ? sc.affectedProducts : [];
  const covered = Array.isArray(sc.coveredProductIds) ? sc.coveredProductIds : [];
  const fresh = affected.filter((ap) => !(ap.productId && covered.includes(ap.productId)));
  const effective = fresh.length > 0 ? fresh : affected;
  const match = (it: CopyDraftItem) => effective.find((ap) => (!!ap.productId && ap.productId === it.productId) || (!!ap.code && ap.code === it.productCode));
  const kept = effective.length > 0 ? draftItems.filter((it) => !!match(it)) : draftItems;
  const base = kept.length > 0 ? kept : draftItems;
  const lines = linesFromCopyDraft(base).map((line, i) => {
    const ap = match(base[i]);
    if (!ap) return line;
    const q = Number(ap.qty);
    const next: SvLine = { ...line, ...(Number.isFinite(q) && q > 0 ? { quantity: Math.floor(q) } : {}) };
    if (Array.isArray(ap.components) && ap.components.length > 0) {
      next.scope = { preset: "CUSTOM", depts: [...ALL_DEPTS], components: ap.components.map((c) => ({ key: c.key, label: c.label, qty: c.qty })) };
    }
    return next;
  });
  return { lines, alreadyCovered: affected.length - effective.length };
}

// ---- totals ------------------------------------------------------------------------------------------------
type PricedLine = Pick<SvLine, "quantity" | "basePriceSen" | "discountSen" | "divanPriceSen" | "legPriceSen" | "totalHeightPriceSen" | "specialOrderPriceSen">;
/** Unit price = base + every stored surcharge: the shared src/lib/pricing.ts sum desktop create / edit use (service-order mode too). */
export const unitPriceSen = (l: PricedLine): number =>
  calculateUnitPrice({ basePriceSen: l.basePriceSen, divanPriceSen: l.divanPriceSen, legPriceSen: l.legPriceSen, totalHeightPriceSen: l.totalHeightPriceSen, specialOrderPriceSen: l.specialOrderPriceSen });
/** Line total = (unit price x qty) - line discount, clamped >= 0 (create.tsx getLineTotal). */
export const lineTotalSen = (l: PricedLine): number =>
  Math.max(0, calculateLineTotal(unitPriceSen(l), l.quantity) - (l.discountSen || 0));

/** Desktop "Subtotal" = sum of the line totals (discounts included); a service order has no combo discount, so Total = Subtotal. */
export function totals(lines: SvLine[]) {
  const qty = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + lineTotalSen(l), 0);
  return { lines: lines.length, qty, subtotalSen: subtotal, totalSen: subtotal };
}

// ---- validation --------------------------------------------------------------------------------------------
/** Why a single line cannot be saved ("" = fine). Mirrors the item editor's own Save. */
export function lineProblem(l: SvLine): string {
  if (!l.productId && !l.productCode) return "Choose a product.";
  if (!(Number.isInteger(l.quantity) && l.quantity >= 1)) return "Quantity must be at least 1.";
  if (l.scope.preset === "CUSTOM" && l.scope.depts.length === 0) return "Pick at least one department for a custom scope.";
  if (l.scope.preset !== "CUSTOM" && l.scope.components.length > 0) return "Damaged components can only be picked on a custom scope.";
  const check = validateRepairScopeInput(scopeToStored(l.scope));
  if (!check.ok) return check.error;
  return "";
}

/** Everything that stops a save, first message first (desktop handleSubmit order). Empty list = ready. */
export function formBlockers(header: Pick<SvHeader, "customerId">, lines: SvLine[]): string[] {
  const out: string[] = [];
  if (!header.customerId) out.push("Choose a customer.");
  if (lines.length === 0) out.push("Add at least one item.");
  lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.productId && !l.productCode) { out.push(`Item ${n}: choose a product.`); return; }
    if (l.itemCategory === "SOFA" && !l.sizeLabel.trim()) out.push(`Item ${n}: choose a seat size.`);
    if (!l.fabricCode.trim()) out.push(`Item ${n}: choose a fabric.`);
    const p = lineProblem(l);
    if (p) out.push(`Item ${n}: ${p}`);
  });
  const cats = lines.map((l) => ({ itemCategory: l.itemCategory }));
  if (hasMixedSofaBedframe(cats)) out.push(SO_MIXED_CATEGORY_ERROR);
  const bad = findInvalidSofaQty(lines.map((l, i) => ({ itemCategory: l.itemCategory, quantity: l.quantity, productCode: l.productCode, lineNo: i + 1 })));
  if (bad) out.push(formatSofaQtyError(bad));
  return out;
}

// ---- request bodies ---------------------------------------------------------------------------------------------
const digits = (v: unknown): string => str(v).replace(/[^\d.]/g, "");

/** One line as POST / PUT /api/sales-orders take it. `options` re-canonicalizes damaged-part picks (see scopeToStored). */
export function lineBody(l: SvLine, options?: readonly ScopePick[] | null): Raw {
  const sofa = l.itemCategory === "SOFA";
  return {
    ...(l.id ? { id: l.id } : {}),
    productId: l.productId,
    productCode: l.productCode.trim(),
    productName: l.productName || l.productCode.trim(),
    itemCategory: l.itemCategory,
    ...(l.baseModel ? { baseModel: l.baseModel } : {}),
    sizeCode: l.sizeCode,
    sizeLabel: l.sizeLabel,
    ...(sofa ? { seatHeight: l.sizeLabel.trim() || digits(l.sizeCode) } : {}),
    fabricCode: l.fabricCode.trim(),
    quantity: l.quantity,
    basePriceSen: Math.max(0, Math.round(l.basePriceSen)),
    gapInches: l.gapInches,
    divanHeightInches: l.divanHeightInches,
    legHeightInches: l.legHeightInches,
    divanPriceSen: l.divanPriceSen,
    legPriceSen: l.legPriceSen,
    totalHeightPriceSen: l.totalHeightPriceSen,
    specialOrder: l.specialOrder.trim(),
    specialOrderPriceSen: l.specialOrderPriceSen,
    customSpecials: l.customSpecials,
    discountSen: l.discountSen || 0,
    notes: l.notes.trim(),
    repairScope: scopeToStored(l.scope, options),
  };
}

/** POST /api/sales-orders — always a DRAFT (the server persists DRAFT; confirm is a separate call). */
export function createBody(header: SvHeader, lines: SvLine[], opts: { caseId?: string | null; options?: Record<string, readonly ScopePick[] | null | undefined> } = {}): Raw {
  return {
    customerId: header.customerId,
    customerPOId: header.customerPOId.trim(),
    customerSOId: header.customerSOId.trim(),
    reference: header.reference.trim(),
    deliveryHubId: header.hubId,
    companySODate: header.companySODate,
    customerDeliveryDate: header.customerDeliveryDate,
    hookkaExpectedDD: header.hookkaExpectedDD,
    notes: header.notes.trim(),
    salesOrgCode: header.salesOrgCode || DEFAULT_COMPANY,
    items: lines.map((l) => lineBody(l, opts.options?.[l.key])),
    status: "DRAFT",
    isServiceOrder: true,
    ...(opts.caseId ? { caseId: opts.caseId } : {}),
  };
}

/**
 * PUT /api/sales-orders/:id. customerId / hubId ride along ONLY for a DRAFT; a confirmed / in-production order's
 * customer and hub change through PATCH …/customer and …/hub (their own locks), so the PUT repeats the stored
 * customer. No overrideToken, ever (the server ignores it).
 */
export function editBody(header: SvHeader, lines: SvLine[], opts: { draft: boolean; options?: Record<string, readonly ScopePick[] | null | undefined>; stored?: Pick<SvHeader, "customerId" | "hubId"> }): Raw {
  // PUT /:id leaves the hub alone when hubId is undefined and clears it for ''. A draft whose customer or hub changed
  // to "no hub" must therefore SEND '' or the old customer's hub survives (sales-orders.ts PUT hub resolution).
  const hubChanged = !!opts.stored && (header.hubId !== opts.stored.hubId || header.customerId !== opts.stored.customerId);
  const hub = !opts.draft ? {} : header.hubId ? { hubId: header.hubId } : hubChanged ? { hubId: "" } : {};
  return {
    customerId: header.customerId,
    ...hub,
    customerPOId: header.customerPOId.trim(),
    customerSOId: header.customerSOId.trim(),
    reference: header.reference.trim(),
    companySODate: header.companySODate,
    customerDeliveryDate: header.customerDeliveryDate,
    hookkaExpectedDD: header.hookkaExpectedDD,
    notes: header.notes.trim(),
    items: lines.map((l) => lineBody(l, opts.options?.[l.key])),
  };
}

export const DEFAULT_COMPANY = "HOOKKA";

/**
 * Desktop "Clone" (sales/detail.tsx handleClone -> create.tsx ?clone=1), reproduced exactly. Carried: customer,
 * delivery dates, notes and each line's product / size / fabric / qty / base, divan, leg and special-order prices /
 * gap, divan, leg heights / special order / notes. NOT carried: customer PO and SO ids (blank), hub, company
 * (HOOKKA default), discount, custom specials, repair scope, total-height price and line ids. The reference reads
 * "Clone of <order no>" and the order date is today.
 */
export function cloneSeedFromDoc(doc: Raw, today: string): { header: SvHeader; lines: SvLine[] } {
  const day = (v: unknown) => str(v).slice(0, 10);
  const header: SvHeader = {
    ...blankHeader(today),
    customerId: str(doc.customerId),
    customerName: str(doc.customerName),
    reference: `Clone of ${str(doc.companySOId) || str(doc.companySO)}`,
    customerDeliveryDate: day(doc.customerDeliveryDate),
    hookkaExpectedDD: day(doc.hookkaExpectedDD),
    notes: str(doc.notes),
  };
  const items = Array.isArray(doc.items) ? (doc.items as Raw[]) : [];
  const lines = items.map((it, i) => {
    const src = lineFromServer(it, i);
    return {
      ...blankLine(),
      productId: src.productId, productCode: src.productCode, productName: src.productName, itemCategory: src.itemCategory,
      baseModel: src.baseModel,
      sizeCode: src.sizeCode, sizeLabel: src.sizeLabel, fabricCode: src.fabricCode, quantity: src.quantity,
      basePriceSen: src.basePriceSen, gapInches: src.gapInches,
      divanHeightInches: src.divanHeightInches, divanPriceSen: src.divanPriceSen,
      legHeightInches: src.legHeightInches, legPriceSen: src.legPriceSen,
      specialOrder: src.specialOrder, specialOrderPriceSen: src.specialOrderPriceSen, notes: src.notes, prefilled: true,
    };
  });
  return { header, lines };
}

/** Company picked for a customer: the customer's default company when it is an active org, else the current pick. */
export function companyForCustomer(defaultCompanyCode: string | null | undefined, activeCodes: readonly string[], current: string): string {
  const mapped = String(defaultCompanyCode ?? "").trim().toUpperCase();
  return mapped && activeCodes.includes(mapped) ? mapped : current;
}

/** Sofa seat sizes: the shared single source (src/lib/sofa-seat-heights.ts) over kv-config variants-config.sofaSizes. */
export const sofaSizeOptions = (cfg: unknown): string[] => sofaSeatHeights({ sofaSizes: cfg });
/** Desktop selectSeatHeight: sizeLabel = the picked value, sizeCode = the same without quotes. */
export const sofaSizePatch = (value: string): Pick<SvLine, "sizeCode" | "sizeLabel"> => ({ sizeLabel: value, sizeCode: value.replace(/"/g, "").trim() });

export function headerFromDoc(doc: Raw): SvHeader {
  const day = (v: unknown) => str(v).slice(0, 10);
  return {
    customerId: str(doc.customerId),
    customerName: str(doc.customerName),
    hubId: str(doc.hubId),
    hubName: str(doc.hubName),
    customerPOId: str(doc.customerPOId) || str(doc.customerPO),
    customerSOId: str(doc.customerSOId) || str(doc.customerSO),
    reference: str(doc.reference),
    companySODate: day(doc.companySODate),
    customerDeliveryDate: day(doc.customerDeliveryDate),
    hookkaExpectedDD: day(doc.hookkaExpectedDD),
    notes: str(doc.notes),
    salesOrgCode: str(doc.salesOrgCode) || str(doc.sales_org_code) || DEFAULT_COMPANY,
  };
}

export function blankHeader(today: string): SvHeader {
  return { customerId: "", customerName: "", hubId: "", hubName: "", customerPOId: "", customerSOId: "", reference: "", companySODate: today, customerDeliveryDate: "", hookkaExpectedDD: "", notes: "", salesOrgCode: DEFAULT_COMPANY };
}

/** Stable text of the editable state, to tell whether anything changed since the form opened. */
export function formSignature(header: SvHeader, lines: SvLine[]): string {
  return JSON.stringify([header, lines.map((l) => ({ ...l, key: "" }))]);
}

// ---- server lock answers ------------------------------------------------------------------------------------------
export type Eligibility = { editable?: boolean; reason?: string; startedDept?: string; jcStatus?: string; status?: string };

/** The text for a locked order (the server's own sentence for production_started). "" when editable. */
export function lockedMessage(e: Eligibility | null | undefined): string {
  if (!e || e.editable !== false) return "";
  if (e.reason === "production_started") {
    return `Cannot edit — ${e.startedDept || "A department"} has started production (job card status: ${e.jcStatus || "in progress"}). Editing items would orphan in-flight work.`;
  }
  return `Cannot edit — a ${String(e.status || "this").replace(/_/g, " ").toLowerCase()} order is read-only. Only draft, confirmed and in-production orders can be edited.`;
}

/** A PUT/POST failure that is the edit lock (403 locked / production_started) -> its text, else "". */
export function lockFromResponse(status: number, body: unknown): string {
  const b = (body ?? {}) as { error?: string; locked?: boolean; reason?: string };
  if (status === 403 && (b.locked === true || b.reason === "production_started")) return b.error || "Editing is locked for this order.";
  return "";
}

/** The "Draft saved; confirmation failed." line + reason shown when create worked but confirm did not. */
export function confirmFailMessage(reason: string): string {
  return reason ? `Draft saved; confirmation failed. ${reason}` : "Draft saved; confirmation failed.";
}

/** What to do after POST /api/sales-orders succeeded. Desktop (create.tsx ~1948) toasts the duplicate PO/SO warning and does NOT confirm. */
export type CreateOutcome =
  | { kind: "open" }                                  // saved, nothing to say: go to the draft
  | { kind: "warn_draft"; text: string }              // saved with a duplicate warning: show it, let the user open the draft
  | { kind: "warn_unconfirmed"; text: string }        // Save & confirm + warning: draft kept, NOT confirmed, no retry
  | { kind: "confirm" };                              // Save & confirm, no warning: POST /confirm next
export function createOutcome(andConfirm: boolean, warning?: string | null): CreateOutcome {
  const text = typeof warning === "string" ? warning.trim() : "";
  if (text) return andConfirm ? { kind: "warn_unconfirmed", text } : { kind: "warn_draft", text };
  return andConfirm ? { kind: "confirm" } : { kind: "open" };
}
export type ResultCard = { title: string; retry: boolean };
/** The result card shown on the form after a save that did not end on the draft screen. */
export function resultCard(kind: "warn_draft" | "warn_unconfirmed" | "confirm_failed"): ResultCard {
  if (kind === "warn_draft") return { title: "Draft saved", retry: false };
  if (kind === "warn_unconfirmed") return { title: "Draft saved; not confirmed", retry: false };
  return { title: "Draft saved; confirmation failed.", retry: true };
}

/** Entry mode from the route query. */
export type SvEntry =
  | { kind: "blank" }
  | { kind: "clone"; svId: string }
  | { kind: "case"; caseId: string }
  | { kind: "copy"; type: "SO" | "CO"; sourceId: string }
  | { kind: "pick"; pick: "so" | "co" | "case" };

export function entryFromQuery(q: URLSearchParams): SvEntry {
  const fromCase = q.get("fromCase") || "";
  if (fromCase) return { kind: "case", caseId: fromCase };
  const clone = q.get("clone") || "";
  if (clone) return { kind: "clone", svId: clone };
  const from = (q.get("from") || "").toLowerCase();
  const sourceId = q.get("sourceId") || "";
  if (from === "so" || from === "co") return sourceId ? { kind: "copy", type: from === "so" ? "SO" : "CO", sourceId } : { kind: "pick", pick: from };
  if (from === "case") return { kind: "pick", pick: "case" };
  return { kind: "blank" };
}
