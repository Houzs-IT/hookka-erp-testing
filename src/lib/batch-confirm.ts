// ---------------------------------------------------------------------------
// batch-confirm.ts — confirm several documents from a list, one at a time.
//
// Review G11 (owner-approved 2026-11-10; ported from Houzs#5249 / #5250).
// Tick several DRAFT rows on the GRN or Purchase Invoice list, press
// "Confirm selected": each document goes through the SAME per-document
// endpoint its own Confirm / Approve button uses (PUT /api/<doc>/:id with
// `{ status: "CONFIRMED" }`), in turn — never in parallel — so the server sees
// exactly the sequence of single confirms it would see from the detail page.
//
// Nothing here posts stock or ledger entries; it only decides WHICH rows are
// sent, sends them one by one, and collects every refusal with the server's
// own reason (src/lib/response-error.ts). A refusal does not stop the run and
// a success is never rolled back.
//
// Idempotency: the per-document confirm PUT carries no Idempotency-Key today
// (the #1208 helper covers creates only), so none is sent here either. A
// repeated DRAFT → CONFIRMED is refused by the server's own transition table,
// which is what the failure list then shows.
// ---------------------------------------------------------------------------

import { bodyErrorText } from "./response-error";

export type BatchFailure = { label: string; reason: string };

export type BatchResult = {
  succeeded: string[];
  failed: BatchFailure[];
};

/** The rows of a selection that may be confirmed — everything else is left out of N. */
export function eligibleForConfirm<T>(rows: readonly T[], canConfirm: (row: T) => boolean): T[] {
  return rows.filter(canConfirm);
}

/** Integer-sen total of the rows about to be confirmed (for the dialog). */
export function batchTotalSen<T>(rows: readonly T[], amountSen: (row: T) => number | null | undefined): number {
  let total = 0;
  for (const r of rows) {
    const v = Number(amountSen(r));
    if (Number.isFinite(v)) total += Math.round(v);
  }
  return total;
}

/** "Confirming 3 of 12" — `done` is the number already finished. */
export function batchProgressLabel(done: number, total: number): string {
  const current = Math.min(done + 1, total);
  return `Confirming ${current} of ${total}`;
}

/** One line for the end-of-run summary. */
export function batchSummary(result: BatchResult, noun: string): string {
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`);
  if (bad === 0) return `Confirmed ${ok} ${plural(ok)}.`;
  if (ok === 0) return `None confirmed — ${bad} ${plural(bad)} refused.`;
  return `Confirmed ${ok} ${plural(ok)}; ${bad} refused.`;
}

/**
 * Run `confirmOne` for every item, strictly one after another. Each call
 * resolves to `null` on success or the refusal reason. A thrown error counts
 * as a refusal (its message is the reason); the run always reaches the end.
 */
export async function runSequentialBatch<T>(
  items: readonly T[],
  label: (item: T) => string,
  confirmOne: (item: T) => Promise<string | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchResult> {
  const result: BatchResult = { succeeded: [], failed: [] };
  const total = items.length;
  for (let i = 0; i < total; i++) {
    const item = items[i];
    onProgress?.(i, total);
    let reason: string | null;
    try {
      reason = await confirmOne(item);
    } catch (e) {
      reason = e instanceof Error && e.message ? e.message : "Network error";
    }
    if (reason == null) result.succeeded.push(label(item));
    else result.failed.push({ label: label(item), reason });
  }
  onProgress?.(total, total);
  return result;
}

/**
 * The single-document confirm the detail pages already make:
 * PUT `url` with `{ status: "CONFIRMED" }`. Success is exactly what the detail
 * page treats as success (`res.ok && body.success`); anything else returns the
 * server's own reason, or the fallback with the HTTP status.
 */
export async function putStatusConfirmed(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "CONFIRMED" }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — fall through to the HTTP status */
  }
  const success = !!(body && typeof body === "object" && (body as { success?: unknown }).success);
  if (res.ok && success) return null;
  return bodyErrorText(body) || `Confirm failed (HTTP ${res.status})`;
}
