// Reads / calls the phone's Payment Voucher screens share (no components): the chart of accounts and the voucher attachments.
import { useCachedJson } from "@/lib/cached-fetch";
import type { CoaAccount } from "../../lib/pv-mobile";

type CoaResp = { success?: boolean; data?: CoaAccount[] };
export function useCoa(): { coa: CoaAccount[]; loading: boolean; failed: boolean } {
  const { data, loading, error } = useCachedJson<CoaResp>("/api/accounting/coa");
  return { coa: data?.data ?? [], loading, failed: !!error || (!!data && data.success === false) };
}

// ---- attachments (resourceType payment_voucher; accounting:update to add, only while DRAFT / PREPARED to delete) ------------
export type PvAttachment = { id: string; filename: string; contentType?: string; sizeBytes?: number };
export type PvAttachments = { rows: PvAttachment[]; canAdd: boolean; canDelete: boolean };

export async function listPvAttachments(pvId: string): Promise<PvAttachments | null> {
  try {
    const res = await fetch(`/api/accounting/payment-vouchers/${encodeURIComponent(pvId)}/attachments`, { credentials: "include" });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: PvAttachments } | null;
    return res.ok && j?.success && j.data ? j.data : null;
  } catch {
    return null;
  }
}

/** Attach once: if a file with the same name is already on the voucher, that is done (a retry after a lost response must not double it). */
export async function attachPvFileOnce(pvId: string, file: File): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const existing = await listPvAttachments(pvId);
  if (existing?.rows.some((r) => r.filename === file.name)) return { ok: true, already: true };
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/accounting/payment-vouchers/${encodeURIComponent(pvId)}/attachments`, { method: "POST", body: fd, credentials: "include" });
    const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    return res.ok && j?.success ? { ok: true, already: false } : { ok: false, error: j?.error || `Upload failed (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
