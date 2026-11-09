// ---------------------------------------------------------------------------
// response-error.ts — read the REAL reason out of a failed API response.
//
// Every route answers a refusal as `{ success: false, error: "<sentence>" }`.
// A page that toasts a hard-coded "Failed" (or, worse, never checks `res.ok`
// and carries on as if the save worked) throws that sentence away — the
// operator sees "Failed" or "Saved" when the server said "Credit limit
// exceeded". This helper returns the server's own `error` (or `message`), and
// only when the body has none, the caller's fallback with the HTTP status.
//
// It does NOT decide what is safe to show: `toast.error` already runs every
// message through `humanizeError`, which keeps a clean backend sentence and
// swaps a technical one (or the "(HTTP 500)" fallback) for a friendly line.
//
// Reads a CLONE of the response, so a caller that still wants the body can
// read it afterwards.
// ---------------------------------------------------------------------------

/** Extract `error` / `message` from an already-parsed response body. */
export function bodyErrorText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as { error?: unknown; message?: unknown };
  if (typeof b.error === "string" && b.error.trim()) return b.error.trim();
  if (typeof b.message === "string" && b.message.trim()) return b.message.trim();
  return "";
}

/**
 * The message to show for a failed response: the server's `error` field when
 * it sent one, else `"<fallback> (HTTP <status>)"`.
 */
export async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    /* non-JSON body (proxy error page, empty 204) — fall through */
  }
  return bodyErrorText(body) || `${fallback} (HTTP ${res.status})`;
}
