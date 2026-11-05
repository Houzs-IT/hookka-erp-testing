// Attach a document to a record through the existing generic file API (POST /api/files, resourceType + resourceId; listed with
// GET /api/files?resourceType=&resourceId=; viewed with /api/files/:id/download?inline=1), AT MOST ONCE per file name.
// A retry after a lost response must not store the same document twice, so the record's files are listed first and a file with
// the same name counts as done. Used by the Goods Receipt and Purchase Invoice screens (their follow-up step and the detail page's
// "Add document"). Upload needs files:create; listing needs only a login.
//
// A Purchase Invoice can also LINK one of its attached files as its source document (POST /api/purchase-invoices/:id/source-document,
// purchase-invoices:update): linking the file that is already the source is a no-op, so the two steps (attach, link) can each be
// repeated; replacing a DIFFERENT source needs `replace: true`, which only an explicit user action sends.
import { uploadSourceDoc } from "@/lib/scan-queue-client";

export type FileRow = { id: string; filename?: string; contentType?: string };

export async function listRecordFiles(resourceType: string, resourceId: string): Promise<FileRow[] | null> {
  try {
    const res = await fetch(`/api/files?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`, { credentials: "include" });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: FileRow[] } | null;
    return res.ok && j?.success ? (j.data ?? []) : null;
  } catch {
    return null;
  }
}

/** The file's id: the same-named file already on the record if there is one, else the new upload. Null when it could not be stored. */
export async function attachOnceReturningId(origin: Parameters<typeof uploadSourceDoc>[0], resourceType: string, resourceId: string, fileName: string): Promise<string | null> {
  const existing = await listRecordFiles(resourceType, resourceId);
  const hit = existing?.find((f) => !fileName || f.filename === fileName);
  if (hit) return hit.id;
  return uploadSourceDoc(origin, resourceType, resourceId);
}

export async function attachOriginalOnce(origin: Parameters<typeof uploadSourceDoc>[0], resourceType: string, resourceId: string, fileName: string): Promise<boolean> {
  return (await attachOnceReturningId(origin, resourceType, resourceId, fileName)) != null;
}

export type LinkResult = { ok: true; unchanged: boolean } | { ok: false; status: number; error: string };

/** Make an attached file the invoice's source document. `replace` only when the user explicitly chose to replace an existing source. */
export async function linkSourceDocument(piId: string, fileId: string, replace = false): Promise<LinkResult> {
  try {
    const res = await fetch(`/api/purchase-invoices/${encodeURIComponent(piId)}/source-document`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(replace ? { fileId, replace: true } : { fileId }),
    });
    const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { unchanged?: boolean } } | null;
    return res.ok && j?.success ? { ok: true, unchanged: !!j.data?.unchanged } : { ok: false, status: res.status, error: j?.error || `Failed (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Network error" };
  }
}
