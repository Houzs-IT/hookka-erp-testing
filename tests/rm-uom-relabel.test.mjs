// Relabel a raw material's unit without touching its quantities (owner
// 2026-11-11 「用mtr」 for PC151-01 / 02 / 17). Their stock was always metres,
// but the rows kept ROLL after a merge, and a unit change on an item with stock
// is refused (checkRawMaterialUomLocked: "all counted in the current unit").
// A relabel says the quantities are already in the new unit: it skips that
// lock, is Super Admin only and is audited as a relabel.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { uomChangeGate } from "../src/api/lib/lock-helpers.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("uomChangeGate: no change → nothing; a change → the stock lock; a relabel → Super Admin only", () => {
  assert.equal(uomChangeGate({ uomChanged: false, relabel: true, role: "STAFF" }), "none");
  assert.equal(uomChangeGate({ uomChanged: true, relabel: false, role: "SUPER_ADMIN" }), "lock-check");
  assert.equal(uomChangeGate({ uomChanged: true, relabel: true, role: "super_admin" }), "relabel");
  for (const role of ["ADMIN", "FINANCE", "WAREHOUSE", undefined]) {
    assert.equal(uomChangeGate({ uomChanged: true, relabel: true, role }), "forbidden", String(role));
  }
});

test("PUT /api/raw-materials/:id: the lock still runs for a plain change; a relabel is refused for non Super Admins and audited", () => {
  const src = read("src/api/routes/raw-materials.ts");
  const put = src.slice(src.indexOf('app.put("/:id"'), src.indexOf('app.put("/:id"') + 12000);
  assert.match(put, /uomChangeGate\(\{ uomChanged, relabel: body\.uomRelabel === true, role \}\)/);
  assert.match(put, /gate === "forbidden"[\s\S]{0,200}403/);
  assert.match(put, /gate === "lock-check"[\s\S]{0,200}checkRawMaterialUomLocked\(/);
  assert.match(put, /relabel: gate === "relabel"/, "the audit row says it was a relabel");
});
