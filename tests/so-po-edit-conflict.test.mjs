import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { editConflictMessage } from "../src/api/lib/edit-conflict.ts";

test("a save carrying an older updatedAt than the row is refused", () => {
  const msg = editConflictMessage({ updated_at: "2026-11-09T05:00:00.000Z" }, "2026-11-09T04:59:00.000Z", "sales order");
  assert.match(msg, /This sales order was changed by someone else/);
});

test("the same instant passes, whatever its string form", () => {
  assert.equal(editConflictMessage({ updatedAt: "2026-11-09T05:00:00.000Z" }, "2026-11-09T05:00:00Z", "x"), null);
  assert.equal(editConflictMessage({ updated_at: new Date("2026-11-09T05:00:00Z") }, "2026-11-09T05:00:00.000Z", "x"), null);
});

test("opt-in: no expectedUpdatedAt, or a row without a stamp, is not checked", () => {
  assert.equal(editConflictMessage({ updated_at: "2026-11-09T05:00:00Z" }, undefined, "x"), null);
  assert.equal(editConflictMessage({ updated_at: "2026-11-09T05:00:00Z" }, "", "x"), null);
  assert.equal(editConflictMessage({}, "2026-11-09T05:00:00Z", "x"), null);
});

test("SO and PO PUT refuse a stale save with 409; both edit forms send what they loaded", () => {
  for (const f of ["src/api/routes/sales-orders.ts", "src/api/routes/purchase-orders.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /editConflictMessage\(existing as \{ updated_at\?: unknown; updatedAt\?: unknown \}, body\?\.expectedUpdatedAt,/, f);
    assert.match(src, /conflict: true \}, 409\)/, f);
  }
  assert.match(readFileSync("src/pages/sales/edit.tsx", "utf8"), /expectedUpdatedAt: order\.updatedAt/);
  assert.match(readFileSync("src/pages/procurement/detail.tsx", "utf8"), /expectedUpdatedAt: po\.updatedAt/);
});
