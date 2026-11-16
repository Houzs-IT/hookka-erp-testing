// m-pi-grn-receive-date.test.mjs — HK-0125: mobile Purchase Invoice detail, Document lineage.
// The linked Goods Receipt row shows its status and receive date ("Posted · 9 Nov 2026"), the same text
// PO detail shows, and stays tappable. No receive date: the status alone. Frontend only; the receive date
// is already in GET /api/purchase-invoices/:id -> linkedGRNs[].receiveDate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grnLineageSub } from "../src/pages/m/lib/procurement-mobile.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a linked GRN reads 'Status · D Mon YYYY'", () => {
  assert.equal(grnLineageSub({ status: "POSTED", receiveDate: "2026-11-09" }), "Posted · 9 Nov 2026");
  assert.equal(grnLineageSub({ status: "POSTED", receiveDate: "2026-11-09T00:00:00.000Z" }), "Posted · 9 Nov 2026", "a timestamp reads as its date");
});

test("no receive date (missing, null or blank): the status alone", () => {
  assert.equal(grnLineageSub({ status: "POSTED" }), "Posted");
  assert.equal(grnLineageSub({ status: "POSTED", receiveDate: null }), "Posted");
  assert.equal(grnLineageSub({ status: "POSTED", receiveDate: "" }), "Posted");
});

test("it is the same text PO detail builds for its GRN rows", () => {
  const po = read("src/pages/m/screens/procurement/PoDetail.tsx");
  assert.match(po, /sub: \[statusOf\("grn", s\(g, "status"\)\)\.label, fmtDate\(dateOnly\(s\(g, "receiveDate"\)\)\)\]\.filter\(Boolean\)\.join\(" · "\)/);
});

test("PI detail uses it for the Goods Receipt row, and the row stays tappable", () => {
  const pi = read("src/pages/m/screens/procurement/PiDetail.tsx");
  assert.match(pi, /label: "Goods Receipt", doc: s\(grn, "grnNumber"\), sub: grnLineageSub\(grn\), state: "linked", onClick: \(\) => open\(s\(grn, "id"\)\)/);
  assert.match(pi, /\{ label: "Goods Receipt", doc: "None", sub: "Not linked", state: "pending" \}/);
});
