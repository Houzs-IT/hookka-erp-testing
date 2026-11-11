// ---------------------------------------------------------------------------
// scan-so — pure logic of the mobile "Scan customer PO → draft Sales Order" flow.
//
// The OCR rows come off the existing scan queue (rawJson.pos[]), in the SAME shape the
// desktop ScanPOModal reads (server ExtractedPO / ExtractedItem). This file turns one
// of those POs into an editable review draft and then into the POST /api/sales-orders
// body, following src/components/scan-po-modal.tsx field for field:
//
//   · category → itemCategory (the old mobile prefill read `itemCategory`, which the
//     server never sends, so every scanned line became a bedframe)
//   · unit price is RM on the document; the API wants integer sen (RM x 100, rounded)
//   · sofa seat height rides on sizeLabel AND seatHeight; a bedframe's size is left
//     empty so the server resolves it from the product master
//   · specialOrder tokens that are not in the catalog's Specials list are dropped (the
//     desktop does this silently; here the dropped words are reported)
//
// Nothing here talks to the network. The sheet owns fetch / queue / attachment calls.
// ---------------------------------------------------------------------------
import { resolveScanParty, type CatalogCustomer } from "../../../lib/scan-party-resolve";
import { SO_MIXED_CATEGORY_ERROR, findInvalidSofaQty, formatSofaQtyError, hasMixedSofaBedframe } from "../../../lib/so-category";

export type ScanCategory = "BEDFRAME" | "SOFA" | "ACCESSORY";
export const SCAN_CATEGORIES: readonly ScanCategory[] = ["BEDFRAME", "SOFA", "ACCESSORY"];

/** One line as the server returns it (scan-po.ts ExtractedItem). */
export type RawScanItem = {
  category?: string | null;
  productCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  sizeLabel?: string | null;
  fabricCode?: string | null;
  divanHeightInches?: number | null;
  legHeightInches?: number | null;
  gapInches?: number | null;
  noLeg?: boolean | null;
  specialOrder?: string | null;
  specialNotes?: string | null;
  unitPrice?: number | null;
  transferredSO?: string | null;
  customSpecials?: { description: string; surchargeSen: number }[] | null;
};

/** One PO as the server returns it (scan-po.ts ExtractedPO). */
export type RawScanPo = {
  customerPO?: string | null;
  customerName?: string | null;
  customerCode?: string | null;
  customerId?: string | null;
  customerState?: string | null;
  deliveryHub?: string | null;
  deliveryHubId?: string | null;
  yourRefNo?: string | null;
  customerSO?: string | null;
  deliveryDate?: string | null;
  isUrgent?: boolean | null;
  pageNumbers?: number[] | null;
  items?: RawScanItem[] | null;
};

/** GET /api/scan-po/catalog (the pieces the review needs). */
export type ScanCustomer = CatalogCustomer & { code?: string };
export type ScanCatalog = {
  customers: ScanCustomer[];
  bedframes: string[];
  sofas: string[];
  accessories: string[];
  fabrics: string[];
  bedframeSpecials: string[];
  sofaSpecials: string[];
};

export type ReviewItem = {
  key: string;
  category: ScanCategory | "";
  productCode: string;
  fabricCode: string;
  qty: string;
  priceRm: string;
  /** Sofa seat height, inches (digits). */
  seatHeight: string;
  divan: string;
  leg: string;
  noLeg: boolean;
  gap: string;
  specialOrder: string;
  notes: string;
  /** Kept as read so nothing the scan found is lost on the way to the API. */
  transferredSO: string | null;
  customSpecials: { description: string; surchargeSen: number }[];
  /** Present only when the line was loaded from a SAVED order (edit). See lib/so-edit.ts. */
  edit?: EditExtra;
};

/**
 * What an edit of a saved line must carry through untouched. The server replaces ALL of an order's
 * lines on save (DELETE + INSERT), so anything not sent is lost; and it trusts every price field it
 * is given while re-deriving only the ones it is NOT given — so `orig` records what was loaded to tell
 * "the operator changed this" from "this is just what was there".
 */
export type EditExtra = {
  id: string;
  productId: string;
  productName: string;
  sizeCode: string;
  sizeLabel: string;
  legPriceRm: string;
  divanPriceRm: string;
  specialPriceRm: string;
  discountRm: string;
  repairScope: unknown;
  orig: {
    productCode: string;
    gap: number | null;
    divan: number | null;
    leg: number | null;
    specialOrder: string;
    seatHeight: string;
    basePriceSen: number;
    legPriceSen: number;
    divanPriceSen: number;
    specialOrderPriceSen: number;
    totalHeightPriceSen: number;
  };
};

export type ReviewDraft = {
  customerId: string;
  /** What the document says; display only. */
  customerName: string;
  hubId: string;
  customerPO: string;
  reference: string;
  customerSO: string;
  /** YYYY-MM-DD or "". */
  deliveryDate: string;
  isUrgent: boolean;
  items: ReviewItem[];
};

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const numStr = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n !== 0 ? String(n) : "";
};

/** RM (as typed or read) → integer sen. Anything blank, negative or not a number is 0. */
export function rmToSen(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function senToRm(sen: number): string {
  return (sen / 100).toFixed(2);
}

export function normCategory(v: unknown): ScanCategory | "" {
  const c = str(v).toUpperCase();
  return (SCAN_CATEGORIES as readonly string[]).includes(c) ? (c as ScanCategory) : "";
}

const positiveNum = (v: string): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const isoDay = (v: unknown): string => {
  const d = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
};

export function reviewItemFromRaw(raw: RawScanItem, idx: number): ReviewItem {
  const category = normCategory(raw.category);
  const sofaSeat = category === "SOFA" && raw.sizeLabel ? String(raw.sizeLabel).replace(/[^\d.]/g, "") : "";
  return {
    key: `i${idx}`,
    category,
    productCode: str(raw.productCode),
    fabricCode: str(raw.fabricCode),
    qty: numStr(raw.quantity),
    priceRm: raw.unitPrice != null && raw.unitPrice > 0 ? String(raw.unitPrice) : "",
    seatHeight: sofaSeat,
    divan: numStr(raw.divanHeightInches),
    leg: numStr(raw.legHeightInches),
    noLeg: raw.noLeg === true,
    gap: numStr(raw.gapInches),
    specialOrder: str(raw.specialOrder),
    notes: str(raw.specialNotes),
    transferredSO: raw.transferredSO ? String(raw.transferredSO) : null,
    customSpecials: Array.isArray(raw.customSpecials) ? raw.customSpecials.filter((c) => c && str(c.description)) : [],
  };
}

/** Customer and hub are resolved by the SAME function the desktop modal renders from. */
export function draftFromPo(
  po: RawScanPo,
  catalog: Pick<ScanCatalog, "customers"> | null,
  aliases?: Record<string, string> | null,
): ReviewDraft {
  const party = resolveScanParty(catalog?.customers, po, aliases);
  return {
    customerId: party.customerId ?? "",
    customerName: str(po.customerName),
    hubId: party.hubId ?? "",
    customerPO: str(po.customerPO),
    reference: str(po.yourRefNo),
    customerSO: str(po.customerSO),
    deliveryDate: isoDay(po.deliveryDate),
    isUrgent: po.isUrgent === true,
    items: (po.items ?? []).map(reviewItemFromRaw),
  };
}

// ---------------------------------------------------------------------------
// Review flags
// ---------------------------------------------------------------------------
export type ItemFlag = { field: "category" | "productCode" | "qty" | "price"; kind: "missing" | "check"; text: string };

const catalogCodes = (cat: ScanCategory | "", c: Pick<ScanCatalog, "bedframes" | "sofas" | "accessories"> | null): string[] | null =>
  !c || !cat ? null : cat === "BEDFRAME" ? c.bedframes : cat === "SOFA" ? c.sofas : c.accessories;

export function itemFlags(item: ReviewItem, catalog: Pick<ScanCatalog, "bedframes" | "sofas" | "accessories"> | null): ItemFlag[] {
  const out: ItemFlag[] = [];
  if (!item.category) out.push({ field: "category", kind: "missing", text: "Pick a category" });
  if (!item.productCode.trim()) out.push({ field: "productCode", kind: "missing", text: "Product code not found" });
  else {
    const list = catalogCodes(item.category, catalog);
    if (list && list.length > 0 && !list.some((c) => c.toLowerCase() === item.productCode.trim().toLowerCase())) {
      out.push({ field: "productCode", kind: "check", text: "Code not in the product catalog — check it" });
    }
  }
  if (positiveNum(item.qty) == null) out.push({ field: "qty", kind: "missing", text: "Quantity needed" });
  if (rmToSen(item.priceRm) === 0) out.push({ field: "price", kind: "check", text: "Price not read — the system price list is used if left blank" });
  return out;
}

export type DraftFlags = {
  missing: Set<"customerId" | "customerPO" | "deliveryDate" | "items">;
  hubCheck: boolean;
  /** Count of "not found" fields (header + lines). */
  missingCount: number;
  /** Count of values worth a second look. */
  checkCount: number;
};

export function draftFlags(draft: ReviewDraft, catalog: ScanCatalog | null): DraftFlags {
  const missing: DraftFlags["missing"] = new Set();
  if (!draft.customerId) missing.add("customerId");
  if (!draft.customerPO.trim()) missing.add("customerPO");
  if (!draft.deliveryDate) missing.add("deliveryDate");
  if (draft.items.length === 0) missing.add("items");
  const cust = catalog?.customers.find((c) => c.id === draft.customerId);
  const hubCheck = !!cust && cust.hubs.length > 0 && !draft.hubId;
  let missingCount = missing.size;
  let checkCount = hubCheck ? 1 : 0;
  for (const it of draft.items) {
    for (const f of itemFlags(it, catalog)) {
      if (f.kind === "missing") missingCount += 1;
      else checkCount += 1;
    }
    if (droppedSpecials(it, catalog).length) checkCount += 1;
  }
  return { missing, hubCheck, missingCount, checkCount };
}

/**
 * The two category rules the server enforces on create AND edit (src/lib/so-category.ts): sofa and
 * bedframe cannot share an order, and a sofa line is one unit. Same messages, so the operator hears
 * them before the request instead of after.
 */
export function categoryBlockers(items: { category: string; qty: string; productCode: string }[]): string[] {
  const out: string[] = [];
  if (hasMixedSofaBedframe(items.map((i) => ({ itemCategory: i.category })))) out.push(SO_MIXED_CATEGORY_ERROR);
  const bad = findInvalidSofaQty(items.map((i, idx) => ({ itemCategory: i.category, quantity: Number(i.qty) || 0, productCode: i.productCode, lineNo: idx + 1 })));
  if (bad) out.push(formatSofaQtyError(bad));
  return out;
}

/** What stops "Create" (the server needs a customer and at least one real line). */
export function blockers(draft: ReviewDraft): string[] {
  const out: string[] = [];
  if (!draft.customerId) out.push("Choose the customer.");
  if (draft.items.length === 0) out.push("Add at least one item.");
  draft.items.forEach((it, i) => {
    const n = i + 1;
    if (!it.category) out.push(`Item ${n}: pick a category.`);
    if (!it.productCode.trim()) out.push(`Item ${n}: enter the product code.`);
    if (positiveNum(it.qty) == null) out.push(`Item ${n}: enter a quantity.`);
  });
  out.push(...categoryBlockers(draft.items));
  return out;
}

// ---------------------------------------------------------------------------
// Specials (desktop: tokens not in the catalog list are dropped at save time)
// ---------------------------------------------------------------------------
function specialsList(item: ReviewItem, c: Pick<ScanCatalog, "bedframeSpecials" | "sofaSpecials"> | null): string[] {
  return item.category === "SOFA" ? c?.sofaSpecials ?? [] : c?.bedframeSpecials ?? [];
}

const tokens = (s: string): string[] => s.split(",").map((t) => t.trim()).filter(Boolean);

export function cleanSpecialOrder(item: ReviewItem, c: Pick<ScanCatalog, "bedframeSpecials" | "sofaSpecials"> | null): string {
  const list = specialsList(item, c);
  return tokens(item.specialOrder)
    .filter((t) => list.length === 0 || list.some((x) => x.toLowerCase() === t.toLowerCase()))
    .join(", ");
}

export function droppedSpecials(item: ReviewItem, c: Pick<ScanCatalog, "bedframeSpecials" | "sofaSpecials"> | null): string[] {
  const list = specialsList(item, c);
  if (list.length === 0) return [];
  return tokens(item.specialOrder).filter((t) => !list.some((x) => x.toLowerCase() === t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------
export function soItemsBody(items: ReviewItem[], catalog: Pick<ScanCatalog, "bedframeSpecials" | "sofaSpecials"> | null) {
  return items.map((it, idx) => {
    const sofa = it.category === "SOFA";
    const seat = sofa ? it.seatHeight.replace(/[^\d.]/g, "") : "";
    return {
      lineNo: idx + 1,
      lineSuffix: `-${String(idx + 1).padStart(2, "0")}`,
      productCode: it.productCode.trim(),
      productName: "", // the server resolves it from the product master
      itemCategory: it.category,
      sizeLabel: sofa ? seat : "", // bedframe size comes from the product master
      sizeCode: "",
      fabricCode: it.fabricCode.trim(),
      seatHeight: seat,
      quantity: positiveNum(it.qty) ?? 1,
      gapInches: Number(it.gap) || 0,
      divanHeightInches: Number(it.divan) || 0,
      legHeightInches: it.noLeg ? null : Number(it.leg) || null,
      specialOrder: cleanSpecialOrder(it, catalog),
      customSpecials: it.customSpecials.filter((c) => str(c.description).length > 0),
      basePriceSen: rmToSen(it.priceRm),
      transferredFromSO: it.transferredSO,
      notes: it.notes.trim(),
    };
  });
}

export function buildSoBody(
  draft: ReviewDraft,
  catalog: ScanCatalog | null,
  po: Pick<RawScanPo, "customerState" | "customerName" | "customerCode">,
  today: string,
) {
  const cust = catalog?.customers.find((c) => c.id === draft.customerId);
  const hub = cust?.hubs.find((h) => h.id === draft.hubId);
  return {
    customerId: draft.customerId,
    customerName: cust?.name ?? str(po.customerName),
    customerCode: cust?.code ?? po.customerCode ?? null,
    customerState: hub?.state ?? str(po.customerState),
    customerPOId: draft.customerPO.trim(),
    // The customer's own reference goes in `reference` (what the SO list reads).
    reference: draft.reference.trim() || null,
    yourRefNo: draft.reference.trim() || null,
    customerSOId: draft.customerSO.trim() || null,
    deliveryHubId: draft.hubId || null,
    companySODate: today,
    // The date on a customer PO is what the customer expects; Expected DD is planning's job.
    customerDeliveryDate: draft.deliveryDate || null,
    isUrgent: draft.isUrgent,
    customerPOImageB64: null, // the original goes up as a file attachment instead
    items: soItemsBody(draft.items, catalog),
    // Drafts only: never CONFIRMED, so no BOM / purchasing / production cascade.
    status: "DRAFT",
    isServiceOrder: false,
    source: "PO_SCAN_CLAUDE",
  };
}

/** OCR-accuracy report: the extraction with the FINAL values the operator imported laid over it. */
export function correctedJsonFor(po: RawScanPo, draft: ReviewDraft, catalog: Pick<ScanCatalog, "bedframeSpecials" | "sofaSpecials"> | null) {
  const rawItems = po.items ?? [];
  return {
    ...po,
    customerPO: draft.customerPO.trim(),
    customerSO: draft.customerSO.trim() || null,
    yourRefNo: draft.reference.trim() || null,
    deliveryDate: draft.deliveryDate || null,
    isUrgent: draft.isUrgent,
    items: draft.items.map((it, i) => ({
      ...(rawItems[i] ?? {}),
      category: it.category,
      productCode: it.productCode.trim(),
      fabricCode: it.fabricCode.trim() || null,
      quantity: positiveNum(it.qty) ?? 0,
      unitPrice: rmToSen(it.priceRm) / 100,
      specialOrder: cleanSpecialOrder(it, catalog) || null,
      specialNotes: it.notes.trim() || null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Idempotency: one key per distinct body, reused for a retry of the SAME body
// ---------------------------------------------------------------------------
export type IdemStore = { body: string | null; key: string | null };
export function idempotencyKeyFor(store: IdemStore, body: unknown, make: () => string): string {
  const json = JSON.stringify(body);
  if (store.key && store.body === json) return store.key;
  store.body = json;
  store.key = make();
  return store.key;
}

// ---------------------------------------------------------------------------
// Which file can be sent (same contract as POST /api/scan-po/extract)
// ---------------------------------------------------------------------------
export function fileProblem(file: { name: string; type: string; size: number }, opts: { heic?: boolean } = {}): string | null {
  const name = file.name.toLowerCase();
  const pdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const image = ["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/.test(name);
  // The supplier-document scan also takes phone photos in HEIC / HEIF (scan-supplier.ts); the customer-PO scan does not.
  const heic = !!opts.heic && (/^image\/(heic|heif)$/.test(file.type) || /\.(heic|heif)$/.test(name));
  if (!pdf && !image && !heic) return opts.heic ? "Only a PDF or a photo (JPEG / PNG / WebP / HEIC) can be read." : "Only a PDF or a JPEG / PNG / WebP photo can be read. Convert HEIC photos to JPEG first.";
  if (file.size > 32 * 1024 * 1024) return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 32 MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

/**
 * The POs of one finished queue row (rawJson.pos[]). `docIdx` is the position in the row's
 * own list, which is what POST /api/scan-queue/:id/consume wants; empty POs are skipped
 * AFTER numbering, as the desktop modal does.
 */
export function posOfRow(rawJson: unknown): { po: RawScanPo; docIdx: number }[] {
  const pos = (rawJson as { pos?: unknown } | null)?.pos;
  if (!Array.isArray(pos)) return [];
  return (pos as RawScanPo[])
    .map((po, docIdx) => ({ po, docIdx }))
    .filter(({ po }) => Array.isArray(po?.items) && po.items.length > 0);
}
