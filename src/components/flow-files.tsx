// ---------------------------------------------------------------------------
// flow-files.tsx — photos, videos and PDFs on a flow document and its lines
// (review pass 2 C1-5, Conts#278).
//
//   <FlowFilesCard resourceType="PO" resourceId={po.id} />
//       the document's own files (Attachments card).
//   const lineFiles = useFlowLineFiles("PO", po.id);   (src/lib/use-flow-line-files.ts)
//   <LineFilesButton lineType="PO_LINE" lineId={item.id} files={lineFiles} />
//       a paperclip on each line: the line's own files, plus the files carried
//       down READ-ONLY from the line it was made from (PO line on a GRN line…).
//
// Storage is the shared /api/files store (resourceType + resourceId), the same
// type names the phone app writes. Upload goes through uploadFileAsset (size
// pre-check, timeout, readable check); photos are downscaled first like the
// POD photos (longest side 1600 px, JPEG 0.8). A PDF opens in the in-app PDF
// preview; a photo or video opens in a viewer here. Display only — nothing in
// this file touches a quantity, a price or stock.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Film, Image as ImageIcon, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useEscapeClose, isBackdropClick } from "@/lib/escape-stack";
import { uploadFileAsset } from "@/lib/upload-file";
import { usePermissions } from "@/lib/use-permission";
import type { FlowLineFilesState } from "@/lib/use-flow-line-files";
import {
  FLOW_FILE_ACCEPT,
  FLOW_PHOTO_MAX_DIM,
  FLOW_PHOTO_QUALITY,
  flowFileKind,
  flowFileResource,
  jpegName,
  lineFileCount,
  normalizeFileRow,
  shouldDownscale,
  type FlowFileRow,
  type InheritedFileRow,
  type LineFiles,
} from "@/lib/flow-files";

/**
 * Who may do what, mirroring the server gate in src/api/routes/files.ts:
 * upload = the document's update permission; delete = that AND files:delete
 * (an attachment is evidence — removing one stays an admin action, as it was).
 */
function useFlowFileRights(resourceType: string): { canUpload: boolean; canDelete: boolean } {
  const { hasPermission } = usePermissions();
  const resource = flowFileResource(resourceType);
  const canUpload = resource ? hasPermission(resource, "update") : hasPermission("files", "create");
  return { canUpload, canDelete: canUpload && hasPermission("files", "delete") };
}

const fileUrl = (id: string, inline = true) =>
  `/api/files/${encodeURIComponent(id)}/download${inline ? "?inline=1" : ""}`;

function prettySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Shrink a still photo before upload; anything else (video, PDF, GIF, HEIC) goes as-is. */
async function prepareUpload(file: File): Promise<File> {
  if (!shouldDownscale(file)) return file;
  try {
    const { compressImage } = await import("@/lib/image-compress");
    const dataUrl = await compressImage(file, { maxDim: FLOW_PHOTO_MAX_DIM, quality: FLOW_PHOTO_QUALITY });
    const blob = await (await fetch(dataUrl)).blob();
    // Keep the original when the "smaller" copy isn't.
    if (blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Upload picked files one by one; returns how many made it, toasting each failure. */
async function uploadAll(
  files: File[],
  resourceType: string,
  resourceId: string,
  toast: ReturnType<typeof useToast>["toast"],
): Promise<number> {
  let ok = 0;
  for (const picked of files) {
    const file = await prepareUpload(picked);
    const res = await uploadFileAsset({ file, resourceType, resourceId });
    if (res.ok) {
      ok += 1;
      if (!res.verified) toast.error(`${picked.name}: saved, but not readable yet — refresh in a minute.`);
    } else {
      toast.error(`${picked.name}: ${res.error}`);
    }
  }
  if (ok > 0) toast.success(ok === 1 ? "File uploaded." : `${ok} files uploaded.`);
  return ok;
}

async function deleteFile(
  row: FlowFileRow,
  confirm: ReturnType<typeof useConfirm>["confirm"],
  toast: ReturnType<typeof useToast>["toast"],
): Promise<boolean> {
  const go = await confirm({
    title: "Delete file?",
    message: `${row.filename} will be removed from this document.`,
    danger: true,
  });
  if (!go) return false;
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(row.id)}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error || `Delete failed (HTTP ${res.status})`);
      return false;
    }
    toast.success("File deleted.");
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Delete failed");
    return false;
  }
}

/** Photo / video viewer; a PDF goes to the shared in-app PDF preview instead. */
function MediaViewer({ row, onClose }: { row: FlowFileRow; onClose: () => void }) {
  useEscapeClose(onClose);
  const kind = flowFileKind(row.contentType, row.filename);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (isBackdropClick(e)) onClose();
      }}
    >
      <div className="relative flex max-h-full max-w-full flex-col items-center gap-2">
        <div className="flex w-full items-center justify-between gap-3 text-sm text-white">
          <span className="truncate">{row.filename}</span>
          <div className="flex items-center gap-3">
            <a href={fileUrl(row.id, false)} className="underline" title="Download">
              Download
            </a>
            <button type="button" onClick={onClose} title="Close (Esc)">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {kind === "video" ? (
          <video src={fileUrl(row.id)} controls autoPlay className="max-h-[80vh] max-w-[90vw] rounded bg-black" />
        ) : (
          <img src={fileUrl(row.id)} alt={row.filename} className="max-h-[80vh] max-w-[90vw] rounded bg-white object-contain" />
        )}
      </div>
    </div>
  );
}

async function openPdf(row: FlowFileRow, toast: ReturnType<typeof useToast>["toast"]) {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(row.id)}/stream?inline=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const { openPdfPreview } = await import("@/lib/pdf-preview");
    openPdfPreview(blob, row.filename || "Attachment.pdf");
  } catch (err) {
    toast.error(`Couldn't open ${row.filename}: ${err instanceof Error ? err.message : "error"}`);
  }
}

/** The tiles: a thumbnail for a photo, an icon for a video / PDF. */
function FileTiles({
  rows,
  onDelete,
  caption,
}: {
  rows: Array<FlowFileRow | InheritedFileRow>;
  onDelete?: (row: FlowFileRow) => void;
  caption?: (row: FlowFileRow | InheritedFileRow) => string | null;
}) {
  const { toast } = useToast();
  const [viewing, setViewing] = useState<FlowFileRow | null>(null);
  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {rows.map((r) => {
          const kind = flowFileKind(r.contentType, r.filename);
          const sub = caption?.(r);
          return (
            <div key={r.id} className="group relative min-w-0">
              <button
                type="button"
                className="block w-full text-left"
                title={r.filename}
                onClick={() => (kind === "pdf" ? void openPdf(r, toast) : kind === "other" ? window.open(fileUrl(r.id, false)) : setViewing(r))}
              >
                {kind === "image" && !/heic|heif/i.test(`${r.contentType} ${r.filename}`) ? (
                  <img
                    src={fileUrl(r.id)}
                    alt={r.filename}
                    loading="lazy"
                    className="h-20 w-full rounded border border-[#E2DDD8] object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded border border-[#E2DDD8] bg-[#FAF9F7] text-[#6B7280]">
                    {kind === "video" ? <Film className="h-6 w-6" /> : kind === "image" ? <ImageIcon className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                    <span className="text-[10px] uppercase">{kind === "other" ? "file" : kind}</span>
                  </div>
                )}
                <div className="mt-0.5 truncate text-[11px] text-[#1F1D1B]">{r.filename}</div>
                <div className="truncate text-[10px] text-[#9CA3AF]">{sub ?? prettySize(r.sizeBytes)}</div>
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(r)}
                  className="absolute right-1 top-1 rounded bg-white/90 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  style={{ color: "var(--text-danger, #9A3A2D)" }}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {viewing && <MediaViewer row={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** Upload button + hidden picker (several files at once; phone opens camera / gallery). */
function UploadButton({ disabled, onFiles, uploading }: { disabled?: boolean; uploading: boolean; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept={FLOW_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (ref.current) ref.current.value = "";
          if (picked.length) onFiles(picked);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" />
        {uploading ? "Uploading…" : "Add files"}
      </Button>
    </>
  );
}

/** The document's own files — an "Attachments" card on the detail page. */
export function FlowFilesCard({
  resourceType,
  resourceId,
  title = "Attachments",
  hint = "Photos, videos and PDFs for this document.",
}: {
  resourceType: string;
  resourceId: string;
  title?: string;
  hint?: string;
}) {
  const { canUpload, canDelete } = useFlowFileRights(resourceType);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<FlowFileRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/files?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`,
      );
      if (res.status === 403) {
        setState("denied");
        return;
      }
      const j = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[] } | null;
      if (!res.ok) throw new Error(String(res.status));
      setRows((j?.data ?? []).map(normalizeFileRow).reverse());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    if (!resourceId) return;
    // Deferred one tick so the state flip isn't inside the effect body; re-armed
    // whenever the record changes, which a one-shot useTimeout would not do.
    // eslint-disable-next-line no-restricted-syntax
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [resourceId, load]);

  if (state === "denied") return null;

  return (
    <div className="rounded-lg border border-[#E2DDD8] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[#1F1D1B]">
            {title}
            {rows.length > 0 && <span className="ml-1 font-normal text-[#9CA3AF]">({rows.length})</span>}
          </div>
          <div className="text-xs text-[#9CA3AF]">{hint}</div>
        </div>
        {canUpload && (
          <UploadButton
            uploading={uploading}
            disabled={!resourceId}
            onFiles={async (files) => {
              setUploading(true);
              try {
                await uploadAll(files, resourceType, resourceId, toast);
              } finally {
                setUploading(false);
              }
              await load();
            }}
          />
        )}
      </div>
      {state === "loading" ? (
        <div className="py-4 text-center text-sm text-[#9CA3AF]">Loading…</div>
      ) : state === "error" ? (
        <div className="py-4 text-center text-sm text-[#9CA3AF]">
          Couldn't load the files.{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#E2DDD8] py-4 text-center text-sm text-[#9CA3AF]">
          No files yet.
        </div>
      ) : (
        <FileTiles
          rows={rows}
          onDelete={
            canDelete
              ? async (row) => {
                  if (await deleteFile(row, confirm, toast)) await load();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** The paperclip on one line, and its popup. */
export function LineFilesButton({
  lineType,
  lineId,
  files,
  lineLabel,
}: {
  lineType: string;
  lineId: string | number | null | undefined;
  files: FlowLineFilesState;
  /** e.g. "Line 2 — FAB-001", shown as the popup title. */
  lineLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = lineId == null ? "" : String(lineId);
  if (!id) return null;
  const entry = files.data[id];
  const count = lineFileCount(entry);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-[#F0ECE3] ${
          count > 0 ? "text-[#6B5C32]" : "text-[#C4BFB8]"
        }`}
        title={count > 0 ? `${count} file${count === 1 ? "" : "s"} on this line` : "Attach files to this line"}
        aria-label="Line files"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {count > 0 && <span>{count}</span>}
      </button>
      {open && (
        <LineFilesPopup
          lineType={lineType}
          lineId={id}
          entry={entry}
          title={lineLabel}
          onChanged={files.reload}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function LineFilesPopup({
  lineType,
  lineId,
  entry,
  title,
  onChanged,
  onClose,
}: {
  lineType: string;
  lineId: string;
  entry: LineFiles | undefined;
  title?: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { canUpload, canDelete } = useFlowFileRights(lineType);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [uploading, setUploading] = useState(false);
  useEscapeClose(onClose, !uploading);
  const own = entry?.own ?? [];
  const inherited = entry?.inherited ?? [];
  // Carried-down files grouped by where they come from.
  const groups = new Map<string, InheritedFileRow[]>();
  for (const r of inherited) {
    const arr = groups.get(r.fromLabel);
    if (arr) arr.push(r);
    else groups.set(r.fromLabel, [r]);
  }
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (isBackdropClick(e) && !uploading) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[#1F1D1B]">Line files</div>
            {title && <div className="text-xs text-[#6B7280]">{title}</div>}
          </div>
          <div className="flex items-center gap-2">
            {canUpload && (
              <UploadButton
                uploading={uploading}
                onFiles={async (files) => {
                  setUploading(true);
                  try {
                    await uploadAll(files, lineType, lineId, toast);
                  } finally {
                    setUploading(false);
                  }
                  await onChanged();
                }}
              />
            )}
            <button type="button" onClick={onClose} disabled={uploading} title="Close (Esc)" className="text-[#6B7280]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {own.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#E2DDD8] py-4 text-center text-sm text-[#9CA3AF]">
            No files on this line yet.
          </div>
        ) : (
          <FileTiles
            rows={own}
            onDelete={
              canDelete
                ? async (row) => {
                    if (await deleteFile(row, confirm, toast)) await onChanged();
                  }
                : undefined
            }
          />
        )}
        {[...groups.entries()].map(([label, rows]) => (
          <div key={label} className="mt-4">
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-[#8A8577]">
              From the {label.toLowerCase()} ({rows.length}) · read-only
            </div>
            <FileTiles rows={rows} />
          </div>
        ))}
      </div>
    </div>
  );
}
