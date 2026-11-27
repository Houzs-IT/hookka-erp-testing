// HK-0179 — Production Tracking Overview: tick-list per text column (show only
// the ticked PO numbers) + the customer PO number on the printed schedule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/pages/production/index.tsx", import.meta.url), "utf8");

test("Overview filter drops rows whose value is not ticked", () => {
  assert.match(
    src,
    /for \(const \[col, vals\] of Object\.entries\(f\.picks\)[^\n]*\n\s*if \(vals && vals\.length > 0 && !vals\.includes\(overviewPickValue\(o, col\)\)\) return false;/,
  );
});

test("SO ID, Product, Customer PO and Special Order headers use the tick-list", () => {
  for (const col of ["soId", "product", "customerPO", "specialOrder"]) {
    assert.ok(src.includes(`render: () => pickFilter("${col}")`), col);
  }
});

test("Overview print carries the customer PO number", () => {
  assert.ok(src.includes("<th>PO No</th>"));
  assert.ok(src.includes('<td class="so">${o.customerPOId || ""}</td>'));
});
