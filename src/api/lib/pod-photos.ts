// ---------------------------------------------------------------------------
// pod-photos.ts — delivery photos uploaded the moment they are taken (review
// H3-4, Houzs#5397 / #5526; C2-3, Conts#547).
//
// Before: the phone kept every photo as a raw data URL in page memory and sent
// them all with "Confirm Delivery". A phone that reloaded the page under the
// camera lost them, and a failed submit lost them too. Now each photo (already
// compressed and stamped with the DO number + the server's time by the page)
// is stored here as soon as it is taken, keyed by DO. The POD write names the
// photos by id and the server copies them into the POD; the drafts are then
// deleted in the same batch.
//
// Table `delivery_pod_photos` is created at runtime (migrations do not apply
// on deploy) — awaited before the first read or write.
// ---------------------------------------------------------------------------
import type { D1Database } from "@cloudflare/workers-types";

/** At most this many photos per POD (the POD has always kept five). */
export const MAX_POD_PHOTOS = 5;
/** Largest accepted data URL (characters): a 1280 px JPEG at 0.7 is ~150–300 kB. */
export const MAX_POD_PHOTO_CHARS = 900_000;

let podPhotosTable: Promise<void> | null = null;

/** Create the draft-photo table once per worker (awaited by every caller). */
export function ensurePodPhotosTable(db: D1Database): Promise<void> {
  if (!podPhotosTable) {
    podPhotosTable = (async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS delivery_pod_photos (
             id          TEXT PRIMARY KEY,
             org_id      TEXT,
             do_id       TEXT NOT NULL,
             data_url    TEXT NOT NULL,
             server_at   TEXT NOT NULL,
             created_by  TEXT,
             size_chars  INTEGER NOT NULL DEFAULT 0
           )`,
        )
        .run();
      await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_delivery_pod_photos_do_id ON delivery_pod_photos (do_id)")
        .run();
    })().catch((err) => {
      podPhotosTable = null; // retry on the next request
      throw err;
    });
  }
  return podPhotosTable;
}

function b64Head(b64: string, n: number): number[] {
  try {
    const bin = atob(b64.slice(0, Math.ceil(n / 3) * 4 + 4).replace(/[^A-Za-z0-9+/=]/g, ""));
    return Array.from(bin.slice(0, n), (ch) => ch.charCodeAt(0));
  } catch {
    return [];
  }
}

/**
 * Why a photo data URL is refused, or null when it is fine. Only JPEG / PNG /
 * WebP images, checked by their first bytes (a label is not trusted), within
 * MAX_POD_PHOTO_CHARS.
 */
export function podPhotoProblem(dataUrl: unknown): string | null {
  if (typeof dataUrl !== "string" || !dataUrl) return "No photo was sent.";
  const m = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
  if (!m) return "Only JPEG, PNG or WebP photos can be attached.";
  if (dataUrl.length > MAX_POD_PHOTO_CHARS) {
    return `The photo is too large (${Math.round(dataUrl.length / 1024)} KB). Take it again or choose a smaller one.`;
  }
  const head = b64Head(dataUrl.slice(m[0].length), 12);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp =
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  if (!isJpeg && !isPng && !isWebp) return "The file is not a readable photo.";
  return null;
}

export type PodPhotoRow = { id: string; dataUrl: string; serverAt: string };

function rowOf(r: Record<string, unknown>): PodPhotoRow {
  return {
    id: String(r.id),
    dataUrl: String(r.dataUrl ?? r.data_url ?? ""),
    serverAt: String(r.serverAt ?? r.server_at ?? ""),
  };
}

/** The draft photos of a DO, oldest first. */
export async function listPodPhotos(db: D1Database, doId: string): Promise<PodPhotoRow[]> {
  await ensurePodPhotosTable(db);
  const res = await db
    .prepare("SELECT id, data_url, server_at FROM delivery_pod_photos WHERE do_id = ? ORDER BY server_at, id")
    .bind(doId)
    .all<Record<string, unknown>>();
  return (res.results ?? []).map(rowOf);
}

/**
 * The named draft photos of THIS DO, in the order the page sent the ids.
 * Unknown ids (another DO's, already used, deleted) are skipped.
 */
export async function loadPodPhotosByIds(db: D1Database, doId: string, ids: unknown): Promise<PodPhotoRow[]> {
  const want = Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))].slice(0, MAX_POD_PHOTOS) : [];
  if (want.length === 0) return [];
  const byId = new Map((await listPodPhotos(db, doId)).map((p) => [p.id, p] as const));
  return want.map((id) => byId.get(id)).filter((p): p is PodPhotoRow => !!p);
}
