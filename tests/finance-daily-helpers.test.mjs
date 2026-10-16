// ---------------------------------------------------------------------------
// finance-daily-helpers.test.mjs — pure mapping for the v2 Daily lists (plan
// 2026-10-16-finance-v2-daily-a Task 1): document dates as "15 Oct 2026", the
// footer total over active rows only, and the status pills (labels and tones
// from the design's tokens). Made-up figures only (the repo is public).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { fmtDocDate, activeTotalSen, pvStatus, foreignPayStatus } from "../src/lib/finance-daily.ts";

test("document dates read like the design: two-digit day, short month, year", () => {
  assert.equal(fmtDocDate("2026-10-15"), "15 Oct 2026");
  assert.equal(fmtDocDate("2026-10-05"), "05 Oct 2026");
  assert.equal(fmtDocDate("2026-10-15T09:00:00Z"), "15 Oct 2026");
  assert.equal(fmtDocDate(""), "");
  assert.equal(fmtDocDate(null), "");
  assert.equal(fmtDocDate("x"), "");
  assert.equal(fmtDocDate("2026-13-01"), "", "no month 13");
});

test("the footer total counts active rows only, in whole sen", () => {
  const t = activeTotalSen([
    { state: "ACTIVE", totalSen: 12345 },
    { state: "VOID", totalSen: 99999 },
    { state: "DELETED", totalSen: 5 },
    { state: "ACTIVE", totalSen: 1 },
  ]);
  assert.equal(t, 12346);
  assert.ok(Number.isInteger(t));
});

test("voucher status pills: every rung, the advance, the accrual, the void", () => {
  assert.deepEqual(pvStatus({ status: "VOID", approvalState: "APPROVED" }), { label: "VOID", tone: "faint" });
  assert.deepEqual(pvStatus({ approvalState: "DRAFT" }), { label: "Draft", tone: "neutral" });
  assert.deepEqual(pvStatus({ approvalState: "DRAFT", rejectReason: "wrong account" }),
    { label: "Draft", tone: "neutral", title: "Rejected: wrong account" });
  assert.deepEqual(pvStatus({ approvalState: "PREPARED" }), { label: "Prepared", tone: "info" });
  assert.deepEqual(pvStatus({ approvalState: "CHECKED", pvNo: "HPV-0001" }),
    { label: "Checked · awaiting approval", tone: "warn", title: "Formal No. HPV-0001 — pending in Cash Position" });
  const adv = pvStatus({ approvalState: "APPROVED", advanceOpenSen: 12000 });
  assert.equal(adv.tone, "warn");
  assert.match(adv.label, /^Approved · advance open RM\s120\.00$/, "the app's RM format (a no-break space)");
  assert.deepEqual(pvStatus({ approvalState: "APPROVED", accrued: 1, settledAt: null }),
    { label: "Approved · accrued, unpaid", tone: "err" });
  assert.deepEqual(pvStatus({ approvalState: "APPROVED", accrued: 1, settledAt: "2026-10-01" }),
    { label: "Approved · paid", tone: "ok" });
  assert.deepEqual(pvStatus({}), { label: "Approved · paid", tone: "ok" }, "a legacy row without a state was posted");
});

test("a payment from another door: posted on save, advance open, or its void state", () => {
  assert.deepEqual(foreignPayStatus("VOID", 0, "x"), { label: "VOID", tone: "faint" });
  assert.deepEqual(foreignPayStatus("DELETED", 500, "x"), { label: "DELETED", tone: "faint" });
  const adv = foreignPayStatus("ACTIVE", 5000, "x");
  assert.equal(adv.tone, "warn");
  assert.match(adv.label, /^Approved · advance open RM\s50\.00$/);
  assert.deepEqual(foreignPayStatus("ACTIVE", 0, "Supplier Payment — posts on save"),
    { label: "Approved · paid", tone: "ok", title: "Posted on save — Supplier Payment — posts on save" });
});
