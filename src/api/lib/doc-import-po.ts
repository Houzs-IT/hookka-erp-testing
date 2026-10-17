// ---------------------------------------------------------------------------
// doc-import-po — the Purchase Order adapter for the shared importer (HK-0002).
// Shape copied from doc-import-invoice.ts (the reference adapter).
//
//   load   — the POs the file names, read through GET /api/purchase-orders/:id
//            and mapped by the export's own builder (buildPoDetailListingAoa),
//            so "stored" is exactly what was exported.
//   update — PUT /api/purchase-orders/:id — the detail page's edit path. PUT
//            replaces the whole item list, so EVERY stored line is sent (lines
//            the file leaves out are kept as stored), with the typed Qty /
//            Unit Price applied and blank-Line-ID rows appended as new lines.
//            Doc Date → orderDate.
//   create — POST /api/purchase-orders { supplierId, supplierName, items }.
//            Party Code names the supplier; each line names a raw material by
//            Item Code and gives Qty + Unit Price. The route assigns the PO No.
//
// UOM is never sent for a new line: the route takes it from the raw material's
// baseUOM (HK-0037). An existing line sends back its stored unit, so an import
// never re-unitises a line it did not mean to touch.
// ---------------------------------------------------------------------------

import purchaseOrders from "../routes/purchase-orders";
import { getOrgId } from "./tenant";
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
import { buildPoDetailListingAoa, type PODetailItem, type PODetailOrder } from "../../lib/doc-detail-listings";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const ucode = (v: unknown) => str(v).trim().toUpperCase();

export const PO_IMPORT_SPEC: ImportSpec = {
  docTypes: ["PO"],
  fields: withFields(
    ["docDate", "qty", "unitPrice"],
    [{ key: "supplierSku", header: "Supplier SKU", kind: "text", level: "line" }],
  ),
};

/** Adapter-private state carried from load to validate / update. */
export type PoMeta = { status: string; receivedQty: number; items: PODetailItem[] };

const LOCKED = new Set(["CANCELLED", "RECEIVED", "CLOSED"]);

/** Refusals the server would otherwise only find mid-apply. */
export function validatePoPlan(plan: ImportPlan): Issue[] {
  const errors: Issue[] = [];
  for (const doc of plan.docs) {
    const label = doc.docNo ?? (doc.key || "(new)");
    const first = doc.rows[0] ?? 0;
    const newLines = doc.lines.filter((l) => l.action === "create");
    for (const l of newLines) {
      if (l.typed.itemCode === undefined) errors.push({ row: l.row, docNo: label, message: "Item Code is blank — a new line needs the raw material code." });
      if (l.typed.qty === undefined) errors.push({ row: l.row, docNo: label, message: "Qty is blank — say how many to order on this new line." });
      if (l.typed.unitPrice === undefined) errors.push({ row: l.row, docNo: label, message: "Unit Price is blank — a new line needs a price (type 0 for a free line)." });
    }
    if (doc.action === "update") {
      const meta = (doc.current?.meta ?? {}) as Partial<PoMeta>;
      const asks = doc.headerChanges.length > 0 || newLines.length > 0 || doc.lines.some((l) => l.changes.length > 0);
      if (asks && (LOCKED.has(meta.status ?? "") || (meta.receivedQty ?? 0) > 0)) {
        errors.push({
          row: first,
          docNo: label,
          message: `${label} is ${meta.status}${(meta.receivedQty ?? 0) > 0 ? " with goods received" : ""} — it can no longer be edited (same lock as the PO page).`,
        });
      }
      continue;
    }
    if (doc.docNo) {
      errors.push({ row: first, docNo: label, message: `${doc.docNo} is not an existing PO. A new PO's number is assigned on save — leave Doc No. blank or use NEW-1, NEW-2… to split new POs.` });
    }
    if (doc.header.partyCode === undefined) errors.push({ row: first, docNo: label, message: "Party Code is blank — a new PO needs the supplier code." });
    if (doc.lines.length === 0) errors.push({ row: first, docNo: label, message: "A new PO needs at least one line (Item Code, Qty, Unit Price)." });
  }
  return errors;
}

type RmInfo = { code: string; name: string; group: string };

/** Raw materials for every new line, by upper-cased code. Unknown = refused. */
async function rawMaterials(ctx: ImportCtx, lines: LinePlan[]): Promise<Map<string, RmInfo>> {
  const codes = [...new Set(lines.map((l) => ucode(l.typed.itemCode)).filter(Boolean))];
  const out = new Map<string, RmInfo>();
  for (let i = 0; i < codes.length; i += 90) {
    const chunk = codes.slice(i, i + 90);
    const res = await ctx.db
      .prepare(
        `SELECT itemCode, description, itemGroup FROM raw_materials WHERE orgId = ? AND UPPER(TRIM(itemCode)) IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(getOrgId(ctx.c), ...chunk)
      .all<Row>();
    for (const r of res.results ?? []) {
      const k = ucode(r.itemCode);
      if (!out.has(k)) out.set(k, { code: str(r.itemCode).trim(), name: str(r.description), group: str(r.itemGroup) });
    }
  }
  for (const l of lines) {
    if (!out.has(ucode(l.typed.itemCode))) throw new RouteRefusal(`Row ${l.row}: no raw material with Item Code ${str(l.typed.itemCode)}.`, 422);
  }
  return out;
}

/** A new PO line body. No `unit`: the route sets it from the RM's baseUOM. */
function newItem(l: LinePlan, rm: Map<string, RmInfo>) {
  const m = rm.get(ucode(l.typed.itemCode))!;
  return {
    materialCode: m.code,
    materialName: str(l.typed.description) || m.name,
    materialCategory: m.group,
    supplierSKU: str(l.typed.supplierSku),
    quantity: Number(l.typed.qty),
    unitPriceSen: Number(l.typed.unitPrice),
  };
}

/** PUT replaces all items: every stored line (typed edits applied), then the new ones. */
export function poUpdateItems(doc: DocPlan, rm: Map<string, RmInfo> = new Map()) {
  const meta = (doc.current?.meta ?? {}) as Partial<PoMeta>;
  const edits = new Map(doc.lines.filter((l) => l.action === "update").map((l) => [l.lineId!, l]));
  const kept = (meta.items ?? []).map((it) => {
    const l = edits.get(str(it.id));
    const changed = new Set(l?.changes.map((ch) => ch.key) ?? []);
    return {
      id: it.id,
      materialCode: it.materialCode ?? "",
      materialName: it.materialName ?? "",
      materialCategory: it.materialCategory ?? "",
      supplierSKU: it.supplierSKU ?? "",
      // Unchanged price goes back exactly as stored (sub-sen rates included).
      quantity: changed.has("qty") ? Number(l!.typed.qty) : Number(it.quantity) || 0,
      unitPriceSen: changed.has("unitPrice") ? Number(l!.typed.unitPrice) : Number(it.unitPriceSen) || 0,
      receivedQty: Number(it.receivedQty) || 0,
      unit: it.unit ?? "",
    };
  });
  return [...kept, ...doc.lines.filter((l) => l.action === "create").map((l) => newItem(l, rm))];
}

export function makePoImportAdapter(route: Parameters<ImportCtx["callRoute"]>[0] = purchaseOrders): DocImportAdapter {
  return {
    docTypes: ["PO"],
    resource: "purchase-orders",
    spec: PO_IMPORT_SPEC,
    validate: validatePoPlan,

    async load(ctx, docNos) {
      if (docNos.length === 0) return new Map<string, CurrentDoc>();
      const found: Row[] = [];
      for (let i = 0; i < docNos.length; i += 90) {
        const chunk = docNos.slice(i, i + 90);
        const res = await ctx.db
          .prepare(`SELECT id, poNo FROM purchase_orders WHERE orgId = ? AND poNo IN (${chunk.map(() => "?").join(",")})`)
          .bind(getOrgId(ctx.c), ...chunk)
          .all<Row>();
        found.push(...(res.results ?? []));
      }
      if (found.length === 0) return new Map<string, CurrentDoc>();

      // The export's own source (the detail route) and its own builder.
      const orders: Array<PODetailOrder & { id: string }> = [];
      for (const r of found) {
        const res = await ctx.callRoute(route, "GET", `/${str(r.id)}`);
        orders.push(res.data as PODetailOrder & { id: string });
      }
      const supIds = [...new Set(orders.map((o) => str(o.supplierId)).filter(Boolean))];
      const partyCodes = new Map<string, string>();
      for (let i = 0; i < supIds.length; i += 90) {
        const chunk = supIds.slice(i, i + 90);
        const res = await ctx.db
          .prepare(`SELECT id, code FROM suppliers WHERE id IN (${chunk.map(() => "?").join(",")})`)
          .bind(...chunk)
          .all<Row>();
        for (const r of res.results ?? []) partyCodes.set(str(r.id), str(r.code));
      }
      const aoa = buildPoDetailListingAoa(orders, partyCodes);
      const idByDocNo = new Map(orders.map((o) => [str(o.poNo), o.id]));
      const meta = new Map<string, Record<string, unknown>>(
        orders.map((o) => [
          str(o.poNo),
          {
            status: str(o.status),
            receivedQty: (o.items ?? []).reduce((s, it) => s + (Number(it.receivedQty) || 0), 0),
            items: o.items ?? [],
          } satisfies PoMeta,
        ]),
      );
      return currentFromListing(aoa, PO_IMPORT_SPEC, idByDocNo, meta);
    },

    async update(ctx, doc) {
      const body: Record<string, unknown> = {};
      const date = doc.headerChanges.find((ch) => ch.key === "docDate");
      if (date) body.orderDate = date.to;
      if (doc.lines.some((l) => l.action === "create" || l.changes.length > 0)) {
        const rm = await rawMaterials(ctx, doc.lines.filter((l) => l.action === "create"));
        body.items = poUpdateItems(doc, rm);
      }
      await ctx.callRoute(route, "PUT", `/${doc.current!.id}`, body);
    },

    async create(ctx, doc) {
      const code = str(doc.header.partyCode);
      const sup = await ctx.db
        .prepare("SELECT id, name FROM suppliers WHERE orgId = ? AND code = ?")
        .bind(getOrgId(ctx.c), code)
        .first<Row>();
      if (!sup) throw new RouteRefusal(`Supplier ${code} (Party Code) not found.`, 404);
      const rm = await rawMaterials(ctx, doc.lines);
      const created = (await ctx.callRoute(route, "POST", "/", {
        supplierId: str(sup.id),
        supplierName: str(sup.name),
        ...(doc.header.docDate !== undefined ? { orderDate: doc.header.docDate } : {}),
        items: doc.lines.map((l) => newItem(l, rm)),
      })) as { data?: { id: string; poNo: string } };
      return { id: created.data!.id, docNo: created.data!.poNo };
    },
  };
}

export const poImportAdapter = makePoImportAdapter();
