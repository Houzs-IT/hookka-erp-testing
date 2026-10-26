// ---------------------------------------------------------------------------
// so-pdf.ts — "Download PDF" for the phone Sales Order detail (owner 2026-10-27).
//
// Reuses the desktop generator as-is: generateSOPdf(order, customer?) from
// src/lib/generate-so-pdf.ts, fed the SAME payload the detail already holds
// (GET /api/sales-orders/:id → data), exactly as src/pages/sales/detail.tsx does.
// The PDF's Bill To block comes from the customer's company address, which desktop
// reads from the existing GET /api/customers/:id. This does the same read, once, on
// tap. No new endpoint, no write, no status or order change.
//
// If the address cannot be had (the read fails, or the customer has none on file) the
// caller must ASK before downloading: we never produce a PDF with an empty Bill To
// silently. Failures come back as values for a toast, never thrown.
// ---------------------------------------------------------------------------
import type { RawRow } from "../config/types";

export type SoPdfResult = { ok: true } | { ok: false; error: string };

/** Outcome of looking up the Bill To address. */
export type BillTo =
  | { state: "ready"; address: string }
  | { state: "missing"; reason: "no-customer" | "lookup-failed" | "no-address" };

export const BILL_TO_MESSAGE: Record<"no-customer" | "lookup-failed" | "no-address", string> = {
  "no-customer": "This order has no customer on file, so the Bill To address would be empty.",
  "lookup-failed": "We couldn’t load the customer’s address, so the Bill To block would be empty.",
  "no-address": "This customer has no company address on file, so the Bill To block would be empty.",
};

export const PDF_FAILED = "Couldn’t create the sales order PDF. Please try again.";

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const defaultFetch: Fetcher = (url) => fetch(url, { credentials: "include" });

/** Reads the customer's company address (same endpoint and field as desktop). */
export async function lookupBillTo(doc: RawRow, fetcher: Fetcher = defaultFetch): Promise<BillTo> {
  const customerId = String(doc.customerId ?? doc.customer_id ?? "").trim();
  if (!customerId) return { state: "missing", reason: "no-customer" };
  try {
    const res = await fetcher(`/api/customers/${encodeURIComponent(customerId)}`);
    if (!res.ok) return { state: "missing", reason: "lookup-failed" };
    const body = (await res.json()) as { success?: boolean; data?: RawRow };
    if (!body?.success || !body.data) return { state: "missing", reason: "lookup-failed" };
    const address = String(body.data.companyAddress ?? body.data.company_address ?? "").trim();
    return address ? { state: "ready", address } : { state: "missing", reason: "no-address" };
  } catch {
    return { state: "missing", reason: "lookup-failed" };
  }
}

/**
 * Builds and downloads `<SO number>.pdf` through the desktop generator. `address` is
 * the looked-up Bill To ("" only after the user confirmed an incomplete PDF).
 */
export async function downloadSoPdf(
  doc: RawRow,
  address: string,
  generate?: (order: RawRow, customer: { companyAddress: string } | null) => Promise<void>,
): Promise<SoPdfResult> {
  try {
    const gen =
      generate ??
      (async (order, customer) => {
        const { generateSOPdf } = await import("@/lib/generate-so-pdf");
        await generateSOPdf(order as never, customer as never);
      });
    await gen(doc, address ? { companyAddress: address } : null);
    return { ok: true };
  } catch {
    return { ok: false, error: PDF_FAILED };
  }
}
