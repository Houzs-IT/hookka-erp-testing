// BUG-2026-11-23-543: the scan queue reuses a finished read for the same file bytes. A customer-PO
// read that found no item lines must not be reused, or every Retry of that file returns the same
// empty result at once ("No purchase order was found in this file") without reading it again.
export function isReusableRead(kind: string, rawJson: unknown): boolean {
  if (rawJson == null) return false;
  if (kind !== "po") return true;
  let raw = rawJson;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return false; }
  }
  const pos = (raw as { pos?: unknown } | null)?.pos;
  return Array.isArray(pos) && pos.some((p) => Array.isArray((p as { items?: unknown } | null)?.items) && (p as { items: unknown[] }).items.length > 0);
}
