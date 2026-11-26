// ---------------------------------------------------------------------------
// File helpers for the Batch 2 comms screens. Pure, so tests/m-comms-*.test.mjs
// can run them under node.
//
// The rules are each module's existing ones, not new ones:
//   • IT Support — src/pages/it-support/index.tsx (MAX_FILES 5, 10 MB each,
//     images / PDF / MP4 / MOV / ZIP, judged as desktop judges them).
//   • Announcements — the shared /api/files upload (src/api/routes/files.ts:
//     50 MB ceiling); the composer offers images, videos and PDFs as desktop does.
// ---------------------------------------------------------------------------

export type FileKind = "image" | "video" | "pdf" | "zip" | "file";

type NamedFile = { name: string; type: string; size: number; lastModified?: number };

/** Coarse kind from a MIME type (and the name, for ZIP). */
export function kindOf(mime: string, name = ""): FileKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  if (m.includes("zip") || name.toLowerCase().endsWith(".zip")) return "zip";
  return "file";
}

/** "Image" / "Video" / "PDF" / "ZIP" / "File". */
export function kindLabel(k: FileKind): string {
  return k === "image" ? "Image" : k === "video" ? "Video" : k === "pdf" ? "PDF" : k === "zip" ? "ZIP" : "File";
}

/** "820 KB" / "2.4 MB" (one decimal from 1 MB). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Same file picked twice (name, size and modified time all equal). */
export function sameFile(a: NamedFile, b: NamedFile): boolean {
  return a.name === b.name && a.size === b.size && (a.lastModified ?? 0) === (b.lastModified ?? 0);
}

// ---- IT Support -------------------------------------------------------------------
export const IT_MAX_FILES = 5;
export const IT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The file browser's accept list (desktop FILE_ACCEPT). */
export const IT_FILE_ACCEPT = "image/*,video/mp4,video/quicktime,application/pdf,.zip";

/** Desktop acceptedType: images, PDF, MP4, MOV, or a .zip by name. */
export function itAcceptedType(f: { name: string; type: string }): boolean {
  return (
    f.type.startsWith("image/") ||
    ["application/pdf", "video/mp4", "video/quicktime"].includes(f.type) ||
    f.name.toLowerCase().endsWith(".zip")
  );
}

/**
 * Add picked files to the current list under the desktop rules, plus duplicate
 * prevention. Returns the new list and the reasons for anything left out.
 */
export function itAddFiles<T extends NamedFile>(current: T[], incoming: T[]): { files: T[]; rejected: string[] } {
  const rejected: string[] = [];
  const next = current.slice();
  for (const f of incoming) {
    if (!itAcceptedType(f)) rejected.push(`${f.name} wasn't added — only images, PDF, MP4, MOV and ZIP are allowed.`);
    else if (f.size > IT_MAX_FILE_BYTES) rejected.push(`${f.name} wasn't added — it's ${formatBytes(f.size)}, the limit is 10 MB.`);
    else if (next.some((x) => sameFile(x, f))) rejected.push(`${f.name} is already attached.`);
    else if (next.length >= IT_MAX_FILES) rejected.push(`You can attach up to ${IT_MAX_FILES} files.`);
    else next.push(f);
  }
  // One "up to 5" message is enough however many were left out for room.
  const room = `You can attach up to ${IT_MAX_FILES} files.`;
  const out = rejected.filter((r, i) => r !== room || rejected.indexOf(r) === i);
  return { files: next, rejected: out };
}

// ---- Announcements -------------------------------------------------------------------
/** /api/files ceiling (src/api/routes/files.ts MAX_UPLOAD_BYTES). */
export const ANN_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ANN_ACCEPT_MEDIA = "image/*,video/*";
export const ANN_ACCEPT_PDF = "application/pdf";
