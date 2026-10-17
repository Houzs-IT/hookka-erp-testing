// ---------------------------------------------------------------------------
// doc-import-pi — the Purchase Invoice adapter for the shared importer
// (HK-0002). Same shape as doc-import-invoice.ts.
//
//   load   — the PIs the file names, read through GET /api/purchase-invoices/:id
//            and mapped by the export's own builder (buildPiDetailRows), so
//            "stored" is exactly what was exported. The raw GET items ride
//            along in meta: the export rounds sub-cent unit prices and leaves
//            out grnItemId / notes, and an edit must not lose either.
//   update — PUT /api/purchase-invoices/:id — the on-screen editor's path
//            (header fields, and items[] replace-all with GRN invoiced_qty
//            re-sync, PO ceiling and GL correction for CONFIRMED PIs).
//   create — POST /api/purchase-invoices — the "Create Invoice" path. Party
//            Code = supplier code, Ref Doc No. = the PO it bills. Lands DRAFT.
// ---------------------------------------------------------------------------

import purchaseInvoices from "../routes/purchase-invoices";
import { RouteRefusal, type DocImportAdapter } from "./doc-import";
import {
  currentFromListing,
  withFields,
  type CurrentDoc,
  type ImportPlan,
  type ImportSpec,
  type Issue,
  type Values,
} from "../../lib/doc-import/core";
import { buildPiDetailRows } from "../../lib/invoice-detail-export";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const PI_IMPORT_SPEC: ImportSpec = {
  docTypes: ["PI"],
  fields: withFields(
    ["docDate", "supplierInvoiceNo", "itemCode", "description", "qty", "unitPrice", "discount", "tax", "supplierSku", "lineType"],
    [
      { key: "supplierInvoiceNo", header: "Supplier Invoice No.", kind: "text", level: "header" },
      { key: "supplierSku", header: "Supplier SKU", kind: "text", level: "line" },
      { key: "lineType", header: "Line Type", kind: "text", level: "line" },
      { key: "tax", header: "Tax", kind: "money", level: "line" },
    ],
  ),
};

/** The PUT/POST items[] input shape (PurchaseInvoiceItemInput in the route). */
type ItemInput = {
  materialCode: string | null;
  materialName: string;
  supplierSku: string | null;
  qty: number;
  unitPriceSen: number;
  discountSen: number;
  taxSen: number;
  lineType: string;
  notes?: string | null;
  grnItemId?: string | null;
  poId?: string | null;
};

type PiMeta = { status: string; items: Row[] };

/** Sheet key → items[] key, for the line fields an import may set. */
const LINE_KEYS: Array<[string, keyof ItemInput]> = [
  ["itemCode", "materialCode"],
  ["description", "materialName"],
  ["supplierSku", "supplierSku"],
  ["qty", "qty"],
  ["unitPrice", "unitPriceSen"],
  ["discount", "discountSen"],
  ["tax", "taxSen"],
  ["lineType", "lineType"],
];

const fromTyped = (typed: Values): ItemInput => ({
  materialCode: typed.itemCode === undefined ? null : str(typed.itemCode),
  materialName: str(typed.description),
  supplierSku: typed.supplierSku === undefined ? null : str(typed.supplierSku),
  qty: Number(typed.qty ?? 0),
  unitPriceSen: Number(typed.unitPrice ?? 0),
  discountSen: Number(typed.discount ?? 0),
  taxSen: Number(typed.tax ?? 0),
  lineType: typed.lineType === undefined ? "STOCKED" : str(typed.lineType).toUpperCase(),
});

/** Refusals the route would otherwise only give mid-apply, or not at all. */
export function validatePiPlan(plan: ImportPlan): Issue[] {
  const errors: Issue[] = [];
  for (const doc of plan.docs) {
    if (doc.action !== "create") continue;
    const label = doc.docNo ?? (doc.key || "(new)");
    const first = doc.rows[0] ?? 0;
    if (doc.header.partyCode === undefined)
      errors.push({ row: first, docNo: label, message: "A new PI needs Party Code = the supplier code." });
    // POST honours a typed number only when it looks like PI-…; anything else
    // would be silently replaced by the next sequence number.
    if (doc.docNo && !/^PI-\d/.test(doc.docNo))
      errors.push({ row: first, docNo: label, message: `Doc No. "${doc.docNo}" is not a PI number (PI-…). Leave it blank or use NEW-1, NEW-2… to get the next number.` });
    if (doc.lines.length === 0)
      errors.push({ row: first, docNo: label, message: "A new PI needs at least one line (Item Code / Description, Qty, Unit Price)." });
    for (const l of doc.lines) {
      if (l.typed.description === undefined) errors.push({ row: l.row, docNo: label, message: "Description is blank — a PI line needs one." });
      if (l.typed.qty === undefined) errors.push({ row: l.row, docNo: label, message: "Qty is blank." });
    }
  }
  return errors;
}

export const piImportAdapter: DocImportAdapter = {
  docTypes: ["PI"],
  resource: "purchase-invoices",
  spec: PI_IMPORT_SPEC,
  validate: validatePiPlan,

  async load(ctx, docNos) {
    if (docNos.length === 0) return new Map<string, CurrentDoc>();
    // Same scope as GET /api/purchase-invoices (no org filter there either).
    const found: Row[] = [];
    for (let i = 0; i < docNos.length; i += 100) {
      const chunk = docNos.slice(i, i + 100);
      const res = await ctx.db
        .prepare(`SELECT id, piNo, status, supplierId FROM purchase_invoices WHERE piNo IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<Row>();
      found.push(...(res.results ?? []));
    }
    if (found.length === 0) return new Map<string, CurrentDoc>();

    const supIds = [...new Set(found.map((r) => str(r.supplierId)).filter(Boolean))];
    const partyCodes = new Map<string, string>();
    for (let i = 0; i < supIds.length; i += 100) {
      const chunk = supIds.slice(i, i + 100);
      const res = await ctx.db
        .prepare(`SELECT id, code FROM suppliers WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<Row>();
      for (const r of res.results ?? []) partyCodes.set(str(r.id), str(r.code));
    }

    // The export's own fetch + mapping, pointed at the in-process route. The
    // raw items are kept for update (full-precision price, grnItemId, notes).
    const rawItems = new Map<string, Row[]>();
    const aoa = await buildPiDetailRows(
      found.map((r) => ({ id: str(r.id), piNo: str(r.piNo) })),
      {
        fetchJson: async (url) => {
          const j = await ctx.callRoute(purchaseInvoices, "GET", url.replace(/^\/api\/purchase-invoices/, ""));
          const data = (j.data ?? {}) as { id?: string; items?: Row[] };
          rawItems.set(str(data.id), data.items ?? []);
          return j;
        },
        wait: async () => {},
        confirmLarge: () => true,
        partyCodes,
      },
    );
    const idByDocNo = new Map(found.map((r) => [str(r.piNo), str(r.id)]));
    const meta = new Map<string, Record<string, unknown>>(
      found.map((r) => [str(r.piNo), { status: str(r.status), items: rawItems.get(str(r.id)) ?? [] } satisfies PiMeta]),
    );
    return currentFromListing(aoa, PI_IMPORT_SPEC, idByDocNo, meta);
  },

  async update(ctx, doc) {
    const cur = doc.current!;
    const body: Record<string, unknown> = {};
    for (const ch of doc.headerChanges) {
      if (ch.key === "docDate") body.invoiceDate = ch.to;
      if (ch.key === "supplierInvoiceNo") body.supplierInvoiceNo = ch.to;
    }
    if (doc.lines.some((l) => l.action === "create" || l.changes.length > 0)) {
      // PUT items[] replaces every line, so send every stored line (raw, as
      // GET returned it) with this file's changes applied; lines the file
      // leaves out are kept as they are. New rows are appended.
      const planByLine = new Map(doc.lines.filter((l) => l.lineId).map((l) => [l.lineId!, l]));
      const items: ItemInput[] = ((cur.meta as PiMeta | undefined)?.items ?? []).map((it) => {
        const input: ItemInput = {
          materialCode: (it.materialCode as string | null) ?? null,
          materialName: str(it.materialName),
          supplierSku: (it.supplierSku as string | null) ?? null,
          qty: Number(it.qty) || 0,
          unitPriceSen: Number(it.unitPriceSen) || 0,
          discountSen: Number(it.discountSen) || 0,
          taxSen: Number(it.taxSen) || 0,
          lineType: str(it.lineType) || "STOCKED",
          notes: (it.notes as string | null) ?? null,
          grnItemId: it.grnItemId == null ? null : str(it.grnItemId),
        };
        for (const ch of planByLine.get(str(it.id))?.changes ?? []) {
          const target = LINE_KEYS.find(([k]) => k === ch.key)?.[1];
          if (!target) continue;
          (input as Record<string, unknown>)[target] =
            ch.key === "lineType" ? str(ch.to).toUpperCase() : ch.to;
        }
        return input;
      });
      for (const l of doc.lines) if (l.action === "create") items.push(fromTyped(l.typed));
      body.items = items;
    }
    if (Object.keys(body).length > 0) await ctx.callRoute(purchaseInvoices, "PUT", `/${cur.id}`, body);
  },

  async create(ctx, doc) {
    const code = str(doc.header.partyCode);
    const sup = await ctx.db.prepare("SELECT id, name FROM suppliers WHERE code = ?").bind(code).all<Row>();
    const matches = sup.results ?? [];
    if (matches.length !== 1) {
      throw new RouteRefusal(
        matches.length === 0
          ? `Supplier code ${code} (Party Code) not found.`
          : `Supplier code ${code} (Party Code) matches ${matches.length} suppliers — cannot tell which one.`,
        matches.length === 0 ? 404 : 422,
      );
    }
    let purchaseOrderId: string | null = null;
    if (doc.header.refDocNo !== undefined) {
      const poNo = str(doc.header.refDocNo);
      const po = await ctx.db.prepare("SELECT id FROM purchase_orders WHERE poNo = ?").bind(poNo).first<Row>();
      if (!po) throw new RouteRefusal(`Purchase order ${poNo} (Ref Doc No.) not found.`, 404);
      purchaseOrderId = str(po.id);
    }
    const created = (await ctx.callRoute(purchaseInvoices, "POST", "/", {
      supplierId: str(matches[0].id),
      supplierName: str(matches[0].name),
      status: "DRAFT",
      ...(doc.header.docDate !== undefined ? { invoiceDate: doc.header.docDate } : {}),
      ...(doc.header.supplierInvoiceNo !== undefined ? { supplierInvoiceNo: doc.header.supplierInvoiceNo } : {}),
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
      ...(doc.docNo ? { piNo: doc.docNo } : {}),
      items: doc.lines.map((l) => ({ ...fromTyped(l.typed), poId: purchaseOrderId })),
    })) as { data?: { id: string; piNo: string } | null };
    if (!created.data) throw new RouteRefusal("The purchase invoice route created nothing.", 500);
    return { id: created.data.id, docNo: created.data.piNo };
  },
};
