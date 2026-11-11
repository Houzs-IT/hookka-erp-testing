// ---------------------------------------------------------------------------
// scan-so-recovery — pure rules for the Sales Order scan that outlive one open sheet:
//
//   1. PENDING SCANS. GET /api/scan-queue/pending?kind=po (the endpoint the desktop modal resumes
//      from) lists the user's latest batch with un-consumed rows. A finished row is reviewed straight
//      from its stored rawJson — no extraction. A row still queued / processing, or one that failed,
//      is only continued when the user taps for it: continuing is what costs an OCR call, so it is
//      never started on its own.
//
//   2. PARTIAL SUCCESS. Once POST /api/sales-orders has answered, the order exists. What follows —
//      attaching the original, confirming the accuracy sample, marking the queue row consumed — can
//      each fail without undoing it. The saved order id is kept in a small record (survives closing
//      the sheet), and a retry runs ONLY the steps that have not succeeded. It can never create a
//      second order, because it never calls the create endpoint.
//
// No network here: callers inject the three step functions.
// ---------------------------------------------------------------------------
import { posOfRow, type RawScanPo } from "./scan-so";

export type FollowUpKey = "original" | "sample" | "consume";
/** todo = not tried yet; skipped = nothing to do (e.g. no accuracy sample on an old row). */
export type FollowUpStatus = "todo" | "ok" | "failed" | "skipped";

export const FOLLOW_ORDER: readonly FollowUpKey[] = ["original", "sample", "consume"];
export const FOLLOW_LABEL: Record<FollowUpKey, string> = {
  original: "Attach the scanned document to the order",
  sample: "Send the OCR accuracy report",
  consume: "Mark the scan as used",
};

export type MadeRecord = {
  rowId: string;
  docIdx: number;
  soId: string;
  soNo: string;
  poNo: string;
  sampleId: string | null;
  /** The final imported values, kept so the accuracy report can be re-sent exactly. */
  corrected: unknown;
  follow: Record<FollowUpKey, FollowUpStatus>;
  at: number;
};

export function newMadeRecord(
  base: Pick<MadeRecord, "rowId" | "docIdx" | "soId" | "soNo" | "poNo" | "sampleId" | "corrected">,
  now = Date.now(),
): MadeRecord {
  return {
    ...base,
    follow: { original: "todo", sample: base.sampleId ? "todo" : "skipped", consume: base.rowId ? "todo" : "skipped" },
    at: now,
  };
}

/** Anything with a per-step status (a saved-order record here; the other documents' records in scan-doc-recovery.ts). */
export type HasFollow = { follow: Record<FollowUpKey, FollowUpStatus> };
export const failedKeys = (rec: HasFollow): FollowUpKey[] => FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed");
export const hasOpenFollowUps = (rec: HasFollow): boolean => FOLLOW_ORDER.some((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo");

export type FollowUpDeps = Record<FollowUpKey, () => Promise<boolean>>;

/**
 * Run the steps that are `todo` or `failed`, in order, and return the record with the new statuses.
 * A step that already succeeded is never run again. "Consume" waits for "original": consuming nulls
 * the stored scan bytes, so it must not happen while the original still has to be read from them.
 */
export async function runFollowUps<R extends HasFollow>(rec: R, deps: FollowUpDeps): Promise<R> {
  const follow = { ...rec.follow };
  for (const key of FOLLOW_ORDER) {
    if (follow[key] !== "todo" && follow[key] !== "failed") continue;
    if (key === "consume" && follow.original === "failed") continue; // stays failed: nothing was attempted
    let ok = false;
    try {
      ok = await deps[key]();
    } catch {
      ok = false;
    }
    follow[key] = ok ? "ok" : "failed";
  }
  return { ...rec, follow };
}

// ---- persistence (per browser; wiped by the app's sign-out / sign-in cache sweep) ----------
export const MADE_KEY = "hookka-cache:m-scan-so-made:v1";
export const MADE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MADE_MAX = 30;
type KV = Pick<Storage, "getItem" | "setItem">;

export function loadMade(kv: KV | null | undefined, now = Date.now()): MadeRecord[] {
  try {
    const raw = kv?.getItem(MADE_KEY);
    const list = raw ? (JSON.parse(raw) as MadeRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.soId === "string" && now - r.at < MADE_TTL_MS) : [];
  } catch {
    return [];
  }
}

export function saveMade(kv: KV | null | undefined, list: MadeRecord[]): void {
  try {
    kv?.setItem(MADE_KEY, JSON.stringify(list.slice(-MADE_MAX)));
  } catch {
    /* private mode / quota: the in-memory list still works for this sheet */
  }
}

export const sameDoc = (r: Pick<MadeRecord, "rowId" | "docIdx">, rowId: string, docIdx: number): boolean => r.rowId === rowId && r.docIdx === docIdx;

export function upsertMade(list: MadeRecord[], rec: MadeRecord): MadeRecord[] {
  return [...list.filter((r) => !sameDoc(r, rec.rowId, rec.docIdx)), rec];
}

// ---- pending queue rows -> what the sheet offers -------------------------------------------
export type PendingRow = {
  id: string;
  status: string;
  fileName: string;
  rawJson: unknown;
  error: string | null;
  sampleId: string | null;
  consumedAt?: string | null;
  consumedDocIdxs?: number[] | null;
};

export type PendingPo = { po: RawScanPo; docIdx: number; made: MadeRecord | null };
export type PendingView = {
  rowId: string;
  fileName: string;
  /** ready: has a result to review; reading: queued / processing; failed: the OCR gave up. */
  state: "ready" | "reading" | "failed";
  sampleId: string | null;
  error: string | null;
  /**
   * True when this row is the ONLY unfinished one in its batch. Continuing a batch drives every
   * queued row in it (one OCR call each), so a row that shares a batch with others is left to the
   * desktop rather than silently paying for the rest.
   */
  solo: boolean;
  pos: PendingPo[];
};

export const PENDING_SHOWN = 5;

/**
 * A PO already turned into an order is offered again only while one of its follow-up steps is still
 * open (so the order is finished, never re-created). One that is consumed on the server and has no
 * open record is finished and hidden.
 */
export function pendingViews(rows: PendingRow[], made: MadeRecord[]): PendingView[] {
  const views: PendingView[] = [];
  const unfinished = rows.filter((x) => x.status === "queued" || x.status === "processing" || x.status === "failed").length;
  for (const r of rows) {
    const consumed = new Set(Array.isArray(r.consumedDocIdxs) ? r.consumedDocIdxs : []);
    if (r.status === "done" || r.status === "cached") {
      const pos: PendingPo[] = [];
      for (const { po, docIdx } of posOfRow(r.rawJson)) {
        const rec = made.find((m) => sameDoc(m, r.id, docIdx)) ?? null;
        if (rec) {
          if (hasOpenFollowUps(rec)) pos.push({ po, docIdx, made: rec });
          continue;
        }
        if (consumed.has(docIdx) || r.consumedAt) continue;
        pos.push({ po, docIdx, made: null });
      }
      if (pos.length) views.push({ rowId: r.id, fileName: r.fileName, state: "ready", sampleId: r.sampleId ?? null, error: null, solo: true, pos });
    } else if (r.status === "queued" || r.status === "processing") {
      views.push({ rowId: r.id, fileName: r.fileName, state: "reading", sampleId: null, error: null, solo: unfinished === 1, pos: [] });
    } else if (r.status === "failed" && !r.consumedAt) {
      views.push({ rowId: r.id, fileName: r.fileName, state: "failed", sampleId: null, error: r.error ?? null, solo: unfinished === 1, pos: [] });
    }
  }
  // Records whose row has dropped out of /pending (consumed) but still owe a step.
  for (const rec of made) {
    if (!hasOpenFollowUps(rec)) continue;
    if (views.some((v) => v.pos.some((p) => p.made && sameDoc(p.made, rec.rowId, rec.docIdx)))) continue;
    views.push({ rowId: rec.rowId, fileName: rec.poNo || rec.soNo, state: "ready", sampleId: rec.sampleId, error: null, solo: true, pos: [{ po: { customerPO: rec.poNo }, docIdx: rec.docIdx, made: rec }] });
  }
  return views.slice(0, PENDING_SHOWN);
}
