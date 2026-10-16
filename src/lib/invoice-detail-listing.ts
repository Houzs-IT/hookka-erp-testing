// ---------------------------------------------------------------------------
// invoice-detail-listing — the per-line "Invoice Detail Listing" export.
//
// ONE ROW PER LINE ITEM, document header fields repeated on every line, in the
// same shape as the Sales Order / PO / GRN / DO listings (so-detail-listing.ts,
// doc-detail-listings.ts). Invoices were the one module without one, and the
// reason was written down in `src/pages/invoices/index.tsx`: the list endpoint
// ships `items: []` on every row, so a per-line export needed a per-invoice
// re-fetch that nobody had built. The caller does that fetch; this file only
// maps the result, so the mapping stays unit-testable without a database.
//
// ## Two columns the other listings do not have
//
// **The price build-up.** Base / Divan / Leg / T.Height / Special. The owner's
// reason for asking (2026-08-20) was to check prices in bulk, and a Unit Price
// on its own cannot be checked — you have to open the invoice. With the
// components spelled out, `Base + Divan + Leg + T.Height + Special = Unit Price`
// is a formula in a spreadsheet column, and every line that does not add up
// sorts to the top.
//
// A component that does not apply to the line's category renders BLANK, not
// 0.00 — rule 6 of `invoice-line-price.ts`. A sofa has no divan; printing
// "0.00" there states a fact about a thing that does not exist. Blank says
// "not applicable"; zero says "it costs nothing". They are different claims.
//
// **`Line ID`.** A technical column, and the one that makes a round trip
// possible: an invoice can carry the SAME product code on several lines
// (INV-2608-031 has `1007-(Q)` four times), so invoice number + item code does
// not identify a line. Matching on this id survives the operator sorting,
// filtering or reordering the sheet in Excel — matching on row position does
// not.
// ---------------------------------------------------------------------------

import type { Aoa } from "./export-report";
import { priceComponentApplies } from "./invoice-line-price";
import { commonCells, commonHeaders, rm, day, uomFor } from "./doc-columns";

/**
 * A component cell: blank when the component does not apply to this line's
 * category, otherwise the value in ringgit. See rule 6.
 */
const comp = (
  key: "base" | "divan" | "leg" | "totalHeight" | "special",
  category: string | null | undefined,
  sen: number | null | undefined,
): string | number => (priceComponentApplies(key, category, Number(sen) || 0) ? rm(sen) : "");

export type InvoiceDetailItem = {
  id?: string | null;
  productCode?: string | null;
  productName?: string | null;
  sizeLabel?: string | null;
  fabricCode?: string | null;
  quantity?: number | null;
  unitPriceSen?: number | null;
  discountSen?: number | null;
  totalSen?: number | null;
  basePriceSen?: number | null;
  divanPriceSen?: number | null;
  legPriceSen?: number | null;
  totalHeightPriceSen?: number | null;
  specialOrderPriceSen?: number | null;
  priceEdited?: number | null;
  /** From /print-extras — the line's category and its resolved references. */
  itemCategory?: string | null;
  customerPOId?: string | null;
  customerSOLine?: string | null;
  companySO?: string | null;
};

export type InvoiceDetailDoc = {
  id?: string | null;
  invoiceNo?: string | null;
  /** Set = the invoice was raised from a delivery order ("DI"); empty = "SI". */
  deliveryOrderId?: string | null;
  doNo?: string | null;
  customerId?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  customerName?: string | null;
  customerPOId?: string | null;
  companySOId?: string | null;
  status?: string | null;
  subtotalSen?: number | null;
  totalSen?: number | null;
  paidAmount?: number | null;
  items?: InvoiceDetailItem[] | null;
};

/**
 * DI vs SI (owner YH 2026-10-16): both live in the one `invoices` table. An
 * invoice raised from a delivery order (deliveryOrderId set — the normal path,
 * POST /api/invoices requires one) is a DI, "Delivery Invoice"; one with no DO
 * (consignment-note conversion, opening-balance AR) is an SI.
 */
export const invoiceDocType = (d: { deliveryOrderId?: string | null }): "DI" | "SI" =>
  d.deliveryOrderId ? "DI" : "SI";

/** Shared common block (doc-columns.ts, Ref Doc No. = the DO), then the
 *  invoice's own columns. */
export const INVOICE_DETAIL_HEADERS = [
  ...commonHeaders(true),
  "Due Date", "Status", "Doc SubTotal", "Doc Total", "Paid",
  "Cust. PO", "Cust. SO Ref", "Our SO",
  "Size", "Fabric", "Category",
  "Base", "Divan", "Leg", "T.Height", "Special",
  "Build-up Reconciles", "Price Edited",
];

/**
 * Does the build-up account for the charge?
 *
 * "YES" / "NO" / "" — and the blank is load-bearing. An unresolved build-up
 * (all five components zero on a line that charges something) is not a
 * mismatch, it is an absence: the components were never recorded for that line.
 * Reporting it as "NO" would send the operator hunting for an error that isn't
 * there. Today's bug was an absence read as a value; this column refuses to
 * repeat it.
 */
export function reconcilesCell(it: InvoiceDetailItem): string {
  const unit = Number(it.unitPriceSen) || 0;
  const sum =
    (Number(it.basePriceSen) || 0) +
    (Number(it.divanPriceSen) || 0) +
    (Number(it.legPriceSen) || 0) +
    (Number(it.totalHeightPriceSen) || 0) +
    (Number(it.specialOrderPriceSen) || 0);
  if (sum === 0 && unit !== 0) return "";
  return sum === unit ? "YES" : "NO";
}

export function buildInvoiceDetailListingAoa(
  docs: InvoiceDetailDoc[],
  /** customerId → customer.code; a missing entry leaves Party Code blank. */
  customerCodes?: Map<string, string>,
): Aoa {
  const body: (string | number)[][] = [];
  for (const d of docs) {
    // An invoice with no lines still gets one row: dropping it silently would
    // make the export disagree with the invoice count on screen.
    const items = d.items && d.items.length > 0 ? d.items : [{} as InvoiceDetailItem];
    for (const it of items) {
      const cat = it.itemCategory;
      body.push([
        ...commonCells(
          {
            docType: invoiceDocType(d),
            docNo: d.invoiceNo,
            docDate: d.invoiceDate,
            partyCode: (d.customerId && customerCodes?.get(d.customerId)) || "",
            partyName: d.customerName,
            refDocNo: d.doNo,
            lineId: it.id,
            itemCode: it.productCode,
            description: it.productName,
            qty: Number(it.quantity) || 0,
            uom: uomFor(cat),
            unitPriceSen: it.unitPriceSen ?? 0,
            discountSen: it.discountSen ?? 0,
            lineTotalSen: it.totalSen ?? 0,
          },
          true,
        ),
        day(d.dueDate),
        d.status ?? "",
        rm(d.subtotalSen),
        rm(d.totalSen),
        rm(d.paidAmount),
        it.customerPOId ?? d.customerPOId ?? "",
        it.customerSOLine ?? "",
        it.companySO ?? d.companySOId ?? "",
        it.sizeLabel ?? "",
        it.fabricCode ?? "",
        cat ?? "",
        comp("base", cat, it.basePriceSen),
        comp("divan", cat, it.divanPriceSen),
        comp("leg", cat, it.legPriceSen),
        comp("totalHeight", cat, it.totalHeightPriceSen),
        comp("special", cat, it.specialOrderPriceSen),
        reconcilesCell(it),
        Number(it.priceEdited) === 1 ? "YES" : "",
      ]);
    }
  }
  return [INVOICE_DETAIL_HEADERS, ...body];
}
