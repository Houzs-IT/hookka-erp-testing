// ---------------------------------------------------------------------------
// doc-import-grn — the Goods Received Note adapter for the shared importer
// (HK-0002). Shape copied from doc-import-invoice.ts.
//
//   load   — the GRNs the file names, read through GET /api/grn/:id and mapped
//            by the export's own builder (buildGrnDetailListingAoa), so
//            "stored" is exactly what was exported.
//   update — PUT /api/grn/:id { items } with EVERY stored line (raw, from the
//            GET), only the typed Qty (= accepted qty) swapped in. The route's
//            own guards run: CANCELLED refused, per-line PI lock, committed
//            lines matched by position (id order) with compensating stock and
//            the PO received-qty recount.
//   create — POST /api/grn { poId, items } — the "From PO" path. Ref Doc No.
//            names the PO, each row names its PO line by Item Code. The route
//            assigns the GRN number and runs the over-receipt guard.
//
// Only Qty is editable. Rejected Qty / Rejection Reason are read on CREATE;
// everything else is read-only (a differing value is a warning).
// ---------------------------------------------------------------------------

import grn from "../routes/grn";
import { PO_ITEMS_ORDER, ensurePoItemLineNo } from "../routes/purchase-orders";
import { getOrgId } from "./tenant";
import { RouteRefusal, type DocImportAdapter } from "./doc-import";
import {
  currentFromListing,
  withFields,
  type CurrentDoc,
  type DocPlan,
  type ImportPlan,
  type ImportSpec,
  type Issue,
} from "../../lib/doc-import/core";
import { buildGrnDetailListingAoa, type GrnDetailNote } from "../../lib/doc-detail-listings";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const GRN_IMPORT_SPEC: ImportSpec = {
  docTypes: ["GRN"],
  fields: withFields(
    ["qty"],
    [
      { key: "rejectedQty", header: "Rejected Qty", kind: "qty", level: "line" },
      { key: "rejectionReason", header: "Rejection Reason", kind: "text", level: "line" },
    ],
  ),
};

/** The stored GRN lines exactly as GET /api/grn/:id returned them. */
export type GrnMeta = { status: string; items: Row[] };

/** PUT body for an EDIT: every stored line, in id order (the committed-edit
 *  path matches by position on id ASC), with the changed Qty applied. */
export function grnUpdateBody(doc: DocPlan): { items: Row[] } {
  const meta = (doc.current?.meta ?? { items: [] }) as GrnMeta;
  const qty = new Map(
    doc.lines.filter((l) => l.action === "update" && l.changes.length > 0).map((l) => [l.lineId!, Number(l.merged.qty)]),
  );
  const items = [...meta.items]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((it) => {
      const q = qty.get(str(it.id));
      if (q === undefined) return it;
      // received = accepted + rejected — the same rule the committed path applies.
      return { ...it, acceptedQty: q, receivedQty: q + (Number(it.rejectedQty) || 0) };
    });
  return { items };
}

/** POST body for a CREATE against one PO. `poLines` are the PO's lines in
 *  PO_ITEMS_ORDER (poItemIndex is the position in that order). */
export function grnCreateBody(doc: DocPlan, poId: string, poLines: Row[]): Row {
  const poNo = str(doc.header.refDocNo);
  const byCode = new Map<string, Array<{ id: string; index: number }>>();
  poLines.forEach((r, index) => {
    // The route's own code rule: material code, else supplier SKU.
    const code = str(r.materialCode ?? r.material_code) || str(r.supplierSKU ?? r.supplierSku ?? r.supplier_sku);
    byCode.set(code, [...(byCode.get(code) ?? []), { id: str(r.id), index }]);
  });
  const items = doc.lines.map((l) => {
    const code = str(l.typed.itemCode);
    const hits = byCode.get(code) ?? [];
    if (hits.length !== 1) {
      throw new RouteRefusal(
        hits.length === 0
          ? `Row ${l.row}: ${poNo} has no line with Item Code ${code}.`
          : `Row ${l.row}: ${poNo} carries Item Code ${code} on ${hits.length} lines — cannot tell which one to receive.`,
        422,
      );
    }
    const accepted = Number(l.typed.qty);
    const rejected = Number(l.typed.rejectedQty ?? 0);
    return {
      poId,
      poItemId: hits[0].id,
      poItemIndex: hits[0].index,
      receivedQty: accepted + rejected,
      acceptedQty: accepted,
      rejectedQty: rejected,
      rejectionReason: l.typed.rejectionReason === undefined ? null : str(l.typed.rejectionReason),
    };
  });
  return { poId, items, ...(doc.header.docDate ? { receiveDate: doc.header.docDate } : {}) };
}

/** Refusals the route would otherwise only find mid-apply (or get wrong). */
export function validateGrnPlan(plan: ImportPlan): Issue[] {
  const errors: Issue[] = [];
  for (const doc of plan.docs) {
    const label = doc.docNo ?? (doc.key || "(new)");
    const first = doc.rows[0] ?? 0;
    if (doc.action === "update") {
      for (const l of doc.lines)
        if (l.action === "create")
          errors.push({ row: l.row, docNo: label, message: "A row without a Line ID would ADD a line to an existing GRN — not supported by import. Add it on the GRN, or put the Line ID back." });
      continue;
    }
    if (doc.docNo)
      errors.push({ row: first, docNo: label, message: `${doc.docNo} is not an existing GRN. GRN numbers are assigned on save — leave Doc No. blank (or NEW-1, NEW-2…) to create one.` });
    if (doc.header.refDocNo === undefined)
      errors.push({ row: first, docNo: label, message: "A new GRN needs Ref Doc No. = the purchase order it receives." });
    if (doc.lines.length === 0) errors.push({ row: first, docNo: label, message: "A new GRN needs at least one line (Item Code + Qty)." });
    const codes = new Map<string, number>();
    for (const l of doc.lines) {
      if (l.typed.qty === undefined) errors.push({ row: l.row, docNo: label, message: "Qty is blank — say how many were accepted on this line." });
      const code = str(l.typed.itemCode);
      if (codes.has(code)) errors.push({ row: l.row, docNo: label, message: `Item Code ${code} is listed twice on this new GRN (row ${codes.get(code)}). One row per PO line.` });
      codes.set(code, l.row);
    }
  }
  return errors;
}

export const grnImportAdapter: DocImportAdapter = {
  docTypes: ["GRN"],
  resource: "grn",
  spec: GRN_IMPORT_SPEC,
  validate: validateGrnPlan,

  async load(ctx, docNos) {
    if (docNos.length === 0) return new Map<string, CurrentDoc>();
    // grns carries no orgId (the route reads it unscoped too).
    const found: Row[] = [];
    for (let i = 0; i < docNos.length; i += 100) {
      const chunk = docNos.slice(i, i + 100);
      const res = await ctx.db
        .prepare(`SELECT id, grnNumber FROM grns WHERE grnNumber IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<Row>();
      found.push(...(res.results ?? []));
    }
    if (found.length === 0) return new Map<string, CurrentDoc>();

    const notes: Row[] = [];
    for (const r of found) notes.push(((await ctx.callRoute(grn, "GET", `/${str(r.id)}`)).data ?? {}) as Row);

    const supIds = [...new Set(notes.map((n) => str(n.supplierId)).filter(Boolean))];
    const supplierCodes = new Map<string, string>();
    for (let i = 0; i < supIds.length; i += 100) {
      const chunk = supIds.slice(i, i + 100);
      const res = await ctx.db
        .prepare(`SELECT id, code FROM suppliers WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<Row>();
      for (const r of res.results ?? []) supplierCodes.set(str(r.id), str(r.code));
    }

    const aoa = buildGrnDetailListingAoa(notes as GrnDetailNote[], supplierCodes);
    const idByDocNo = new Map(notes.map((n) => [str(n.grnNumber), str(n.id)]));
    const meta = new Map<string, Record<string, unknown>>(
      notes.map((n) => [str(n.grnNumber), { status: str(n.status), items: (n.items ?? []) as Row[] } satisfies GrnMeta]),
    );
    return currentFromListing(aoa, GRN_IMPORT_SPEC, idByDocNo, meta);
  },

  async update(ctx, doc) {
    await ctx.callRoute(grn, "PUT", `/${doc.current!.id}`, grnUpdateBody(doc));
  },

  async create(ctx, doc) {
    const poNo = str(doc.header.refDocNo);
    const po = await ctx.db
      .prepare("SELECT id FROM purchase_orders WHERE orgId = ? AND poNo = ?")
      .bind(getOrgId(ctx.c), poNo)
      .first<Row>();
    if (!po) throw new RouteRefusal(`Purchase order ${poNo} (Ref Doc No.) not found.`, 404);
    // poItemIndex is a position in PO_ITEMS_ORDER — the order the route reads.
    await ensurePoItemLineNo(ctx.db);
    const res = await ctx.db
      .prepare(`SELECT * FROM purchase_order_items WHERE purchaseOrderId = ? ${PO_ITEMS_ORDER}`)
      .bind(str(po.id))
      .all<Row>();
    const created = (await ctx.callRoute(grn, "POST", "/", grnCreateBody(doc, str(po.id), res.results ?? []))) as {
      data?: { id: string; grnNumber: string };
    };
    return { id: created.data!.id, docNo: created.data!.grnNumber };
  },
};
