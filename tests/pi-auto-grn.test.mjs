// ---------------------------------------------------------------------------
// pi-auto-grn.test.mjs — a CONFIRMED purchase invoice receives its matched
// lines into raw-material stock through a system GRN (owner 2026-10-27). The
// office bills from the PO without GRNs, so since April 2026 production kept
// issuing stock that nothing billed ever put back.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planPiAutoGrn, autoGrnIdForPi } from "../src/api/lib/pi-auto-grn.ts";

const pi = (id, poId, code, qty, extra = {}) => ({
  id, poId, poItemId: null, materialCode: code, qty, unitPriceSen: 100,
  lineType: "STOCKED", grnItemId: null, ...extra,
});
const po = (id, poId, code, quantity, receivedQty = 0, poStatus = "CONFIRMED") => ({
  id, poId, materialCode: code, materialName: `${code} - desc`, quantity, receivedQty, poStatus,
});

test("a matched line is received against its PO line", () => {
  const { lines, skipped } = planPiAutoGrn([pi("a", "po1", "MDF-5", 10)], [po("1", "po1", "MDF-5", 10)]);
  assert.deepEqual(lines.map((l) => [l.poItemId, l.qty]), [["1", 10]]);
  assert.equal(skipped.length, 0);
});

test("code match ignores case and spaces", () => {
  const { lines } = planPiAutoGrn([pi("a", "po1", " mdf-5 ", 4)], [po("1", "po1", "MDF-5", 10)]);
  assert.equal(lines[0].qty, 4);
});

test("only what the PO line still has open is received", () => {
  const { lines, skipped } = planPiAutoGrn([pi("a", "po1", "MDF-5", 10)], [po("1", "po1", "MDF-5", 10, 7)]);
  assert.equal(lines[0].qty, 3);
  assert.deepEqual(skipped.map((s) => [s.reason, s.qty]), [["ALREADY_RECEIVED", 7]]);
});

test("a PO already received in full gets nothing", () => {
  const { lines, skipped } = planPiAutoGrn([pi("a", "po1", "MDF-5", 10)], [po("1", "po1", "MDF-5", 10, 10)]);
  assert.equal(lines.length, 0);
  assert.equal(skipped[0].reason, "ALREADY_RECEIVED");
});

test("a code billed that is not on the PO is left for a person (PO-2609-033 shape)", () => {
  const { lines, skipped } = planPiAutoGrn([pi("a", "po1", 'NLY-D30-3"', 5)], [po("1", "po1", 'NLY-D30-1"', 5)]);
  assert.equal(lines.length, 0);
  assert.equal(skipped[0].reason, "CODE_NOT_ON_PO");
});

test("no PO, no code, GRN-sourced and non-stock lines are skipped", () => {
  const { lines, skipped } = planPiAutoGrn(
    [
      pi("a", null, "MDF-5", 1),
      pi("b", "po1", "", 1),
      pi("c", "po1", "MDF-5", 1, { grnItemId: "77" }),
      pi("d", "po1", "MDF-5", 1, { lineType: "SERVICE" }),
    ],
    [po("1", "po1", "MDF-5", 10)],
  );
  assert.equal(lines.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason), ["NO_PO", "NO_CODE", "FROM_GRN", "NOT_STOCKED"]);
});

test("the PI's own PO line is filled first, then other lines of the same code", () => {
  const { lines } = planPiAutoGrn(
    [pi("a", "po1", "MDF-5", 8, { poItemId: "2" })],
    [po("1", "po1", "MDF-5", 5), po("2", "po1", "MDF-5", 5)],
  );
  assert.deepEqual(lines.map((l) => [l.poItemId, l.qty]), [["2", 5], ["1", 3]]);
});

test("a CLOSED or SUBMITTED PO is not received on", () => {
  for (const st of ["CLOSED", "SUBMITTED"]) {
    const { lines, skipped } = planPiAutoGrn([pi("a", "po1", "MDF-5", 5)], [po("1", "po1", "MDF-5", 5, 0, st)]);
    assert.equal(lines.length, 0);
    assert.equal(skipped[0].reason, "PO_NOT_OPEN");
  }
});

test("a line on another PO does not draw this PO", () => {
  const { lines, skipped } = planPiAutoGrn([pi("a", "po2", "MDF-5", 5)], [po("1", "po1", "MDF-5", 5)]);
  assert.equal(lines.length, 0);
  assert.equal(skipped[0].reason, "CODE_NOT_ON_PO");
});

test("a shared open map stops two invoices receiving the same goods", () => {
  const open = new Map();
  const poLines = [po("1", "po1", "MDF-5", 10)];
  const first = planPiAutoGrn([pi("a", "po1", "MDF-5", 10)], poLines, open);
  const second = planPiAutoGrn([pi("b", "po1", "MDF-5", 10)], poLines, open);
  assert.equal(first.lines[0].qty, 10);
  assert.equal(second.lines.length, 0);
});

test("one receipt per invoice: the GRN id is derived from the PI id", () => {
  assert.equal(autoGrnIdForPi("pi-abc"), "grn-pi-pi-abc");
});

test("both confirm paths post the receipt, and the preview route is read-only", () => {
  const route = readFileSync(resolve(process.cwd(), "src/api/routes/purchase-invoices.ts"), "utf8");
  assert.match(route, /status === "CONFIRMED" \? await autoReceivePiStock\(db, id\)/);
  assert.match(route, /merged\.status === "CONFIRMED" && existing\.status !== "CONFIRMED"\s*\?\s*await autoReceivePiStock\(db, id\)/);
  const preview = route.slice(route.indexOf('app.get("/auto-grn-preview"'), route.indexOf('app.get("/:id"'));
  assert.match(preview, /requirePermission\(c, "purchase-invoices", "read"\)/);
  assert.ok(preview.indexOf('app.get("/auto-grn-preview"') >= 0);
  const lib = readFileSync(resolve(process.cwd(), "src/api/lib/pi-auto-grn.ts"), "utf8");
  const previewFn = lib.slice(lib.indexOf("export async function previewPiAutoGrn"));
  assert.doesNotMatch(previewFn, /INSERT|UPDATE|DELETE|\.batch\(/);
});
