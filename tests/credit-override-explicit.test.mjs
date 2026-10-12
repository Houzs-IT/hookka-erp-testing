// BUG-2026-10-12-280: "delivery-orders:*" (all DO actions) let every Sales and
// Office account pass the customer credit block. The override now needs the
// exact tick; the API gate, the browser check and the User Management boxes
// all use the same EXPLICIT_ONLY_RIGHTS list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";

import { hasPermission } from "../src/api/lib/rbac.ts";

// Stub for the role_permissions JOIN (same shape as rbac-fail-closed.test.mjs).
const dbWith = (rows) => ({
  prepare() {
    const stmt = { bind: () => stmt, all: async () => ({ results: rows, success: true }) };
    return stmt;
  },
});

// Each call uses its own role name: rbac.ts memoises a role's set for 5 s.
async function allowed(role, rows, resource, action) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", dbWith(rows));
    c.set("userRole", role);
    await next();
  });
  app.get("/", async (c) => c.json({ ok: await hasPermission(c, resource, action) }));
  return (await (await app.request("/", undefined, {})).json()).ok;
}

test("a module wildcard no longer grants the credit override", async () => {
  const rows = [{ resource: "delivery-orders", action: "*" }];
  assert.equal(await allowed("T_WILD_A", rows, "delivery-orders", "create"), true);
  assert.equal(await allowed("T_WILD_B", rows, "delivery-orders", "credit-override"), false);
  assert.equal(await allowed("T_STAR", [{ resource: "*", action: "*" }], "delivery-orders", "credit-override"), false);
});

test("the exact tick, ADMIN and SUPER_ADMIN still pass", async () => {
  const rows = [{ resource: "delivery-orders", action: "credit-override" }];
  assert.equal(await allowed("T_EXACT", rows, "delivery-orders", "credit-override"), true);
  assert.equal(await allowed("ADMIN", [], "delivery-orders", "credit-override"), true);
  assert.equal(await allowed("SUPER_ADMIN", [], "delivery-orders", "credit-override"), true);
});

test("browser check and User Management boxes use the same list", () => {
  const rule = "if (EXPLICIT_ONLY_RIGHTS.has(`${resource}:${action}`)) return set.has(`${resource}:${action}`);";
  for (const f of ["src/api/lib/rbac.ts", "src/lib/use-permission.ts", "src/components/user-permissions-panel.tsx"]) {
    assert.ok(readFileSync(resolve(process.cwd(), f), "utf8").includes(rule), f);
  }
});
