// ---------------------------------------------------------------------------
// settings-system-info.ts — the /settings "System Information" card
// (BUG-2026-11-27-594). Real facts only.
//
// The card used to show hard-coded sample figures ("Total Users 5", "Total
// Records 1,247", "Last Backup 14/04/2026, 02:00") and a seeded "System
// Version 1.0.0" that no deploy ever changed. Now:
//  * User accounts — the length of GET /api/users (needs users:read; "—" when
//    it is not readable or failed, never a guess).
//  * Deployed build — the commit GET /api/health reports (deploy.yml stamps it).
//  * Environment — the same /api/health reply.
// There is no endpoint for a record count or the last backup, so those tiles
// are gone rather than invented.
// ---------------------------------------------------------------------------

export type SystemInfoItem = { label: string; value: string };

export type SystemInfoSources = {
  /** GET /api/users rows, or null when not readable / failed / loading. */
  users: unknown[] | null;
  /** GET /api/health body, or null. */
  health: { commit?: unknown; env?: unknown } | null;
};

const DASH = "—";

export function shortCommit(commit: unknown): string {
  const s = typeof commit === "string" ? commit.trim() : "";
  if (!s || s === "unknown" || s === "dev") return s || DASH;
  return /^[0-9a-f]{8,}$/i.test(s) ? s.slice(0, 7) : s;
}

export function systemInfoItems(src: SystemInfoSources): SystemInfoItem[] {
  const env = typeof src.health?.env === "string" && src.health.env.trim() ? src.health.env.trim() : DASH;
  return [
    { label: "User accounts", value: Array.isArray(src.users) ? src.users.length.toLocaleString("en-MY") : DASH },
    { label: "Deployed build", value: src.health ? shortCommit(src.health.commit) : DASH },
    { label: "Environment", value: env },
  ];
}
