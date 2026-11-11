// ===========================================================================
// invoice-pdf.ts — Invoice PDF View / Download for the phone Invoice Detail
// (owner 2026-10-21). Mirrors the desktop `printInvoicePdf`
// (src/pages/invoices/detail.tsx) step for step:
//   1. GET /api/invoices/:id/print-extras (optional — failure just means no
//      extras, the PDF still renders);
//   2. render with the shared @/lib/unified-doc-download builder (the same one
//      the backend e-mail uses), given the GET /api/invoices/:id `data` object
//      the detail screen already holds.
// Read-only: no status, payment or invoice change. No new endpoint.
//
// Two safety fixes over the desktop flow (desktop itself is unchanged):
//   • the View tab is closed on EVERY failure (desktop leaves it blank if the
//     PDF module fails to load, because that load sits outside its try);
//   • failures come back as a message for a toast instead of escaping.
// ===========================================================================
import type { RawRow } from "../config/types";

/** Outcome of a PDF action; `error` is shown as a toast. */
export type PdfResult = { ok: true } | { ok: false; error: string };

const VIEW_FAILED = "Couldn’t create the invoice PDF. Please try again.";
const DOWNLOAD_FAILED = "Couldn’t download the invoice PDF. Please try again.";

/**
 * View: builds the PDF and opens it in the in-app preview (viewUnifiedInvoicePdf, main #1250),
 * so no pop-up window has to be opened inside the tap any more.
 */
export async function viewInvoicePdf(doc: RawRow, id: string): Promise<PdfResult> {
  try {
    const extras = await fetchPrintExtras(id);
    const { viewUnifiedInvoicePdf } = await import("@/lib/unified-doc-download");
    await viewUnifiedInvoicePdf(doc, extras);
    return { ok: true };
  } catch {
    return { ok: false, error: VIEW_FAILED };
  }
}

/** Download: builds the PDF and saves `<invoiceNo>.pdf` via the shared utility. */
export async function downloadInvoicePdf(doc: RawRow, id: string): Promise<PdfResult> {
  try {
    const extras = await fetchPrintExtras(id);
    const { downloadUnifiedInvoicePdf } = await import("@/lib/unified-doc-download");
    await downloadUnifiedInvoicePdf(doc, extras);
    return { ok: true };
  } catch {
    return { ok: false, error: DOWNLOAD_FAILED };
  }
}

/** Optional print enrichment (customer SO / ref, per-line price build-up). */
async function fetchPrintExtras(id: string): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`/api/invoices/${encodeURIComponent(id)}/print-extras`);
    const j = (await r.json()) as { success?: boolean; data?: Record<string, unknown> };
    return j?.success && j.data ? j.data : {};
  } catch {
    return {};
  }
}
