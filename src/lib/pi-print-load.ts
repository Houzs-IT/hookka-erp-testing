// ---------------------------------------------------------------------------
// pi-print-load.ts — one printable purchase invoice. Shared by the Purchase
// Invoices list (row print, bulk print) and Finance › AP Invoices (owner
// 2026-10-20: tick-box print, row menu Print), so a PI prints the same
// wherever it is printed from. List rows are lean (no items), so the full
// invoice is fetched first; the supplier block and the buying company's
// letterhead come from the caller's suppliers and organisations. null on any
// failure — the caller decides how loudly to say so.
// ---------------------------------------------------------------------------
import type { LetterheadInfo, OrgRegistryRow } from "./generate-purchase-order-pdf";

export type PiPrintSupplier = {
  id: string;
  address?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  purchaseOrgCode?: string;
};

/** The invoice as the PDF wants it — the full record plus its supplier's
 *  block — and the company whose letterhead it prints under. */
export function piWithSupplier(
  pi: Record<string, unknown>,
  suppliers: readonly PiPrintSupplier[],
): { pi: Record<string, unknown>; orgCode: string } {
  const sup = suppliers.find((s) => s.id === (pi as { supplierId?: string }).supplierId);
  return {
    pi: {
      ...pi,
      supplierAddress: sup?.address,
      supplierContact: sup?.contactPerson,
      supplierPhone: sup?.phone,
      supplierEmail: sup?.email,
    },
    orgCode: sup?.purchaseOrgCode || "HOOKKA",
  };
}

export async function loadPiForPrint(
  id: string,
  suppliers: readonly PiPrintSupplier[],
  organisations?: OrgRegistryRow[],
): Promise<{ pi: Record<string, unknown>; letterhead: LetterheadInfo } | null> {
  const res = await fetch(`/api/purchase-invoices/${id}`);
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown> } | null;
  if (!res.ok || !j?.success || !j.data) return null;
  const { pi, orgCode } = piWithSupplier(j.data, suppliers);
  // Lazy: the PDF code stays out of the page's own bundle until a print.
  const { letterheadForPurchaseOrg } = await import("./generate-purchase-order-pdf");
  return { pi, letterhead: letterheadForPurchaseOrg(orgCode, organisations) };
}
