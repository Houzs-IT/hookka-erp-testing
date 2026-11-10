// ---------------------------------------------------------------------------
// Review C2-4 (Conts#530 / #641) — photos on a goods receipt (proof of
// receipt: the supplier's delivery note, damaged cartons) that print on the
// GRN PDF. Stored in the shared /api/files store under resourceType "grn" +
// the GRN id, like every other attachment (no new table, no migration).
//
// On print the photos are downscaled (longest side 1000 px, JPEG 0.7) and
// laid out two per page after the GRN's own pages, each captioned
// "Photo 2 of 5". Display only: nothing here reads a quantity or an amount.
// ---------------------------------------------------------------------------
export const GRN_PHOTO_RESOURCE = "grn";
export const GRN_PDF_PHOTO_MAX = 12;
export const GRN_PDF_PHOTO_MAX_DIM = 1000;
export const GRN_PDF_PHOTO_QUALITY = 0.7;

export type GrnFileRow = {
  id: string;
  filename?: string | null;
  contentType?: string | null;
  uploadedAt?: string | null;
  uploaded_at?: string | null;
};

const isImageRow = (r: GrnFileRow) =>
  String(r.contentType ?? "").startsWith("image/") ||
  /\.(png|jpe?g|webp|gif)$/i.test(String(r.filename ?? ""));

/** The image attachments that print, oldest first, capped. HEIC is left out (a desktop browser can't decode it). */
export function grnPrintablePhotos(rows: GrnFileRow[], max = GRN_PDF_PHOTO_MAX): GrnFileRow[] {
  return rows
    .filter((r) => r && r.id && isImageRow(r) && !/heic|heif/i.test(`${r.contentType ?? ""} ${r.filename ?? ""}`))
    .sort((a, b) => String(a.uploadedAt ?? a.uploaded_at ?? "").localeCompare(String(b.uploadedAt ?? b.uploaded_at ?? "")))
    .slice(0, max);
}

/** Fit an image into a box, keeping its shape. */
export function fitPhoto(w: number, h: number, boxW: number, boxH: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: boxW, height: boxH };
  const k = Math.min(boxW / w, boxH / h);
  return { width: w * k, height: h * k };
}

export function grnPhotoCaption(index: number, total: number): string {
  return `Photo ${index + 1} of ${total}`;
}

/**
 * Browser only: fetch and downscale the GRN's printable photos to JPEG data
 * URLs, one at a time (memory). A photo that cannot be read is left out; a
 * failed list read prints the GRN without photos.
 */
export async function loadGrnPhotoDataUrls(grnId: string): Promise<string[]> {
  if (!grnId) return [];
  let rows: GrnFileRow[] = [];
  try {
    const res = await fetch(
      `/api/files?resourceType=${encodeURIComponent(GRN_PHOTO_RESOURCE)}&resourceId=${encodeURIComponent(grnId)}`,
    );
    const body = (await res.json().catch(() => ({}))) as { data?: GrnFileRow[] };
    if (!res.ok) return [];
    rows = body.data ?? [];
  } catch {
    return [];
  }
  const { compressImage } = await import("./image-compress");
  const out: string[] = [];
  for (const r of grnPrintablePhotos(rows)) {
    try {
      const blob = await (await fetch(`/api/files/${encodeURIComponent(r.id)}/download`)).blob();
      const file = new File([blob], r.filename || "grn-photo", { type: blob.type || "image/jpeg" });
      out.push(await compressImage(file, { maxDim: GRN_PDF_PHOTO_MAX_DIM, quality: GRN_PDF_PHOTO_QUALITY }));
    } catch {
      /* undecodable — leave it out */
    }
  }
  return out;
}
