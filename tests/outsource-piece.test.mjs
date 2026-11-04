// ---------------------------------------------------------------------------
// outsource-piece.test.mjs — HK-0130 piece-rate wages.
//
// Rate keys, the wage arithmetic on Violet's price list, the pasted rate list,
// and the drift check that stops a month being approved without its wages.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const P = await import(pathToFileURL(resolve(process.cwd(), "src/lib/outsource-piece.ts")).href);
const L = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-piece.ts")).href);

test("both sides of a module share one rate key", () => {
  assert.equal(P.pieceItemCode("5530-2A(LHF)"), "5530-2A");
  assert.equal(P.pieceItemCode("5530-2A(RHF)"), "5530-2A");
  assert.equal(P.pieceItemCode("5531-L(RHF)"), "5531-L");
  assert.equal(P.pieceItemCode(" 5530-stool "), "5530-STOOL");
  assert.equal(P.pieceItemCode("5530-1NA"), "5530-1NA");
});

test("a set is the sum of its modules, in whole sen", () => {
  const set = P.pieceAmountSen(1, 3167) + P.pieceAmountSen(1, 2597);
  assert.equal(set, 5764);
  assert.equal(P.pieceAmountSen(3, 2407), 7221);
});

test("rate list pasted from Excel", () => {
  const { rates, errors } = P.parseRateLines("5530-1A\t24.07\r\n5530-2A(LHF), RM 31.67\n\n5530-STOOL 19\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(rates, [
    { itemCode: "5530-1A", rateSen: 2407 },
    { itemCode: "5530-2A", rateSen: 3167 },
    { itemCode: "5530-STOOL", rateSen: 1900 },
  ]);
});

test("a rate that cannot be read is reported, never dropped", () => {
  const { rates, errors } = P.parseRateLines("5530-1A abc\n5530-2A 31.67\n5530-2A 32.00\n");
  assert.equal(rates.length, 1);
  assert.equal(errors.length, 2);
});

test("drift: a payslip that disagrees with the imported wages", () => {
  const expected = new Map([["w1", 5764]]);
  const drift = L.computePieceDrift(expected, [
    { employeeId: "w1", employeeName: "A", pieceWagesSen: 0 },
    { employeeId: "w2", employeeName: "B", pieceWagesSen: 0 },
  ]);
  assert.deepEqual(drift, [{ workerId: "w1", employeeName: "A", expectedSen: 5764, onPayslipSen: 0 }]);
});

test("drift: wages with no payslip are never silently unpaid", () => {
  const drift = L.computePieceDrift(new Map([["w9", 100]]), [
    { employeeId: "w1", employeeName: "A", pieceWagesSen: 0 },
  ]);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].workerId, "w9");
});

test("drift: matching payslips pass", () => {
  const drift = L.computePieceDrift(new Map([["w1", 5764]]), [
    { employeeId: "w1", employeeName: "A", pieceWagesSen: 5764 },
  ]);
  assert.deepEqual(drift, []);
});
