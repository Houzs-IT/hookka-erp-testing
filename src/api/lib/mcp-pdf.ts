// ---------------------------------------------------------------------------
// mcp-pdf.ts — the AI connector hands back the document's PDF itself (owner
// 2026-11-25 「就是给我那个PDF」).
//
// Same generator as the ERP's own "Download PDF" button (unified-do-invoice-pdf,
// pdf-lib, Workers-pure), fed the same two responses the page feeds it
// (GET /:id and /:id/print-extras, read in-process AS THE PERSON) — so the file
// is the one they would download. Uploaded to private storage and returned as a
// signed link that expires after PDF_LINK_TTL_S.
//
// Delivery orders, invoices and (2026-11-26) sales orders — the SO page's
// Download PDF already renders through this same pdf-lib generator
// (generate-so-pdf.ts → renderUnifiedSalesOrderBytes), so the server builds it
// with the very same functions, fed GET /api/sales-orders/:id and the
// customer's company address (the page's "Bill To", GET /api/customers/:id).
// Purchase orders still print through a browser-only jsPDF + autotable
// template (generate-purchase-order-pdf.ts); the connector answers those with
// a link to the ERP page — not a clean port, see docs/plans/mcp-connector.md.
// Known difference: a DO's POD photo pages (browser-only) are not appended.
// ---------------------------------------------------------------------------
import { buildUnifiedDocPdf } from "./unified-do-invoice-pdf";
import { buildUnifiedDoData, buildUnifiedInvoiceData, buildUnifiedSalesOrderData } from "../../lib/build-unified-doc-data";
import { HOOKKA_LOGO_PNG_BASE64 } from "./hookka-logo-base64";
import { workerCjkFontLoader } from "./worker-cjk-font";
import { isCancelledStatus } from "../../lib/pdf-cancelled-stamp";
import { doInputFromOrder, invoiceInputFromInvoice, salesOrderInputFromOrder } from "../../lib/unified-doc-download";
import { putFile, signedDownloadUrl } from "./supabase-storage";
import { pdfFileName } from "../../lib/pdf-preview";

export const PDF_LINK_TTL_S = 15 * 60;
export const PDF_BUCKET = "hookka-files";
export const PDF_PREFIX = "mcp-exports";

export type PdfKind = "delivery-order" | "invoice" | "sales-order";
export const SERVER_PDF_KINDS: Record<PdfKind, { api: string; label: string }> = {
  "delivery-order": { api: "/api/delivery-orders", label: "DO" },
  invoice: { api: "/api/invoices", label: "INV" },
  "sales-order": { api: "/api/sales-orders", label: "SO" },
};

type Rec = Record<string, unknown>;

export async function renderServerPdf(
  kind: PdfKind,
  doc: Rec,
  extras: Rec | undefined,
  env: unknown,
  requestUrl: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const opts = { loadCjkFont: workerCjkFontLoader(env, requestUrl) };
  if (kind === "sales-order") {
    // extras = the customer record; its companyAddress is the page's "Bill To".
    const billAddress = typeof extras?.companyAddress === "string" && extras.companyAddress ? extras.companyAddress : undefined;
    const bytes = await buildUnifiedDocPdf(
      { ...buildUnifiedSalesOrderData(salesOrderInputFromOrder(doc as never, billAddress), HOOKKA_LOGO_PNG_BASE64), cancelled: isCancelledStatus(doc.status as string) },
      opts,
    );
    return { bytes, filename: pdfFileName(doc.companySOId as string, doc.customerName as string, "SO") };
  }
  if (kind === "delivery-order") {
    const bytes = await buildUnifiedDocPdf(
      { ...buildUnifiedDoData(doInputFromOrder(doc as never, extras as never), HOOKKA_LOGO_PNG_BASE64), cancelled: isCancelledStatus(doc.status as string) },
      opts,
    );
    return { bytes, filename: pdfFileName(doc.doNo as string, doc.customerName as string, "DO") };
  }
  const bytes = await buildUnifiedDocPdf(
    { ...buildUnifiedInvoiceData(invoiceInputFromInvoice(doc as never, extras as never), HOOKKA_LOGO_PNG_BASE64), cancelled: isCancelledStatus(doc.status as string) },
    opts,
  );
  return { bytes, filename: pdfFileName((doc.invoiceNo ?? doc.invoiceNumber) as string, doc.customerName as string, "INV") };
}

/** Upload under the person's org and return a short-lived signed link. */
export async function uploadPdfAndSign(env: unknown, orgId: string, filename: string, bytes: Uint8Array): Promise<string> {
  return uploadExportAndSign(env, orgId, filename, bytes, "application/pdf", ".pdf");
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Any connector export (PDF, and since round 3 the export_excel .xlsx): same place, same 15-minute link. */
export async function uploadExportAndSign(env: unknown, orgId: string, filename: string, bytes: Uint8Array, contentType: string, ext: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(orgId)) throw new Error("Invalid org");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const safe = filename.replace(/[^A-Za-z0-9._ -]+/g, "").replace(/\s+/g, "_").slice(0, 120) || `document${ext}`;
  const key = `${PDF_PREFIX}/${orgId}/${rand}-${safe.endsWith(ext) ? safe : safe + ext}`;
  const storageEnv = env as Parameters<typeof putFile>[0];
  await putFile(storageEnv, PDF_BUCKET, key, bytes, contentType);
  const url = await signedDownloadUrl(storageEnv, PDF_BUCKET, key, PDF_LINK_TTL_S);
  if (!url) throw new Error("File storage is not configured, so a download link cannot be made.");
  return url;
}
