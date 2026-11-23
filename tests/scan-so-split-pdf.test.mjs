// BUG-2026-11-23-547 — a customer-PO PDF of 3+ pages that the queue split into child rows left the phone
// "Scan Sales Order" sheet on "Reading the document…" for ever: it watched only the parent row, which
// turns 'split' (neither done nor failed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posOfSplit } from "../src/pages/m/lib/scan-so.ts";

const parent = { id: "p", status: "split", rawJson: null, sampleId: null };
const po = (no) => ({ pos: [{ customerPO: no, items: [{ qty: 1 }] }] });

test("waits while the split has no children yet, or a child is still being read", () => {
  assert.equal(posOfSplit([parent], "p"), null);
  assert.equal(posOfSplit([parent, { id: "a", status: "done", rawJson: po("A") }, { id: "b", status: "processing", rawJson: null }], "p"), null);
  assert.equal(posOfSplit([parent, { id: "a", status: "done", rawJson: null }], "p"), null);
});

test("collects every child's POs, each tagged with its own row and sample", () => {
  const r = posOfSplit([
    parent,
    { id: "a", status: "done", rawJson: po("A"), sampleId: "s-a" },
    { id: "b", status: "cached", rawJson: { pos: [{ items: [] }, { customerPO: "B", items: [{}] }] }, sampleId: null },
    { id: "c", status: "failed", rawJson: null },
  ], "p");
  assert.deepEqual(r.found.map((f) => [f.po.customerPO, f.rowId, f.docIdx, f.sampleId]), [["A", "a", 0, "s-a"], ["B", "b", 1, null]]);
  assert.equal(r.failed, 1);
});

test("the sheet follows a split parent and creates each SO against the child row it came from", () => {
  const src = readFileSync(new URL("../src/pages/m/screens/dashboard/ScanSoSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /item\.status === "split"/);
  assert.match(src, /posOfSplit\(/);
  assert.match(src, /rowId: pick\.rowId/);
  assert.match(src, /sampleId: pick\.sampleId/);
});
