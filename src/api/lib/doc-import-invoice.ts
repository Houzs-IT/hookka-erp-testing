// ---------------------------------------------------------------------------
// doc-import-invoice — the Sales Invoice (DI + SI) adapter for the shared
// importer (HK-0002). The reference adapter: copy its shape for a new doc type.
//
//   load   — the invoices the file names, read through GET /api/invoices/:id
//            and /:id/print-extras and mapped by the export's own builder
//            (buildInvoiceDetailRows), so "stored" is exactly what was exported.
//   update — PUT /api/invoices/:id { priceEdits } — the on-screen price editor's
//            path, GL restatement for SENT invoices included.
//   create — POST /api/invoices { deliveryOrderId, lines, invoiceNo? } — the
//            "Generate Invoice" path; then PUT priceEdits for any component the
//            sheet typed on the new lines.
// ---------------------------------------------------------------------------

import invoices from "../routes/invoices";
import { getOrgId } from "./tenant";
import { customerScopeSql } from "./customer-scope";
import { RouteRefusal, type DocImportAdapter } from "./doc-import";
import { currentFromListing, type CurrentDoc } from "../../lib/doc-import/core";
import {
  INVOICE_COMPONENTS,
  INVOICE_IMPORT_SPEC,
  invoiceEditPlan,
  validateInvoicePlan,
  type InvoiceMeta,
  type PriceEdit,
} from "../../lib/doc-import/invoice";
import { buildInvoiceDetailRows } from "../../lib/invoice-detail-export";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const invoiceImportAdapter: DocImportAdapter = {
  docTypes: ["DI", "SI"],
  resource: "invoices",
  spec: INVOICE_IMPORT_SPEC,
  validate: validateInvoicePlan,

  async load(ctx, docNos) {
    if (docNos.length === 0) return new Map<string, CurrentDoc>();
    const scope = await customerScopeSql(ctx.c, "customerId");
    const found: Row[] = [];
    for (let i = 0; i < docNos.length; i += 100) {
      const chunk = docNos.slice(i, i + 100);
      const res = await ctx.db
        .prepare(
          `SELECT id, invoiceNo, status, paidAmount, customerId, deliveryOrderId FROM invoices
            WHERE orgId = ? AND invoiceNo IN (${chunk.map(() => "?").join(",")})${scope.clause ? ` AND ${scope.clause}` : ""}`,
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
        .prepare(`SELECT id, code FROM customers WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<Row>();
      for (const r of res.results ?? []) partyCodes.set(str(r.id), str(r.code));
    }

    // The export's own fetch + mapping, pointed at the in-process routes.
    const aoa = await buildInvoiceDetailRows(
      found.map((r) => ({ id: str(r.id), invoiceNo: str(r.invoiceNo) })),
      {
        fetchJson: (url) => ctx.callRoute(invoices, "GET", url.replace(/^\/api\/invoices/, "")),
        wait: async () => {},
        confirmLarge: () => true,
        partyCodes,
      },
    );
    const idByDocNo = new Map(found.map((r) => [str(r.invoiceNo), str(r.id)]));
    const meta = new Map<string, Record<string, unknown>>(
      found.map((r) => [
        str(r.invoiceNo),
        { status: str(r.status), paidSen: Number(r.paidAmount) || 0, deliveryOrderId: str(r.deliveryOrderId) } satisfies InvoiceMeta,
      ]),
    );
    return currentFromListing(aoa, INVOICE_IMPORT_SPEC, idByDocNo, meta);
  },

  async update(ctx, doc) {
    const { edits, errors } = invoiceEditPlan(doc);
    if (errors.length > 0) throw new RouteRefusal(errors[0].message, 409); // validate() already reported these
    if (edits.length > 0) await ctx.callRoute(invoices, "PUT", `/${doc.current!.id}`, { priceEdits: edits });
  },

  async create(ctx, doc) {
    const doNo = str(doc.header.refDocNo);
    const scope = await customerScopeSql(ctx.c, "customerId");
    const dOrder = await ctx.db
      .prepare(`SELECT id FROM delivery_orders WHERE orgId = ? AND doNo = ?${scope.clause ? ` AND ${scope.clause}` : ""}`)
      .bind(getOrgId(ctx.c), doNo, ...scope.binds)
      .first<Row>();
    if (!dOrder) throw new RouteRefusal(`Delivery order ${doNo} (Ref Doc No.) not found.`, 404);
    const deliveryOrderId = str(dOrder.id);

    // Each sheet line names its DO line by Item Code. No lines = bill
    // everything still un-invoiced (the route's own default).
    let lines: Array<{ deliveryOrderItemId: string; quantity: number }> | undefined;
    const doItemByRow = new Map<number, string>();
    if (doc.lines.length > 0) {
      const res = await ctx.db
        .prepare("SELECT id, productCode FROM delivery_order_items WHERE deliveryOrderId = ?")
        .bind(deliveryOrderId)
        .all<Row>();
      const byCode = new Map<string, string[]>();
      for (const r of res.results ?? []) {
        const code = str(r.productCode);
        byCode.set(code, [...(byCode.get(code) ?? []), str(r.id)]);
      }
      lines = doc.lines.map((l) => {
        const code = str(l.typed.itemCode);
        const ids = byCode.get(code) ?? [];
        if (ids.length !== 1) {
          throw new RouteRefusal(
            ids.length === 0
              ? `Row ${l.row}: ${doNo} has no line with Item Code ${code}.`
              : `Row ${l.row}: ${doNo} carries Item Code ${code} on ${ids.length} lines — cannot tell which one to bill.`,
            422,
          );
        }
        doItemByRow.set(l.row, ids[0]);
        return { deliveryOrderItemId: ids[0], quantity: Number(l.typed.qty) };
      });
    }

    const created = (await ctx.callRoute(invoices, "POST", "/", {
      deliveryOrderId,
      ...(lines ? { lines } : {}),
      ...(doc.docNo ? { invoiceNo: doc.docNo } : {}),
    })) as { data?: { id: string; invoiceNo: string; items?: Row[] } };
    const inv = created.data!;

    // Components / discount typed on the new lines → the price editor's path.
    const priced = doc.lines.filter((l) =>
      [...INVOICE_COMPONENTS.map(([k]) => k), "discount"].some((k) => l.typed[k] !== undefined),
    );
    if (priced.length > 0) {
      const links = await ctx.db
        .prepare(`SELECT id, delivery_order_item_id AS "deliveryOrderItemId" FROM invoice_items WHERE invoiceId = ?`)
        .bind(inv.id)
        .all<Row>();
      const lineByDoItem = new Map(
        (links.results ?? []).map((r) => [str(r.deliveryOrderItemId), str(r.id)]),
      );
      const itemById = new Map((inv.items ?? []).map((it) => [str(it.id), it]));
      const edits: PriceEdit[] = priced.map((l) => {
        const id = lineByDoItem.get(doItemByRow.get(l.row)!) ?? "";
        const it = itemById.get(id) ?? {};
        const pick = (k: string, stored: unknown) => (l.typed[k] !== undefined ? Number(l.typed[k]) : Number(stored) || 0);
        return {
          id,
          baseSen: pick("base", it.basePriceSen),
          divanSen: pick("divan", it.divanPriceSen),
          legSen: pick("leg", it.legPriceSen),
          totalHeightSen: pick("totalHeight", it.totalHeightPriceSen),
          specialSen: pick("special", it.specialOrderPriceSen),
          discountSen: pick("discount", it.discountSen),
          allowZero: true,
        };
      });
      await ctx.callRoute(invoices, "PUT", `/${inv.id}`, { priceEdits: edits });
    }
    return { id: inv.id, docNo: inv.invoiceNo };
  },
};
