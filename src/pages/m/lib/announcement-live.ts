// ===========================================================================
// announcement-live — the desktop "Live" rule for an announcement row (owner
// 2026-10-16, /m/updates phone "Live" chip + pill).
//
// Mirrors src/pages/announcements.tsx `isExpired` + `live = a.isActive &&
// !expired`: shown (isActive === true) AND not expired, where expired means
// expiresAt parses AND is at or before now. expires_at is TIMESTAMPTZ and
// reaches the client as an ISO instant, so comparing epoch ms is
// timezone-independent. Empty or unparseable expiry → never expired (the
// server's own notExpired in src/api/routes/announcements.ts agrees).
// Rows are read dual-keyed (expiresAt ?? expires_at).
// ===========================================================================

export function isLiveAnnouncement(r: Record<string, unknown>, now: number = Date.now()): boolean {
  if (r.isActive !== true) return false;
  const raw = r.expiresAt ?? r.expires_at;
  if (raw == null || String(raw).trim() === "") return true;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) || t > now;
}
