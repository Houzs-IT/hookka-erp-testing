# Context Pack: Security, Auth, and RBAC

> **Last verified: 2026-11-09** (branch `fix/security-batch`, to `main`): the "Hardening batch 2026-11-08" section below — `src/api/lib/rbac.ts` default-deny paths, `src/api/lib/user-sessions.ts` + `src/api/routes/auth-sessions.ts` (mounted `/api/auth/sessions` in `src/api/worker.ts`), `src/api/lib/text-caps.ts`, `tests/no-query-in-loop.test.mjs`. Nothing else re-checked.

> **Last verified: 2026-08-13** against `src/api/lib/auth-middleware.ts` (`PUBLIC_PATHS`/`PUBLIC_PREFIXES` + 4 regex-opened paths), `rbac.ts`, `tenant.ts`, `routes/auth.ts`, `auth-oauth.ts`, `auth-totp.ts`, `users.ts` (`requireSuperAdmin`, 9 call sites), `worker-auth.ts`, `worker.ts`, and the named tests (`security-permission-matrix`, `security-public-endpoints`, `security-route-coverage`, `permissions`, `tenant-isolation`). All present.

Use this pack for login/session handling, CSRF, OAuth, TOTP, worker portal access, permissions, tenancy, and audit trails.

> Security / auth / RBAC / tenancy is **always deep review** — never fast-lane it (`docs/DEV-OPERATING-FRAMEWORK.md`). Note the SUPER_ADMIN tier gate (`requireSuperAdmin`) on user-account mutations in `users.ts`.

## Read first

- `src/lib/api-client.ts`
- `src/api/lib/auth-middleware.ts`
- `src/api/lib/rbac.ts`
- `src/api/lib/tenant.ts`
- `src/api/routes/auth.ts`
- `src/api/routes/auth-oauth.ts`
- `src/api/routes/auth-totp.ts`
- `src/api/routes/users.ts`
- `src/api/routes/worker-auth.ts`
- `src/api/routes/worker.ts`

## Hardening batch 2026-11-08 (owner-approved)

**Permissions default to deny.** Read out of `src/api/lib/rbac.ts`: no `userRole` → 401;
a role with no grants (and no legacy default) → empty set; a lookup that throws → empty set
(or the role's explicit legacy default); the matcher only accepts the exact tuple,
`resource:*`, `*:action` or `*:*`. No path widens. Pinned by
`tests/rbac-default-deny.test.mjs` — (a) unknown resource, for DB-backed AND every
code-defined role in `role-policy.ts`; (b) role with no grant / no grants at all / legacy
`USER`; (c) no role and empty-string role — plus `tests/rbac-fail-closed.test.mjs` for the
2026-09 fail-open closures. Not tested against production (out of scope for the batch).

**Signed-in devices.** Dashboard sessions are server-side rows in `user_sessions`, so a user
can list and end their own. `src/api/lib/user-sessions.ts` self-applies three nullable
columns (`user_agent`, `ip_address`, `last_seen_at`); `stampSessionDevice` fills them
right after each of the four session INSERTs (`auth.ts` login + accept-invite,
`auth-totp.ts` login-verify, `auth-oauth.ts` callback) as a separate best-effort UPDATE, so
sign-in never depends on the new columns. `authMiddleware` refreshes `last_seen_at` only on
a session-cache miss (at most once per 5 min per session) and only when it is >15 min old,
fire-and-forget, errors swallowed; it never SELECTs the new columns. Routes
(`src/api/routes/auth-sessions.ts`, self-scoped to `userId`, no permission gate):
`GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`,
`POST /api/auth/sessions/revoke-others`. The browser only ever sees `sessionPublicId` (a
one-way hash), never the token; revocation matches it against the caller's own rows, deletes
the row and purges the KV session cache. UI: top-bar user menu → **Signed-in Devices** on desktop, and a **Signed-in devices** row on the
phone app's More screen (`src/pages/m/screens/More.tsx`) — one shared dialog,
`src/components/layout/signed-in-devices-dialog.tsx`, portalled to `<body>`. The top bar moved from
`z-30` to `z-[35]`: page sticky bars (the dashboard tab strip) are `z-30` and later in the DOM, so they
were painting over the lower items of the user menu. Tests:
`tests/user-sessions.test.mjs`.

**Free-text length caps.** `src/api/lib/text-caps.ts` (`textCapError`) refuses an over-long
name (200) / short field (100) / address (1000) / note or remark (5000) with a 400 naming the
field, on POST and PUT of sales orders, purchase orders, purchase invoices, customers and
suppliers (plus line `items[]` for the three documents). Base64 / image / file / JSON-blob
fields are never capped. Tests: `tests/text-caps.test.mjs`.

**No new query-in-loop.** `tests/no-query-in-loop.test.mjs` counts `await … .prepare(/.first(/
.all(/.run(` inside `for`/`while`/`do` bodies in `src/api/routes/*.ts` and fails when a file
exceeds `tests/no-query-in-loop.baseline.json` (157 sites in 45 files when written). Existing
loops were not refactored.

## Useful searches

```bash
rg -n "hookka_session|hookka_csrf|CSRF|HttpOnly|SameSite" src docs tests
rg -n "requirePermission|hasPermission|role|permission|audit" src/api tests
rg -n "PUBLIC|public|worker-auth|worker token|org_id|tenant" src/api/lib src/api/routes tests
```

## Tests to inspect first

- `tests/security-*.mjs`
- `tests/permissions.test.mjs`
- `tests/tenant-isolation.test.mjs`
- `tests/rbac-default-deny.test.mjs` / `tests/rbac-fail-closed.test.mjs`
- `tests/user-sessions.test.mjs`
- Auth, session, and worker portal tests matching the changed route.
