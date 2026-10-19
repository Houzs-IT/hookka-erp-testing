// ---------------------------------------------------------------------------
// datagrid-user-layout.test.mjs — each user's own saved grid layout ("Save
// Layout" on the finance v2 header menu; plan 2026-10-16-finance-v2-foundation
// Task 2). It rides the existing datagrid_org_layouts table under the kind
// "user:<userId>", so it follows the user to any PC; the org-wide kinds stay
// SUPER_ADMIN-only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { layoutKindFor } from "../src/api/lib/datagrid-layout-kind.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ROUTE = "src/api/routes/datagrid-layouts.ts";
const handler = (src, verb) => {
  const at = src.indexOf(`app.${verb}(`);
  assert.ok(at >= 0, `app.${verb} missing`);
  const end = src.indexOf("\n});\n", at);
  return src.slice(at, end);
};

test("a user's layout is stored under their own kind; unknown kinds are refused", () => {
  assert.equal(layoutKindFor("user", "u1"), "user:u1");
  assert.equal(layoutKindFor("user", undefined), null, "no signed-in user, no personal row");
  assert.equal(layoutKindFor("user", ""), null);
  assert.equal(layoutKindFor("org-default", "u1"), "org-default");
  assert.equal(layoutKindFor("print", undefined), "print");
  assert.equal(layoutKindFor("user:u2", "u1"), null, "nobody writes another user's row");
  assert.equal(layoutKindFor("x", "u1"), null);
});

test("GET returns the caller's own layout as `mine`, with when it was saved", () => {
  const get = handler(read(ROUTE), "get");
  assert.match(get, /layoutKindFor\(USER_LAYOUT_KIND, userId\)/, "the caller's own kind");
  assert.match(get, /SELECT kind, visible_cols, col_order, col_widths, updated_at/);
  assert.match(get, /kind IN \('org-default', 'print'\) OR kind = \?/, "only the shared rows and the caller's own");
  assert.match(get, /mine = \{ \.\.\.preset, updatedAt:/);
  assert.match(get, /return c\.json\(\{ success: true, orgDefault, print, mine \}\)/);
});

test("PUT and DELETE: anyone signed in may save or clear their own layout; shared ones stay SUPER_ADMIN", () => {
  const src = read(ROUTE);
  for (const verb of ["put", "delete"]) {
    const h = handler(src, verb);
    assert.match(h, /if \(kind !== USER_LAYOUT_KIND\) \{\s*const denied = requireSuperAdmin\(c\);\s*if \(denied\) return denied;\s*\}/,
      `${verb}: the SUPER_ADMIN gate guards only the shared kinds`);
    assert.match(h, /const storedKind = layoutKindFor\(kind, userId\);/, `${verb}: maps the kind`);
    assert.match(h, /if \(!storedKind\)/, `${verb}: refuses an unknown kind`);
  }
  assert.match(handler(src, "put"), /\.bind\(\s*crypto\.randomUUID\(\),\s*orgId,\s*gridId,\s*storedKind,/);
  assert.match(handler(src, "delete"), /\.bind\(orgId, gridId, storedKind\)/);
});
