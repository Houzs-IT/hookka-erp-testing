// ---------------------------------------------------------------------------
// scan-pi — the pure logic of "scan a supplier invoice → draft Purchase Invoice" on mobile.
//
// This is the desktop's CreatePIWizard (src/components/scan-supplier-modal.tsx) taken out of the
// 6,000-line component so the phone can use it and so it can be tested. It follows the desktop rules
// one for one and calls the same shared libs for the matching:
//   · supplier from the printed name: taught alias → exact → normalised → contains → nearest (a clear winner only)
//   · each line resolves to OUR material through the supplier's bindings (five readings, SKU or description,
//     theirs or ours), else by text against the linked PO → this supplier's history → the whole catalogue
//     at a stricter bar (a near-tie resolves to nothing: a blank line beats a wrong stock booking)
//   · every named PO links (an invoice often covers several of our orders); each line is allocated to the
//     PO that owns it; a missing price is filled from that PO's line
//   · STRICT PICK: no line may be saved unbound to a catalogue item
//   · tax: per-line SST if any line has one, else the footer tax spread pro-rata (last line absorbs drift)
//   · the invoice discount is spread over the lines pro-rata
//   · the body is POST /api/purchase-invoices with status DRAFT — never confirmed
// Nothing here talks to the network. The sheet owns fetch / queue / attachment calls.
// ---------------------------------------------------------------------------
import {
  buildCandidateTiers, indexByCode, materialsEverBought, normKey, resolveMaterialForLine, sameSupplierCode, supplierCodeOf, supplierSkuIndex,
  MIN_SKU_SUFFIX_MATCH, type BindingLike, type CandidateTier, type MaterialLike, type PoLike as CandPo,
} from "../../../lib/supplier-material-candidates";
import { allocateLinesToPos, headerPoId, type AllocPo } from "../../../lib/po-line-allocate";
import { resolvePoLink, splitPoRefs } from "../../../lib/po-ref-match";
import { allocateDiscountSen, lineTotalSen, roundUnitPriceSen } from "../../../lib/unit-price";
import { bestMatch } from "../../../lib/party-fuzzy-match";
import { resolveAlias } from "../../../lib/party-alias-client";

// ---- inputs (what the screens load) ---------------------------------------------------------------
export type PiSupplier = { id: string; name: string; code: string; purchaseOrgCode?: string | null };
export type PiMaterial = MaterialLike & { itemCode: string; description?: string | null };
export type PiBinding = BindingLike & { supplierDescription?: string | null };
export type PiPoItem = { id: string; materialCode?: string | null; materialName?: string | null; supplierSKU?: string | null; quantity?: number | null; receivedQty?: number | null; unitPriceSen?: number | null };
export type PiPo = CandPo & AllocPo & { id: string; poNo?: string | null; supplierId?: string | null; status?: string | null; items?: PiPoItem[] | null };
export type PiOrg = { code: string; name: string; isActive?: boolean };

export type PiContext = {
  suppliers: PiSupplier[];
  materials: PiMaterial[];
  bindings: PiBinding[];
  purchaseOrders: PiPo[];
  orgs: PiOrg[];
  /** Taught aliases: normalised OCR name → supplierId. */
  aliases: Record<string, string>;
};

/** One doc of a queue row's rawJson.docs[] (scan-engine SupplierDoc). */
export type SupplierDoc = {
  supplierName?: string | null;
  docType?: string | null;
  docNo?: string | null;
  deliveryOrderNo?: string | null;
  docDate?: string | null;
  currency?: string | null;
  customerPoRef?: string | null;
  lines?: {
    supplierCode?: string | null; description?: string | null; qty?: number | null; uom?: string | null; unitPrice?: number | null;
    amount?: number | null; tax?: number | null; discount?: number | null; density?: string | null; thickness?: string | null;
  }[] | null;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  discount?: number | null;
};

/** The documents of one finished queue row, each with its own index for /consume (docs[] or a legacy single doc). */
export function docsOfRow(rawJson: unknown): { doc: SupplierDoc; docIdx: number }[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const docs = (rawJson as { docs?: unknown }).docs;
  const list = Array.isArray(docs) ? docs : [rawJson];
  return list
    .map((doc, docIdx) => ({ doc: doc as SupplierDoc, docIdx }))
    .filter(({ doc }) => !!doc && typeof doc === "object" && Array.isArray(doc.lines) && doc.lines.length > 0);
}

// ---- the card ------------------------------------------------------------------------------------------
export type PiCardLine = {
  key: string;
  materialCode: string;
  materialName: string;
  supplierSku: string;
  description: string;
  uom: string;
  /** Editable numbers are strings so the keyboard can type them. */
  qty: string;
  unitPriceRm: string;
  taxRm: string;
  poId: string | null;
  autoMatched: boolean;
  matchTier: CandidateTier | null;
  matchVia: "sku" | "code" | "text" | null;
};

export type PiCard = {
  supplierId: string;
  /** What the document says (display only). */
  supplierDocName: string;
  purchaseOrgCode: string;
  purchaseOrderIds: string[];
  /** Refs the document named that matched no order. */
  unmatchedPoRefs: string[];
  multiPoRefs: string[];
  invoiceDate: string;
  supplierInvoiceNo: string;
  supplierDoNo: string;
  discountRm: string;
  docType: string;
  currency: string;
  /** Printed footer figures, for the reconciliation line. */
  docTotalRm: number | null;
  docTaxRm: number | null;
  lines: PiCardLine[];
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const normSku = (s: string | null | undefined): string => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normDesc = normSku;
const rmStr = (n: number): string => (n === 0 ? "" : String(n));

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Mirrors futureInvoiceDate() in src/api/routes/purchase-invoices.ts: a 36-hour tolerance for the UTC / MYT gap. */
export function isFutureInvoiceDate(date: string | null | undefined, now = Date.now()): boolean {
  const d = (date ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d > new Date(now + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---- supplier from the printed name --------------------------------------------------------------------
export function pickSupplierFromName(rawName: string | null | undefined, suppliers: PiSupplier[], aliasMap?: Record<string, string> | null): PiSupplier | null {
  const guess = (rawName ?? "").trim();
  if (!guess) return null;
  const taughtId = resolveAlias(aliasMap, guess);
  if (taughtId) {
    const taught = suppliers.find((s) => s.id === taughtId);
    if (taught) return taught;
  }
  const up = guess.toUpperCase();
  const exact = suppliers.filter((s) => s.name.trim().toUpperCase() === up || s.code.trim().toUpperCase() === up);
  if (exact.length === 1) return exact[0];
  const norm = (s: string) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const g = norm(guess);
  if (!g) return null;
  const eq = suppliers.filter((s) => norm(s.name) === g);
  if (eq.length === 1) return eq[0];
  const containing = suppliers.filter((s) => {
    const n = norm(s.name);
    return !!n && (n.endsWith(g) || g.endsWith(n) || n.startsWith(g) || g.startsWith(n));
  });
  if (containing.length === 1) return containing[0];
  return bestMatch(suppliers, guess)?.party ?? null;
}

// ---- bindings: the two-way link between the supplier's code and ours ----------------------------------
export function makeBindingResolver(bindings: PiBinding[]) {
  const bySku = new Map<string, PiBinding>();
  const byDesc = new Map<string, PiBinding>();
  const byMaterial = new Map<string, PiBinding>();
  for (const b of bindings) {
    if (!b.supplierId) continue;
    const sk = normSku(b.supplierSku);
    if (sk) bySku.set(`${b.supplierId}__${sk}`, b);
    const dk = normDesc(b.supplierDescription);
    if (dk && !byDesc.has(`${b.supplierId}__${dk}`)) byDesc.set(`${b.supplierId}__${dk}`, b);
    const mk = (b.materialCode || "").trim().toUpperCase();
    if (mk) byMaterial.set(`${b.supplierId}__${mk}`, b);
  }
  const forSku = (supplierId: string, supplierSku: string): PiBinding | null => {
    const sku = normSku(supplierSku);
    if (!sku || !supplierId) return null;
    const exact = bySku.get(`${supplierId}__${sku}`);
    if (exact) return exact;
    // Same code, different zero-padding (NICCA-6-FOG vs NICCA-06-FOG).
    const padded = bindings.find((b) => b.supplierId === supplierId && sameSupplierCode(b.supplierSku, supplierSku));
    if (padded) return padded;
    // Vendor-prefixed SKUs ("OST- SL 27" vs "SL.27"): suffix match, but only on keys long enough to identify anything.
    for (const b of bindings) {
      if (b.supplierId !== supplierId) continue;
      const bs = normSku(b.supplierSku);
      if (!bs || sku.length < MIN_SKU_SUFFIX_MATCH || bs.length < MIN_SKU_SUFFIX_MATCH) continue;
      if (bs.endsWith(sku) || sku.endsWith(bs)) return b;
    }
    return null;
  };
  const forMaterial = (supplierId: string, materialCode: string): PiBinding | null => {
    const code = (materialCode || "").trim().toUpperCase();
    return code && supplierId ? byMaterial.get(`${supplierId}__${code}`) ?? null : null;
  };
  const forDescription = (supplierId: string, description: string): PiBinding | null => {
    const d = normDesc(description);
    if (!d || !supplierId) return null;
    const exact = byDesc.get(`${supplierId}__${d}`);
    if (exact) return exact;
    // A containment match, but ONLY when exactly one binding qualifies — two candidates means we cannot tell.
    const hits = bindings.filter((b) => {
      if (b.supplierId !== supplierId) return false;
      const bd = normDesc(b.supplierDescription);
      return !!bd && (bd === d || bd.includes(d) || d.includes(bd));
    });
    return hits.length === 1 ? hits[0] : null;
  };
  /** The five readings that can identify a line, most specific first. */
  const anyWay = (supplierId: string, rawSku: string, description: string): PiBinding | null => {
    if (!supplierId) return null;
    return (
      (rawSku ? forSku(supplierId, rawSku) : null) ??
      (rawSku ? forMaterial(supplierId, rawSku) : null) ??
      (description ? forDescription(supplierId, description) : null) ??
      (description ? forMaterial(supplierId, description) : null) ??
      (description ? forSku(supplierId, description) : null)
    );
  };
  return { forSku, forMaterial, forDescription, anyWay };
}

const materialMap = (materials: PiMaterial[]): Map<string, PiMaterial> => {
  const m = new Map<string, PiMaterial>();
  for (const r of materials) m.set(r.itemCode.trim().toUpperCase(), r);
  return m;
};

// ---- a card from a scanned document -------------------------------------------------------------------------
export function applyPoPriceFill(lines: PiCardLine[], po: PiPo | null | undefined): PiCardLine[] {
  if (!po || !Array.isArray(po.items) || po.items.length === 0) return lines;
  const byCode = new Map<string, PiPoItem>();
  const byName = new Map<string, PiPoItem>();
  for (const it of po.items) {
    const c = (it.materialCode ?? "").trim().toUpperCase();
    if (c) byCode.set(c, it);
    const n = (it.materialName ?? "").trim().toUpperCase();
    if (n) byName.set(n, it);
  }
  return lines.map((l) => {
    if (num(l.unitPriceRm) > 0) return l;
    const hit = (l.materialCode.trim() ? byCode.get(l.materialCode.trim().toUpperCase()) : undefined) ?? (l.materialName.trim() ? byName.get(l.materialName.trim().toUpperCase()) : undefined);
    const priceRm = hit ? num(hit.unitPriceSen) / 100 : 0;
    return priceRm > 0 ? { ...l, unitPriceRm: String(priceRm) } : l;
  });
}

const posById = (ctx: PiContext, ids: string[]): PiPo[] => ids.map((id) => ctx.purchaseOrders.find((p) => p.id === id) ?? null).filter((p): p is PiPo => p !== null);

/** Allocate every line to the order that owns it, then price any blank line from its own order. */
export function relinkToPos(card: PiCard, poIds: string[], ctx: PiContext): PiCard {
  const pos = posById(ctx, poIds);
  const allocations = allocateLinesToPos(card.lines, pos);
  const lines = card.lines.map((l, i) => ({ ...l, poId: allocations[i]?.poId ?? null }));
  const byId = new Map(pos.map((p) => [p.id, p]));
  return { ...card, purchaseOrderIds: poIds, lines: lines.map((l) => applyPoPriceFill([l], byId.get(l.poId ?? "") ?? null)[0]) };
}

export function buildPiCard(ex: SupplierDoc, ctx: PiContext, opts: { defaultSupplierId?: string | null; today?: string } = {}): PiCard {
  const matched = pickSupplierFromName(ex.supplierName, ctx.suppliers, ctx.aliases);
  const sId = matched?.id ?? opts.defaultSupplierId ?? "";
  const sup = ctx.suppliers.find((s) => s.id === sId) ?? null;
  const activeOrgs = ctx.orgs.filter((o) => o.isActive !== false);
  const orgCode = sup?.purchaseOrgCode || activeOrgs[0]?.code || "HOOKKA";

  // A document can carry both numbers: docNo routes by type, an explicit D/O ref fills the DO field either way.
  const dt = (ex.docType ?? "").toUpperCase();
  const docNo = (ex.docNo ?? "").trim();
  let supInvNo = "";
  let supDoNo = "";
  if (docNo) {
    if (dt === "DELIVERY_NOTE") supDoNo = docNo;
    else supInvNo = docNo;
  }
  if (!supDoNo && (ex.deliveryOrderNo ?? "").trim()) supDoNo = (ex.deliveryOrderNo ?? "").trim();
  const invoiceDate = ex.docDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.docDate) ? ex.docDate : opts.today ?? todayIso();

  // The orders we wrote are the best statement of what this document covers: resolve them BEFORE the lines.
  const link = resolvePoLink(ex.customerPoRef, ctx.purchaseOrders, null);
  const namedPoIds = link.matchedPoIds.length > 0 ? link.matchedPoIds : link.poId ? [link.poId] : [];
  const linkedPos = posById(ctx, namedPoIds);
  const materialIdx = indexByCode(ctx.materials);
  const byCode = materialMap(ctx.materials);
  const tiers = buildCandidateTiers({ supplierId: sId, linkedPo: linkedPos, purchaseOrders: ctx.purchaseOrders, bindings: ctx.bindings, materialByCode: materialIdx, catalog: ctx.materials });
  const skuIndex = supplierSkuIndex(sId, ctx.purchaseOrders, ctx.bindings, materialIdx);
  const resolver = makeBindingResolver(ctx.bindings);

  const lines: PiCardLine[] = (ex.lines ?? []).map((ln, i) => {
    // A "code" that is only the line number is not a code (supplierCodeOf).
    const rawSku = supplierCodeOf(ln.supplierCode);
    const binding = sId ? resolver.anyWay(sId, rawSku, (ln.description ?? "").trim()) : null;
    let rm = binding ? byCode.get(binding.materialCode.trim().toUpperCase()) ?? null : null;
    let autoMatched = false;
    let matchTier: CandidateTier | null = null;
    let matchVia: "sku" | "code" | "text" | null = null;
    if (!binding && !rm) {
      const hit = resolveMaterialForLine(`${rawSku} ${ln.description ?? ""}`.trim(), tiers, { supplierSku: rawSku, skuIndex });
      if (hit) { rm = hit.item as PiMaterial; autoMatched = true; matchTier = hit.tier; matchVia = hit.via; }
    }
    // The supplier's own code for whatever we ended up with, from this supplier's bindings.
    const resolved = binding ?? (sId && rm ? resolver.forMaterial(sId, rm.itemCode) : null);
    const qty = num(ln.qty);
    const unit = ln.unitPrice == null ? 0 : num(ln.unitPrice);
    const spec = [ln.density, ln.thickness].map((x) => (x ?? "").toString().trim()).filter(Boolean).join(" ");
    const base = ln.description ?? "";
    const desc = spec && !base.toUpperCase().includes(spec.toUpperCase()) ? `${base}${base ? " " : ""}(${spec})`.trim() : base;
    return {
      key: `l${i}`,
      materialCode: rm?.itemCode ?? binding?.materialCode ?? "",
      materialName: rm?.description ?? desc,
      supplierSku: resolved?.supplierSku ?? rawSku,
      description: desc,
      uom: ln.uom ?? "",
      qty: String(qty > 0 ? qty : 1),
      unitPriceRm: rmStr(unit),
      taxRm: rmStr(ln.tax == null ? 0 : num(ln.tax)),
      poId: null,
      autoMatched,
      matchTier,
      matchVia,
    };
  });

  const allocations = allocateLinesToPos(lines, linkedPos);
  const allocated = lines.map((l, i) => ({ ...l, poId: allocations[i]?.poId ?? null }));
  const byId = new Map(linkedPos.map((p) => [p.id, p]));
  const filled = allocated.map((l) => applyPoPriceFill([l], byId.get(l.poId ?? "") ?? null)[0]);

  return {
    supplierId: sId,
    supplierDocName: str(ex.supplierName),
    purchaseOrgCode: orgCode,
    purchaseOrderIds: namedPoIds,
    unmatchedPoRefs: link.unmatchedRefs,
    multiPoRefs: namedPoIds.length > 1 ? splitPoRefs((ex.customerPoRef ?? "").trim()) : [],
    invoiceDate,
    supplierInvoiceNo: supInvNo,
    supplierDoNo: supDoNo,
    // One invoice discount: the footer "Less: Discount" plus any per-line discount the OCR read.
    discountRm: rmStr(Math.max(0, num(ex.discount)) + (ex.lines ?? []).reduce((s, l) => s + Math.max(0, num(l.discount)), 0)),
    docType: str(ex.docType),
    currency: str(ex.currency),
    docTotalRm: ex.total == null ? null : num(ex.total),
    docTaxRm: ex.tax == null ? null : num(ex.tax),
    lines: filled,
  };
}

/** Changing the supplier re-resolves the lines against that supplier's bindings (hand-bound lines keep theirs). */
export function changeSupplier(card: PiCard, supplierId: string, ctx: PiContext): PiCard {
  const sup = ctx.suppliers.find((s) => s.id === supplierId) ?? null;
  const activeOrgs = ctx.orgs.filter((o) => o.isActive !== false);
  const resolver = makeBindingResolver(ctx.bindings);
  const byCode = materialMap(ctx.materials);
  return {
    ...card,
    supplierId,
    purchaseOrgCode: sup?.purchaseOrgCode || card.purchaseOrgCode || activeOrgs[0]?.code || "HOOKKA",
    lines: card.lines.map((l) => {
      const b = resolver.forSku(supplierId, l.supplierSku);
      if (!b) return l;
      const rm = byCode.get(b.materialCode.trim().toUpperCase());
      return { ...l, materialCode: rm?.itemCode ?? b.materialCode, materialName: l.materialName.trim() ? l.materialName : rm?.description ?? l.materialName, autoMatched: false, matchTier: null, matchVia: null };
    }),
  };
}

/** The operator picks the internal code: it fills our name and, if this supplier has a binding, their code. */
export function pickMaterial(card: PiCard, lineKey: string, materialCode: string, ctx: PiContext): PiCard {
  const rm = materialMap(ctx.materials).get(materialCode.trim().toUpperCase()) ?? null;
  const binding = makeBindingResolver(ctx.bindings).forMaterial(card.supplierId, materialCode);
  return {
    ...card,
    lines: card.lines.map((l) =>
      l.key !== lineKey ? l : {
        ...l,
        materialCode: rm?.itemCode ?? materialCode,
        materialName: rm?.description ?? l.materialName,
        supplierSku: binding?.supplierSku ?? l.supplierSku,
        // A hand pick is a decision, not a guess.
        autoMatched: false, matchTier: null, matchVia: null,
      },
    ),
  };
}

/** Picker rows: what this supplier has delivered first, then the rest of the catalogue labelled as unfamiliar. */
export function materialOptions(supplierId: string, ctx: PiContext): { itemCode: string; description: string; known: boolean }[] {
  const idx = indexByCode(ctx.materials);
  const known = materialsEverBought(supplierId, ctx.purchaseOrders, ctx.bindings, idx);
  const keys = new Set(known.map((m) => normKey(m.itemCode)));
  return [
    ...known.map((m) => ({ itemCode: m.itemCode, description: str(m.description), known: true })),
    ...ctx.materials.filter((m) => !keys.has(normKey(m.itemCode))).map((m) => ({ itemCode: m.itemCode, description: str(m.description), known: false })),
  ];
}

// ---- hints ---------------------------------------------------------------------------------------------------------
export function matchTierHint(tier: CandidateTier | null | undefined, via?: "sku" | "code" | "text" | null): string {
  if (via === "code") return "Matched on the supplier's code — check the code before creating.";
  switch (tier) {
    case "po": return "Matched to a line on the linked PO — confirm the quantity.";
    case "supplier": return "Matched from what this supplier has delivered before — check the code.";
    case "catalog": return "Matched from the document text alone — no history with this supplier yet, so check the code before creating.";
    default: return "Matched from the document text — check the code.";
  }
}

/** How much of this material the linked PO has on order (the early warning; the API keeps the exact over-billing check). */
export function poOrderedFor(line: { materialCode: string; poId: string | null }, purchaseOrders: PiPo[]): { poNo: string; ordered: number } | null {
  const code = normKey(line.materialCode);
  if (!code || !line.poId) return null;
  const po = purchaseOrders.find((p) => p.id === line.poId);
  if (!po || !Array.isArray(po.items)) return null;
  let ordered = 0;
  let found = false;
  for (const it of po.items) {
    if (normKey(it.materialCode ?? "") !== code) continue;
    ordered += num(it.quantity);
    found = true;
  }
  return found ? { poNo: str(po.poNo), ordered } : null;
}

// ---- money -----------------------------------------------------------------------------------------------------------
const grossSen = (l: PiCardLine): number => lineTotalSen(num(l.qty), roundUnitPriceSen(num(l.unitPriceRm) * 100));
const discountSplit = (card: PiCard): number[] => allocateDiscountSen(card.lines.map(grossSen), Math.round(num(card.discountRm) * 100));

/** Per-line SST if the operator set any; else the footer tax spread pro-rata by net amount (the last line absorbs rounding). */
export function lineTaxesSen(card: PiCard): number[] {
  const disc = discountSplit(card);
  const net = card.lines.map((l, i) => grossSen(l) - disc[i]);
  if (card.lines.some((l) => num(l.taxRm) > 0)) return card.lines.map((l) => Math.max(0, Math.round(num(l.taxRm) * 100)));
  const footer = Math.max(0, Math.round((card.docTaxRm ?? 0) * 100));
  const sub = net.reduce((s, v) => s + v, 0);
  if (footer <= 0 || sub <= 0) return card.lines.map(() => 0);
  let allocated = 0;
  return net.map((n, i) => {
    if (i === net.length - 1) return Math.max(0, footer - allocated);
    const t = Math.round((footer * n) / sub);
    allocated += t;
    return t;
  });
}

export function cardTotals(card: PiCard): { subtotalSen: number; discountSen: number; taxSen: number; totalSen: number } {
  const disc = discountSplit(card);
  const tax = lineTaxesSen(card);
  const subtotalSen = card.lines.reduce((s, l) => s + grossSen(l), 0);
  const discountSen = disc.reduce((s, v) => s + v, 0);
  const taxSen = tax.reduce((s, v) => s + v, 0);
  return { subtotalSen, discountSen, taxSen, totalSen: subtotalSen - discountSen + taxSen };
}

// ---- gates and the request ------------------------------------------------------------------------------------------
/** What stops "Create": the same rules as the desktop wizard and the server. */
export function piBlockers(card: PiCard, ctx: PiContext, now = Date.now()): string[] {
  const out: string[] = [];
  if (!card.supplierId || !ctx.suppliers.some((s) => s.id === card.supplierId)) out.push("Choose the supplier.");
  const valid = card.lines.filter((l) => (l.materialName || l.description).trim() !== "");
  if (valid.length === 0) out.push("Add at least one line.");
  const unbound = valid.filter((l) => !l.materialCode.trim());
  if (unbound.length > 0) out.push(`${unbound.length} line${unbound.length === 1 ? "" : "s"} not matched to a catalogue item — pick the internal code.`);
  if (isFutureInvoiceDate(card.invoiceDate, now)) out.push(`Invoice date ${card.invoiceDate} is in the future — check the supplier's invoice.`);
  return out;
}

export function piDraftBody(card: PiCard, ctx: PiContext, fileName: string, sourceDocumentFileId: string | null) {
  const sup = ctx.suppliers.find((s) => s.id === card.supplierId);
  const keep = card.lines.map((l, i) => ({ l, i })).filter(({ l }) => (l.materialName || l.description).trim() !== "");
  const kept = { ...card, lines: keep.map(({ l }) => l) };
  const disc = discountSplit(kept);
  const tax = lineTaxesSen(kept);
  const body: Record<string, unknown> = {
    supplierId: card.supplierId,
    supplierName: sup?.name ?? "",
    invoiceDate: card.invoiceDate,
    remarks: `Scanned: ${fileName}`,
    status: "DRAFT",
    purchaseOrgCode: card.purchaseOrgCode,
    supplierInvoiceNo: card.supplierInvoiceNo.trim() || null,
    supplierDoNo: card.supplierDoNo.trim() || null,
    items: kept.lines.map((l, i) => ({
      materialCode: l.materialCode.trim() || null,
      materialName: (l.materialName || l.description).trim(),
      supplierSku: l.supplierSku.trim() || null,
      qty: num(l.qty),
      // A RATE, not an amount: keep the sub-cent digits (RM 0.055 must not become RM 0.06).
      unitPriceSen: roundUnitPriceSen(num(l.unitPriceRm) * 100),
      taxSen: tax[i],
      discountSen: disc[i],
      lineType: "STOCKED",
      grnItemId: null,
      // Which of our orders this line bills (the server's per-PO over-invoicing ceiling reads it).
      poId: l.poId ?? null,
      // The catalogue tier is the scanner reading text with nothing to corroborate it: it may fill the field, it may not teach a binding.
      unverifiedMatch: l.autoMatched === true && l.matchTier === "catalog",
    })),
  };
  if (card.purchaseOrderIds.length > 0) {
    const ids = [...new Set(kept.lines.map((l) => l.poId).filter((v): v is string => !!v))];
    body.purchaseOrderId = headerPoId(kept.lines.map((l) => (l.poId ? { poId: l.poId, poItemId: "", poItemIndex: 0, outstanding: true } : null)), card.purchaseOrderIds) ?? ids[0] ?? card.purchaseOrderIds[0];
  }
  if (sourceDocumentFileId) body.sourceDocumentFileId = sourceDocumentFileId;
  return body;
}

/** The OCR-accuracy report: what the operator finally imported, in the extraction's own shape. */
export function correctedExtraction(card: PiCard, original: SupplierDoc): SupplierDoc {
  return {
    supplierName: original.supplierName ?? null,
    docType: original.docType ?? null,
    docNo: card.supplierInvoiceNo.trim() || card.supplierDoNo.trim() || original.docNo || null,
    docDate: card.invoiceDate || original.docDate || null,
    currency: original.currency ?? null,
    lines: card.lines.map((l) => ({
      supplierCode: l.supplierSku || null,
      description: (l.materialName || l.description) || null,
      qty: num(l.qty) || null,
      uom: l.uom || null,
      unitPrice: num(l.unitPriceRm) || null,
      amount: num(l.qty) * num(l.unitPriceRm) || null,
    })),
    subtotal: original.subtotal ?? null,
    tax: original.tax ?? null,
    total: original.total ?? null,
    discount: num(card.discountRm) || null,
  };
}

/** A blank line the operator can fill in. */
export function blankLine(key: string): PiCardLine {
  return { key, materialCode: "", materialName: "", supplierSku: "", description: "", uom: "", qty: "1", unitPriceRm: "", taxRm: "", poId: null, autoMatched: false, matchTier: null, matchVia: null };
}

// ---- what the screens load -> the context -----------------------------------------------------------------------
type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

/** Raw API rows (suppliers, organisations, raw materials, supplier-material bindings, purchase orders) as a PiContext. */
export function piContextFrom(raw: { suppliers?: unknown; orgs?: unknown; materials?: unknown; bindings?: unknown; purchaseOrders?: unknown }, aliases: Record<string, string> = {}): PiContext {
  return {
    suppliers: arr(raw.suppliers)
      .filter((r) => !r.status || str(r.status) === "ACTIVE")
      .map((r) => ({ id: str(r.id), name: str(r.name), code: str(r.code), purchaseOrgCode: r.purchaseOrgCode ? str(r.purchaseOrgCode) : null })),
    orgs: arr(raw.orgs).map((r) => ({ code: str(r.code), name: str(r.name), isActive: r.isActive !== false })),
    materials: arr(raw.materials).filter((r) => r.isActive !== false).map((r) => ({ itemCode: str(r.itemCode), description: str(r.description) })),
    bindings: arr(raw.bindings).map((r) => ({ supplierId: str(r.supplierId), materialCode: str(r.materialCode), supplierSku: r.supplierSku == null ? null : str(r.supplierSku), supplierDescription: r.supplierDescription == null ? null : str(r.supplierDescription) })),
    purchaseOrders: arr(raw.purchaseOrders).map((r) => ({
      id: str(r.id), poNo: str(r.poNo), supplierId: str(r.supplierId), status: str(r.status),
      items: arr(r.items).map((it) => ({ id: str(it.id), materialCode: it.materialCode == null ? null : str(it.materialCode), materialName: it.materialName == null ? null : str(it.materialName), supplierSKU: it.supplierSKU == null ? null : str(it.supplierSKU), quantity: num(it.quantity), receivedQty: num(it.receivedQty), unitPriceSen: num(it.unitPriceSen) })),
    })),
    aliases,
  };
}

/** Orders this supplier's invoice may bill: not cancelled, draft or closed (the desktop picker's rule). */
export function openPosFor(supplierId: string, ctx: PiContext): PiPo[] {
  return ctx.purchaseOrders.filter((p) => !["CANCELLED", "DRAFT", "CLOSED"].includes(str(p.status)) && (!supplierId || str(p.supplierId) === supplierId));
}
