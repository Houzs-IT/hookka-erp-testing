// ---------------------------------------------------------------------------
// list-load-error — the one sentence a list page shows when its rows did not
// load (review G7, Conts#594). A failed list request used to read as an empty
// list ("No sales orders found."), which is a wrong answer, not an error.
//
// Two ways a list fails:
//   1. the request itself failed (network, timeout, 5xx) — `useCachedJson`
//      hands back `error` (already through humanizeError);
//   2. the server answered 200 with `{ success: false, error }` on a first
//      load — the page's `resp?.success ? data : []` turns that into [].
// Both come back here as a sentence; a good response comes back as null.
// The wording of a refusal is the server's own (`bodyErrorText`, see
// src/lib/response-error.ts).
// ---------------------------------------------------------------------------
import { bodyErrorText } from "./response-error";

export function listLoadError(resp: unknown, error: string | null | undefined): string | null {
  if (error && error.trim()) return error.trim();
  if (resp && typeof resp === "object" && !Array.isArray(resp) && (resp as { success?: unknown }).success === false) {
    return bodyErrorText(resp) || "The server could not return this list.";
  }
  return null;
}
