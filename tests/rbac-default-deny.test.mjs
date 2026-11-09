// ---------------------------------------------------------------------------
// rbac-default-deny.test.mjs — permission checks DEFAULT TO DENY.
//
// Hardening batch (owner-approved 2026-11-08). Verified by reading
// src/api/lib/rbac.ts that every unresolved path refuses: no role → 401, a role
// with no grants → empty set, a lookup failure → empty set (see also
// rbac-fail-closed.test.mjs, which pins the two fail-open paths closed in
// 2026-09). This file pins the three plain "nothing configured" cases the
// hardening review asked for, so a future refactor of the matcher or of the
// role-policy table cannot quietly turn any of them into an allow:
//
//   (a) a resource nobody has ever heard of     → 403, even for a role that
//       holds plenty of other grants (DB-backed and code-defined roles alike);
//   (b) a role that holds no grant for this resource (or no grants at all)
//                                               → 403;
//   (c) a request with no role on it at all      → 401 from the gate, `false`
//       from the field check, and no dashboard-tab escape hatch.
//
// Behavioural tests against the real requirePermission / hasPermission /
// requireReadOrDashboardTab with a stub DB. Each test uses its own role name
// because rbac.ts memoises a role's set for 5 s per isolate.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import {
  requirePermission,
  hasPermission,
  requireReadOrDashboardTab,
} from '../src/api/lib/rbac.ts';
import { CODE_ROLE_POLICIES } from '../src/api/lib/role-policy.ts';

// No SESSION_CACHE → getRolePermissions skips KV and asks the stub DB.
const TEST_ENV = {};

/** Stub DB whose role_permissions JOIN always answers `rows`. */
function dbWith(rows) {
  return {
    prepare() {
      const stmt = {
        bind() {
          return stmt;
        },
        async all() {
          return { results: rows, success: true };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  };
}

function appFor(db, role) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('DB', db);
    if (role !== undefined) c.set('userRole', role);
    await next();
  });
  app.get('/gate/:resource/:action', async (c) => {
    const denied = await requirePermission(c, c.req.param('resource'), c.req.param('action'));
    if (denied) return denied;
    return c.json({ success: true });
  });
  app.get('/field/:resource/:action', async (c) =>
    c.json({ allowed: await hasPermission(c, c.req.param('resource'), c.req.param('action')) }),
  );
  app.get('/tab/:resource/:tab', async (c) => {
    const denied = await requireReadOrDashboardTab(c, c.req.param('resource'), c.req.param('tab'));
    if (denied) return denied;
    return c.json({ success: true });
  });
  return app;
}

const get = (app, path) => app.request(path, undefined, TEST_ENV);

function quietly(fn) {
  return async () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = original;
    }
  };
}

async function assertForbidden(res, missing) {
  assert.equal(res.status, 403, `expected 403 for ${missing}, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.missingPermission, missing);
}

// ---------------------------------------------------------------- (a) -----

test(
  '(a) an unknown resource is denied to a DB-backed role that holds other grants',
  quietly(async () => {
    const app = appFor(
      dbWith([
        { resource: 'customers', action: 'read' },
        { resource: 'sales-orders', action: '*' },
      ]),
      'TEST_DENY_A_DB_ROLE',
    );
    // Sanity: the role really can do what it was granted…
    assert.equal((await get(app, '/gate/customers/read')).status, 200);
    assert.equal((await get(app, '/gate/sales-orders/delete')).status, 200);
    // …and nothing it was not.
    await assertForbidden(await get(app, '/gate/no-such-resource-xyz/read'), 'no-such-resource-xyz:read');
    await assertForbidden(await get(app, '/gate/no-such-resource-xyz/delete'), 'no-such-resource-xyz:delete');
    const field = await (await get(app, '/field/no-such-resource-xyz/read')).json();
    assert.equal(field.allowed, false);
  }),
);

test(
  '(a) an unknown resource is denied to every code-defined role (role-policy.ts)',
  quietly(async () => {
    // Code-defined roles never read role_permissions; an empty stub proves the
    // answer comes from the policy table, and that it has no catch-all.
    const roles = Object.keys(CODE_ROLE_POLICIES);
    assert.ok(roles.length >= 5, 'expected the code-defined roles to be present');
    for (const role of roles) {
      const app = appFor(dbWith([]), role);
      const res = await get(app, '/gate/no-such-resource-xyz/read');
      assert.equal(res.status, 403, `${role} must not read an unknown resource`);
    }
  }),
);

// ---------------------------------------------------------------- (b) -----

test(
  '(b) a role with no grant for the resource is denied, even with a sibling grant',
  quietly(async () => {
    const app = appFor(dbWith([{ resource: 'customers', action: 'read' }]), 'TEST_DENY_B_PARTIAL');
    await assertForbidden(await get(app, '/gate/customers/update'), 'customers:update');
    await assertForbidden(await get(app, '/gate/suppliers/read'), 'suppliers:read');
  }),
);

test(
  '(b) a role with NO grants at all (and no legacy default) is denied everything',
  quietly(async () => {
    const app = appFor(dbWith([]), 'TEST_DENY_B_EMPTY');
    for (const [r, a] of [
      ['customers', 'read'],
      ['sales-orders', 'create'],
      ['settings', 'read'],
      ['users', 'update'],
    ]) {
      await assertForbidden(await get(app, `/gate/${r}/${a}`), `${r}:${a}`);
    }
    const field = await (await get(app, '/field/customers/read')).json();
    assert.equal(field.allowed, false);
    // Not a tab-restricted role → the dashboard escape hatch does not apply.
    await assertForbidden(await get(app, '/tab/customers/sales'), 'customers:read');
  }),
);

test(
  '(b) the legacy USER role (empty legacy default) is denied, not widened',
  quietly(async () => {
    const app = appFor(dbWith([]), 'USER');
    await assertForbidden(await get(app, '/gate/customers/read'), 'customers:read');
  }),
);

// ---------------------------------------------------------------- (c) -----

test(
  '(c) a request with no role is refused by the gate (401), the field check and the tab gate',
  quietly(async () => {
    // A grant-rich DB proves the refusal comes from the missing role, not from
    // an empty permission table.
    const app = appFor(dbWith([{ resource: '*', action: '*' }]), undefined);
    const res = await get(app, '/gate/customers/read');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
    const field = await (await get(app, '/field/customers/read')).json();
    assert.equal(field.allowed, false);
    assert.equal((await get(app, '/tab/customers/sales')).status, 401);
  }),
);

test(
  '(c) an empty-string role is treated as no role',
  quietly(async () => {
    const app = appFor(dbWith([{ resource: '*', action: '*' }]), '');
    assert.equal((await get(app, '/gate/customers/read')).status, 401);
    const field = await (await get(app, '/field/customers/read')).json();
    assert.equal(field.allowed, false);
  }),
);
