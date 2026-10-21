// ---------------------------------------------------------------------------
// doc-detail-listings — per-line-item "Detail Listing" exports for Purchase
// Orders, Goods Receipts, Delivery Orders and Purchase Invoices (plus the
// Consignment Order listing): ONE ROW PER LINE ITEM, document header fields
// repeated on every line.
//
// HK-0002 (2026-10-16): every listing here except CO now LEADS with the shared
// column contract from doc-columns.ts (Doc Type, Doc No., Doc Date, Party Code,
// Party Name, [Ref Doc No.], Line ID, Item Code, Description, Qty, UOM, Unit
// Price, Discount, Line Total) and only then adds the document's own columns.
// That is what makes the files comparable across documents and importable back
// through src/lib/doc-import/core.ts. Party Code is not on the list rows; the
// caller passes a lookup it already holds (suppliers / customers), and a
// missing entry is blank, never invented.
//
// Pure so the row mapping is unit-tested without a database.
// ---------------------------------------------------------------------------

import type { Aoa } from "./export-report";
import { commonCells, commonHeaders, rm, day, num } from "./doc-columns";

/** id → party code (supplier.code / customer.code). */
export type PartyCodeLookup = Map<string, string>;
const code = (lookup: PartyCodeLookup | undefined, id: string | null | undefined) =>
  (id && lookup?.get(id)) || "";

// ── Purchase Order ─────────────────────────────────────────────────────────
export type PODetailItem = {
  id?: string | null;
  materialCategory?: string | null;
  materialCode?: string | null;
  supplierSKU?: string | null;
  materialName?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unitPriceSen?: number | null;
  totalSen?: number | null;
  receivedQty?: number | null;
};
export type PODetailOrder = {
  poNo?: string | null;
  orderDate?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;
  totalSen?: number | null;
  items?: PODetailItem[] | null;
};

export const PO_DETAIL_HEADERS = [
  ...commonHeaders(false),
  "Status", "Doc Total", "Item Group", "Supplier SKU", "Received Qty",
];

export function buildPoDetailListingAoa(orders: PODetailOrder[], supplierCodes?: PartyCodeLookup): Aoa {
  const body: (string | number)[][] = [];
  for (const o of orders) {
    const items = o.items && o.items.length > 0 ? o.items : [{} as PODetailItem];
    for (const it of items) {
      body.push([
        ...commonCells(
          {
            docType: "PO",
            docNo: o.poNo,
            docDate: o.orderDate,
            partyCode: code(supplierCodes, o.supplierId),
            partyName: o.supplierName,
            lineId: it.id,
            itemCode: it.materialCode,
            description: it.materialName,
            qty: num(it.quantity),
            uom: it.unit,
            unitPriceSen: it.unitPriceSen ?? 0,
            discountSen: null, // PO lines carry no discount
            lineTotalSen: it.totalSen ?? 0,
          },
          false,
        ),
        o.status ?? "",
        rm(o.totalSen),
        it.materialCategory ?? "",
        it.supplierSKU ?? "",
        num(it.receivedQty),
      ]);
    }
  }
  return [PO_DETAIL_HEADERS, ...body];
}

// ── Goods Receipt Note ───────────────────────────────────────────────────────
export type GrnDetailItem = {
  id?: string | null;
  materialCode?: string | null;
  supplierSKU?: string | null;
  materialName?: string | null;
  orderedQty?: number | null;
  receivedQty?: number | null;
  acceptedQty?: number | null;
  rejectedQty?: number | null;
  rejectionReason?: string | null;
  unitPrice?: number | null; // sen — see pi/create.tsx
};
export type GrnDetailNote = {
  grnNumber?: string | null;
  receiveDate?: string | null;
  poNumber?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;
  items?: GrnDetailItem[] | null;
};

// Qty is the ACCEPTED quantity — the one the line is billed on (Line Total =
// accepted × unit price, matching the PI pre-match). Ordered / received /
// rejected follow as GRN-specific columns.
export const GRN_DETAIL_HEADERS = [
  ...commonHeaders(true),
  "Status", "Supplier SKU", "Ordered Qty", "Received Qty", "Rejected Qty", "Rejection Reason",
];

export function buildGrnDetailListingAoa(notes: GrnDetailNote[], supplierCodes?: PartyCodeLookup): Aoa {
  const body: (string | number)[][] = [];
  for (const n of notes) {
    const items = n.items && n.items.length > 0 ? n.items : [{} as GrnDetailItem];
    for (const it of items) {
      body.push([
        ...commonCells(
          {
            docType: "GRN",
            docNo: n.grnNumber,
            docDate: n.receiveDate,
            partyCode: code(supplierCodes, n.supplierId),
            partyName: n.supplierName,
            refDocNo: n.poNumber,
            lineId: it.id,
            itemCode: it.materialCode,
            description: it.materialName,
            qty: num(it.acceptedQty),
            uom: "",
            unitPriceSen: it.unitPrice ?? 0,
            discountSen: null,
            lineTotalSen: num(it.acceptedQty) * num(it.unitPrice),
          },
          true,
        ),
        n.status ?? "",
        it.supplierSKU ?? "",
        num(it.orderedQty),
        num(it.receivedQty),
        num(it.rejectedQty),
        it.rejectionReason ?? "",
      ]);
    }
  }
  return [GRN_DETAIL_HEADERS, ...body];
}

// ── Consignment Order ────────────────────────────────────────────────────────
// The CO list endpoint ships each order's lines (rowToCOList), so a real
// per-line export is possible here — unlike Sales/Purchase Invoices, whose
// list payloads deliberately ship `items: []`.
//
// Header fields are the CO's OWN columns (companyCOId / companyCODate /
// customerCOId), NOT the SO names. The consignment list page annotates its
// rows as `SalesOrder`, which is wrong at runtime: `consignment_orders` has no
// `customerPOId` column at all, so anything reading SO field names off a CO row
// exports blanks. Only fields the table actually has appear below.
export type CODetailItem = {
  itemCategory?: string | null;
  productCode?: string | null;
  productName?: string | null;
  sizeLabel?: string | null;
  fabricCode?: string | null;
  quantity?: number | null;
  unitPriceSen?: number | null;
  discountSen?: number | null;
  lineTotalSen?: number | null;
};
export type CODetailOrder = {
  companyCOId?: string | null;
  companyCODate?: string | null;
  customerCOId?: string | null;
  customerName?: string | null;
  customerState?: string | null;
  hubName?: string | null;
  status?: string | null;
  totalSen?: number | null;
  items?: CODetailItem[] | null;
};

export const CO_DETAIL_HEADERS = [
  "CO No.", "Date", "Customer CO", "Customer", "State", "Hub", "Status", "Doc Total",
  "Item Group", "Item Code", "Description", "Size", "Fabric",
  "Qty", "Unit Price", "Discount", "Line Total",
] as const;

export function buildCoDetailListingAoa(orders: CODetailOrder[]): Aoa {
  const body: (string | number)[][] = [];
  for (const o of orders) {
    const items = o.items && o.items.length > 0 ? o.items : [{} as CODetailItem];
    for (const it of items) {
      body.push([
        o.companyCOId ?? "",
        day(o.companyCODate),
        o.customerCOId ?? "",
        o.customerName ?? "",
        o.customerState ?? "",
        o.hubName ?? "",
        o.status ?? "",
        rm(o.totalSen),
        it.itemCategory ?? "",
        it.productCode ?? "",
        it.productName ?? "",
        it.sizeLabel ?? "",
        it.fabricCode ?? "",
        num(it.quantity),
        rm(it.unitPriceSen),
        rm(it.discountSen),
        rm(it.lineTotalSen),
      ]);
    }
  }
  return [CO_DETAIL_HEADERS as unknown as string[], ...body];
}

// ── Delivery Order ───────────────────────────────────────────────────────────
// DO lines carry NO price: delivery_orders / delivery_order_items have no money
// column (the grid's "Sales Figure" is derived from the SO lines at read time).
// So Unit Price / Discount / Line Total are BLANK here, not 0 — a zero would
// claim the goods were delivered free.
export type DoDetailItem = {
  id?: string | null;
  salesOrderNo?: string | null;
  poNo?: string | null;
  customerPOId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  sizeLabel?: string | null;
  fabricCode?: string | null;
  quantity?: number | null;
  itemM3?: number | null;
  rackingNumber?: string | null;
};
export type DoDetailOrder = {
  doNo?: string | null;
  dispatchDate?: string | null;
  companySO?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  status?: string | null;
  deliveryDate?: string | null;
  remarks?: string | null;
  items?: DoDetailItem[] | null;
};

// PO No. / Delivery Date / Remarks are what the DO importer reads back
// (src/api/lib/doc-import-do.ts): PO No. names the production order a new DO
// line delivers; Delivery Date and Remarks are the editable header fields.
export const DO_DETAIL_HEADERS = [
  ...commonHeaders(true),
  "Status", "Customer PO", "Size", "Fabric", "M3", "Racking",
  "PO No.", "Delivery Date", "Remarks",
];

export function buildDoDetailListingAoa(orders: DoDetailOrder[], customerCodes?: PartyCodeLookup): Aoa {
  const body: (string | number)[][] = [];
  for (const o of orders) {
    const items = o.items && o.items.length > 0 ? o.items : [{} as DoDetailItem];
    for (const it of items) {
      body.push([
        ...commonCells(
          {
            docType: "DO",
            docNo: o.doNo,
            docDate: o.dispatchDate,
            partyCode: code(customerCodes, o.customerId),
            partyName: o.customerName,
            // A DO can cover several SOs — the line's own SO wins.
            refDocNo: it.salesOrderNo || o.companySO,
            lineId: it.id,
            itemCode: it.productCode,
            description: it.productName,
            qty: num(it.quantity),
            uom: "",
            unitPriceSen: null,
            discountSen: null,
            lineTotalSen: null,
          },
          true,
        ),
        o.status ?? "",
        it.customerPOId ?? "",
        it.sizeLabel ?? "",
        it.fabricCode ?? "",
        num(it.itemM3),
        it.rackingNumber ?? "",
        it.poNo ?? "",
        day(o.deliveryDate),
        o.remarks ?? "",
      ]);
    }
  }
  return [DO_DETAIL_HEADERS, ...body];
}

// ── Purchase Invoice ─────────────────────────────────────────────────────────
// GET /api/purchase-invoices ships no items (rowToPI), so the caller fetches
// each PI (buildPiDetailRows in invoice-detail-export.ts, the same paced
// pattern the sales-invoice listing uses) and hands the result here.
export type PiDetailItem = {
  id?: string | null;
  materialCode?: string | null;
  materialName?: string | null;
  supplierSku?: string | null;
  qty?: number | null;
  unitPriceSen?: number | null;
  discountSen?: number | null;
  taxSen?: number | null;
  lineTotalSen?: number | null;
  lineType?: string | null;
};
export type PiDetailDoc = {
  piNo?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  poRef?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierInvoiceNo?: string | null;
  status?: string | null;
  amountSen?: number | null;
  items?: PiDetailItem[] | null;
};

export const PI_DETAIL_HEADERS = [
  ...commonHeaders(true),
  "Status", "Due Date", "Supplier Invoice No.", "Doc Total", "Supplier SKU", "Line Type", "Tax",
];

export function buildPiDetailListingAoa(docs: PiDetailDoc[], supplierCodes?: PartyCodeLookup): Aoa {
  const body: (string | number)[][] = [];
  for (const d of docs) {
    const items = d.items && d.items.length > 0 ? d.items : [{} as PiDetailItem];
    for (const it of items) {
      body.push([
        ...commonCells(
          {
            docType: "PI",
            docNo: d.piNo,
            docDate: d.invoiceDate,
            partyCode: code(supplierCodes, d.supplierId),
            partyName: d.supplierName,
            refDocNo: d.poRef,
            lineId: it.id,
            itemCode: it.materialCode,
            description: it.materialName,
            qty: num(it.qty),
            uom: "",
            unitPriceSen: it.unitPriceSen ?? 0,
            discountSen: it.discountSen ?? 0,
            lineTotalSen: it.lineTotalSen ?? 0,
          },
          true,
        ),
        d.status ?? "",
        day(d.dueDate),
        d.supplierInvoiceNo ?? "",
        rm(d.amountSen),
        it.supplierSku ?? "",
        it.lineType ?? "",
        rm(it.taxSen),
      ]);
    }
  }
  return [PI_DETAIL_HEADERS, ...body];
}
