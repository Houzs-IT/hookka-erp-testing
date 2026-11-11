// ---------------------------------------------------------------------------
// so-edit — editing a SAVED Sales Order without losing anything on its lines.
//
// Why this exists. PUT /api/sales-orders/:id with `items` replaces ALL of the order's lines
// (DELETE + INSERT from the payload). The old mobile edit form carried only code, name, category,
// size, fabric, qty and price, so saving an edited order — and in particular a scanned one — silently
// dropped divan / leg / gap heights, special orders, custom specials, notes, discounts and the
// surcharges priced for them.
//
// The server also TRUSTS every price field it is sent (a deliberate 0 included) and re-derives only
// the ones it is NOT sent. So a faithful round trip is:
//   · send every stored field back as it was;
//   · when the operator changed the thing a surcharge is priced from (a height, the special-order
//     text) and did not touch the surcharge itself, OMIT that surcharge so the server re-prices it;
//   · never turn a stored null into 0, or a blank into something else.
// Pure; the sheet owns the fetch.
// ---------------------------------------------------------------------------
import { normCategory, rmToSen, senToRm, categoryBlockers, type EditExtra, type ReviewItem } from "./scan-so";

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const sen = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
/** null for blank / not a number; otherwise the number (0 stays 0). */
export const numOrNull = (v: unknown): number | null => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** null, 0 and blank all mean "none" when asking whether a height changed. */
const same = (a: number | null, b: number | null): boolean => (a ?? 0) === (b ?? 0);
const digits = (v: unknown): string => str(v).replace(/[^\d.]/g, "");
const rmOrBlank = (s: number): string => (s > 0 ? senToRm(s) : "");

function customSpecialsOf(v: unknown): { description: string; surchargeSen: number }[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try { list = JSON.parse(v); } catch { list = []; }
  }
  return Array.isArray(list)
    ? (list as { description?: unknown; surchargeSen?: unknown }[])
        .filter((c) => c && str(c.description))
        .map((c) => ({ description: str(c.description), surchargeSen: Math.round(Number(c.surchargeSen) || 0) }))
    : [];
}

/** A saved line (GET /api/sales-orders/:id → items[]) as an editable line that remembers what it was. */
export function editItemFromServer(raw: Raw, idx: number): ReviewItem {
  const category = normCategory(raw.itemCategory);
  const sofa = category === "SOFA";
  const seat = sofa ? digits(raw.sizeLabel) || digits(raw.sizeCode) : "";
  const gap = numOrNull(raw.gapInches);
  const divan = numOrNull(raw.divanHeightInches);
  const leg = numOrNull(raw.legHeightInches);
  const edit: EditExtra = {
    id: str(raw.id),
    productId: str(raw.productId),
    productName: str(raw.productName),
    sizeCode: str(raw.sizeCode),
    sizeLabel: str(raw.sizeLabel),
    legPriceRm: rmOrBlank(sen(raw.legPriceSen)),
    divanPriceRm: rmOrBlank(sen(raw.divanPriceSen)),
    specialPriceRm: rmOrBlank(sen(raw.specialOrderPriceSen)),
    discountRm: rmOrBlank(sen(raw.discountSen)),
    repairScope: raw.repairScope ?? null,
    orig: {
      productCode: str(raw.productCode),
      gap, divan, leg,
      specialOrder: str(raw.specialOrder),
      seatHeight: seat,
      basePriceSen: sen(raw.basePriceSen),
      legPriceSen: sen(raw.legPriceSen),
      divanPriceSen: sen(raw.divanPriceSen),
      specialOrderPriceSen: sen(raw.specialOrderPriceSen),
      totalHeightPriceSen: sen(raw.totalHeightPriceSen),
    },
  };
  return {
    key: str(raw.id) || `i${idx}`,
    category,
    productCode: str(raw.productCode),
    fabricCode: str(raw.fabricCode),
    qty: Number(raw.quantity) > 0 ? String(Number(raw.quantity)) : "",
    priceRm: rmOrBlank(sen(raw.basePriceSen)),
    seatHeight: seat,
    divan: divan == null ? "" : String(divan),
    leg: leg == null ? "" : String(leg),
    noLeg: false,
    gap: gap == null ? "" : String(gap),
    specialOrder: str(raw.specialOrder),
    notes: str(raw.notes),
    transferredSO: null,
    customSpecials: customSpecialsOf(raw.customSpecials),
    edit,
  };
}

export type SoEditHeader = {
  customerId: string;
  customerPOId: string;
  customerSOId: string;
  reference: string;
  companySODate: string;
  customerDeliveryDate: string;
  hookkaExpectedDD: string;
  notes: string;
};

const day = (v: unknown): string => str(v).slice(0, 10);

export function editHeaderFromDoc(doc: Raw): SoEditHeader {
  return {
    customerId: str(doc.customerId),
    customerPOId: str(doc.customerPOId) || str(doc.customerPO),
    customerSOId: str(doc.customerSOId) || str(doc.customerSO),
    reference: str(doc.reference),
    companySODate: day(doc.companySODate),
    customerDeliveryDate: day(doc.customerDeliveryDate),
    hookkaExpectedDD: day(doc.hookkaExpectedDD),
    notes: str(doc.notes),
  };
}

/** The lines as PUT /api/sales-orders/:id expects them. See the file header for the price rules. */
export function soEditItemsBody(items: ReviewItem[]): Raw[] {
  return items.map((it) => {
    const e = it.edit;
    const sofa = it.category === "SOFA";
    const gap = numOrNull(it.gap);
    const divan = numOrNull(it.divan);
    const leg = numOrNull(it.leg);
    const seat = digits(it.seatHeight);
    const gapSame = !e || same(gap, e.orig.gap);
    const divanSame = !e || same(divan, e.orig.divan);
    const legSame = !e || same(leg, e.orig.leg);
    const specialSame = !e || it.specialOrder.trim() === e.orig.specialOrder;
    const seatSame = !e || seat === e.orig.seatHeight;

    const out: Raw = {
      ...(e?.id ? { id: e.id } : {}),
      // A changed code is a different product: drop the stale id so the server resolves it from the code.
      productId: e && it.productCode.trim() === e.orig.productCode ? e.productId : "",
      productCode: it.productCode.trim(),
      productName: e?.productName || it.productCode.trim(),
      itemCategory: it.category,
      // A sofa's size IS its seat height; everything else is the product master's (the server snaps it).
      sizeCode: sofa && !seatSame ? seat : e?.sizeCode ?? "",
      sizeLabel: sofa && !seatSame ? seat : e?.sizeLabel ?? "",
      ...(sofa ? { seatHeight: seat } : {}),
      fabricCode: it.fabricCode.trim(),
      quantity: Number(it.qty) > 0 ? Number(it.qty) : 1,
      basePriceSen: rmToSen(it.priceRm),
      // Heights: an untouched null stays null (the old form turned blanks into undefined / 0).
      gapInches: gapSame && e ? e.orig.gap : gap,
      divanHeightInches: divanSame && e ? e.orig.divan : divan,
      legHeightInches: legSame && e ? e.orig.leg : leg,
      specialOrder: it.specialOrder.trim(),
      customSpecials: it.customSpecials,
      discountSen: rmToSen(e?.discountRm ?? ""),
      notes: it.notes.trim(),
      ...(e && e.repairScope != null ? { repairScope: e.repairScope } : {}),
    };

    // Surcharges: send what is on screen, UNLESS the thing it is priced from changed and the amount
    // itself did not — then leave it out and the server prices the new height / special order.
    const divanPrice = rmToSen(e?.divanPriceRm ?? "");
    const legPrice = rmToSen(e?.legPriceRm ?? "");
    const specialPrice = rmToSen(e?.specialPriceRm ?? "");
    if (!(e && !divanSame && divanPrice === e.orig.divanPriceSen)) out.divanPriceSen = divanPrice;
    if (!(e && !legSame && legPrice === e.orig.legPriceSen)) out.legPriceSen = legPrice;
    if (!(e && !specialSame && specialPrice === e.orig.specialOrderPriceSen)) out.specialOrderPriceSen = specialPrice;
    if (e && gapSame && divanSame && legSame) out.totalHeightPriceSen = e.orig.totalHeightPriceSen;
    return out;
  });
}

export function soEditBlockers(header: SoEditHeader, items: ReviewItem[]): string[] {
  const out: string[] = [];
  if (!header.customerId) out.push("Choose the customer.");
  if (items.length === 0) out.push("Add at least one item.");
  items.forEach((it, i) => {
    const n = i + 1;
    if (!it.category) out.push(`Item ${n}: pick a category.`);
    if (!it.productCode.trim()) out.push(`Item ${n}: enter the product code.`);
    if (!(Number(it.qty) > 0)) out.push(`Item ${n}: enter a quantity.`);
    // Desktop edit (sales/edit.tsx) asks a sofa line for its seat size.
    if (it.category === "SOFA" && !digits(it.seatHeight)) out.push(`Item ${n}: enter the sofa's seat height.`);
  });
  out.push(...categoryBlockers(items));
  return out;
}

export function soEditBody(header: SoEditHeader, items: ReviewItem[], overrideToken?: string | null) {
  return {
    customerId: header.customerId,
    customerPOId: header.customerPOId.trim(),
    customerSOId: header.customerSOId.trim(),
    reference: header.reference.trim(),
    companySODate: header.companySODate,
    customerDeliveryDate: header.customerDeliveryDate,
    hookkaExpectedDD: header.hookkaExpectedDD,
    notes: header.notes.trim(),
    items: soEditItemsBody(items),
    ...(overrideToken ? { overrideToken } : {}),
  };
}

// ---------------------------------------------------------------------------
// The generic FormSheet path (config/forms.ts editSalesOrderSpec, used by editSpecFor) edits a line
// with its own field names. These two functions carry the WHOLE saved row through that form (`__src`)
// and map it back, so that path round-trips exactly like the phone sheet instead of dropping fields.
// ---------------------------------------------------------------------------
export function formLineFromServer(raw: Raw): Raw {
  const blank = (v: unknown) => (numOrNull(v) == null ? "" : numOrNull(v));
  return {
    productId: str(raw.productId),
    productCode: str(raw.productCode),
    productName: str(raw.productName),
    itemCategory: normCategory(raw.itemCategory) || "BEDFRAME",
    sizeLabel: str(raw.sizeLabel),
    fabricCode: str(raw.fabricCode),
    quantity: Number(raw.quantity) || 1,
    basePriceSen: sen(raw.basePriceSen),
    gapInches: blank(raw.gapInches),
    legHeightInches: blank(raw.legHeightInches),
    legPriceSen: sen(raw.legPriceSen),
    divanHeightInches: blank(raw.divanHeightInches),
    divanPriceSen: sen(raw.divanPriceSen),
    discountSen: sen(raw.discountSen),
    notes: str(raw.notes),
    __src: raw,
  };
}

export function itemFromFormLine(line: Raw, idx: number): ReviewItem {
  const src = line.__src as Raw | undefined;
  const base: ReviewItem = src
    ? editItemFromServer(src, idx)
    : { key: `n${idx}`, category: "", productCode: "", fabricCode: "", qty: "", priceRm: "", seatHeight: "", divan: "", leg: "", noLeg: false, gap: "", specialOrder: "", notes: "", transferredSO: null, customSpecials: [] };
  const category = normCategory(line.itemCategory) || base.category;
  const text = (v: unknown) => (numOrNull(v) == null ? "" : String(numOrNull(v)));
  const item: ReviewItem = {
    ...base,
    category,
    productCode: str(line.productCode),
    fabricCode: str(line.fabricCode),
    qty: Number(line.quantity) > 0 ? String(Number(line.quantity)) : "",
    priceRm: rmOrBlank(sen(line.basePriceSen)),
    seatHeight: category === "SOFA" ? digits(line.sizeLabel) : "",
    divan: text(line.divanHeightInches),
    leg: text(line.legHeightInches),
    gap: text(line.gapInches),
    notes: str(line.notes),
  };
  if (base.edit) {
    item.edit = {
      ...base.edit,
      productName: str(line.productName) || base.edit.productName,
      legPriceRm: rmOrBlank(sen(line.legPriceSen)),
      divanPriceRm: rmOrBlank(sen(line.divanPriceSen)),
      discountRm: rmOrBlank(sen(line.discountSen)),
    };
  } else {
    // A line added in the form has no saved row behind it; its discount and surcharges still count, and
    // a height with no surcharge typed is left for the server to price.
    item.edit = {
      id: "", productId: "", productName: str(line.productName), sizeCode: "", sizeLabel: str(line.sizeLabel),
      legPriceRm: rmOrBlank(sen(line.legPriceSen)), divanPriceRm: rmOrBlank(sen(line.divanPriceSen)), specialPriceRm: "",
      discountRm: rmOrBlank(sen(line.discountSen)), repairScope: null,
      orig: { productCode: "", gap: null, divan: null, leg: null, specialOrder: "", seatHeight: "", basePriceSen: 0, legPriceSen: 0, divanPriceSen: 0, specialOrderPriceSen: 0, totalHeightPriceSen: 0 },
    };
  }
  return item;
}

/** Sofa lines are one unit each: replace a qty-N sofa line by N lines of qty 1 (same fields). */
export function splitSofaLine(items: ReviewItem[], key: string): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const it of items) {
    const qty = Math.floor(Number(it.qty));
    if (it.key !== key || it.category !== "SOFA" || !(qty > 1)) { out.push(it); continue; }
    for (let i = 0; i < qty; i++) {
      // Copies are NEW lines: no saved id, so the server inserts them instead of matching the original.
      const copy: ReviewItem = { ...it, key: `${it.key}-${i + 1}`, qty: "1", edit: it.edit && i > 0 ? { ...it.edit, id: "" } : it.edit };
      out.push(copy);
    }
  }
  return out;
}
