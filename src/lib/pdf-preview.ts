// ---------------------------------------------------------------------------
// pdf-preview.ts — ONE in-app PDF preview for every document (review D1, P7).
//
// Before: Invoice / DO / CN "view" opened the jsPDF blob in a new tab. That
// window.open ran after the render, so the browser often treated it as an
// unsolicited popup and the click silently downloaded instead; and a PDF saved
// from that tab came down named after the blob GUID (93cc409c-….pdf). SO / PO
// / PI / GRN could only be downloaded.
//
// Now: the PDF shows in an overlay inside Hookka (a visible iframe), with
// Print / Download / Open in new tab / Close. No popup is needed, so nothing
// gets blocked. Every file Hookka saves is named after the document
// (`pdfFileName`), e.g. "PO-2611-012 Supplier Name.pdf".
//
// The browser's OWN Save button (inside the PDF viewer) names the file from the
// address. A blob address saves as a GUID, so when the service worker is in
// control the PDF is served from `/pdf-preview/<name>.pdf` instead (public/sw.js
// answers that path from Cache Storage) — the browser then saves it under the
// document's name. Without the worker (dev, first visit) it falls back to the
// blob; the toolbar Download is always named. Port of Houzs#4430 / #5342.
//
// Framework-free DOM so the generators in src/lib can call it directly.
// ---------------------------------------------------------------------------
import type { jsPDF } from "jspdf";

export type PdfOutputMode = "download" | "view";

/** Cache name + path prefix shared with public/sw.js — keep the three in step. */
export const PDF_PREVIEW_CACHE = "hookka-pdf-preview";
export const PDF_PREVIEW_PREFIX = "/pdf-preview/";
export const PDF_PREVIEW_HEADER = "X-Hookka-Pdf-Preview";

/* Characters Windows / macOS refuse in a file name, plus control chars. */
// eslint-disable-next-line no-control-regex
const BAD_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** One file-name segment: illegal characters dropped, whitespace folded. */
export function cleanFileNamePart(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(BAD_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The saved name of a document PDF: "<doc no> <party>.pdf", e.g.
 * `PO-2611-012 Supplier Name.pdf`. The party (customer / supplier) is optional;
 * a missing doc number falls back to `fallback`. Capped at 120 characters
 * before the extension so a very long company name cannot break the save.
 */
export function pdfFileName(docNo: unknown, party?: unknown, fallback = "Document"): string {
  const no = cleanFileNamePart(docNo) || cleanFileNamePart(fallback) || "Document";
  const who = cleanFileNamePart(party);
  let base = who && who !== no ? `${no} ${who}` : no;
  if (base.length > 120) base = base.slice(0, 120).trim();
  // A trailing dot breaks the name on Windows.
  base = base.replace(/\.+$/, "");
  return `${base}.pdf`;
}

/** The overlay's / tab's title: the file name without ".pdf". */
export function pdfTitle(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

function toBlob(data: Blob | Uint8Array): Blob {
  if (data instanceof Blob) return data;
  return new Blob([data.slice()], { type: "application/pdf" });
}

/** Save a PDF under `filename` (the toolbar Download and every download path). */
export function savePdfBlob(data: Blob | Uint8Array, filename: string): void {
  const url = URL.createObjectURL(toBlob(data));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // eslint-disable-next-line no-restricted-syntax -- one-shot object-URL cleanup, not a React timer
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Open a URL in a new tab and say whether it worked (review P7, Houzs#5423).
 * `noopener` in the features string makes window.open return null even when
 * the tab DID open, so the opener is cleared by hand instead. Returns false
 * when the browser blocked the tab, so the caller can tell the user.
 */
export function openUrlInNewTab(url: string): boolean {
  let w: Window | null = null;
  try {
    w = window.open(url, "_blank");
  } catch {
    w = null;
  }
  if (!w) return false;
  try {
    w.opener = null;
  } catch {
    /* cross-origin already — nothing to clear */
  }
  return true;
}

export const BLOCKED_TAB_MESSAGE =
  "Your browser blocked the new tab. Allow pop-ups for this site, or use Download.";

/**
 * Put the PDF behind `/pdf-preview/<name>` for the service worker to serve, so
 * the browser's own Save uses the document's name. Returns the path, or null
 * when the worker is not in control or did not answer (the caller then uses
 * the blob). Only the latest preview is kept.
 */
export async function putPdfPreview(blob: Blob, filename: string): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return null;
  if (typeof caches === "undefined") return null;
  const path = `${PDF_PREVIEW_PREFIX}${encodeURIComponent(filename)}`;
  const cache = await caches.open(PDF_PREVIEW_CACHE);
  for (const k of await cache.keys()) await cache.delete(k);
  const disposition = `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  await cache.put(
    path,
    new Response(blob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        [PDF_PREVIEW_HEADER]: "1",
      },
    }),
  );
  // An older worker (before this route) would pass the request to the network
  // and get the SPA's HTML back. Only use the path if THIS worker answered it.
  const probe = await fetch(path, { method: "GET", cache: "no-store" });
  if (probe.headers.get(PDF_PREVIEW_HEADER) !== "1") return null;
  return path;
}

const OVERLAY_ID = "hookka-pdf-preview";
// Chrome needs the viewer to finish laying out before print() takes the pages.
const PRINT_SETTLE_MS = 400;

function button(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = [
    "padding:6px 12px",
    "border-radius:6px",
    "font:500 13px system-ui,sans-serif",
    "cursor:pointer",
    primary
      ? "background:#6B5C32;color:#fff;border:1px solid #6B5C32"
      : "background:#fff;color:#1F2937;border:1px solid #D1D5DB",
  ].join(";");
  return b;
}

/**
 * Show a PDF inside Hookka with Print / Download / Open in new tab / Close.
 * `print: true` also asks for the print dialog once the PDF has loaded.
 * Esc closes the preview only (caught in the capture phase, so a dialog
 * underneath stays open). Returns a function that closes it.
 */
export function openPdfPreview(
  data: Blob | Uint8Array,
  filename: string,
  opts: { print?: boolean } = {},
): () => void {
  document.getElementById(OVERLAY_ID)?.remove();
  const blob = toBlob(data);
  const blobUrl = URL.createObjectURL(blob);
  const title = pdfTitle(filename);
  let viewUrl = blobUrl;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;background:rgba(17,24,39,.6);display:flex;align-items:stretch;justify-content:center;padding:16px";

  const panel = document.createElement("div");
  panel.style.cssText =
    "display:flex;flex-direction:column;width:100%;max-width:1100px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #E5E7EB;background:#FAF9F7";

  const name = document.createElement("div");
  name.textContent = title;
  name.title = filename;
  name.style.cssText =
    "flex:1;min-width:120px;font:600 14px system-ui,sans-serif;color:#1F2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

  const note = document.createElement("div");
  note.setAttribute("role", "status");
  note.style.cssText = "flex-basis:100%;font:12px system-ui,sans-serif;color:#9A3412;display:none";

  const printBtn = button("Print", true);
  const downloadBtn = button("Download");
  const tabBtn = button("Open in new tab");
  const closeBtn = button("Close");
  closeBtn.setAttribute("aria-label", "Close preview");

  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.style.cssText = "flex:1;width:100%;border:0;display:block;background:#525659";

  const showNote = (msg: string) => {
    note.textContent = msg;
    note.style.display = "block";
  };

  const printFrame = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      showNote("Printing from the preview is not available in this browser. Use Open in new tab, then print.");
    }
  };

  const prevOverflow = document.body.style.overflow;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    close();
  };
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    document.body.style.overflow = prevOverflow;
    // eslint-disable-next-line no-restricted-syntax -- let the iframe let go of the blob first
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  printBtn.addEventListener("click", printFrame);
  downloadBtn.addEventListener("click", () => savePdfBlob(blob, filename));
  tabBtn.addEventListener("click", () => {
    if (!openUrlInNewTab(viewUrl)) showNote(BLOCKED_TAB_MESSAGE);
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey, true);

  for (const el of [name, printBtn, downloadBtn, tabBtn, closeBtn, note]) bar.appendChild(el);
  panel.appendChild(bar);
  panel.appendChild(iframe);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  closeBtn.focus();

  void (async () => {
    let path: string | null = null;
    try {
      path = await putPdfPreview(blob, filename);
    } catch {
      // Any storage / worker failure just means the blob address.
    }
    if (path) viewUrl = path;
    if (opts.print) {
      iframe.addEventListener(
        "load",
        () => {
          // eslint-disable-next-line no-restricted-syntax -- one-shot settle delay, not a React timer
          setTimeout(printFrame, PRINT_SETTLE_MS);
        },
        { once: true },
      );
    }
    iframe.src = viewUrl;
  })();

  return close;
}

/** Download or preview raw PDF bytes / a blob, by mode. */
export function deliverPdf(data: Blob | Uint8Array, filename: string, mode: PdfOutputMode = "download"): void {
  if (mode === "view") openPdfPreview(data, filename);
  else savePdfBlob(data, filename);
}

/** Download or preview a finished jsPDF document, by mode. */
export function deliverJsPdf(doc: jsPDF, filename: string, mode: PdfOutputMode = "download"): void {
  if (mode === "view") {
    doc.setProperties({ title: pdfTitle(filename) });
    openPdfPreview(doc.output("blob"), filename);
    return;
  }
  doc.save(filename);
}
