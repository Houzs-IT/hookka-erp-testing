// ---------------------------------------------------------------------------
// doc-import-so — the Sales Order adapter for the shared importer (HK-0002).
// Shape copied from doc-import-invoice.ts (the reference adapter).
//
//   load   — the SOs the file names, read through GET /api/sales-orders/:id and
//            mapped by the export's own builder (buildSoDetailListingAoa), so
//            "stored" is exactly what was exported.
//   update — PUT /api/sales-orders/:id { items } — the edit screen's path. The
//            route REPLACES the item list, so every stored line is sent back
//            as GET returned it (ids kept), with the typed Qty / Discount
//            applied and any new rows appended.
//   create — POST /api/sales-orders { customerId, companySODate, items } — the
//            create screen's path. The route mints the SO number and prices
//            each line (customer price > typed Unit Price > catalog).
//
// Editable on an existing SO: Qty and Discount, and new rows (blank Line ID).
// Unit Price is read-only on an edit: the route re-derives it from the
// customer price list, so a typed price would not stick.
// ---------------------------------------------------------------------------

import salesOrders from "../routes/sales-orders";
import { getOrgId } from "./tenant";
import { customerScopeSql } from "./customer-scope";
import { RouteRefusal, type DocImportAdapter, type ImportCtx } from "./doc-import";
import {
  currentFromListing,
  withFields,
  type CurrentDoc,
  type DocPlan,
  type ImportPlan,
  type ImportSpec,
  type Issue,
  type LinePlan,
} from "../../lib/doc-import/core";
import { buildSoDetailListingAoa } from "../../lib/so-detail-listing";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const holes = (n: number) => Array.from({ length: n }, () => "?").join(",");

export const SO_IMPORT_SPEC: ImportSpec = { docTypes: ["SO"], fields: withFields(["qty", "discount"]) };

export type SoProduct = { id: string; code: string; category: string };

/** The PUT/POST item for a NEW sheet row. */
function newItem(l: LinePlan, products: Map<string, SoProduct>): Row {
  const p = products.get(str(l.typed.itemCode).toUpperCase());
  return {
    productId: p?.id ?? "",
    productCode: p?.code ?? str(l.typed.itemCode),
    itemCategory: p?.category ?? "",
    quantity: Number(l.typed.qty),
    ...(l.typed.discount !== undefined ? { discountSen: Number(l.typed.discount) } : {}),
    // Honoured only when the customer has no price for the product.
    ...(l.typed.unitPrice !== undefined ? { basePriceSen: Number(l.typed.unitPrice) } : {}),
  };
}

/** The full item list for PUT: stored lines as GET returned them (typed Qty /
 *  Discount applied), then the new rows. Pure, so it is unit-tested. */
export function soItemsForPut(stored: Row[], doc: DocPlan, products: Map<string, SoProduct>): Row[] {
  const byId = new Map(doc.lines.filter((l) => l.lineId).map((l) => [l.lineId!, l]));
  const kept = stored.map((it) => {
    const l = byId.get(str(it.id));
    if (!l || l.changes.length === 0) return it;
    return { ...it, quantity: Number(l.merged.qty), discountSen: Number(l.merged.discount ?? 0) };
  });
  return [...kept, ...doc.lines.filter((l) => l.action === "create").map((l) => newItem(l, products))];
}

/** Refusals the server would otherwise only find mid-apply. */
export function validateSoPlan(plan: ImportPlan): Issue[] {
  const errors: Issue[] = [];
  for (const doc of plan.docs) {
    const label = doc.docNo ?? (doc.key || "(new)");
    const first = doc.rows[0] ?? 0;
    const newRows = doc.lines.filter((l) => l.action === "create");
    for (const l of newRows) {
      if (l.typed.itemCode === undefined) errors.push({ row: l.row, docNo: label, message: "Item Code is blank on a new line." });
      if (l.typed.qty === undefined) errors.push({ row: l.row, docNo: label, message: "Qty is blank on a new line." });
    }
    if (doc.action === "update") continue;
    if (doc.docNo) {
      errors.push({ row: first, docNo: label, message: `No sales order ${doc.docNo} was found. SO numbers are assigned by the system: leave Doc No. blank (or NEW-1, NEW-2 … for several orders) to create one.` });
    }
    if (doc.header.partyCode === undefined) errors.push({ row: first, docNo: label, message: "Party Code is blank: a new sales order needs the customer's code." });
    if (newRows.length === 0) errors.push({ row: first, docNo: label, message: "A new sales order needs at least one line (Item Code + Qty)." });
  }
  return errors;
}

async function productsByCode(ctx: ImportCtx, codes: string[]): Promise<Map<string, SoProduct>> {
  const out = new Map<string, SoProduct>();
  const want = [...new Set(codes.filter(Boolean).map((s) => s.toUpperCase()))];
  for (let i = 0; i < want.length; i += 100) {
    const chunk = want.slice(i, i + 100);
    const res = await ctx.db
      .prepare(`SELECT id, code, category FROM products WHERE UPPER(code) IN (${holes(chunk.length)})`)
      .bind(...chunk)
      .all<Row>();
    for (const r of res.results ?? []) out.set(str(r.code).toUpperCase(), { id: str(r.id), code: str(r.code), category: str(r.category) });
  }
  return out;
}

async function requireProducts(ctx: ImportCtx, lines: LinePlan[]) {
  const products = await productsByCode(ctx, lines.map((l) => str(l.typed.itemCode)));
  for (const l of lines) {
    if (!products.has(str(l.typed.itemCode).toUpperCase())) {
      throw new RouteRefusal(`Row ${l.row}: Item Code ${str(l.typed.itemCode)} is not a product.`, 422);
    }
  }
  return products;
}

export const soImportAdapter: DocImportAdapter = {
  docTypes: ["SO"],
  resource: "sales-orders",
  spec: SO_IMPORT_SPEC,
  validate: validateSoPlan,

  async load(ctx, docNos) {
    if (docNos.length === 0) return new Map<string, CurrentDoc>();
    const scope = await customerScopeSql(ctx.c, "customerId");
    const found: Row[] = [];
    for (let i = 0; i < docNos.length; i += 100) {
      const chunk = docNos.slice(i, i + 100);
      const res = await ctx.db
        .prepare(
          `SELECT id, companySOId AS "companySOId", customerId AS "customerId" FROM sales_orders
            WHERE orgId = ? AND companySOId IN (${holes(chunk.length)})${scope.clause ? ` AND ${scope.clause}` : ""}`,
        )
        .bind(getOrgId(ctx.c), ...chunk, ...scope.binds)
        .all<Row>();
      found.push(...(res.results ?? []));
    }
    if (found.length === 0) return new Map<string, CurrentDoc>();

    const custIds = [...new Set(found.map((r) => str(r.customerId)).filter(Boolean))];
    const debtorCodeByCustomerId = new Map<string, string>();
    for (let i = 0; i < custIds.length; i += 100) {
      const chunk = custIds.slice(i, i + 100);
      const res = await ctx.db
        .prepare(`SELECT id, code FROM customers WHERE id IN (${holes(chunk.length)})`)
        .bind(...chunk)
        .all<Row>();
      for (const r of res.results ?? []) debtorCodeByCustomerId.set(str(r.id), str(r.code));
    }

    // The export's own mapping over the route's own read.
    const orders = [];
    for (const r of found) orders.push((await ctx.callRoute(salesOrders, "GET", `/${str(r.id)}`)).data as Row);
    const aoa = buildSoDetailListingAoa(orders, { debtorCodeByCustomerId });
    return currentFromListing(aoa, SO_IMPORT_SPEC, new Map(found.map((r) => [str(r.companySOId), str(r.id)])));
  },

  async update(ctx, doc) {
    const id = doc.current!.id;
    const so = (await ctx.callRoute(salesOrders, "GET", `/${id}`)).data as { items?: Row[] };
    const products = await requireProducts(ctx, doc.lines.filter((l) => l.action === "create"));
    await ctx.callRoute(salesOrders, "PUT", `/${id}`, { items: soItemsForPut(so.items ?? [], doc, products) });
  },

  async create(ctx, doc) {
    const code = str(doc.header.partyCode);
    const scope = await customerScopeSql(ctx.c, "id");
    const res = await ctx.db
      .prepare(`SELECT id FROM customers WHERE code = ?${scope.clause ? ` AND ${scope.clause}` : ""} LIMIT 2`)
      .bind(code, ...scope.binds)
      .all<Row>();
    const custs = res.results ?? [];
    if (custs.length !== 1) {
      throw new RouteRefusal(custs.length === 0 ? `Customer ${code} (Party Code) not found.` : `Party Code ${code} matches more than one customer.`, 422);
    }
    const products = await requireProducts(ctx, doc.lines);
    const created = (await ctx.callRoute(salesOrders, "POST", "/", {
      customerId: str(custs[0].id),
      ...(doc.header.docDate !== undefined ? { companySODate: str(doc.header.docDate) } : {}),
      items: doc.lines.map((l) => newItem(l, products)),
    })) as { data?: { id: string; companySOId: string } };
    return { id: created.data!.id, docNo: created.data!.companySOId };
  },
};
