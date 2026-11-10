// ---------------------------------------------------------------------------
// pod-capture.ts — the phone's POD capture state, kept out of the component
// so it can be tested (review H3-4, Houzs#5397 / #5526). Pure, plus two
// try/catch-wrapped sessionStorage helpers.
//
// Each photo is a tile with its own upload state: "uploading" → "done" (has
// the server id) or "failed" (Retry / Remove). Confirm Delivery waits until
// every tile is done. The typed fields and the signature are kept in
// sessionStorage per DO, and the sheet reopens itself, so a phone that reloads
// the page under the camera comes back where it was; the photos come back
// from the server (they were uploaded when taken).
// ---------------------------------------------------------------------------

export type PodPhotoTile = {
  /** Local key (stable across retries). */
  key: string;
  status: "uploading" | "done" | "failed";
  /** Server id once uploaded. */
  id?: string;
  /** The stamped JPEG (thumbnail + what a retry re-sends). */
  dataUrl: string;
  error?: string;
};

export const POD_MAX_PHOTOS = 5;

/** Tiles from the server's draft list (after a reload). */
export function tilesFromServer(rows: Array<{ id: string; dataUrl: string }>): PodPhotoTile[] {
  return rows.slice(0, POD_MAX_PHOTOS).map((r) => ({ key: r.id, id: r.id, status: "done", dataUrl: r.dataUrl }));
}

/** How many of `picked` files fit, and the message when some do not. */
export function photoSlots(current: number, picked: number): { take: number; dropped: string | null } {
  const free = Math.max(0, POD_MAX_PHOTOS - current);
  const take = Math.min(free, picked);
  const left = picked - take;
  return {
    take,
    dropped:
      left > 0
        ? `Only ${POD_MAX_PHOTOS} photos can be attached — ${left} photo${left === 1 ? " was" : "s were"} not added.`
        : null,
  };
}

/** Replace one tile by key. */
export function patchTile(tiles: PodPhotoTile[], key: string, patch: Partial<PodPhotoTile>): PodPhotoTile[] {
  return tiles.map((t) => (t.key === key ? { ...t, ...patch } : t));
}

/** Why Confirm Delivery must wait, or null when the photos are ready. */
export function photosBlocker(tiles: PodPhotoTile[]): string | null {
  if (tiles.some((t) => t.status === "uploading")) return "Photos are still uploading — wait a moment.";
  if (tiles.some((t) => t.status === "failed")) return "A photo did not upload. Tap Retry, or remove it.";
  return null;
}

/** The server ids to put in the POD, in tile order. */
export function uploadedPhotoIds(tiles: PodPhotoTile[]): string[] {
  return tiles.filter((t) => t.status === "done" && t.id).map((t) => t.id as string);
}

// ── Draft kept across a reload ────────────────────────────────────────────
export type PodDraft = {
  open: boolean;
  receiverName: string;
  receiverIC: string;
  remarks: string;
  signatureDataUrl: string;
};

export const podDraftKey = (doId: string) => `hookka-pod-draft:${doId}`;

export function parsePodDraft(raw: string | null | undefined): PodDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PodDraft>;
    if (!v || typeof v !== "object") return null;
    return {
      open: v.open === true,
      receiverName: String(v.receiverName ?? ""),
      receiverIC: String(v.receiverIC ?? ""),
      remarks: String(v.remarks ?? ""),
      signatureDataUrl: String(v.signatureDataUrl ?? "").startsWith("data:image/") ? String(v.signatureDataUrl) : "",
    };
  } catch {
    return null;
  }
}

export function readPodDraft(doId: string): PodDraft | null {
  try {
    return parsePodDraft(sessionStorage.getItem(podDraftKey(doId)));
  } catch {
    return null;
  }
}

export function writePodDraft(doId: string, draft: PodDraft | null): void {
  try {
    if (draft) sessionStorage.setItem(podDraftKey(doId), JSON.stringify(draft));
    else sessionStorage.removeItem(podDraftKey(doId));
  } catch {
    /* private mode / quota — the photos are on the server anyway */
  }
}
