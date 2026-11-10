// ---------------------------------------------------------------------------
// stale-refresh.ts — ask again when a snapshot report answered with its
// older copy.
//
// Owner 2026-11-10 「要，改」: the first Financial Dashboard open after a save
// could still show the figures from before it. /api/accounting/dashboard is a
// serve-stale-while-revalidate snapshot: once a source table changes, the next
// read gets the copy built before the change at once while the server
// rebuilds it behind (~5–9 s on prod). The route now says so beside `data`:
//   { success, data, stale: { builtFrom, sourceMax } }
// builtFrom = the source watermark the served copy was built from;
// sourceMax = the newest source change when the server answered.
//
// The page asks again on STALE_RETRY_DELAYS_MS: once after the first stale
// answer, then only while the copy still predates that first answer. A copy
// built from that answer's watermark holds every change made before the page
// asked, which is what the reader is waiting for. Later changes (the factory
// scans job cards all day) are left to the next open. Never more than three
// retries.
// ---------------------------------------------------------------------------

/** What the route says about a copy it served while rebuilding. */
export type StaleCopy = { builtFrom: string | null; sourceMax: string | null };

/** Where a page is in one run of stale answers. */
export type StaleRun = { tries: number; firstMax: string | null };

export const NO_STALE_RUN: StaleRun = { tries: 0, firstMax: null };

/** The wait before retry 1, 2 and 3. A rebuild measured ~5–9 s on prod. */
export const STALE_RETRY_DELAYS_MS: readonly number[] = [10_000, 10_000, 15_000];

/** The `stale` beside a response's data, or null when the answer is current. */
export function staleCopyOf(body: unknown): StaleCopy | null {
  if (!body || typeof body !== "object") return null;
  const s = (body as { stale?: unknown }).stale;
  if (s === true) return { builtFrom: null, sourceMax: null };
  if (!s || typeof s !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const o = s as { builtFrom?: unknown; sourceMax?: unknown };
  return { builtFrom: str(o.builtFrom), sourceMax: str(o.sourceMax) };
}

const ms = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);

/**
 * One answer in, the run to keep and how long to wait before asking again
 * (null = stop). A current answer, a copy that covers the first stale answer,
 * or the third retry ends the run.
 */
export function planStaleRetry(run: StaleRun, body: unknown): { run: StaleRun; retryInMs: number | null } {
  const copy = staleCopyOf(body);
  if (!copy) return { run: NO_STALE_RUN, retryInMs: null };
  const firstMax = run.tries === 0 ? copy.sourceMax : run.firstMax;
  if (run.tries >= STALE_RETRY_DELAYS_MS.length) return { run: NO_STALE_RUN, retryInMs: null };
  // Covered: built from (at least) the watermark of the first stale answer.
  // Unreadable dates never count as covered; the retry cap ends those runs.
  if (run.tries > 0 && ms(copy.builtFrom) >= ms(firstMax)) return { run: NO_STALE_RUN, retryInMs: null };
  return { run: { tries: run.tries + 1, firstMax }, retryInMs: STALE_RETRY_DELAYS_MS[run.tries] };
}
