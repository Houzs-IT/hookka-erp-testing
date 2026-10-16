// ---------------------------------------------------------------------------
// doc-import-do — the Delivery Order adapter for the shared importer (HK-0002).
// Shape copied from doc-import-invoice.ts (the reference adapter).
//
// A DO line IS a production order: the screens never retype a line's qty or
// item, they add / remove production orders. So the import does the same:
//
//   load   — the DOs the file names, read through GET /api/delivery-orders/:id
//            and mapped by the export's own builder (buildDoDetailListingAoa).
//   update — PUT /api/delivery-orders/:id { deliveryDate?, remarks? } — the
//            edit screen's path; the invoice lock (checkDeliveryOrderLocked)
//            and every other guard are the route's own.
//   create — POST /api/delivery-orders { productionOrderIds, doNo?, ... } —
//            the Pending Delivery "Create DO" path, so the once-only-delivery,
//            one-customer and one-hub guards (validateDoComposition) run.
//            Each row names its production order by Item Code + PO No., or by
//            Item Code alone when exactly one undelivered PO of its Ref Doc No.
//            (SO) has it.
//
// Ref Doc No. is a LINE field here: a consolidated DO covers several SOs and
// the export writes each line's own SO, so as a header field the planner would
// refuse every multi-SO DO as "contradicted".
// ---------------------------------------------------------------------------

import deliveryOrders from "../routes/delivery-orders";
import { getOrgId } from "./tenant";
import { customerScopeSql } from "./customer-scope";
import { RouteRefusal, type DocImportAdapter } from "./doc-import";
import {
  currentFromListing,
  withFields,
  type CurrentDoc,
  type ImportPlan,
  type ImportSpec,
  type Issue,
} from "../../lib/doc-import/core";
import { buildDoDetailListingAoa, type DoDetailOrder } from "../../lib/doc-detail-listings";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

export const DO_IMPORT_SPEC: ImportSpec = {
  docTypes: ["DO"],
  fields: withFields(
    ["deliveryDate", "remarks"],
    [
      { key: "poNo", header: "PO No.", kind: "text", level: "line" },
      { key: "deliveryDate", header: "Delivery Date", kind: "date", level: "header" },
      { key: "remarks", header: "Remarks", kind: "text", level: "header" },
    ],
  ).map((f) => (f.key === "refDocNo" ? { ...f, level: "line" as const } : f)),
};

/** Refusals the server would otherwise only find mid-apply. */
export function validateDoPlan(plan: ImportPlan): Issue[] {
  const errors: Issue[] = [];
  const poRows = new Map<string, number>();
  for (const doc of plan.docs) {
    const label = doc.docNo ?? (doc.key || "(new)");
    if (doc.action === "update") {
      for (const l of doc.lines)
        if (l.action === "create")
          errors.push({ row: l.row, docNo: label, message: "A row without a Line ID would ADD a production order to an existing DO — not supported by import. Use Edit > Add Items on the DO, or put the Line ID back." });
      continue;
    }
    // The core skips a row with neither Line ID nor Item Code as header-only,
    // so every line here has an Item Code.
    if (doc.lines.length === 0)
      errors.push({ row: doc.rows[0] ?? 0, docNo: label, message: "A new DO needs at least one line — one row per production order it delivers, each with its Item Code." });
    for (const l of doc.lines) {
      const po = str(l.typed.poNo);
      if (po) {
        if (poRows.has(po)) errors.push({ row: l.row, docNo: label, message: `PO No. ${po} is listed twice (row ${poRows.get(po)}). A production order is delivered once.` });
        poRows.set(po, l.row);
      } else if (l.typed.refDocNo === undefined) {
        errors.push({ row: l.row, docNo: label, message: "Name the production order: Item Code + PO No., or Item Code + Ref Doc No. (the SO)." });
      }
    }
  }
  return errors;
}

/** GET /api/delivery-orders/:id payload → the export builder's input — the
 *  same fields the list page's mapDOToRow hands it. */
function toDetailOrder(d: Row): DoDetailOrder {
  return {
    doNo: str(d.doNo),
    dispatchDate: (d.dispatchedAt as string) || null,
    companySO: str(d.companySO),
    customerId: str(d.customerId),
    customerName: str(d.customerName),
    status: str(d.status),
    deliveryDate: str(d.deliveryDate),
    remarks: str(d.remarks),
    items: ((d.items as Row[]) ?? []).map((i) => ({
      id: str(i.id),
      salesOrderNo: str(i.salesOrderNo) || str(d.companySO),
      poNo: str(i.poNo),
      productCode: str(i.productCode),
      productName: str(i.productName),
      sizeLabel: str(i.sizeLabel),
      fabricCode: str(i.fabricCode),
      quantity: Number(i.quantity) || 0,
      itemM3: Number(i.itemM3) || 0,
      rackingNumber: str(i.rackingNumber),
    })),
  };
}

export const doImportAdapter: DocImportAdapter = {
  docTypes: ["DO"],
  resource: "delivery-orders",
  spec: DO_IMPORT_SPEC,
  validate: validateDoPlan,

  async load(ctx, docNos) {
    if (docNos.length === 0) return new Map<string, CurrentDoc>();
    const scope = await customerScopeSql(ctx.c, "customerId");
    const found: Row[] = [];
    for (let i = 0; i < docNos.length; i += 100) {
      const chunk = docNos.slice(i, i + 100);
      const res = await ctx.db
        .prepare(
          `SELECT id, doNo, customerId FROM delivery_orders
            WHERE orgId = ? AND doNo IN (${ph(chunk.length)})${scope.clause ? ` AND ${scope.clause}` : ""}`,
        )
        .bind(getOrgId(ctx.c), ...chunk, ...scope.binds)
        .all<Row>();
      found.push(...(res.results ?? []));
    }
    if (found.length === 0) return new Map<string, CurrentDoc>();

    const custIds = [...new Set(found.map((r) => str(r.customerId)).filter(Boolean))];
    const partyCodes = new Map<string, string>();
    for (let i = 0; i < custIds.length; i += 100) {
      const chunk = custIds.slice(i, i + 100);
      const res = await ctx.db
        .prepare(`SELECT id, code FROM customers WHERE id IN (${ph(chunk.length)})`)
        .bind(...chunk)
        .all<Row>();
      for (const r of res.results ?? []) partyCodes.set(str(r.id), str(r.code));
    }

    const orders: DoDetailOrder[] = [];
    for (const r of found) {
      const res = await ctx.callRoute(deliveryOrders, "GET", `/${str(r.id)}`);
      orders.push(toDetailOrder((res.data ?? {}) as Row));
    }
    const aoa = buildDoDetailListingAoa(orders, partyCodes);
    const idByDocNo = new Map(found.map((r) => [str(r.doNo), str(r.id)]));
    return currentFromListing(aoa, DO_IMPORT_SPEC, idByDocNo);
  },

  async update(ctx, doc) {
    const body: Record<string, unknown> = {};
    for (const ch of doc.headerChanges) body[ch.key] = ch.to; // deliveryDate / remarks only (the editable set)
    if (Object.keys(body).length > 0) await ctx.callRoute(deliveryOrders, "PUT", `/${doc.current!.id}`, body);
  },

  async create(ctx, doc) {
    const org = getOrgId(ctx.c);
    const productionOrderIds: string[] = [];
    for (const l of doc.lines) {
      const poNo = str(l.typed.poNo);
      const soNo = str(l.typed.refDocNo);
      const code = str(l.typed.itemCode);
      // By PO No.: exact. By SO + Item Code: only among POs not already on a
      // live DO (the route's own once-only rule), and only if that is one PO.
      const res = poNo
        ? await ctx.db
            .prepare("SELECT id, poNo, quantity FROM production_orders WHERE orgId = ? AND poNo = ? AND productCode = ?")
            .bind(org, poNo, code)
            .all<Row>()
        : await ctx.db
            .prepare(
              `SELECT id, poNo, quantity FROM production_orders po
                WHERE po.orgId = ? AND po.companySOId = ? AND po.productCode = ?
                  AND NOT EXISTS (SELECT 1 FROM delivery_order_items di
                                    JOIN delivery_orders d ON d.id = di.deliveryOrderId
                                   WHERE di.productionOrderId = po.id AND d.status != 'CANCELLED')`,
            )
            .bind(org, soNo, code)
            .all<Row>();
      const hits = res.results ?? [];
      if (hits.length !== 1) {
        const what = poNo ? `PO No. ${poNo} with Item Code ${code}` : `an undelivered production order of ${soNo} with Item Code ${code}`;
        throw new RouteRefusal(
          hits.length === 0
            ? `Row ${l.row}: no ${what}.`
            : `Row ${l.row}: ${hits.length} production orders match ${what} — put the PO No. on the row to say which.`,
          422,
        );
      }
      const po = hits[0];
      if (l.typed.qty !== undefined && Number(l.typed.qty) !== Number(po.quantity)) {
        throw new RouteRefusal(
          `Row ${l.row}: Qty ${l.typed.qty} but ${str(po.poNo)} is for ${Number(po.quantity)}. A DO line delivers its whole production order — leave Qty blank or match it.`,
          422,
        );
      }
      productionOrderIds.push(str(po.id));
    }
    const created = (await ctx.callRoute(deliveryOrders, "POST", "/", {
      productionOrderIds,
      ...(doc.docNo ? { doNo: doc.docNo } : {}),
      ...(doc.header.deliveryDate !== undefined ? { deliveryDate: doc.header.deliveryDate } : {}),
      ...(doc.header.remarks !== undefined ? { remarks: doc.header.remarks } : {}),
    })) as { data?: { id: string; doNo: string } };
    return { id: created.data!.id, docNo: created.data!.doNo };
  },
};
