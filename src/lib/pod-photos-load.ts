// ---------------------------------------------------------------------------
// pod-photos-load.ts — turn a DO's stored proof of delivery into the
// downscaled image bytes src/lib/pod-photos-pdf.ts lays out (review D3 / D4).
//
// POD photos are stored on the DO as data URLs. The desktop dialog already
// shrinks them to 1280 px, but the phone sheet stores the camera original
// (several MB each). Every photo is re-encoded here to at most 1000 px on the
// longest side, JPEG quality 0.7 (~100–200 KB), so a PDF of eight photos stays
// small enough to send on WhatsApp. Browser only (canvas).
// ---------------------------------------------------------------------------
import { compressImage } from "./image-compress";
import { buildPodPhotosPdf, type PdfImageBytes, type PodPdfInput } from "./pod-photos-pdf";
import { deliverPdf, pdfFileName, type PdfOutputMode } from "./pdf-preview";

export const POD_PDF_PHOTO_MAX_DIM = 1000;
export const POD_PDF_PHOTO_QUALITY = 0.7;

type PodLike = {
  receiverName?: string;
  receiverIC?: string;
  signatureDataUrl?: string;
  photoDataUrls?: string[];
  deliveredAt?: string;
  capturedBy?: string;
} | null | undefined;

/** Base64 data URL → bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const bin = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** How many photos a POD carries (non-empty entries only). */
export function podPhotoCount(pod: PodLike): number {
  return (pod?.photoDataUrls ?? []).filter((s) => typeof s === "string" && s.length > 0).length;
}

async function downscale(src: string): Promise<PdfImageBytes | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], "pod-photo", { type: blob.type || "image/jpeg" });
    const jpeg = await compressImage(file, { maxDim: POD_PDF_PHOTO_MAX_DIM, quality: POD_PDF_PHOTO_QUALITY });
    return { bytes: dataUrlToBytes(jpeg), kind: "jpg" };
  } catch {
    // Undecodable (e.g. HEIC on a desktop browser) — leave it out.
    return null;
  }
}

function signatureBytes(src: string | undefined): PdfImageBytes | null {
  if (!src || !src.startsWith("data:image/")) return null;
  try {
    const kind = src.startsWith("data:image/png") ? "png" : "jpg";
    return { bytes: dataUrlToBytes(src), kind };
  } catch {
    return null;
  }
}

/** The DO's POD as PDF input: photos downscaled one at a time (memory), signature as stored. */
export async function loadPodPdfInput(
  docNo: string,
  customerName: string | undefined,
  pod: PodLike,
): Promise<PodPdfInput> {
  const photos: PdfImageBytes[] = [];
  for (const src of pod?.photoDataUrls ?? []) {
    if (!src) continue;
    const img = await downscale(src);
    if (img) photos.push(img);
  }
  return {
    docNo,
    customerName,
    receiverName: pod?.receiverName,
    receiverIC: pod?.receiverIC,
    deliveredAt: pod?.deliveredAt,
    capturedBy: pod?.capturedBy,
    signature: signatureBytes(pod?.signatureDataUrl),
    photos,
  };
}

/** "DO-2611-001 Acme - POD photos.pdf". */
export function podPhotosFileName(docNo: string, customerName?: string): string {
  return pdfFileName(docNo, [customerName, "POD photos"].filter(Boolean).join(" - "), "DO");
}

/**
 * The "POD photos PDF" action: one PDF of the DO's photos (two per page),
 * opened in the in-app preview (Download / Share / Open in new tab) or saved.
 * Returns false when the DO has no photo that could be read.
 */
export async function openPodPhotosPdf(
  docNo: string,
  customerName: string | undefined,
  pod: PodLike,
  mode: PdfOutputMode = "view",
): Promise<boolean> {
  const input = await loadPodPdfInput(docNo, customerName, pod);
  if (input.photos.length === 0) return false;
  deliverPdf(await buildPodPhotosPdf(input), podPhotosFileName(docNo, customerName), mode);
  return true;
}
