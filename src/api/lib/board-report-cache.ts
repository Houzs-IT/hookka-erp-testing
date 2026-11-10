// ---------------------------------------------------------------------------
// board-report-cache.ts — build the Board Report once, in the background.
//
// Owner 2026-11-10: "我点了 generate 了在 backend 跑，然后我之后回来 download
// 就行了". Measured the same day: one build of a month takes 10–20 s, but the
// page fired two identical requests and a second person (or a Refresh) added a
// third; concurrent builds of the SAME month blocked each other and none
// finished in minutes, so the page sat on "Building…" for good.
//
//   • a built report is kept in kv_config `board_report_cache:<YYYY-MM>`;
//     opening the page reads it at once (Refresh rebuilds);
//   • one build per month at a time: a lock row `board_report_build:<YYYY-MM>`
//     is taken atomically; a request that finds a fresh lock does not build,
//     it answers "building" and the page polls until the cache appears;
//   • the build runs under waitUntil, so leaving the page does not stop it;
//   • Finance's notes are read fresh on every open (they change without a
//     rebuild).
// A lock older than LOCK_STALE_MS (a crashed build) is taken over.
// ---------------------------------------------------------------------------
export const BUILD_WAIT_MS = 25_000;
export const LOCK_STALE_MS = 3 * 60_000;

export const cacheKey = (ym: string) => `board_report_cache:${ym}`;
export const lockKey = (ym: string) => `board_report_build:${ym}`;

export async function readBoardCache<T>(db: D1Database, ym: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(cacheKey(ym)).first<{ value: string }>();
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function writeBoardCache(db: D1Database, ym: string, report: unknown): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(cacheKey(ym), JSON.stringify(report), now)
    .run();
}

/**
 * Take the month's build lock. True = this request builds. A fresh lock held
 * by another build → false. A stale one (crashed build) is taken over.
 * Atomic: the conditional upsert changes a row only when free or stale.
 */
export async function takeBuildLock(db: D1Database, ym: string, nowMs = Date.now()): Promise<boolean> {
  const now = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - LOCK_STALE_MS).toISOString();
  const r = await db
    .prepare(
      `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE kv_config.updated_at < ?`,
    )
    .bind(lockKey(ym), JSON.stringify({ startedAt: now }), now, staleBefore)
    .run();
  const changes = Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  return changes > 0;
}

export async function releaseBuildLock(db: D1Database, ym: string): Promise<void> {
  await db.prepare("DELETE FROM kv_config WHERE key = ?").bind(lockKey(ym)).run();
}

export async function buildStartedAt(db: D1Database, ym: string): Promise<string | null> {
  const row = await db.prepare("SELECT updated_at FROM kv_config WHERE key = ?").bind(lockKey(ym)).first<{ updatedAt?: string; updated_at?: string }>();
  return row ? String(row.updatedAt ?? row.updated_at ?? "") || null : null;
}

/** Resolve `p`, or `null` once `ms` has passed (the build keeps going). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  // eslint-disable-next-line no-restricted-syntax -- server code, not React
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);
}
