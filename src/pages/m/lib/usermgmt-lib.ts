// ===========================================================================
// User Management (mobile, Final Batch 5) — pure data layer. No React, no
// fetch, no storage: normalizers, formatters, filters and validation that the
// screens and tests/m-usermgmt.test.mjs share.
//
// Real shapes (src/api/routes/users.ts):
//   publicUser   { id, email, role, isActive, createdAt, lastLoginAt, displayName, department, position, reportsTo }
//   publicInvite { token, email, role, displayName, invitedBy, inviterName, createdAt, expiresAt, emailSentAt }
//   access       GET /api/user-permissions/:id → { userId, role, locked, customized, permissions }
//
// Invitation tokens: `toInvite` returns the token SEPARATELY from the Invite
// object, so an Invite (the thing that is rendered, filtered and searched)
// never carries it. The screen keeps the token in component memory only.
// ===========================================================================
import { ROLE_OPTIONS, roleShort } from "../../../lib/role-labels";

export type RawRow = Record<string, unknown>;

export type Account = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  displayName: string;
  department: string;
  position: string;
};

/** A pending invite as shown on screen. Deliberately has NO token field. */
export type Invite = {
  /** Local key ("inv-<email>"; email is unique among invites). Not the token. */
  key: string;
  email: string;
  role: string;
  displayName: string;
  inviterName: string;
  createdAt: string;
  expiresAt: string;
  emailSentAt: string | null;
};

export type AccessSummary =
  | { kind: "full" }
  | { kind: "custom" }
  | { kind: "role"; role: string };

// ---- endpoints ---------------------------------------------------------------
export const USERS_URL = "/api/users";
export const INVITES_URL = "/api/users/invites";
export const INVITE_POST_URL = "/api/users/invite";
export const userUrl = (id: string) => `/api/users/${encodeURIComponent(id)}`;
export const accessUrl = (id: string) => `/api/user-permissions/${encodeURIComponent(id)}`;
/** Fetch addresses only (never a route, link or history entry). */
export const resendUrl = (secret: string) => `/api/users/invites/${encodeURIComponent(secret)}/resend`;
export const revokeUrl = (secret: string) => `/api/users/invites/${encodeURIComponent(secret)}`;

// ---- dual-key reads ------------------------------------------------------------
const str = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "") return String(v);
  }
  return "";
};
const strOrNull = (r: RawRow, ...k: string[]) => str(r, ...k) || null;
const bool = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null) return v === true || v === 1 || v === "1" || v === "true";
  }
  return false;
};

export function toAccount(r: RawRow): Account {
  return {
    id: str(r, "id"),
    email: str(r, "email"),
    role: str(r, "role").toUpperCase(),
    isActive: bool(r, "isActive", "is_active", "isactive"),
    createdAt: str(r, "createdAt", "created_at", "createdat"),
    lastLoginAt: strOrNull(r, "lastLoginAt", "last_login_at", "lastloginat"),
    displayName: str(r, "displayName", "display_name", "displayname").trim(),
    department: str(r, "department").trim(),
    position: str(r, "position").trim(),
  };
}

/** One invite row → the displayable Invite plus its secret, kept apart. */
export function toInvite(r: RawRow, key: string): { invite: Invite; secret: string } {
  return {
    invite: {
      key,
      email: str(r, "email"),
      role: str(r, "role").toUpperCase(),
      displayName: str(r, "displayName", "display_name", "displayname").trim(),
      inviterName: str(r, "inviterName", "inviter_name", "invitername"),
      createdAt: str(r, "createdAt", "created_at", "createdat"),
      expiresAt: str(r, "expiresAt", "expires_at", "expiresat"),
      emailSentAt: strOrNull(r, "emailSentAt", "email_sent_at", "emailsentat"),
    },
    secret: str(r, "token"),
  };
}

export function toAccess(r: RawRow | null | undefined): AccessSummary | null {
  if (!r) return null;
  if (bool(r, "locked")) return { kind: "full" };
  if (bool(r, "customized")) return { kind: "custom" };
  return { kind: "role", role: str(r, "role").toUpperCase() };
}

export const rowsOf = (v: unknown): RawRow[] => (Array.isArray(v) ? (v as RawRow[]) : []);

// ---- display -------------------------------------------------------------------
export const nameOf = (a: { displayName: string; email: string }) => a.displayName || a.email;
export const roleChip = (role: string) => roleShort(role) || "No role";

export function initials(s: string): string {
  const w = s.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (((w[0] || "?")[0] ?? "?") + (w[1] ? w[1][0] : "")).toUpperCase();
}
/** Stable 0..4 index for the avatar colour pair. */
export const avatarTone = (s: string) => [...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MYT_OFFSET_MS = 8 * 3600 * 1000; // Malaysia has no DST.

/** "27 Nov 2026, 16:02" in Malaysia time; "" for a blank / bad value. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const d = new Date(t + MYT_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

export function isExpired(expiresAt: string, nowMs: number): boolean {
  const t = Date.parse(expiresAt);
  return isFinite(t) && t <= nowMs;
}

/** "Expires in 40 min" / "Expires in 5 hours" / "Expires in 2 days" / "Expired". */
export function expiryText(expiresAt: string, nowMs: number): string {
  const t = Date.parse(expiresAt);
  if (!isFinite(t)) return "";
  const m = Math.round((t - nowMs) / 60000);
  if (m <= 0) return "Expired";
  if (m < 60) return `Expires in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `Expires in ${h} hour${h === 1 ? "" : "s"}`;
  return `Expires in ${Math.round(h / 24)} days`;
}

// ---- roles ---------------------------------------------------------------------
/** The 13 role codes, in picker order — the one list (src/lib/role-labels.ts). */
export const ROLE_CODES: string[] = ROLE_OPTIONS.map((o) => o.value);

/** Filter options: every known role, plus any extra (legacy) code present in the data. */
export function roleFilterCodes(present: string[]): string[] {
  const extra = [...new Set(present.filter((r) => r && !ROLE_CODES.includes(r)))].sort();
  return [...ROLE_CODES, ...extra];
}

/** Super Admin and Admin get the "full access" note under the picker. */
export const isFullAccessRole = (role: string) => role === "SUPER_ADMIN" || role === "ADMIN";

// ---- members list ----------------------------------------------------------------
export type MemberSort = "name" | "login" | "created";
export type StatusChip = "all" | "active" | "disabled";
export const MEMBER_SORTS: { k: MemberSort; l: string }[] = [
  { k: "name", l: "Name A–Z" },
  { k: "login", l: "Last login" },
  { k: "created", l: "Recently created" },
];

export function matchesAccount(a: Account, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return `${a.displayName} ${a.email} ${a.role} ${roleShort(a.role)} ${a.department} ${a.position}`.toLowerCase().includes(n);
}
export function matchesInvite(x: Invite, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return `${x.displayName} ${x.email} ${x.role} ${roleShort(x.role)} ${x.inviterName}`.toLowerCase().includes(n);
}

export type MemberFilter = { q: string; role: string; dept: string };

/** Search + role + department (the chip counts are taken from this). */
export function baseMembers(all: Account[], f: MemberFilter): Account[] {
  return all.filter((a) => (f.role === "all" || a.role === f.role) && (f.dept === "all" || a.department === f.dept) && matchesAccount(a, f.q));
}
export function statusCounts(base: Account[]): Record<StatusChip, number> {
  const active = base.filter((a) => a.isActive).length;
  return { all: base.length, active, disabled: base.length - active };
}
export function sortMembers(list: Account[], sort: MemberSort): Account[] {
  const byName = (a: Account, b: Account) => nameOf(a).localeCompare(nameOf(b));
  return [...list].sort((a, b) => {
    if (sort === "login") {
      // Most recent first; never-signed-in last.
      if (!a.lastLoginAt && !b.lastLoginAt) return byName(a, b);
      if (!a.lastLoginAt) return 1;
      if (!b.lastLoginAt) return -1;
      return b.lastLoginAt.localeCompare(a.lastLoginAt) || byName(a, b);
    }
    if (sort === "created") return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
    return byName(a, b);
  });
}
export function visibleMembers(all: Account[], f: MemberFilter, chip: StatusChip, sort: MemberSort): Account[] {
  const base = baseMembers(all, f).filter((a) => chip === "all" || (chip === "active" ? a.isActive : !a.isActive));
  return sortMembers(base, sort);
}
export const departmentsOf = (all: Account[]) => [...new Set(all.map((a) => a.department).filter(Boolean))].sort();

// ---- invite form -------------------------------------------------------------------
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export type InviteDraft = { email: string; displayName: string; role: string };
export type InviteErrors = { email?: string; role?: string };

export function validateInvite(v: InviteDraft): InviteErrors {
  const e: InviteErrors = {};
  const em = v.email.trim().toLowerCase();
  if (!em) e.email = "Email is required.";
  else if (!EMAIL_RE.test(em)) e.email = "Enter a valid email, like name@company.com.";
  if (!v.role) e.role = "Pick a role.";
  return e;
}
/** Client pre-check against the loaded lists (all accounts, active or disabled). */
export function duplicateOf(email: string, accounts: Account[], invites: Invite[]): "user" | "invite" | null {
  const em = email.trim().toLowerCase();
  if (!em) return null;
  if (accounts.some((a) => a.email.toLowerCase() === em)) return "user";
  if (invites.some((x) => x.email.toLowerCase() === em)) return "invite";
  return null;
}
/** The only fields POST /api/users/invite reads. */
export function invitePayload(v: InviteDraft): { email: string; role: string; displayName?: string } {
  const name = v.displayName.trim();
  return { email: v.email.trim().toLowerCase(), role: v.role, ...(name ? { displayName: name } : {}) };
}

// ---- write outcomes (copy) -------------------------------------------------------
/** A network failure is an UNKNOWN outcome — never claim nothing changed. */
export const UNKNOWN_ACCOUNT = "Couldn't reach the server. Check your connection, then refresh to see whether the change went through.";
export const UNKNOWN_INVITE = "Couldn't reach the server. Refresh Pending Invites before trying again.";
export const UNKNOWN_RESEND = "Couldn't reach the server. Refresh to check whether the email went out.";
export const UNKNOWN_REVOKE = "Couldn't reach the server. Refresh to check whether the invite was revoked.";
export const LAST_SA_HINT = "Make another account Super Admin on desktop first.";
/** The server's own 400 text, plus the desktop hint when it is the last-Super-Admin guard. */
export function disableErrorText(serverText: string): string {
  return /last active super admin/i.test(serverText) ? `${serverText} ${LAST_SA_HINT}` : serverText;
}
