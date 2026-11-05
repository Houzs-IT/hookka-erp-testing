// ---------------------------------------------------------------------------
// connect-login.ts — Houzs Connect (the company chat) checks a Hookka account.
//
// Hookka staff sign in to Connect with their Hookka email and password. Connect
// does not hold Hookka passwords; its server asks here, server to server, with
// CONNECT_LOGIN_KEY as a Bearer token. Unset, every call is refused (503).
//
//   POST /api/connect/verify-login
//     { email, password }   → { ok: true, user } or { twoStep: true, challenge }
//     { challenge, code }   → { ok: true, user }   (TOTP or a recovery code)
//
// The same gates as /api/auth/login + /api/auth/totp/login-verify: the login
// throttle, disabled accounts, and the second factor for an enrolled user. The
// challenge carries the pending-2FA token (lib/totp-pending.ts), so the code
// step still needs the password step to have happened. No Hookka session is
// issued; Connect keeps its own.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { verifyPassword } from "../lib/password";
import { verifyTotp, verifyRecoveryCode } from "../lib/totp";
import { checkLoginRateLimit, clearLoginRateLimit, clientIp } from "../lib/rate-limit";
import { checkPendingTotpToken, consumePendingTotpToken, issuePendingTotpToken } from "../lib/totp-pending";
import { emitAudit } from "../lib/audit";

const app = new Hono<Env>();

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: number;
  displayName: string | null;
  totpSecret: string | null;
  totpEnrolledAt: string | null;
  totpRecoveryHashes: string | null;
};

function sameKey(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const person = (u: UserRow) => ({
  ok: true,
  user: { email: u.email, name: u.displayName || u.email, role: u.role },
});

app.post("/verify-login", async (c) => {
  // The key is checked before anything about an account is said.
  const key = (c.env.CONNECT_LOGIN_KEY ?? "").trim();
  if (!key) return c.json({ success: false, error: "Not configured." }, 503);
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!sameKey(given, key)) return c.json({ success: false, error: "Not allowed." }, 401);

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    challenge?: string;
    code?: string;
  };

  // Second step: the code. challenge = "<userId>~<pendingToken>".
  if (body.challenge) {
    const [userId, pendingToken] = body.challenge.split("~");
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!userId || !code) return c.json({ success: false, error: "Enter the code from your authenticator app." }, 400);
    const rlDenied = await checkLoginRateLimit(c, `totp:${userId}`);
    if (rlDenied) return rlDenied;
    const pending = await checkPendingTotpToken(c.var.DB, userId, pendingToken);
    if (!pending.ok) {
      return c.json(
        {
          success: false,
          error:
            pending.reason === "expired"
              ? "That sign-in attempt timed out. Please enter your password again."
              : "Invalid credentials",
        },
        401,
      );
    }
    const user = await c.var.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
    if (!user || !user.totpEnrolledAt || !user.totpSecret) return c.json({ success: false, error: "Invalid credentials" }, 401);
    if (user.isActive !== 1) return c.json({ success: false, error: "Account disabled" }, 403);

    let ok = false;
    if (/^\d{6}$/.test(code)) {
      ok = await verifyTotp(user.totpSecret, code, 1);
    } else {
      const hashes: string[] = user.totpRecoveryHashes ? (JSON.parse(user.totpRecoveryHashes) as string[]) : [];
      const idx = await verifyRecoveryCode(userId, code, hashes);
      if (idx >= 0) {
        ok = true;
        await c.var.DB.prepare("UPDATE users SET totpRecoveryHashes = ? WHERE id = ?")
          .bind(JSON.stringify(hashes.filter((_, i) => i !== idx)), userId)
          .run();
      }
    }
    if (!ok) {
      await emitAudit(c, { resource: "connect-login", resourceId: userId, action: "connect.login.fail", after: { reason: "bad_code" } });
      return c.json({ success: false, error: "That code is not right." }, 401);
    }
    await consumePendingTotpToken(c.var.DB, userId);
    await clearLoginRateLimit(c, `totp:${userId}`);
    await emitAudit(c, { resource: "connect-login", resourceId: userId, action: "connect.login.ok", after: { method: "totp" } });
    return c.json(person(user));
  }

  // First step: email and password.
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return c.json({ success: false, error: "Enter your email and password." }, 400);
  const rlKey = `${email}:${clientIp(c)}`;
  const rlDenied = await checkLoginRateLimit(c, rlKey);
  if (rlDenied) return rlDenied;

  const user = await c.var.DB.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1").bind(email).first<UserRow>();
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    await emitAudit(c, {
      resource: "connect-login",
      resourceId: user?.id ?? email.slice(0, 64),
      action: "connect.login.fail",
      after: { reason: user ? "bad_password" : "unknown_email" },
    });
    return c.json({ success: false, error: "Wrong email or password." }, 401);
  }
  if (user.isActive !== 1) return c.json({ success: false, error: "This Hookka account is disabled." }, 403);

  if (user.totpEnrolledAt) {
    const pendingToken = await issuePendingTotpToken(c.var.DB, user.id);
    return c.json({ twoStep: true, challenge: `${user.id}~${pendingToken}` });
  }
  await clearLoginRateLimit(c, rlKey);
  await emitAudit(c, { resource: "connect-login", resourceId: user.id, action: "connect.login.ok", after: { method: "password" } });
  return c.json(person(user));
});

export default app;
