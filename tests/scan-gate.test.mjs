// Worker phone: a card completes only after punch-in + a department QR scan
// today, for that department; outsource exempt (owner 2026-11-17).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideScanGate, checkWorkerScanGate } from "../src/api/lib/scan-gate.ts";

const base = { isOutsource: false, clockIn: "08:01", clockOut: null, lastDeptScan: "FAB_SEW", cardDept: "FAB_SEW" };

test("punched in + scanned this department → allowed", () => {
  assert.equal(decideScanGate(base), null);
  assert.equal(decideScanGate({ ...base, cardDept: "fab_sew " }), null);
  assert.equal(decideScanGate({ ...base, cardDept: null }), null); // section sticker: any dept scan
});

test("not punched in, or already punched out → PUNCH_IN_FIRST", () => {
  assert.equal(decideScanGate({ ...base, clockIn: null }).code, "PUNCH_IN_FIRST");
  assert.equal(decideScanGate({ ...base, clockIn: "" }).code, "PUNCH_IN_FIRST");
  assert.equal(decideScanGate({ ...base, clockOut: "17:30" }).code, "PUNCH_IN_FIRST");
});

test("punched in but no department QR today → DEPT_SCAN_FIRST", () => {
  assert.equal(decideScanGate({ ...base, lastDeptScan: null }).code, "DEPT_SCAN_FIRST");
});

test("card of another department than the last scan → WRONG_DEPT", () => {
  const r = decideScanGate({ ...base, lastDeptScan: "FAB_CUT" });
  assert.equal(r.code, "WRONG_DEPT");
  assert.equal(r.currentDept, "FAB_CUT");
});

test("outsource skips every check", () => {
  assert.equal(decideScanGate({ ...base, isOutsource: true, clockIn: null, lastDeptScan: null, cardDept: "X" }), null);
});

// A tiny fake DB keyed by the table the SQL reads.
const fakeDb = (rows) => ({
  prepare: (sql) => ({
    bind: () => ({
      first: async () => {
        if (/FROM workers/.test(sql)) return rows.worker ?? null;
        if (/FROM attendance_records/.test(sql)) return rows.att ?? null;
        if (/FROM dept_scan_events/.test(sql)) { if (rows.scanThrows) throw new Error("no table"); return rows.scan ?? null; }
        return null;
      },
    }),
  }),
});

test("loader: outsource by OSC number / OUTSOURCE name / flag, and today's punch + scan", async () => {
  for (const worker of [{ empNo: "OSC12", name: "A" }, { empNo: "HK1", name: "Outsource B" }, { empNo: "HK2", name: "C", isOutsource: true }]) {
    assert.equal(await checkWorkerScanGate(fakeDb({ worker }), "w", "FAB_SEW"), null);
  }
  const staff = { empNo: "HK3", name: "D", isOutsource: false };
  assert.equal((await checkWorkerScanGate(fakeDb({ worker: staff }), "w", "FAB_SEW")).code, "PUNCH_IN_FIRST");
  assert.equal((await checkWorkerScanGate(fakeDb({ worker: staff, att: { clockIn: "08:00" }, scanThrows: true }), "w", "FAB_SEW")).code, "DEPT_SCAN_FIRST");
  assert.equal(await checkWorkerScanGate(fakeDb({ worker: staff, att: { clockIn: "08:00" }, scan: { departmentcode: "FAB_SEW" } }), "w", "FAB_SEW"), null);
});

test("all three phone scan-complete endpoints apply the gate, only to worker callers", () => {
  const src = readFileSync("src/api/routes/production-orders.ts", "utf8");
  assert.match(src, /checkWorkerScanGate\(db, workerId, scannedJc\.departmentCode\)/);
  assert.match(src, /checkWorkerScanGate\(db, workerId, deptCode\)/);
  assert.match(src, /checkWorkerScanGate\(db, workerId, null\)/);
  assert.equal((src.match(/if \(!ctxUserId\) \{\n\s+const gateFail = await checkWorkerScanGate/g) ?? []).length, 3);
  const phone = readFileSync("src/pages/worker/scan.tsx", "utf8");
  assert.match(phone, /data\.code === "PUNCH_IN_FIRST"\s+\? t\("scan\.deptNeedPunchIn"\)/);
});
