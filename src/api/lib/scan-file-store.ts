// ---------------------------------------------------------------------------
// scan-file-store.ts - where a scanned original's bytes live (HK-0005).
//
// They used to be base64 text inside a `scan_queue` row, decoded again by every
// worker that touched the row, and NULLed on consume - so originals were lost
// for most document types. New rows put the bytes in object storage, keyed by
// content hash (identical bytes share one object; nothing is ever deleted
// here), and keep only `file_key` on the row. Where storage is not configured
// (local dev, an env missing the secret) the base64 column is the fallback, so
// a scan never fails because of this module.
// ---------------------------------------------------------------------------
import { putFile, getFile } from "./supabase-storage";

type StoreEnv = Parameters<typeof putFile>[0];

export function scanFileKey(orgId: string | null | undefined, fileHash: string): string {
  return `scan-originals/${orgId || "_"}/${fileHash}`;
}

// Only formats a browser renders without running script. SVG/HTML from an
// upload would execute on our origin, so they stay a download.
const INLINE_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|gif))$/i;
export function originalDisposition(mime: string | null | undefined): "inline" | "attachment" {
  return INLINE_MIME.test(mime ?? "") ? "inline" : "attachment";
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Store the bytes; returns the key to persist, or the base64 fallback. */
export async function stashScanBytes(
  env: StoreEnv,
  orgId: string | null | undefined,
  fileHash: string,
  buf: ArrayBuffer,
  mime: string,
): Promise<{ fileKey: string | null; b64: string | null }> {
  const key = scanFileKey(orgId, fileHash);
  try {
    await putFile(env, key, buf, mime || "application/octet-stream");
    return { fileKey: key, b64: null };
  } catch (e) {
    console.warn("[scan-file-store] storage unavailable, base64 fallback:", (e as Error).message);
    return { fileKey: null, b64: toBase64(buf) };
  }
}

/** Bytes of a queue row's original, from storage or the legacy column. */
export async function readScanBytes(
  env: StoreEnv,
  row: { fileKey?: string | null; fileBytesB64?: string | null },
): Promise<ArrayBuffer | null> {
  if (row.fileKey) {
    try {
      const obj = await getFile(env, row.fileKey);
      if (obj) return await new Response(obj.body).arrayBuffer();
    } catch (e) {
      console.warn("[scan-file-store] read failed:", (e as Error).message);
    }
  }
  return row.fileBytesB64 ? fromBase64(row.fileBytesB64) : null;
}
