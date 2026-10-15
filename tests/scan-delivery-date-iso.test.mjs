// HK-0080 — a scanned PO's "Delivery Date" must reach sales_orders as ISO
// YYYY-MM-DD. The overdue SQL compares the text column with `< today`, so a
// DD/MM/YYYY string ("15/10/2026" < "2026-10-15") reads as overdue forever.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toIsoDate } from "../src/api/lib/iso-date.ts";

test("ISO passes through, time part dropped", () => {
  assert.equal(toIsoDate("2026-10-15"), "2026-10-15");
  assert.equal(toIsoDate("2026-10-15T08:00:00.000Z"), "2026-10-15");
});
test("Malaysian DD/MM/YYYY, DD.MM.YYYY, DD-MM-YY convert (day first)", () => {
  assert.equal(toIsoDate("03/06/2026"), "2026-06-03");
  assert.equal(toIsoDate("3.6.2026"), "2026-06-03");
  assert.equal(toIsoDate("15-10-26"), "2026-10-15");
});
test("garbage and impossible dates become null, never a guess", () => {
  assert.equal(toIsoDate("31/02/2026"), null);
  assert.equal(toIsoDate("next week"), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate(null), null);
});
test("scan route and SO create both normalise", () => {
  const scan = readFileSync("src/api/routes/scan-po.ts", "utf8");
  const so = readFileSync("src/api/routes/sales-orders.ts", "utf8");
  assert.match(scan, /toIsoDate\(po\.deliveryDate\)/);
  assert.match(so, /toIsoDate\(body\.customerDeliveryDate\)/);
  assert.match(so, /toIsoDate\(body\.hookkaExpectedDD\)/);
});
