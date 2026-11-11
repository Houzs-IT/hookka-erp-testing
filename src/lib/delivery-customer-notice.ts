// ---------------------------------------------------------------------------
// delivery-customer-notice.ts — the customer goods-movement notices that follow
// a DO status change (dispatch notice with the DO PDF, invoice notice with the
// invoice PDF), POSTed to /api/delivery-orders/:id/notify-customer.
//
// Moved here unchanged from src/pages/delivery/index.tsx (2026-10-20) so the
// desktop Delivery page and the phone Delivery screens send the SAME notice
// through ONE code path. Only the row parameter's type was widened to the
// fields the code reads.
// ---------------------------------------------------------------------------

/** The DO fields the notice reads (desktop passes its DeliveryOrderRow). */
export type NoticeRow = {
  id: string;
  doNo: string;
  customerId: string;
  customerPOId?: string;
  items: { id: string; quantity: number }[];
};
// ---------------------------------------------------------------------------
// Customer goods-movement notices (2026-06-11). After a SUCCESSFUL status
// transition, the page fires POST /api/delivery-orders/:id/notify-customer:
//   * → LOADED:    dispatch notice with the REAL branded DO PDF attached
//     (same generateDOPdf path the Print buttons use).
//   * → DELIVERED: invoice notice with the REAL branded Invoice PDF attached
//     (same generateInvoicePdf path the Invoice page uses); when the client
//     PDF can't be produced, the backend attaches a server-rendered simple
//     invoice PDF instead.
// Strictly fire-and-forget: every failure here is swallowed — an email must
// NEVER block, slow, or roll back the delivery flow. The backend owns the
// recipient rules (hub/customer email chains), the idempotency stamps, and
// every number (doNo / dates / invoice row); this side only contributes the
// PDF plus display fields derived from ONE fetched print-extras object — the
// same object that feeds the attached PDF, so email and PDF cannot diverge.
// ---------------------------------------------------------------------------
// Render the DELIVERED invoice notice PDF (the SAME unified generator the
// Invoice page downloads) for a delivered DO — find its live invoice, pull the
// invoice + print-extras, render to base64. Returns {} on any failure so the
// caller falls back to the backend's own server-rendered invoice. Shared by
// the auto-notice (sendCustomerNotice) AND the manual Re-send so both attach
// the exact same document.
export async function renderDeliveredInvoicePdf(
  doId: string,
  customerId: string,
): Promise<{ pdfBase64?: string; pdfFilename?: string }> {
  try {
    const lr = await fetch(
      `/api/invoices?customerId=${encodeURIComponent(customerId)}&_v=${Date.now()}`,
      { cache: "no-store" },
    );
    const lj = (await lr.json()) as {
      success?: boolean;
      data?: Array<{
        id: string;
        invoiceNo: string;
        deliveryOrderId?: string;
        status?: string;
        createdAt?: string;
      }>;
    };
    const slim = (lj?.success ? (lj.data ?? []) : [])
      .filter((inv) => inv.deliveryOrderId === doId && inv.status !== "CANCELLED")
      .sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
      )[0];
    if (!slim) return {};
    const [ir, er] = await Promise.all([
      fetch(`/api/invoices/${encodeURIComponent(slim.id)}`),
      fetch(`/api/invoices/${encodeURIComponent(slim.id)}/print-extras`),
    ]);
    const ij = (await ir.json()) as {
      success?: boolean;
      data?: import("@/types").Invoice;
    };
    const ej = (await er.json().catch(() => ({}))) as {
      success?: boolean;
      data?: import("@/lib/generate-invoice-pdf").InvoicePrintExtras;
    };
    const invoice = ij?.success ? ij.data : undefined;
    if (!invoice) return {};
    // Unify on ONE template (owner 2026-07-13): the customer email uses the
    // SAME unified generator the download/print button uses (its earlier "歪"
    // alignment + dashed-line issues are now fixed). renderUnifiedInvoiceBase64
    // is exactly what downloadUnifiedInvoicePdf produces — one code path, so
    // the emailed invoice is byte-identical to the download.
    const { renderUnifiedInvoiceBase64 } = await import(
      "@/lib/unified-doc-download"
    );
    return {
      pdfBase64: await renderUnifiedInvoiceBase64(
        invoice,
        ej?.success ? ej.data : undefined,
      ),
      pdfFilename: `${/^INV/i.test(invoice.invoiceNo) ? invoice.invoiceNo : `INV-${invoice.invoiceNo}`}.pdf`,
    };
  } catch {
    return {};
  }
}

export async function sendCustomerNotice(
  row: NoticeRow,
  kind: "DISPATCHED" | "DELIVERED",
): Promise<"queued" | "skipped" | "failed"> {
  try {
    let pdfBase64: string | undefined;
    let pdfFilename: string | undefined;
    let itemsBreakdown: string | undefined;
    let customerPOIds: string[] | undefined;

    if (kind === "DISPATCHED") {
      let extras: import("@/lib/generate-do-pdf").DOPrintExtras = {};
      try {
        const r = await fetch(
          `/api/delivery-orders/${encodeURIComponent(row.id)}/print-extras`,
        );
        const j = (await r.json()) as {
          success?: boolean;
          data?: import("@/lib/generate-do-pdf").DOPrintExtras;
        };
        if (j?.success && j.data) extras = j.data;
      } catch {
        /* graceful — the notice still goes out without the breakdown */
      }
      const { buildDoComponentBreakdown, collectCustomerPOIds } = await import(
        "@/lib/do-component-breakdown"
      );
      itemsBreakdown = buildDoComponentBreakdown(row.items, extras);
      customerPOIds = collectCustomerPOIds(row.items, extras, row.customerPOId);
      try {
        // Unify on ONE template (owner 2026-07-13): the customer email uses the
        // SAME unified generator the download-DO button uses (now that its
        // alignment / dashed-line issues are fixed). renderUnifiedDoBase64 is
        // exactly what downloadUnifiedDoPdf produces — no delivery QR on the
        // customer copy; refs/category/pieces come from the DO print-extras.
        const { renderUnifiedDoBase64 } = await import("@/lib/unified-doc-download");
        pdfBase64 = await renderUnifiedDoBase64(
          row as unknown as Record<string, unknown> & { doNo?: string },
          extras,
        );
        pdfFilename = `${row.doNo.startsWith("DO-") ? row.doNo : `DO-${row.doNo}`}.pdf`;
      } catch {
        /* graceful — backend sends the notice without the attachment */
      }
    } else {
      // DELIVERED — find the DO's live invoice (auto-created by the DELIVERED
      // cascade, committed before this runs) and render the real unified
      // invoice PDF. Any failure → {} → POST without pdfBase64 and let the
      // backend attach its server-rendered fallback.
      const rendered = await renderDeliveredInvoicePdf(row.id, row.customerId);
      pdfBase64 = rendered.pdfBase64;
      pdfFilename = rendered.pdfFilename;
    }

    const r = await fetch(
      `/api/delivery-orders/${encodeURIComponent(row.id)}/notify-customer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          pdfBase64,
          pdfFilename,
          itemsBreakdown,
          customerPOIds,
        }),
      },
    );
    const j = (await r.json().catch(() => ({}))) as {
      queued?: boolean;
      skipped?: boolean;
    };
    if (r.ok && j?.queued) return "queued";
    if (r.ok && j?.skipped) return "skipped";
    return "failed";
  } catch {
    return "failed";
  }
}
