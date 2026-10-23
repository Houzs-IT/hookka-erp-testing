// ---------------------------------------------------------------------------
// 2fa-login-code-step.test.mjs — two-step sign-in has a code screen again.
//
// BUG-2026-08-04-006 switched the 2FA login gate OFF because the login page had
// no code-entry step: an enrolled account saw "isn't available yet" and could
// not sign in at all. The backend half (/api/auth/totp/login-verify + the
// pending token) was finished and tested in totp-login-password-gate.test.mjs;
// this file guards the pieces added on top of it (2026-10-23):
//
//   * the login page asks for the code (both layouts) and posts it WITH the
//     pending token, so the password step is still proven;
//   * the gate is ON, but the set-up prompt stays OFF on its own switch;
//   * Google sign-in refuses an account that has 2FA on (it has no code step);
//   * a Super Admin can reset 2FA for someone who lost their phone — the
//     /setup-2fa page issues no backup codes, so without it a lost phone is a
//     permanent lock-out.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const login = readFileSync("src/pages/login.tsx", "utf8");
const auth = readFileSync("src/api/routes/auth.ts", "utf8");
const oauth = readFileSync("src/api/routes/auth-oauth.ts", "utf8");
const users = readFileSync("src/api/routes/users.ts", "utf8");
const drawer = readFileSync("src/components/user-detail-drawer.tsx", "utf8");
const usersPage = readFileSync("src/pages/settings/Users.tsx", "utf8");

test("the login gate is on, and the set-up prompt is off on its own switch", () => {
  assert.match(auth, /const TOTP_LOGIN_ENFORCEMENT_ENABLED = true;/);
  assert.match(auth, /const TOTP_SETUP_PROMPT_ENABLED = false;/);
  // Turning the gate on must not start nagging everyone to enrol.
  assert.match(auth, /if \(!TOTP_LOGIN_ENFORCEMENT_ENABLED \|\| !TOTP_SETUP_PROMPT_ENABLED\) return null;/);
});

test("the login page shows a code step instead of the dead-end message", () => {
  assert.doesNotMatch(login, /isn't available yet/, "the old dead end must be gone");
  assert.match(login, /setTotpStep\(/, "totpRequired must open the code step");
  assert.match(login, /Two-step sign-in/);
  // Both the phone and the desktop form switch their submit handler.
  const handlers = login.match(/onSubmit=\{totpStep \? handleTotpSubmit : handleSubmit\}/g) || [];
  assert.equal(handlers.length, 2, "both layouts must have the code step");
  assert.equal((login.match(/<TotpCodeField/g) || []).length, 2);
});

test("the code is posted to login-verify WITH the pending token", () => {
  const at = login.indexOf("const handleTotpSubmit = async");
  assert.ok(at > 0, "handleTotpSubmit must exist");
  const body = login.slice(at, at + 2500);
  assert.match(body, /\/api\/auth\/totp\/login-verify/);
  assert.match(body, /pendingToken/, "without the token the server refuses — the password step is the proof");
  assert.match(body, /userId/);
  // A timed-out token sends the person back to the password step.
  assert.match(body, /backToPassword|setTotpStep\(null\)/);
});

test("the code field suits an authenticator code and a backup code", () => {
  const at = login.indexOf("function TotpCodeField");
  assert.ok(at > 0);
  const body = login.slice(at, at + 3000);
  assert.match(body, /autoComplete="one-time-code"/);
  assert.match(body, /inputMode="numeric"/);
  // Recovery codes are longer than 6 digits, so the field must not cap at 6.
  assert.doesNotMatch(body, /maxLength=\{6\}/);
});

test("Google sign-in cannot skip the second step", () => {
  const guard = oauth.indexOf("SELECT totpEnrolledAt FROM users WHERE id = ?");
  const session = oauth.indexOf("INSERT INTO user_sessions");
  assert.ok(guard > 0, "the callback must look up the 2FA state");
  assert.ok(guard < session, "and it must do so BEFORE a session is written");
  assert.match(oauth.slice(guard, session), /enrolled\?\.totpEnrolledAt \?\? enrolled\?\.totp_enrolled_at/, "dual-keyed");
});

test("resetting someone's 2FA is Super Admin only and clears every 2FA column", () => {
  const at = users.indexOf('app.post("/:id/reset-2fa"');
  assert.ok(at > 0, "the reset route must exist");
  const body = users.slice(at, at + 1600);
  assert.match(body, /requirePermission\(c, "users", "update"\)/);
  assert.match(body, /requireSuperAdmin\(c\)/);
  // Both checks come before the first write.
  const write = body.indexOf("UPDATE users SET");
  assert.ok(body.indexOf("requireSuperAdmin(c)") < write);
  assert.match(body, /totpSecret = NULL, totpEnrolledAt = NULL, totpRecoveryHashes = NULL/);
  assert.match(body, /purgeUserSessions\(/, "sessions started with the old code end now");
  assert.match(body, /action: "totp\.admin-reset"/, "and it is audited");
  assert.match(body, /existing\.totpEnrolledAt \?\? existing\.totp_enrolled_at/, "dual-keyed");
});

test("the user list says whether 2FA is on, without leaking the secret", () => {
  assert.match(users, /twoFactorOn: !!\(u\.totpEnrolledAt \?\? u\.totp_enrolled_at\)/);
  const pub = users.indexOf("function publicUser");
  assert.ok(pub > 0);
  const body = users.slice(pub).split(/\r?\n\}\r?\n/)[0];
  assert.doesNotMatch(body, /totpSecret|totpRecoveryHashes/, "the secret never leaves the server");
});

test("the drawer offers the reset only when 2FA is on, behind a confirm", () => {
  assert.match(drawer, /\/api\/users\/\$\{encodeURIComponent\(user\.id\)\}\/reset-2fa/);
  assert.match(drawer, /twoFactorOn && !confirmReset2fa/);
  assert.match(drawer, /Yes, reset/);
  assert.match(usersPage, /twoFactorOn: drawerUser\.twoFactorOn \?\? false/);
});

test("the profile menu offers set-up, and says when it is already on", () => {
  // Opt-in: the set-up prompt after login is off, so this menu item is the
  // only way to reach /setup-2fa without typing the address (2026-10-23).
  const topbar = readFileSync("src/components/layout/topbar.tsx", "utf8");
  assert.match(topbar, /to="\/setup-2fa"/);
  assert.match(topbar, /Set up two-step sign-in/);
  assert.match(topbar, /me\?\.twoFactorOn \?/, "an enrolled account is not offered set-up again");
  // /api/auth/me carries the flag, dual-keyed, and never the secret.
  assert.match(auth, /twoFactorOn: !!\(u\.totpEnrolledAt \?\? u\.totp_enrolled_at\)/);
  const pub = auth.indexOf("function publicUser");
  const body = auth.slice(pub).split(/\r?\n\}\r?\n/)[0];
  assert.doesNotMatch(body, /totpSecret|totpRecoveryHashes/);
});
