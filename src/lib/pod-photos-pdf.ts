// ---------------------------------------------------------------------------
// pod-photos-pdf.ts — a delivery's proof-of-delivery photos as PDF pages
// (review D3 / D4; Houzs#5488, Conts#544, #641, #649).
//
//   • appendPodPagesToPdf: after the DO's own pages, two photos per page with
//     the DO number, receiver, signature and "Photo 3 of 8, captured <MYT>".
//   • buildPodPhotosPdf: the same pages as their own PDF — one file of a DO's
//     photos to send to the customer on WhatsApp.
//
// The photos arrive here already downscaled (src/lib/pod-photos-load.ts:
// longest side 1000 px, JPEG ~0.7) so the PDF stays small. pdf-lib, so it runs
// on the unified DO bytes. Display only: nothing here reads an amount or a
// quantity. Pure layout helpers are exported for the tests.
// ---------------------------------------------------------------------------
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { winAnsi } from "../api/lib/unified-do-invoice-pdf";

export type PdfImageBytes = { bytes: Uint8Array; kind: "jpg" | "png" };

export type PodPdfInput = {
  docNo: string;
  customerName?: string;
  receiverName?: string;
  receiverIC?: string;
  /** ISO time the POD was captured (shown in Malaysia time). */
  deliveredAt?: string;
  capturedBy?: string;
  signature?: PdfImageBytes | null;
  photos: PdfImageBytes[];
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const HEADER_H = 74;
const FOOTER_Y = 40;
const CAPTION_H = 16;
const SLOT_GAP = 14;
const INK = rgb(0.1, 0.09, 0.09);
const MUTED = rgb(0.42, 0.45, 0.48);
const RULE = rgb(0.82, 0.81, 0.78);

export const PHOTOS_PER_PAGE = 2;

/** "10 Nov 2026, 2:05 pm MYT" — always Malaysia time, whatever the device. */
export function formatMyt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = d.toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${s} MYT`;
}

/** "Photo 3 of 8, captured 10 Nov 2026, 2:05 pm MYT". */
export function podPhotoCaption(index: number, total: number, deliveredAt?: string): string {
  const when = formatMyt(deliveredAt);
  return `Photo ${index + 1} of ${total}${when ? `, captured ${when}` : ""}`;
}

/** Number of photo pages for `n` photos (two per page). */
export function podPageCount(n: number): number {
  return Math.ceil(Math.max(0, n) / PHOTOS_PER_PAGE);
}

/** Scale (w, h) to fit inside (boxW, boxH), keeping the aspect ratio. Never upscales. */
export function fitInBox(w: number, h: number, boxW: number, boxH: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const s = Math.min(boxW / w, boxH / h, 1);
  return { width: w * s, height: h * s };
}

/** The two photo slots on a page (pdf-lib coordinates, y up), top slot first. */
export function photoSlots(): Array<{ x: number; y: number; width: number; height: number }> {
  const top = PAGE_H - MARGIN - HEADER_H;
  const bottom = FOOTER_Y + 12;
  const slotH = (top - bottom - SLOT_GAP) / 2;
  const width = PAGE_W - MARGIN * 2;
  return [
    { x: MARGIN, y: top - slotH, width, height: slotH },
    { x: MARGIN, y: bottom, width, height: slotH },
  ];
}

async function embed(pdf: PDFDocument, img: PdfImageBytes): Promise<PDFImage | null> {
  try {
    return img.kind === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
  } catch {
    // An undecodable photo is left out rather than failing the whole PDF.
    return null;
  }
}

function rightText(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont) {
  const t = winAnsi(text);
  page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color: INK });
}

/**
 * Append the POD pages to `pdf`: a header on each page (DO number, customer,
 * receiver, delivered time; the signature on the first page) and up to two
 * photos per page with captions. With no photos but a signature, one page
 * carries the signature. Returns the number of pages added.
 */
export async function appendPodPagesToPdf(pdf: PDFDocument, input: PodPdfInput): Promise<number> {
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const photos = (await Promise.all(input.photos.map((p) => embed(pdf, p)))).filter(
    (p): p is PDFImage => p !== null,
  );
  const signature = input.signature ? await embed(pdf, input.signature) : null;
  if (photos.length === 0 && !signature) return 0;

  const pages = Math.max(1, podPageCount(photos.length));
  const total = photos.length;
  const receiver = [input.receiverName, input.receiverIC ? `IC ${input.receiverIC}` : ""].filter(Boolean).join(", ");
  const when = formatMyt(input.deliveredAt);

  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const top = PAGE_H - MARGIN;
    page.drawText("PROOF OF DELIVERY", { x: MARGIN, y: top - 12, size: 14, font: bold, color: INK });
    rightText(page, `No. ${input.docNo}`, PAGE_W - MARGIN, top - 12, 11, bold);
    let ly = top - 28;
    const line = (label: string, value: string) => {
      if (!value) return;
      page.drawText(winAnsi(label), { x: MARGIN, y: ly, size: 8, font: helv, color: MUTED });
      page.drawText(winAnsi(value).slice(0, 90), { x: MARGIN + 70, y: ly, size: 8.5, font: bold, color: INK });
      ly -= 11;
    };
    line("Customer", input.customerName ?? "");
    line("Received by", receiver);
    line("Delivered", when);
    if (p === 0 && signature) {
      const box = fitInBox(signature.width, signature.height, 150, 30);
      const sx = PAGE_W - MARGIN - box.width;
      const sy = top - 22 - box.height;
      page.drawImage(signature, { x: sx, y: sy, width: box.width, height: box.height });
      rightText(page, "Receiver signature", PAGE_W - MARGIN, sy - 9, 7, helv);
    }
    const ruleY = PAGE_H - MARGIN - HEADER_H + 8;
    page.drawRectangle({ x: MARGIN, y: ruleY, width: PAGE_W - MARGIN * 2, height: 0.7, color: INK });

    const slots = photoSlots();
    for (let s = 0; s < PHOTOS_PER_PAGE; s++) {
      const i = p * PHOTOS_PER_PAGE + s;
      const img = photos[i];
      if (!img) break;
      const slot = slots[s];
      const fit = fitInBox(img.width, img.height, slot.width, slot.height - CAPTION_H);
      const x = slot.x + (slot.width - fit.width) / 2;
      const y = slot.y + CAPTION_H + (slot.height - CAPTION_H - fit.height);
      page.drawImage(img, { x, y, width: fit.width, height: fit.height });
      page.drawText(winAnsi(podPhotoCaption(i, total, input.deliveredAt)), {
        x: slot.x,
        y: slot.y + CAPTION_H - 11,
        size: 8,
        font: helv,
        color: MUTED,
      });
    }

    page.drawRectangle({ x: MARGIN, y: FOOTER_Y, width: PAGE_W - MARGIN * 2, height: 0.4, color: RULE });
    page.drawText(winAnsi(`${input.docNo} · Proof of delivery photos · Page ${p + 1} of ${pages}`), {
      x: MARGIN,
      y: FOOTER_Y - 9,
      size: 7,
      font: helv,
      color: MUTED,
    });
  }
  return pages;
}

/** The DO's own PDF bytes with the POD pages appended. Unchanged when there is nothing to add. */
export async function appendPodPagesToPdfBytes(bytes: Uint8Array, input: PodPdfInput): Promise<Uint8Array> {
  if (input.photos.length === 0 && !input.signature) return bytes;
  const pdf = await PDFDocument.load(bytes);
  const added = await appendPodPagesToPdf(pdf, input);
  return added > 0 ? pdf.save() : bytes;
}

/** One PDF of just the POD pages (the "POD photos PDF" action). */
export async function buildPodPhotosPdf(input: PodPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.docNo} proof of delivery photos`);
  await appendPodPagesToPdf(pdf, input);
  return pdf.save();
}
