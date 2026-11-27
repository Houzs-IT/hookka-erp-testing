// m-usermgmt.test.mjs — the rules behind the PHONE User Management screens
// (src/pages/m/screens/usermgmt + src/pages/m/lib/usermgmt-lib.ts), Final Batch 5.
//
// Owner decisions pinned here:
//   S-1  Super Admin only (server-reported role), nothing fetched otherwise.
//   U-1  Invite-only: no direct account creation, no password input anywhere.
//   U-3  Invitation tokens never reach a URL / route, the DOM, a log, or
//        browser storage (no cached fetch for invites).
//   M1   Real role codes from ROLE_OPTIONS, shown with roleShort.
//   M5   Disable / Enable = PUT { isActive } only; the server's guard text is shown.
//   M6   A network failure on a write is an unknown outcome ("refresh to check").
//   M7   Resend branches on emailSent; no bounce state.
//   M8   "User not found" only on a 404.
// Run: node --import tsx/esm --test tests/m-usermgmt.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  toAccount, toInvite, toAccess, roleChip, ROLE_CODES, roleFilterCodes, expiryText, isExpired, fmtDateTime, sortMembers,
  visibleMembers, baseMembers, statusCounts, matchesAccount, matchesInvite, validateInvite, duplicateOf, invitePayload,
  disableErrorText, initials, UNKNOWN_ACCOUNT, UNKNOWN_INVITE, UNKNOWN_RESEND, UNKNOWN_REVOKE,
} from "../src/pages/m/lib/usermgmt-lib.ts";
import { ROLE_OPTIONS } from "../src/lib/role-labels.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DIR = "src/pages/m/screens/usermgmt";
const FILES = readdirSync(new URL(`../${DIR}`, import.meta.url)).filter((f) => /\.tsx?$/.test(f));
const SRC = Object.fromEntries([...FILES.map((f) => [`${DIR}/${f}`, read(`${DIR}/${f}`)]), ["src/pages/m/lib/usermgmt-lib.ts", read("src/pages/m/lib/usermgmt-lib.ts")]]);
const ALL = Object.values(SRC).join("\n");
const LIST = read(`${DIR}/UserMgmtScreen.tsx`);
const DETAIL = read(`${DIR}/AccountDetailScreen.tsx`);
const FORM = read(`${DIR}/InviteForm.tsx`);
const API = read(`${DIR}/um-api.ts`);
/** Source with comments removed (so a rule's explanation doesn't trip the rule). */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ALL_CODE = code(ALL);

// ── Fixtures in the real response shapes ─────────────────────────────────────
const USER = { id: "usr-5", email: "a@x.test", role: "FINANCE", isActive: true, createdAt: "2025-05-20T03:00:00.000Z", lastLoginAt: "2026-11-25T08:02:00.000Z", displayName: "Lau", department: "Finance", position: "Exec", reportsTo: "" };
const INVITE = { token: "SECRET-1", email: "new@x.test", role: "R_AND_D", displayName: "", invitedBy: "usr-1", inviterName: "Owner", createdAt: "2026-11-26T01:15:00.000Z", expiresAt: "2026-11-29T01:15:00.000Z", emailSentAt: null };

// ── um-lib: normalizers ──────────────────────────────────────────────────────
test("toAccount reads publicUser and the snake_case fallbacks", () => {
  const a = toAccount(USER);
  assert.deepEqual(a, { id: "usr-5", email: "a@x.test", role: "FINANCE", isActive: true, createdAt: USER.createdAt, lastLoginAt: USER.lastLoginAt, displayName: "Lau", department: "Finance", position: "Exec" });
  const b = toAccount({ id: "u", email: "b@x", role: "hr", is_active: 0, created_at: "2025-01-01T00:00:00Z", last_login_at: null, display_name: "" });
  assert.equal(b.isActive, false);
  assert.equal(b.role, "HR");
  assert.equal(b.lastLoginAt, null);
  assert.equal(b.createdAt, "2025-01-01T00:00:00Z");
});

test("toInvite keeps the token OUT of the displayable invite", () => {
  const { invite, secret } = toInvite(INVITE, "inv-1-0");
  assert.equal(secret, "SECRET-1");
  assert.equal("token" in invite, false);
  assert.equal(JSON.stringify(invite).includes("SECRET"), false);
  assert.equal(invite.key, "inv-1-0");
  assert.equal(invite.emailSentAt, null);
  assert.equal(invite.inviterName, "Owner");
});

test("access summary: locked → full, customized → custom, else follows the response role", () => {
  assert.deepEqual(toAccess({ userId: "u", role: "SUPER_ADMIN", locked: true, customized: false }), { kind: "full" });
  assert.deepEqual(toAccess({ userId: "u", role: "FINANCE", locked: false, customized: true }), { kind: "custom" });
  assert.deepEqual(toAccess({ userId: "u", role: "r_and_d", locked: false, customized: false }), { kind: "role", role: "R_AND_D" });
  assert.equal(toAccess(null), null);
});

// ── roles (M1) ───────────────────────────────────────────────────────────────
test("the role list is ROLE_OPTIONS' codes, shown with roleShort; legacy codes stay findable", () => {
  assert.deepEqual(ROLE_CODES, ROLE_OPTIONS.map((o) => o.value));
  assert.equal(ROLE_CODES.length, 13);
  assert.equal(roleChip("R_AND_D"), "R&D");
  assert.equal(roleChip("READ_ONLY"), "Viewer");
  assert.equal(roleChip("STAFF"), "Staff"); // legacy: title-cased, never hidden
  assert.deepEqual(roleFilterCodes(["FINANCE", "STAFF", "MANAGER", "STAFF"]).slice(13), ["MANAGER", "STAFF"]);
  assert.match(SRC["src/pages/m/lib/usermgmt-lib.ts"], /import \{ ROLE_OPTIONS, roleShort \} from "[^"]*lib\/role-labels"/);
  assert.doesNotMatch(ALL_CODE, /"MANAGER"|"STAFF"/, "no retired role literal in the usermgmt screens");
  assert.doesNotMatch(ALL_CODE, /"Super Admin",\s*"Admin",\s*"Sales"/, "no local role-label array");
});

test("config/forms.ts no longer carries the old invite spec (main session removes it)", () => {
  const forms = read("src/pages/m/config/forms.ts");
  assert.doesNotMatch(forms, /USER_ROLE_OPTS|inviteUserSpec/);
});

// ── dates / expiry ───────────────────────────────────────────────────────────
test("dates read in Malaysia time; expiry is relative", () => {
  assert.equal(fmtDateTime("2026-11-25T08:02:00.000Z"), "25 Nov 2026, 16:02");
  assert.equal(fmtDateTime("2026-11-26T18:30:00.000Z"), "27 Nov 2026, 02:30");
  assert.equal(fmtDateTime(null), "");
  const now = Date.parse("2026-11-27T00:00:00.000Z");
  assert.equal(expiryText("2026-11-27T00:40:00.000Z", now), "Expires in 40 min");
  assert.equal(expiryText("2026-11-27T05:00:00.000Z", now), "Expires in 5 hours");
  assert.equal(expiryText("2026-11-27T01:00:00.000Z", now), "Expires in 1 hour");
  assert.equal(expiryText("2026-11-29T00:00:00.000Z", now), "Expires in 2 days");
  assert.equal(expiryText("2026-11-26T23:00:00.000Z", now), "Expired");
  assert.equal(isExpired("2026-11-26T23:00:00.000Z", now), true);
  assert.equal(isExpired("2026-11-27T01:00:00.000Z", now), false);
});

// ── list logic ───────────────────────────────────────────────────────────────
const ACCS = [
  toAccount({ ...USER, id: "a", displayName: "Zed", lastLoginAt: null, createdAt: "2025-01-01T00:00:00Z" }),
  toAccount({ ...USER, id: "b", displayName: "Amy", role: "R_AND_D", department: "R&D", lastLoginAt: "2026-11-20T00:00:00Z", createdAt: "2025-06-01T00:00:00Z" }),
  toAccount({ ...USER, id: "c", displayName: "", email: "mike@x.test", isActive: false, lastLoginAt: "2026-11-26T00:00:00Z", createdAt: "2025-03-01T00:00:00Z" }),
];
test("sort: name, last login (never-signed-in last), recently created", () => {
  assert.deepEqual(sortMembers(ACCS, "name").map((a) => a.id), ["b", "c", "a"]);
  assert.deepEqual(sortMembers(ACCS, "login").map((a) => a.id), ["c", "b", "a"]);
  assert.deepEqual(sortMembers(ACCS, "created").map((a) => a.id), ["b", "c", "a"]);
});
test("search matches role code AND label; status counts follow the other filters", () => {
  assert.equal(matchesAccount(ACCS[1], "r&d"), true);
  assert.equal(matchesAccount(ACCS[1], "r_and_d"), true);
  assert.equal(matchesInvite(toInvite(INVITE, "k").invite, "r&d"), true);
  const base = baseMembers(ACCS, { q: "", role: "FINANCE", dept: "all" });
  assert.deepEqual(statusCounts(base), { all: 2, active: 1, disabled: 1 });
  assert.deepEqual(visibleMembers(ACCS, { q: "", role: "all", dept: "all" }, "disabled", "name").map((a) => a.id), ["c"]);
  assert.equal(initials("Lau Mei Ling"), "LM");
  assert.equal(initials("mike.tan@x.test"), "MT");
});

// ── invite form (U-1, M1) ────────────────────────────────────────────────────
test("invite validation, duplicate pre-check, and the exact payload", () => {
  assert.deepEqual(validateInvite({ email: "", displayName: "", role: "" }), { email: "Email is required.", role: "Pick a role." });
  assert.equal(validateInvite({ email: "bad@x", displayName: "", role: "QA" }).email, "Enter a valid email, like name@company.com.");
  assert.deepEqual(validateInvite({ email: "ok@x.test", displayName: "", role: "QA" }), {});
  assert.equal(duplicateOf(" A@X.test ", ACCS, []), "user"); // disabled or not — the stricter client check
  assert.equal(duplicateOf("new@x.test", [], [toInvite(INVITE, "k").invite]), "invite");
  assert.deepEqual(invitePayload({ email: " New@X.test ", displayName: " ", role: "SUPER_ADMIN" }), { email: "new@x.test", role: "SUPER_ADMIN" });
  assert.deepEqual(invitePayload({ email: "n@x.test", displayName: " Nia ", role: "HR" }), { email: "n@x.test", role: "HR", displayName: "Nia" });
});

test("invite-only: no direct account creation, no password field anywhere", () => {
  assert.doesNotMatch(ALL_CODE, /type="password"|new-password|mustChangePassword|Temporary password|Add user directly|Create account/);
  assert.doesNotMatch(ALL_CODE, /send\(USERS_URL,\s*"POST"/);
  assert.match(FORM, /send\(INVITE_POST_URL, "POST", payload\)/);
  // The response's token / inviteUrl are never read.
  assert.doesNotMatch(ALL_CODE, /inviteUrl|data\??\.token/);
});

// ── U-3: tokens never routed, rendered, cached or logged ─────────────────────
test("invites are read with a plain fetch, never a caching helper", () => {
  assert.doesNotMatch(ALL_CODE, /useCachedJson[^;]*INVITES_URL|useCachedJson[^;]*\/api\/users\/invites|cachedFetchJson/);
  assert.match(API, /fetch\(INVITES_URL, \{ credentials: "include", cache: "no-store" \}\)/);
  assert.doesNotMatch(ALL_CODE, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(ALL_CODE, /console\.(log|info|warn|error|debug)/);
});
test("no invite-token route, link or copy", () => {
  assert.doesNotMatch(ALL_CODE, /\/m\/usermgmt\/invite/);
  assert.doesNotMatch(ALL_CODE, /navigate\([^)]*(token|secret)/i);
  assert.doesNotMatch(ALL_CODE, /href=\{[^}]*(token|secret)/i);
  assert.doesNotMatch(ALL_CODE, /clipboard|Copy link|Copy invite/i);
  for (const f of FILES.filter((x) => x.endsWith(".tsx"))) {
    const s = code(SRC[`${DIR}/${f}`]);
    assert.doesNotMatch(s, /\{[^}]*\.token\b[^}]*\}/, `${f}: renders a token`);
    assert.doesNotMatch(s, /(aria-label|data-[\w-]+|key|title)=\{[^}]*(token|secret)/i, `${f}: token in an attribute`);
  }
  // The secret only ever goes into a resend / revoke fetch address.
  assert.match(LIST, /send\(resendUrl\(secret\), "POST"\)/);
  assert.match(LIST, /send\(revokeUrl\(secret\), "DELETE"\)/);
  // An old /m/usermgmt/invite-… link is answered without any fetch.
  assert.match(DETAIL, /const legacyInvite = id\.startsWith\("invite-"\);/);
  assert.match(DETAIL, /const canRead = access\.isSuperAdmin && !!id && !legacyInvite;/);
});
test("Global Search no longer reads User Management (main session slims usermgmtConfig)", () => {
  const mods = read("src/pages/m/config/modules.ts");
  const block = mods.slice(mods.indexOf("export const usermgmtConfig"), mods.indexOf("export const usermgmtConfig") + 1200);
  assert.doesNotMatch(block, /\/api\/users/);
  assert.doesNotMatch(mods, /\/m\/usermgmt\/invite-/);
});

// ── S-1 gate ─────────────────────────────────────────────────────────────────
test("the gate is the server-reported SUPER_ADMIN role; nothing is fetched otherwise", () => {
  assert.match(API, /const \{ role, loading \} = usePermissions\(\);/);
  assert.match(API, /role\.toUpperCase\(\) === "SUPER_ADMIN"/);
  assert.doesNotMatch(ALL_CODE, /hasPermission\(\s*"users"/);
  assert.match(LIST, /useCachedJson<[^>]*>\(allowed \? USERS_URL : null\)/);
  assert.match(LIST, /useInvites\(allowed\)/);
  assert.match(API, /if \(!enabled\) return;/);
  assert.match(DETAIL, /useCachedJson<One>\(canRead \? userUrl\(id\) : null\)/);
  assert.match(DETAIL, /useCachedJson<One>\(canRead \? accessUrl\(id\) : null\)/);
  for (const s of [LIST, DETAIL]) assert.match(s, /User Management is for Super Admins\./);
});

// ── M5 / M6 / M7 / M8 ────────────────────────────────────────────────────────
test("Disable / Enable send PUT { isActive } only; no delete, reset or role change", () => {
  assert.match(DETAIL, /send\(userUrl\(a\.id\), "PUT", \{ isActive: next \}\)/);
  assert.doesNotMatch(ALL_CODE, /"DELETE"[^\n]*userUrl|userUrl[^\n]*"DELETE"/);
  assert.doesNotMatch(ALL_CODE, /reset-password|role-change|\/api\/user-permissions[^"`]*",\s*"(PUT|DELETE)"/);
  assert.match(DETAIL, /\{!me \? \(/, "no dock on your own account");
  assert.match(DETAIL, /You can't disable your own account\./);
});
test("the last-Super-Admin text comes from the server; no client count", () => {
  assert.equal(disableErrorText("You can't disable the last active Super Admin."), "You can't disable the last active Super Admin. Make another account Super Admin on desktop first.");
  assert.equal(disableErrorText("You can't disable your own account."), "You can't disable your own account.");
  assert.doesNotMatch(ALL_CODE, /filter\([^)]*SUPER_ADMIN[^)]*isActive|isActive[^\n]*\.length\s*<=\s*1/);
});
test("unknown outcomes never claim nothing changed", () => {
  assert.doesNotMatch(ALL, /Nothing changed|Back to Settings|couldn't be delivered/);
  for (const t of [UNKNOWN_ACCOUNT, UNKNOWN_INVITE, UNKNOWN_RESEND, UNKNOWN_REVOKE]) assert.match(t, /refresh/i);
  assert.match(DETAIL, /r\.status === 0[\s\S]{0,200}UNKNOWN_ACCOUNT/);
  assert.match(FORM, /r\.status === 0 \? UNKNOWN_INVITE : r\.error/);
});
test("resend branches on emailSent (no bounce state)", () => {
  assert.match(LIST, /r\.data\?\.emailSent === true/);
  assert.match(LIST, /Email not sent: /);
  assert.match(FORM, /emailSent = r\.data\?\.emailSent === true/);
  assert.match(LIST, /Invitation created — email not sent/);
});
test('"User not found" only on a 404; anything else is "Couldn\'t load" + retry', () => {
  assert.match(DETAIL, /const notFound = !res\.loading && res\.failure\?\.kind === "notFound";/);
  assert.match(DETAIL, /Couldn't load this account/);
  assert.match(ALL, /Never signed in/);
});

// ── house rules the guard tests also check ───────────────────────────────────
test("no fixed-position layer of its own, no viewport sizing, no UTC 'today'", () => {
  assert.doesNotMatch(ALL, /position:\s*"fixed"/);
  assert.doesNotMatch(ALL, /100vw/);
  assert.doesNotMatch(ALL, /toISOString\(\)\.slice\(0,\s*10\)/);
});
test("the invite form guards double submit and discards", () => {
  assert.match(FORM, /if \(inflight\.current\) return;/);
  assert.match(FORM, /Discard this invite\?/);
  assert.match(FORM, /if \(dirty\) setDiscard\(true\);/);
});
