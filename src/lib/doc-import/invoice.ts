// ---------------------------------------------------------------------------
// doc-import/invoice — the pure half of the Sales Invoice (DI + SI) importer.
//
// DI = a Delivery Invoice, raised from a delivery order (invoices.deliveryOrderId
// set). SI = an invoice with no DO (consignment-note conversion, opening
// balance). Same table, same export, one importer.
//
// EDIT reprices lines through planInvoicePriceImport — the rules the old
// "Import Prices" button enforced (DRAFT / unpaid SENT only, the exported Unit
// Price must still be the line's price, no negatives) — and the server applies
// the result through PUT /api/invoices/:id priceEdits, the same path the
// on-screen price editor uses (GL restatement included).
//
// CREATE is a DI only: Ref Doc No. names the delivery order, each line names
// the DO line by Item Code and the Qty to bill. POST /api/invoices is the only
// route that creates an invoice from scratch and it requires a DO.
// ---------------------------------------------------------------------------

import { withFields, type DocPlan, type ImportPlan, type ImportSpec, type Issue, type Values } from "./core";
import { planInvoicePriceImport, type CurrentLine, type ImportRow } from "../invoice-price-import";

/** The five price components, sheet key → PUT priceEdits key. */
export const INVOICE_COMPONENTS = [
  ["base", "baseSen"],
  ["divan", "divanSen"],
  ["leg", "legSen"],
  ["totalHeight", "totalHeightSen"],
  ["special", "specialSen"],
] as const;

export const INVOICE_IMPORT_SPEC: ImportSpec = {
  docTypes: ["DI", "SI"],
  fields: withFields(
    ["base", "divan", "leg", "totalHeight", "special", "discount"],
    [
      { key: "base", header: "Base", kind: "money", level: "line" },
      { key: "divan", header: "Divan", kind: "money", level: "line" },
      { key: "leg", header: "Leg", kind: "money", level: "line" },
      { key: "totalHeight", header: "T.Height", kind: "money", level: "line" },
      { key: "special", header: "Special", kind: "money", level: "line" },
    ],
  ),
};

export type InvoiceMeta = { status: string; paidSen: number; deliveryOrderId: string };

export type PriceEdit = {
  id: string;
  baseSen: number;
  divanSen: number;
  legSen: number;
  totalHeightSen: number;
  specialSen: number;
  discountSen: number;
  allowZero: true;
};

const sen = (v: Values, k: string) => Number(v[k] ?? 0) || 0;
const rmOrUndef = (v: Values, k: string) => (v[k] === undefined ? undefined : Number(v[k]) / 100);

/**
 * The priceEdits an EDIT doc asks for, and the rows refused. Only lines with a
 * changed editable cell are judged — an untouched row asks for nothing.
 */
export function invoiceEditPlan(doc: DocPlan): { edits: PriceEdit[]; errors: Issue[] } {
  const errors: Issue[] = [];
  const cur = doc.current;
  if (!cur) return { edits: [], errors };
  const meta = (cur.meta ?? {}) as Partial<InvoiceMeta>;
  const stored = new Map(cur.lines.map((l) => [l.lineId, l.values]));
  const asked = doc.lines.filter((l) => l.action === "update" && l.changes.length > 0);
  const rows: ImportRow[] = asked.map((l) => ({
    lineId: l.lineId,
    invoiceNo: cur.docNo,
    exportedUnit: rmOrUndef(l.typed, "unitPrice"),
    base: rmOrUndef(l.typed, "base"),
    divan: rmOrUndef(l.typed, "divan"),
    leg: rmOrUndef(l.typed, "leg"),
    totalHeight: rmOrUndef(l.typed, "totalHeight"),
    special: rmOrUndef(l.typed, "special"),
    discount: rmOrUndef(l.typed, "discount"),
  }));
  const current = new Map<string, CurrentLine>();
  for (const l of asked) {
    const v = stored.get(l.lineId!) ?? {};
    current.set(l.lineId!, {
      id: l.lineId!,
      invoiceNo: cur.docNo,
      invoiceId: cur.id,
      invoiceStatus: meta.status ?? "",
      invoicePaidSen: meta.paidSen ?? 0,
      quantity: sen(v, "qty"),
      unitPriceSen: sen(v, "unitPrice"),
      basePriceSen: sen(v, "base"),
      divanPriceSen: sen(v, "divan"),
      legPriceSen: sen(v, "leg"),
      totalHeightPriceSen: sen(v, "totalHeight"),
      specialOrderPriceSen: sen(v, "special"),
      discountSen: sen(v, "discount"),
    });
  }
  const plan = planInvoicePriceImport(rows, current);
  for (const r of plan.rejections) {
    // planInvoicePriceImport numbers rows from its own array (i + 2).
    errors.push({ row: asked[r.row - 2]?.row ?? r.row, docNo: cur.docNo, message: r.reason });
  }
  const edits: PriceEdit[] = plan.changes.map((ch) => ({
    id: ch.lineId,
    baseSen: ch.after.base,
    divanSen: ch.after.divan,
    legSen: ch.after.leg,
    totalHeightSen: ch.after.totalHeight,
    specialSen: ch.after.special,
    discountSen: ch.after.discount,
    // The sheet distinguishes blank (keep) from a typed 0, so a zero here was
    // typed on purpose.
    allowZero: true,
  }));
  return { edits, errors };
}

/** Refusals the server would otherwise only find mid-apply. */
export function validateInvoicePlan(plan: ImportPlan): Issue[] {
  const errors: Issue[] = [];
  for (const doc of plan.docs) {
    const label = doc.docNo ?? (doc.key || "(new)");
    const first = doc.rows[0] ?? 0;
    if (doc.action === "update") {
      for (const l of doc.lines)
        if (l.action === "create")
          errors.push({ row: l.row, docNo: label, message: "A row without a Line ID would ADD a line to an existing invoice — not supported by import. Add it on the invoice, or put the Line ID back." });
      errors.push(...invoiceEditPlan(doc).errors);
      continue;
    }
    if (String(doc.header.docType ?? "").toUpperCase() === "SI" || doc.header.refDocNo === undefined) {
      errors.push({ row: first, docNo: label, message: "A new invoice needs Ref Doc No. = the delivery order it bills (Doc Type DI). An SI without a DO cannot be created by import — no route creates one." });
    }
    const codes = new Map<string, number>();
    for (const l of doc.lines) {
      if (l.typed.qty === undefined) errors.push({ row: l.row, docNo: label, message: "Qty is blank — say how many to bill on this line." });
      const code = String(l.typed.itemCode ?? "");
      if (codes.has(code)) errors.push({ row: l.row, docNo: label, message: `Item Code ${code} is listed twice on this new invoice (row ${codes.get(code)}). One row per DO line.` });
      codes.set(code, l.row);
    }
  }
  return errors;
}
