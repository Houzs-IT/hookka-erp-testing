// ---------------------------------------------------------------------------
// idempotency-key.ts — the CLIENT half of the server's idempotency wrapper.
//
// T-006 R10 wrapped six create/convert routes (DO, GRN, PI, CN convert, both
// returns) in `withIdempotency`, but that wrapper is opt-in: with no
// `Idempotency-Key` header it runs the handler as normal, so the protection
// was inert — no screen sent one. This is the missing half.
//
// The rule that makes a key useful, and that is easy to get backwards:
//
//   * The SAME key must be reused while one attempt is unresolved, so that a
//     retry after a lost response is recognised as that same attempt and
//     replays its result instead of creating a second document. fetchJson
//     aborts at 15s and reports status 0 — a request that timed out may well
//     have committed on the server.
//   * A NEW key must be used once any response has arrived, success or error.
//     The server caches 4xx responses deliberately (a validation error stays a
//     validation error on retry), so a key held across a fixed-and-resubmitted
//     form would replay the old rejection and the form could never be saved.
//
// `withKey` is therefore the whole API: it holds the key across a no-response
// failure and drops it the moment the server answers.
//
// What this does NOT cover: a double-click that fires the handler twice. Each
// click would be a separate, answered attempt. Every call site here already
// disables its submit button while the request is in flight — that is what
// stops the double-click, and it must stay.
//
// Known edge: if a request times out and the operator then edits the payload
// and submits again, the server sees the retained key with a different body
// and answers 422 (BUG-2026-10-20-371). That answer drops the key, so the
// next submit goes through as a new request. The first attempt may still
// have committed, so the operator should check for it before resubmitting.
// ---------------------------------------------------------------------------
import { useRef } from "react";
import { FetchJsonError } from "./fetch-json";

/**
 * The attempt is still UNRESOLVED — keep the key so the retry is the same
 * attempt:
 *   - status 0: nothing came back (network drop, timeout, abort);
 *   - 5xx: the server never caches these and clears its marker, so a
 *     same-key retry simply runs again — and a 502/524 from the edge may
 *     sit on top of a handler that did commit;
 *   - the server's in-flight 409 (`inFlight: true` / `idempotency-in-flight`):
 *     the first attempt is still running. A business-rule 409 is an answer.
 * Anything else is the server's answer: the next submit is a new intent.
 */
function unresolved(status: number, inFlight: boolean): boolean {
  return status === 0 || status >= 500 || (status === 409 && inFlight);
}

function bodyInFlight(body: unknown): boolean {
  return (body as { inFlight?: unknown } | null)?.inFlight === true;
}

/**
 * Exported for tests — this pair IS the rule, and getting it backwards is
 * how a key silently stops protecting anything.
 *
 * For a thrown failure. A raw `fetch()` only rejects on network failure, so
 * anything thrown that is not a FetchJsonError is also a no-answer.
 */
export function serverAnswered(e: unknown): boolean {
  return e instanceof FetchJsonError && !unresolved(e.status, bodyInFlight(e.body));
}

/**
 * For a returned value: a raw `Response`, or a helper that RETURNS its
 * failure — the mobile `mutateJson` hands back `{ ok: false, status, body }`,
 * with status 0 for a network drop.
 */
export function resultAnswered(out: unknown): boolean {
  if (out instanceof Response) {
    return !unresolved(out.status, out.headers.get("idempotency-in-flight") === "true");
  }
  const r = out as { status?: unknown; body?: unknown } | null;
  if (typeof r !== "object" || r === null || typeof r.status !== "number") return true;
  return !unresolved(r.status, bodyInFlight(r.body));
}

/**
 * Several independent documents from one screen — the scan modal creates a
 * GRN or a purchase invoice per card, and they must not share a key or the
 * second card would replay the first card's document. `slot` separates them;
 * anything stable per document does (a card id, a row id).
 */
export function useIdempotencyKeys(): {
  withKey: <T>(slot: string, send: (key: string) => Promise<T>) => Promise<T>;
} {
  const ref = useRef<Map<string, string>>(new Map());

  async function withKey<T>(
    slot: string,
    send: (key: string) => Promise<T>,
  ): Promise<T> {
    const keys = ref.current;
    let key = keys.get(slot);
    if (!key) {
      key = crypto.randomUUID();
      keys.set(slot, key);
    }
    try {
      const out = await send(key);
      if (resultAnswered(out)) keys.delete(slot); // next submit is a new intent
      return out;
    } catch (e) {
      if (serverAnswered(e)) keys.delete(slot);
      throw e; // no answer → keep the key so a retry is the SAME attempt
    }
  }

  return { withKey };
}

/** One document per screen — the common case. */
export function useIdempotencyKey(): {
  withKey: <T>(send: (key: string) => Promise<T>) => Promise<T>;
} {
  const keyed = useIdempotencyKeys();
  return {
    withKey: (send) => keyed.withKey("default", send),
  };
}
