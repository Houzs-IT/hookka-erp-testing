// ---------------------------------------------------------------------------
// pod-history.ts — proof-of-delivery bookkeeping shared by the API and the
// pages (review H3-8, Houzs#5529; C2-3, Conts#547). Pure.
//
// H3-8: "Undo delivered" (Reverse to Dispatched) used to leave the first,
// wrong POD in place, and the next POD write replaced it — the photos,
// signature and time of the first attempt were lost. Now the undo moves the
// current POD into `earlierAttempts` (stamped `undoneAt`), and a POD written
// onto a DO that is not DELIVERED / INVOICED carries any POD still sitting
// there (DOs undone before this change) into the same list. The detail page
// shows them as "Earlier delivery attempt". Display only — nothing reads them
// for stock, money or status.
// ---------------------------------------------------------------------------

/** One earlier (undone) proof of delivery, as it was captured. */
export type PodEarlierAttempt = {
  receiverName?: string;
  receiverIC?: string;
  signatureDataUrl?: string;
  photoDataUrls?: string[];
  remarks?: string;
  deliveredAt?: string;
  capturedBy?: string;
  /** When the delivery was undone (server time); absent for a POD carried
   *  from a DO undone before this field existed. */
  undoneAt?: string;
};

/** How many earlier attempts are kept (oldest dropped first). */
export const MAX_EARLIER_ATTEMPTS = 3;

type PodLike = Record<string, unknown> | null | undefined;

/** True when a stored POD holds an actual capture (not just history). */
export function podHasContent(pod: PodLike): boolean {
  if (!pod || typeof pod !== "object") return false;
  const photos = Array.isArray(pod.photoDataUrls) ? pod.photoDataUrls.filter(Boolean) : [];
  return !!(String(pod.receiverName ?? "").trim() || String(pod.signatureDataUrl ?? "").trim() || photos.length);
}

function attemptsOf(pod: PodLike): PodEarlierAttempt[] {
  const list = pod && Array.isArray(pod.earlierAttempts) ? (pod.earlierAttempts as PodEarlierAttempt[]) : [];
  return list.filter((a) => a && typeof a === "object");
}

/** The POD's own capture, without its history. */
export function podCurrentOnly(pod: PodLike): PodEarlierAttempt {
  if (!pod) return {};
  const rest = { ...(pod as Record<string, unknown>) };
  delete rest.earlierAttempts;
  return rest as PodEarlierAttempt;
}

/**
 * The stored POD after "Undo delivered": the current capture moves into the
 * history, stamped `undoneAt`; nothing is current any more, so the next
 * "Delivered" asks for a fresh POD. Null when there was no POD at all.
 */
export function podAfterUndo(pod: PodLike, undoneAt: string): Record<string, unknown> | null {
  const earlier = attemptsOf(pod);
  if (podHasContent(pod)) earlier.push({ ...podCurrentOnly(pod), undoneAt });
  if (earlier.length === 0) return null;
  return { earlierAttempts: earlier.slice(-MAX_EARLIER_ATTEMPTS) };
}

/**
 * The history a NEW POD write keeps: the earlier attempts already stored,
 * plus the stored capture when the DO is being delivered again (status not
 * DELIVERED / INVOICED — i.e. it was undone). A correction on a DO that is
 * still DELIVERED replaces the capture as before.
 */
export function podEarlierForNewWrite(prevPod: PodLike, existingStatus: string | null | undefined): PodEarlierAttempt[] {
  const earlier = attemptsOf(prevPod);
  const st = String(existingStatus ?? "").toUpperCase();
  if (podHasContent(prevPod) && st !== "DELIVERED" && st !== "INVOICED") {
    earlier.push(podCurrentOnly(prevPod));
  }
  return earlier.slice(-MAX_EARLIER_ATTEMPTS);
}

/** Split a stored POD for the API read: the current capture (or null) + history. */
export function splitStoredPod(pod: PodLike): { current: Record<string, unknown> | null; earlier: PodEarlierAttempt[] } {
  return {
    current: podHasContent(pod) ? (podCurrentOnly(pod) as Record<string, unknown>) : null,
    earlier: attemptsOf(pod),
  };
}
