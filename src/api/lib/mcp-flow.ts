// ---------------------------------------------------------------------------
// mcp-flow.ts — the AI Connector's document_flow (owner 2026-11-26: find the
// transaction flow SO → production order → job cards → DO → invoice → payment,
// and the reverse).
//
// Pure shaping over what the ERP already answers, read AS THE PERSON through
// routes/mcp.ts readValue (module gate + money redaction unchanged):
//   1. the anchor: a search hit (or "kind:id") for a sales / service order,
//      production order, delivery order or invoice;
//   2. its sales order(s): an SO is itself; a production order, invoice or DO
//      names its salesOrderId / companySOId (a consolidated DO lists one SO per
//      line, salesOrderNo);
//   3. each SO's chain from GET /api/sales-orders/:id (linkedPOs + job cards,
//      linkedDOs, linkedInvoices, linkedPayments — the same lists the SO page's
//      document-flow diagram draws) plus /:ref/footprint for the open job cards.
// Money: sen in, RM out; a field the redactor removed comes back as null.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const rmOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) / 100 : null;
};
const day = (v: unknown): string | null => (s(v) ? s(v).slice(0, 10) : null);

export const FLOW_KINDS = ["sales_order", "service_order", "production_order", "delivery_order", "invoice"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

/** Detail endpoint per anchor kind (read as the person). */
export const FLOW_API: Record<FlowKind, string> = {
  sales_order: "/api/sales-orders",
  service_order: "/api/sales-orders",
  production_order: "/api/production-orders",
  delivery_order: "/api/delivery-orders",
  invoice: "/api/invoices",
};

/** The ERP page for one link (the same pages search links to). */
export function flowUrl(origin: string, type: string, id: string, number = ""): string {
  const e = encodeURIComponent;
  if (type === "sales-order") return `${origin}/sales/${e(id)}`;
  if (type === "production-order") return `${origin}/production/${e(id)}`;
  if (type === "delivery-order") return `${origin}/delivery/${e(id)}`;
  if (type === "invoice") return `${origin}/invoices/${e(id)}`;
  if (type === "payment") return `${origin}/invoices/payments?payments.q=${e(number || id)}`;
  return origin;
}

/** "kind:rowId" straight from a search result. */
export function parseAnchorId(raw: string): { kind: FlowKind; id: string } | null {
  const m = /^([a-z_]{2,40}):([A-Za-z0-9._-]{1,80})$/.exec(raw.trim());
  if (!m || !(FLOW_KINDS as readonly string[]).includes(m[1])) return null;
  return { kind: m[1] as FlowKind, id: m[2] };
}

/**
 * The best flow anchor in a /api/search reply: an exact number match first,
 * then the first hit of a flow kind (sales orders before the rest).
 */
export function pickFlowAnchor(searchBody: unknown, query: string): { kind: FlowKind; id: string; label: string } | null {
  const q = query.trim().toLowerCase();
  const hits: { kind: FlowKind; id: string; label: string }[] = [];
  for (const g of arr(obj(obj(searchBody).data).groups)) {
    const kind = s(g.kind);
    if (!(FLOW_KINDS as readonly string[]).includes(kind)) continue;
    for (const it of arr(g.items)) {
      const id = s(it.id);
      if (id) hits.push({ kind: kind as FlowKind, id, label: s(it.label) });
    }
  }
  const exact = hits.find((h) => h.label.toLowerCase() === q || h.id.toLowerCase() === q);
  if (exact) return exact;
  const order = (k: FlowKind) => FLOW_KINDS.indexOf(k);
  return hits.sort((a, b) => order(a.kind) - order(b.kind))[0] ?? null;
}

/**
 * The sales order reference(s) behind a document's detail reply. An SO is its
 * own id; a production order / invoice names its SO; a consolidated DO carries
 * one SO number per line. At most 5. `viaDo` is an invoice's DO, to try when it
 * names no SO.
 */
export function soRefsFromDoc(kind: FlowKind, id: string, detail: unknown): { refs: string[]; viaDo: string | null } {
  if (kind === "sales_order" || kind === "service_order") return { refs: [id], viaDo: null };
  const d = obj(obj(detail).data ?? detail);
  const refs: string[] = [];
  const add = (v: unknown) => {
    const r = s(v).trim();
    if (r && !refs.includes(r)) refs.push(r);
  };
  add(d.salesOrderId);
  if (!refs.length) add(d.companySOId);
  if (kind === "delivery_order" && !refs.length) for (const it of arr(d.items)) add(it.salesOrderNo);
  const viaDo = kind === "invoice" && !refs.length && s(d.deliveryOrderId) ? s(d.deliveryOrderId) : null;
  return { refs: refs.slice(0, 5), viaDo };
}

export type FlowLink = {
  type: "sales-order" | "production-order" | "job-cards" | "delivery-order" | "invoice" | "payment";
  number: string;
  status: string;
  date: string | null;
  amountRm: number | null;
  url: string;
  detail?: string;
};

/** One SO detail reply (+ its footprint, optional) → the chain, in flow order. */
export function shapeFlow(soDetail: unknown, footprint: unknown, origin: string): { salesOrder: string; customer: string; links: FlowLink[] } {
  const body = obj(soDetail);
  const so = obj(body.data ?? soDetail);
  const soId = s(so.id);
  const soNo = s(so.companySOId) || s(so.companySO) || soId;
  const links: FlowLink[] = [
    {
      type: "sales-order",
      number: soNo,
      status: s(so.status),
      date: day(so.companySODate ?? so.createdAt),
      amountRm: rmOrNull(so.totalSen),
      url: flowUrl(origin, "sales-order", soId),
      ...(s(so.customerPOId) ? { detail: `Customer PO ${s(so.customerPOId)}` } : {}),
    },
  ];
  let cards = 0;
  let cardsDone = 0;
  for (const p of arr(body.linkedPOs)) {
    const jcs = arr(p.jobCards);
    const done = jcs.filter((j) => s(j.status) === "COMPLETED" || s(j.status) === "TRANSFERRED").length;
    cards += jcs.length;
    cardsDone += done;
    const where = s(p.currentDepartment);
    links.push({
      type: "production-order",
      number: s(p.poNo),
      status: s(p.status),
      date: day(p.completedDate ?? p.targetEndDate ?? p.startDate),
      amountRm: null,
      url: flowUrl(origin, "production-order", s(p.id)),
      detail: [s(p.productCode) || s(p.productName), p.quantity ? `qty ${s(p.quantity)}` : "", where ? `at ${where}` : "", jcs.length ? `job cards ${done}/${jcs.length} done` : "", s(p.deliveryDoNo) ? `on ${s(p.deliveryDoNo)}` : ""]
        .filter(Boolean)
        .join(" · "),
    });
  }
  const openRow = arr(obj(obj(footprint).data ?? footprint).rows).find((r) => s(r.table) === "job_cards (not yet finished)");
  if (cards > 0 || openRow) {
    const open = openRow ? Number(openRow.count) || 0 : cards - cardsDone;
    links.push({
      type: "job-cards",
      number: `${cards} job card${cards === 1 ? "" : "s"}`,
      status: open > 0 ? `${open} still open` : "all finished",
      date: null,
      amountRm: null,
      url: flowUrl(origin, "sales-order", soId),
    });
  }
  for (const d of arr(body.linkedDOs)) {
    links.push({
      type: "delivery-order",
      number: s(d.doNo),
      status: s(d.status),
      date: day(d.deliveredAt ?? d.dispatchedAt ?? d.scheduledDate),
      amountRm: null,
      url: flowUrl(origin, "delivery-order", s(d.id)),
      ...(s(d.driverName) ? { detail: `driver ${s(d.driverName)}` } : {}),
    });
  }
  for (const i of arr(body.linkedInvoices)) {
    const paid = rmOrNull(i.paidAmount);
    links.push({
      type: "invoice",
      number: s(i.invoiceNo),
      status: s(i.status),
      // The SO's invoice list carries no invoice date; the paid date is the one it has.
      date: null,
      amountRm: rmOrNull(i.totalSen),
      url: flowUrl(origin, "invoice", s(i.id)),
      ...(paid !== null ? { detail: `paid RM ${paid.toFixed(2)}${day(i.paymentDate) ? ` on ${day(i.paymentDate)}` : ""}` } : {}),
    });
  }
  for (const p of arr(body.linkedPayments)) {
    links.push({
      type: "payment",
      number: s(p.receiptNumber),
      status: s(p.status),
      date: day(p.date),
      amountRm: rmOrNull(p.amount),
      url: flowUrl(origin, "payment", s(p.id), s(p.receiptNumber)),
    });
  }
  return { salesOrder: soNo, customer: s(so.customerName), links };
}

// ── purchase flow: PO → GRN → purchase invoice (round 3, FAQ P5) ────────────

/**
 * A purchase order the person asked for: "purchase_order:<id>" from search, or
 * a search hit of kind purchase_order whose number matches exactly (or the
 * only purchase-order hit when no sales-side document matched).
 */
export function pickPurchaseAnchor(raw: string, searchBody: unknown): string | null {
  const m = /^purchase_order:([A-Za-z0-9._-]{1,80})$/.exec(raw.trim());
  if (m) return m[1];
  if (searchBody === null || searchBody === undefined) return null;
  const q = raw.trim().toLowerCase();
  const groups = arr(obj(obj(searchBody).data).groups);
  const pos = groups.filter((g) => s(g.kind) === "purchase_order").flatMap((g) => arr(g.items));
  const exact = pos.find((it) => s(it.label).toLowerCase() === q || s(it.id).toLowerCase() === q);
  if (exact) return s(exact.id) || null;
  const salesSide = groups.some((g) => (FLOW_KINDS as readonly string[]).includes(s(g.kind)) && arr(g.items).length);
  return !salesSide && pos.length === 1 ? s(pos[0].id) || null : null;
}

export type PurchaseFlowLink = { type: "purchase-order" | "grn" | "purchase-invoice"; number: string; status: string; date: string | null; amountRm: number | null; url: string; detail?: string };

/** PO detail + its GRNs (GET /api/grn?poId=) + the supplier's purchase invoices (filtered to this PO) → the chain. */
export function shapePurchaseFlow(poDetail: unknown, grns: unknown, pis: unknown, origin: string): { purchaseOrder: string; supplier: string; links: PurchaseFlowLink[] } {
  const po = obj(obj(poDetail).data ?? poDetail);
  const poId = s(po.id);
  const poNo = s(po.poNo) || poId;
  const e = encodeURIComponent;
  const rows = (v: unknown): Obj[] => (Array.isArray(v) ? arr(v) : arr(obj(v).data));
  const links: PurchaseFlowLink[] = [
    { type: "purchase-order", number: poNo, status: s(po.status), date: day(po.orderDate), amountRm: rmOrNull(po.totalSen), url: `${origin}/procurement/${e(poId)}`, ...(day(po.expectedDate) ? { detail: `expected ${day(po.expectedDate)}` } : {}) },
  ];
  const grnRows = rows(grns);
  const grnIds = new Set(grnRows.map((g) => s(g.id)));
  for (const g of grnRows) {
    links.push({ type: "grn", number: s(g.grnNumber), status: s(g.status), date: day(g.receiveDate), amountRm: null, url: `${origin}/procurement/grn/${e(s(g.id))}`, ...(s(g.arrival_state) ? { detail: `arrival ${s(g.arrival_state)}` } : {}) });
  }
  for (const p of rows(pis)) {
    const mine = s(p.purchaseOrderId) === poId || grnIds.has(s(p.grnId)) || (!!poNo && s(p.poRef).includes(poNo));
    if (!mine) continue;
    const paid = rmOrNull(p.paidAmountSen);
    links.push({
      type: "purchase-invoice",
      number: s(p.piNo) || s(p.supplierInvoiceNo),
      status: s(p.status),
      date: day(p.invoiceDate),
      amountRm: rmOrNull(p.amountSen),
      url: `${origin}/procurement/pi/${e(s(p.id))}`,
      detail: [s(p.supplierInvoiceNo) ? `supplier inv ${s(p.supplierInvoiceNo)}` : "", day(p.dueDate) ? `due ${day(p.dueDate)}` : "", paid !== null ? `paid RM ${paid.toFixed(2)}` : ""].filter(Boolean).join(" · "),
    });
  }
  return { purchaseOrder: poNo, supplier: s(po.supplierName), links };
}
