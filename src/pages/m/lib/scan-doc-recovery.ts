// ---------------------------------------------------------------------------
// scan-doc-recovery — what outlives one open scan sheet, for the supplier / finance documents
// (Purchase Invoice now; Goods Receipt and Payment Voucher use the same module). Same rules as the Sales
// Order flow (scan-so-recovery.ts), which it shares the step runner with:
//
//   · A finished read is reviewed from its stored result (GET /api/scan-queue/pending) — no OCR call.
//     A read still pending or failed is continued only when the user taps, and only when it is alone in
//     its batch (continuing a batch drives every queued file in it).
//   · Once the document exists, the steps after it (attach the original if it was not linked at create,
//     send the OCR-accuracy report, mark the scan used) can each fail without undoing it. The saved
//     document's id is kept in a record that survives closing the sheet, and a retry runs ONLY the steps
//     that have not succeeded — it never calls the create endpoint, so it cannot make a second document.
// Pure: no network.
// ---------------------------------------------------------------------------
import { FOLLOW_ORDER, hasOpenFollowUps, type FollowUpKey, type FollowUpStatus, type PendingRow } from "./scan-so-recovery";

export type DocKind = "PI" | "GRN" | "PV";

export type DocRecord = {
  kind: DocKind;
  rowId: string;
  docIdx: number;
  /** The saved document's id and number (what "Open" and the success card use). */
  docId: string;
  docNo: string;
  /** What the operator knows it by (supplier invoice number, bill reference…). */
  ref: string;
  sampleId: string | null;
  /** The final imported values, kept so the accuracy report can be re-sent exactly. */
  corrected: unknown;
  follow: Record<FollowUpKey, FollowUpStatus>;
  at: number;
};

export const DOC_MADE_KEY = "hookka-cache:m-scan-doc-made:v1";
export const DOC_MADE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX = 40;
type KV = Pick<Storage, "getItem" | "setItem">;

/**
 * `needsOriginal`: the original still has to be attached after create (it was not linked at create). When it
 * was linked, that step is "skipped".
 */
export function newDocRecord(
  base: Pick<DocRecord, "kind" | "rowId" | "docIdx" | "docId" | "docNo" | "ref" | "sampleId" | "corrected"> & { needsOriginal: boolean },
  now = Date.now(),
): DocRecord {
  const { needsOriginal, ...rec } = base;
  return {
    ...rec,
    follow: { original: needsOriginal ? "todo" : "skipped", sample: rec.sampleId ? "todo" : "skipped", consume: rec.rowId ? "todo" : "skipped" },
    at: now,
  };
}

const readAll = (kv: KV | null | undefined, now: number): DocRecord[] => {
  try {
    const raw = kv?.getItem(DOC_MADE_KEY);
    const list = raw ? (JSON.parse(raw) as DocRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.docId === "string" && now - r.at < DOC_MADE_TTL_MS) : [];
  } catch {
    return [];
  }
};

export function loadDocs(kv: KV | null | undefined, kind: DocKind, now = Date.now()): DocRecord[] {
  return readAll(kv, now).filter((r) => r.kind === kind);
}

/** Save this kind's records; other kinds' records are kept as they were. */
export function saveDocs(kv: KV | null | undefined, kind: DocKind, list: DocRecord[], now = Date.now()): void {
  try {
    const others = readAll(kv, now).filter((r) => r.kind !== kind);
    kv?.setItem(DOC_MADE_KEY, JSON.stringify([...others, ...list.filter((r) => r.kind === kind).slice(-MAX)]));
  } catch {
    /* private mode / quota: the in-memory list still works for this sheet */
  }
}

export const sameScanDoc = (r: Pick<DocRecord, "kind" | "rowId" | "docIdx">, kind: DocKind, rowId: string, docIdx: number): boolean => r.kind === kind && r.rowId === rowId && r.docIdx === docIdx;

export function upsertDoc(list: DocRecord[], rec: DocRecord): DocRecord[] {
  return [...list.filter((r) => !sameScanDoc(r, rec.kind, rec.rowId, rec.docIdx)), rec];
}

export const DOC_FOLLOW_LABEL: Record<FollowUpKey, string> = {
  original: "Attach the scanned document",
  sample: "Send the OCR accuracy report",
  consume: "Mark the scan as used",
};

// ---- pending queue rows -> what the sheet offers ---------------------------------------------------------
export type PendingDoc<T> = { doc: T; docIdx: number; made: DocRecord | null };
export type PendingDocView<T> = {
  rowId: string;
  fileName: string;
  state: "ready" | "reading" | "failed";
  sampleId: string | null;
  error: string | null;
  /** True when this row is the ONLY unfinished one in its batch. */
  solo: boolean;
  docs: PendingDoc<T>[];
};

export const PENDING_DOCS_SHOWN = 5;

/**
 * A document already turned into a record is offered again only while one of its steps is open (so it is
 * finished, never re-created); one consumed on the server with no open record is finished and hidden.
 */
export function pendingDocViews<T>(
  rows: PendingRow[],
  records: DocRecord[],
  kind: DocKind,
  docsOf: (rawJson: unknown) => { doc: T; docIdx: number }[],
  placeholder: (rec: DocRecord) => T,
): PendingDocView<T>[] {
  const views: PendingDocView<T>[] = [];
  const unfinished = rows.filter((x) => x.status === "queued" || x.status === "processing" || x.status === "failed").length;
  for (const r of rows) {
    const consumed = new Set(Array.isArray(r.consumedDocIdxs) ? r.consumedDocIdxs : []);
    if (r.status === "done" || r.status === "cached") {
      const docs: PendingDoc<T>[] = [];
      for (const { doc, docIdx } of docsOf(r.rawJson)) {
        const rec = records.find((m) => sameScanDoc(m, kind, r.id, docIdx)) ?? null;
        if (rec) {
          if (hasOpenFollowUps(rec)) docs.push({ doc, docIdx, made: rec });
          continue;
        }
        if (consumed.has(docIdx) || r.consumedAt) continue;
        docs.push({ doc, docIdx, made: null });
      }
      if (docs.length) views.push({ rowId: r.id, fileName: r.fileName, state: "ready", sampleId: r.sampleId ?? null, error: null, solo: true, docs });
    } else if (r.status === "queued" || r.status === "processing") {
      views.push({ rowId: r.id, fileName: r.fileName, state: "reading", sampleId: null, error: null, solo: unfinished === 1, docs: [] });
    } else if (r.status === "failed" && !r.consumedAt) {
      views.push({ rowId: r.id, fileName: r.fileName, state: "failed", sampleId: null, error: r.error ?? null, solo: unfinished === 1, docs: [] });
    }
  }
  for (const rec of records) {
    if (rec.kind !== kind || !hasOpenFollowUps(rec)) continue;
    if (views.some((v) => v.docs.some((d) => d.made && sameScanDoc(d.made, kind, rec.rowId, rec.docIdx)))) continue;
    views.push({ rowId: rec.rowId, fileName: rec.ref || rec.docNo, state: "ready", sampleId: rec.sampleId, error: null, solo: true, docs: [{ doc: placeholder(rec), docIdx: rec.docIdx, made: rec }] });
  }
  return views.slice(0, PENDING_DOCS_SHOWN);
}

export { FOLLOW_ORDER };
