// ---------------------------------------------------------------------------
// flow-files.ts — attachments on the flow documents and their lines (review
// pass 2 C1-5, ported from Conts#278).
//
// Photos, videos and PDFs can be attached to a purchase order, goods receipt,
// purchase invoice, delivery order, delivery return or invoice, and to each
// line of those documents. Everything lives in the SHARED /api/files store
// (file_assets: resourceType + resourceId) — no new table, no migration. The
// type names are the ones the phone app (/m) already writes ("PO", "GRN_LINE",
// …), so a file attached on the phone shows on the desktop page and back.
//
// A line's files also show READ-ONLY on the lines made from it down the chain:
//   PO line → GRN line → PI line
//   SO line → DO line → invoice line, and DO line → delivery-return line
// Nothing is copied: the server resolves the line link on every read
// (src/api/lib/flow-line-files.ts).
//
// Shared by the browser and the Worker, so PURE — no DOM, no DB. Display only:
// nothing here reads or writes a quantity, a price or a stock figure.
// ---------------------------------------------------------------------------

/** The flow documents that carry attachments, keyed by their file_assets type. */
export type FlowDoc = "PO" | "GRN" | "PI" | "DO" | "INVOICE" | "DR";

export const FLOW_DOCS: readonly FlowDoc[] = ["PO", "GRN", "PI", "DO", "INVOICE", "DR"];

/** The file_assets resourceType of a document's lines (resourceId = the line id). */
export const FLOW_LINE_TYPE: Record<FlowDoc, string> = {
  PO: "PO_LINE",
  GRN: "GRN_LINE",
  PI: "PI_LINE",
  DO: "DO_LINE",
  INVOICE: "INVOICE_LINE",
  DR: "DR_LINE",
};

/** The RBAC resource whose read / update permission guards a document's files. */
export const FLOW_DOC_RESOURCE: Record<FlowDoc, string> = {
  PO: "purchase-orders",
  GRN: "grn",
  PI: "purchase-invoices",
  DO: "delivery-orders",
  INVOICE: "invoices",
  DR: "delivery-returns",
};

/**
 * file_assets resourceType → the RBAC resource that guards it. Viewing needs
 * that resource's `read`, uploading or deleting needs its `update` (a file on a
 * document is part of editing that document). `grn` (lower case) is the GRN
 * receipt-photo type from review C2-4; it is the same document.
 *
 * A type NOT listed here keeps the old file-store gate (files:create to upload,
 * files:delete to delete, open read) — SO, SO_LINE, products, equipment … are
 * deliberately unchanged by this batch.
 */
const RESOURCE_BY_TYPE: Record<string, string> = {
  PO: "purchase-orders",
  PO_LINE: "purchase-orders",
  GRN: "grn",
  grn: "grn",
  GRN_LINE: "grn",
  PI: "purchase-invoices",
  PI_LINE: "purchase-invoices",
  DO: "delivery-orders",
  DO_LINE: "delivery-orders",
  INVOICE: "invoices",
  INVOICE_LINE: "invoices",
  DR: "delivery-returns",
  DR_LINE: "delivery-returns",
  // A customer's signed CTOS / CCRIS consent form (owner 2026-11-11, WORK-TRACKER
  // 134): it carries IC and phone numbers, so it is gated like the customer.
  CUSTOMER_CONSENT: "customers",
};

export function flowFileResource(resourceType: unknown): string | null {
  const t = String(resourceType ?? "").trim();
  return Object.prototype.hasOwnProperty.call(RESOURCE_BY_TYPE, t) ? RESOURCE_BY_TYPE[t] : null;
}

export function isFlowDoc(v: unknown): v is FlowDoc {
  return typeof v === "string" && (FLOW_DOCS as readonly string[]).includes(v);
}

/** What a carried-down file is labelled with on the downstream line. */
export const UPSTREAM_LINE_LABEL: Record<string, string> = {
  PO_LINE: "Purchase order line",
  GRN_LINE: "Goods receipt line",
  SO_LINE: "Sales order line",
  DO_LINE: "Delivery order line",
};

/** The upload picker: photos, videos and PDFs (the /api/files allowlist). */
export const FLOW_FILE_ACCEPT = "image/*,video/mp4,video/quicktime,video/webm,video/3gpp,application/pdf";

/** Images are downscaled before upload, like the POD photos: longest side, JPEG quality. */
export const FLOW_PHOTO_MAX_DIM = 1600;
export const FLOW_PHOTO_QUALITY = 0.8;

export type FlowFileKind = "image" | "video" | "pdf" | "other";

export function flowFileKind(contentType: unknown, filename: unknown): FlowFileKind {
  const ct = String(contentType ?? "").toLowerCase();
  const name = String(filename ?? "").toLowerCase();
  if (ct.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/.test(name)) return "image";
  if (ct.startsWith("video/") || /\.(mp4|mov|webm|3gp)$/.test(name)) return "video";
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "other";
}

/**
 * Should this file be shrunk in the browser before it is sent? Still photos
 * only: a GIF would lose its animation, HEIC can't be decoded by a desktop
 * browser (it goes up as-is and the server accepts it), and a photo that is
 * already small is left alone.
 */
export function shouldDownscale(file: { type?: string; name?: string; size?: number }): boolean {
  const ct = String(file.type ?? "").toLowerCase();
  if (!/^image\/(jpe?g|png|webp)$/.test(ct)) return false;
  return Number(file.size ?? 0) > 300 * 1024;
}

/** "IMG_1234.PNG" → "IMG_1234.jpg" — the downscaled copy is always JPEG. */
export function jpegName(name: unknown): string {
  const base = String(name ?? "").trim() || "photo";
  return base.replace(/\.[A-Za-z0-9]+$/, "") + ".jpg";
}

export type FlowFileRow = {
  id: string;
  resourceType: string;
  resourceId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt?: string | null;
};

export type InheritedFileRow = FlowFileRow & {
  /** The upstream line type the file sits on, e.g. "PO_LINE". */
  fromType: string;
  /** "Purchase order line" — what the downstream page shows above it. */
  fromLabel: string;
};

export type LineFiles = { own: FlowFileRow[]; inherited: InheritedFileRow[] };

export type LineRef = { type: string; id: string };

/** Read a file_assets row dual-keyed (the adapter may hand back snake_case). */
export function normalizeFileRow(r: Record<string, unknown>): FlowFileRow {
  return {
    id: String(r.id ?? ""),
    resourceType: String(r.resourceType ?? r.resource_type ?? ""),
    resourceId: String(r.resourceId ?? r.resource_id ?? ""),
    filename: String(r.filename ?? ""),
    contentType: String(r.contentType ?? r.content_type ?? ""),
    sizeBytes: Number(r.sizeBytes ?? r.size_bytes ?? 0) || 0,
    uploadedAt: (r.uploadedAt ?? r.uploaded_at ?? null) as string | null,
  };
}

/**
 * Sort the files of one document's lines into "own" and "carried down".
 * PURE. `upstream` maps a line id to the upstream lines it was made from;
 * `rows` are every file_assets row on the own type AND the upstream refs. A
 * file whose upstream type the reader may not see is dropped by the caller
 * before this (it never reaches `rows`). Oldest first inside each list.
 */
export function groupLineFiles(
  lineIds: readonly string[],
  ownType: string,
  upstream: ReadonlyMap<string, readonly LineRef[]>,
  rows: readonly FlowFileRow[],
): Record<string, LineFiles> {
  const byRef = new Map<string, FlowFileRow[]>();
  for (const r of rows) {
    const k = `${r.resourceType}\u0000${r.resourceId}`;
    const arr = byRef.get(k);
    if (arr) arr.push(r);
    else byRef.set(k, [r]);
  }
  const oldestFirst = (a: FlowFileRow, b: FlowFileRow) =>
    String(a.uploadedAt ?? "").localeCompare(String(b.uploadedAt ?? ""));
  const out: Record<string, LineFiles> = {};
  for (const lineId of lineIds) {
    const own = [...(byRef.get(`${ownType}\u0000${lineId}`) ?? [])].sort(oldestFirst);
    const inherited: InheritedFileRow[] = [];
    const seen = new Set<string>();
    for (const ref of upstream.get(lineId) ?? []) {
      for (const r of byRef.get(`${ref.type}\u0000${ref.id}`) ?? []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        inherited.push({ ...r, fromType: ref.type, fromLabel: UPSTREAM_LINE_LABEL[ref.type] ?? ref.type });
      }
    }
    inherited.sort(oldestFirst);
    out[lineId] = { own, inherited };
  }
  return out;
}

/** How many files a line shows (own + carried down) — the paperclip count. */
export function lineFileCount(entry: LineFiles | undefined | null): number {
  if (!entry) return 0;
  return entry.own.length + entry.inherited.length;
}

/**
 * Production order → sales order line, by (sales order, line number) — the
 * same join the revenue reports use. PURE. A production order whose SO has no
 * line with that number (or two) gets no link: no guessing.
 */
export function mapProdOrdersToSoItems(
  prodOrders: ReadonlyArray<{ id: string; salesOrderId: string; lineNo: number | null }>,
  soItems: ReadonlyArray<{ id: string; salesOrderId: string; lineNo: number | null }>,
): Map<string, string> {
  const byKey = new Map<string, string[]>();
  for (const it of soItems) {
    if (!it.salesOrderId || it.lineNo == null) continue;
    const k = `${it.salesOrderId}\u0000${it.lineNo}`;
    const arr = byKey.get(k);
    if (arr) arr.push(it.id);
    else byKey.set(k, [it.id]);
  }
  const out = new Map<string, string>();
  for (const po of prodOrders) {
    if (!po.salesOrderId || po.lineNo == null) continue;
    const hits = byKey.get(`${po.salesOrderId}\u0000${po.lineNo}`) ?? [];
    if (hits.length === 1) out.set(po.id, hits[0]);
  }
  return out;
}

/**
 * Match a line to the ONE delivery-order line with the same production order.
 * PURE. Zero or several candidates → no link (a wrong link is worse than none).
 */
export function uniqueDoLineByProdOrder(
  doLines: ReadonlyArray<{ id: string; productionOrderId: string }>,
): Map<string, string> {
  const byPo = new Map<string, string[]>();
  for (const l of doLines) {
    if (!l.productionOrderId) continue;
    const arr = byPo.get(l.productionOrderId);
    if (arr) arr.push(l.id);
    else byPo.set(l.productionOrderId, [l.id]);
  }
  const out = new Map<string, string>();
  for (const [po, ids] of byPo) if (ids.length === 1) out.set(po, ids[0]);
  return out;
}
