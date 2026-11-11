// ===========================================================================
// Procurement writes + PDFs for /m/procurement — the SAME calls desktop makes
// (src/pages/procurement/*). Nothing here decides a business rule: the rules
// live in ../../lib/procurement-mobile.ts and the server decides.
// ===========================================================================
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { mutateJson } from "../../config/mutate";
import { rows, s, type RawRow } from "../../lib/procurement-mobile";

export type WriteResult = { ok: true; body: RawRow | null } | { ok: false; error: string; status: number; body: RawRow | null };

/** Every list / detail the procurement cascade can move (PO ↔ GRN ↔ PI ↔ stock). */
export function refreshProcurementCaches(): void {
  for (const p of [
    "/api/purchase-orders",
    "/api/grn",
    "/api/purchase-invoices",
    "/api/three-way-match",
    "/api/inventory",
    "/api/raw-materials",
    "/api/fabric-tracking",
    "/api/accounting",
  ]) {
    invalidateCachePrefix(p);
  }
}

export async function send(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
  headers?: Record<string, string>,
): Promise<WriteResult> {
  const r = await mutateJson<RawRow>(url, method, body, headers);
  if (r.ok) return { ok: true, body: r.body };
  return { ok: false, error: r.error || `Request failed (HTTP ${r.status})`, status: r.status, body: r.body };
}

export const putPo = (id: string, body: unknown) => send(`/api/purchase-orders/${encodeURIComponent(id)}`, "PUT", body);
export const putGrn = (id: string, body: unknown) => send(`/api/grn/${encodeURIComponent(id)}`, "PUT", body);
export const putPi = (id: string, body: unknown) => send(`/api/purchase-invoices/${encodeURIComponent(id)}`, "PUT", body);

/**
 * Sequential POSTs, 200 ms apart (create.tsx / index.tsx Split by Supplier:
 * keeps generatePoNo deterministic across the batch).
 */
export async function postPoGroups(groups: Record<string, unknown>[]): Promise<{ ok: number; failures: string[] }> {
  let ok = 0;
  const failures: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const r = await send("/api/purchase-orders", "POST", g);
    if (r.ok) ok++;
    else failures.push(`${String(g.supplierName ?? "(unknown)")}: ${r.error}`);
    // eslint-disable-next-line no-restricted-syntax -- fixed inter-request throttle inside an async submit loop (desktop create.tsx does the same)
    if (i < groups.length - 1) await new Promise((res) => setTimeout(res, 200));
  }
  refreshProcurementCaches();
  return { ok, failures };
}

/** index.tsx bulkSubmitDrafts: one PUT {status:"SUBMITTED"} per draft, in order. */
export async function submitDrafts(drafts: RawRow[]): Promise<{ ok: number; failures: string[] }> {
  let ok = 0;
  const failures: string[] = [];
  for (const p of drafts) {
    const r = await putPo(s(p, "id"), { status: "SUBMITTED" });
    if (r.ok) ok++;
    else failures.push(`${s(p, "poNo")}: ${r.error}`);
  }
  refreshProcurementCaches();
  return { ok, failures };
}

// ---------------------------------------------------------------------------
// PDFs — the desktop generators, under the supplier's purchase-company
// letterhead, exactly as detail.tsx / grn-detail.tsx / PurchaseInvoiceDetail.tsx.
// ---------------------------------------------------------------------------
type Org = { code: string; name: string; isActive?: boolean };

async function supplierAndOrgs(supplierId: string): Promise<{ sup: RawRow | null; orgs: Org[] }> {
  const [supRes, orgRes] = await Promise.all([
    fetch("/api/suppliers").then((r) => r.json()).catch(() => null) as Promise<{ data?: RawRow[] } | null>,
    fetch("/api/organisations").then((r) => r.json()).catch(() => null) as Promise<{ organisations?: Org[] } | null>,
  ]);
  const sup = rows(supRes?.data).find((x) => s(x, "id") === supplierId) ?? null;
  return { sup, orgs: orgRes?.organisations ?? [] };
}

export async function downloadPoPdf(po: RawRow): Promise<void> {
  const { generatePurchaseOrderPdf, letterheadForPurchaseOrg } = await import("@/lib/generate-purchase-order-pdf");
  const { sup, orgs } = await supplierAndOrgs(s(po, "supplierId"));
  const purchaseOrgCode = (sup && s(sup, "purchaseOrgCode")) || "HOOKKA";
  const lh = letterheadForPurchaseOrg(purchaseOrgCode, orgs);
  generatePurchaseOrderPdf({ ...po, purchaseOrgCode } as unknown as Parameters<typeof generatePurchaseOrderPdf>[0], lh);
}

/** detail.tsx "Print GRN" — the PO-shaped GRN print. */
export async function printGrnFromPo(po: RawRow): Promise<void> {
  const [{ generateGRNPdf }, { letterheadForPurchaseOrg }] = await Promise.all([
    import("@/lib/generate-grn-pdf"),
    import("@/lib/generate-purchase-order-pdf"),
  ]);
  const { sup, orgs } = await supplierAndOrgs(s(po, "supplierId"));
  generateGRNPdf(po, letterheadForPurchaseOrg((sup && s(sup, "purchaseOrgCode")) || "HOOKKA", orgs));
}

export async function downloadGrnPdf(grn: RawRow): Promise<void> {
  const [{ generateGRNPdf }, { letterheadForPurchaseOrg }] = await Promise.all([
    import("@/lib/generate-grn-pdf"),
    import("@/lib/generate-purchase-order-pdf"),
  ]);
  const { sup, orgs } = await supplierAndOrgs(s(grn, "supplierId"));
  generateGRNPdf(
    {
      grnNo: s(grn, "grnNumber"),
      date: s(grn, "receiveDate"),
      poRef: s(grn, "poNumber"),
      supplierName: s(grn, "supplierName"),
      remarks: s(grn, "notes"),
      items: rows(grn.items).map((it) => ({
        itemCode: s(it, "materialCode"),
        supplierSKU: s(it, "supplierSKU"),
        description: s(it, "materialName"),
        poQty: it.orderedQty,
        receivedQty: it.receivedQty,
        rejectedQty: it.rejectedQty,
        acceptedQty: it.acceptedQty,
      })),
    },
    letterheadForPurchaseOrg((sup && s(sup, "purchaseOrgCode")) || "HOOKKA", orgs),
  );
}

export async function downloadPiPdf(pi: RawRow): Promise<void> {
  const [{ generatePurchaseInvoicePdf }, { letterheadForPurchaseOrg }] = await Promise.all([
    import("@/lib/generate-purchase-invoice-pdf"),
    import("@/lib/generate-purchase-order-pdf"),
  ]);
  const { sup, orgs } = await supplierAndOrgs(s(pi, "supplierId"));
  const lh = letterheadForPurchaseOrg((sup && s(sup, "purchaseOrgCode")) || "HOOKKA", orgs);
  generatePurchaseInvoicePdf(
    {
      ...pi,
      supplierAddress: sup ? s(sup, "address") : undefined,
      supplierContact: sup ? s(sup, "contactPerson") : undefined,
      supplierPhone: sup ? s(sup, "phone") : undefined,
      supplierEmail: sup ? s(sup, "email") : undefined,
    } as unknown as Parameters<typeof generatePurchaseInvoicePdf>[0],
    lh,
  );
}
