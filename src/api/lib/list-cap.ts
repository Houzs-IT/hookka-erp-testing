// ---------------------------------------------------------------------------
// list-cap.ts — a capped list must SAY it was capped.
//
// Several list endpoints stop at the newest N rows (LIMIT 500) so an
// append-only table never full-scans. That cap used to be silent: row 501 and
// older simply vanished and the page looked complete. Queries now ask for
// N + 1 rows; when the extra row comes back the list really was cut, so the
// response carries `X-List-Truncated: N` and api-client turns that into a
// one-time warning toast ("only the newest N are shown — narrow the filter").
// Same fix Houzs shipped for its silently-truncated lists.
// ---------------------------------------------------------------------------
import type { Context } from "hono";

export const LIST_TRUNCATED_HEADER = "X-List-Truncated";

/** Rows fetched with `LIMIT cap + 1` → at most `cap` rows, flagging the cut. */
export function capList<T>(c: Context, rows: readonly T[] | null | undefined, cap: number): T[] {
  const list = (rows ?? []) as T[];
  if (list.length <= cap) return list;
  c.header(LIST_TRUNCATED_HEADER, String(cap));
  return list.slice(0, cap);
}
