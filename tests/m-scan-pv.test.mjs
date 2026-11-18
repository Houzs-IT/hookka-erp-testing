// m-scan-pv.test.mjs — Payment Voucher on mobile: the scan → DRAFT logic (src/pages/m/lib/scan-pv.ts), the voucher rules the
// phone follows (src/pages/m/lib/pv-mobile.ts: four-tier ladder, edit, restate, lifecycle, permissions) and the wiring of the
// screens (source-level). Fixture data only: this proves the rules and the request bodies, NOT that real OCR reads a real
// bill and NOT that the real API accepts the requests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PV_ACTION_PERM, accrualAccounts, bankAccounts, lineAccounts, pvActions, pvBody, pvChip, pvFormBlockers, pvFormFromRow, pvIsPosted, pvKind, pvState,
} from "../src/pages/m/lib/pv-mobile.ts";
import { buildMemory, buildPvCard, findDraftTwin, scanBlockers } from "../src/pages/m/lib/scan-pv.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const codeOf = (src) => src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const COA = [
  { code: "300-0001", name: "CASH AT BANK - HLBB", type: "ASSET", specialAccountType: "SBK", isPostable: true, isActive: true },
  { code: "300-0002", name: "PETTY CASH", type: "ASSET", specialAccountType: "SCH", isPostable: 1, isActive: 1 },
  { code: "305-0000", name: "DEBTOR CONTROL", type: "ASSET", specialAccountType: "SDC", isPostable: true, isActive: true },
  { code: "405-0000", name: "OTHER CREDITORS", type: "LIABILITY", isPostable: true, isActive: true },
  { code: "410-0001", name: "ACCRUED UTILITIES", type: "LIABILITY", isPostable: true, isActive: true },
  { code: "900-0100", name: "ELECTRICITY", type: "EXPENSE", isPostable: true, isActive: true },
  { code: "900-0200", name: "TELEPHONE", type: "EXPENSE", isPostable: true, isActive: true },
  { code: "900-0000", name: "EXPENSES (HEADER)", type: "EXPENSE", isPostable: false, isActive: true },
  { code: "706-0000", name: "SST", type: "EXPENSE", isPostable: true, isActive: true },
];
const V = (over = {}) => ({ id: "pv-1", pvNo: "DRAFT-1", date: "2026-11-04", payee: "TNB", description: "BILL", payFrom: "300-0001", accrued: 0, status: "DRAFT", approvalState: "DRAFT", totalSen: 10000, lines: [{ accountCode: "900-0100", description: "Power", amountSen: 10000 }], ...over });

// ---- the ladder, permissions and status rules ---------------------------------------------------------------------------
test("a DRAFT: next rung is Prepare; Edit / Void / Delete are offered; nothing past Prepare", () => {
  const a = pvActions(V());
  assert.equal(a.primary, "PREPARE");
  assert.deepEqual(a.menu, ["EDIT", "VOID", "DELETE"]);
});

test("PREPARED → Check (withdraw / reject / edit allowed); CHECKED → Approve (reject only; locked from editing)", () => {
  const p = pvActions(V({ approvalState: "PREPARED" }));
  assert.equal(p.primary, "CHECK");
  assert.deepEqual(p.menu, ["EDIT", "WITHDRAW", "REJECT", "VOID", "DELETE"]);
  const c = pvActions(V({ approvalState: "CHECKED" }));
  assert.equal(c.primary, "APPROVE");
  assert.ok(!c.menu.includes("EDIT"), "a checked voucher is locked: reject it first");
  assert.ok(c.menu.includes("REJECT"));
});

test("a posted EXPENSE voucher is edited by restate, an unsettled accrual can be settled; a settled / non-accrued one cannot", () => {
  const posted = V({ status: "POSTED", approvalState: "APPROVED" });
  assert.equal(pvIsPosted(posted), true);
  assert.equal(pvActions(posted).primary, null);
  assert.ok(pvActions(posted).menu.includes("RESTATE"));
  assert.ok(!pvActions(posted).menu.includes("SETTLE"));
  assert.ok(pvActions({ ...posted, accrued: 1, accrualAccount: "410-0001" }).menu.includes("SETTLE"));
  assert.ok(!pvActions({ ...posted, accrued: 1, settledAt: "2026-11-05" }).menu.includes("SETTLE"));
});

test("an AP payment and a fund transfer ride the ladder but are never edited, restated or settled on the phone", () => {
  for (const pvKindValue of ["AP", "TRANSFER"]) {
    const draft = pvActions(V({ pvKind: pvKindValue }));
    assert.equal(pvKind(V({ pvKind: pvKindValue })), pvKindValue);
    assert.equal(draft.primary, "PREPARE");
    assert.ok(!draft.menu.includes("EDIT"));
    const posted = pvActions(V({ pvKind: pvKindValue, status: "POSTED", approvalState: "APPROVED", accrued: 1 }));
    assert.ok(!posted.menu.includes("RESTATE") && !posted.menu.includes("SETTLE"));
  }
});

test("a cancelled voucher offers Restore / Delete only, no ladder, no edit", () => {
  const a = pvActions(V({ status: "VOID" }));
  assert.equal(a.primary, null);
  assert.deepEqual(a.menu, ["UNVOID", "DELETE"]);
  assert.equal(pvChip(V({ status: "VOID" })), "CANCELLED");
});

test("permissions are the server's: prepare / withdraw / edit / lifecycle = update, check / reject = check, approve = approve", () => {
  assert.deepEqual(PV_ACTION_PERM.PREPARE, ["accounting", "update"]);
  assert.deepEqual(PV_ACTION_PERM.WITHDRAW, ["accounting", "update"]);
  assert.deepEqual(PV_ACTION_PERM.CHECK, ["accounting", "check"]);
  assert.deepEqual(PV_ACTION_PERM.REJECT, ["accounting", "check"]);
  assert.deepEqual(PV_ACTION_PERM.APPROVE, ["accounting", "approve"]);
  for (const k of ["EDIT", "RESTATE", "SETTLE", "VOID", "DELETE", "UNVOID"]) assert.deepEqual(PV_ACTION_PERM[k], ["accounting", "update"], k);
  assert.equal(pvState({ approval_state: "PREPARED" }), "PREPARED", "snake_case rows read too");
  assert.equal(pvState({}), "APPROVED", "a legacy row with no state is posted");
});

// ---- the form, the body, the account rules ---------------------------------------------------------------------------------
test("line accounts exclude bank / cash, debtor control and header accounts; accrual excludes 405; banks are SBK / SCH", () => {
  assert.deepEqual(lineAccounts(COA).map((a) => a.code), ["405-0000", "410-0001", "900-0100", "900-0200", "706-0000"]);
  assert.deepEqual(accrualAccounts(COA).map((a) => a.code), ["410-0001"]);
  assert.deepEqual(bankAccounts(COA).map((a) => a.code), ["300-0001", "300-0002"]);
});

test("blockers say what the server would refuse: unreadable / zero amounts, missing account, bank as a line, no paid-from", () => {
  const f = pvFormFromRow(V());
  assert.deepEqual(pvFormBlockers(f, COA), []);
  assert.ok(pvFormBlockers({ ...f, payee: " " }, COA).includes("Enter the payee."));
  assert.ok(pvFormBlockers({ ...f, lines: [{ ...f.lines[0], amount: "oops" }] }, COA)[0].includes("can't be read"));
  assert.ok(pvFormBlockers({ ...f, lines: [{ ...f.lines[0], amount: "0" }] }, COA)[0].includes("above zero"));
  assert.ok(pvFormBlockers({ ...f, lines: [{ ...f.lines[0], accountCode: "" }] }, COA)[0].includes("pick an account"));
  assert.ok(pvFormBlockers({ ...f, lines: [{ ...f.lines[0], accountCode: "300-0001" }] }, COA)[0].includes("can't be used"));
  assert.ok(pvFormBlockers({ ...f, payFrom: "" }, COA).some((m) => /paid from/i.test(m)));
  assert.ok(pvFormBlockers({ ...f, accrued: true, accrualAccount: "" }, COA).some((m) => /accrual/i.test(m)));
});

test("the body is the desktop's: money in integer sen, saveAs:draft only on create, accrual XOR paid-from", () => {
  const f = pvFormFromRow(V({ billNo: "B-1", bill_date: "2026-11-01" }));
  const create = pvBody(f, true);
  assert.equal(create.saveAs, "draft");
  assert.deepEqual(create.lines, [{ accountCode: "900-0100", description: "Power", amountSen: 10000 }]);
  assert.equal(create.payFrom, "300-0001");
  assert.equal(create.accrualAccount, undefined);
  assert.equal(pvBody(f, false).saveAs, undefined, "an edit never re-creates");
  const acc = pvBody({ ...f, accrued: true, accrualAccount: "410-0001" }, true);
  assert.deepEqual([acc.accrued, acc.payFrom, acc.accrualAccount], [true, undefined, "410-0001"]);
  assert.equal(pvBody({ ...f, lines: [{ ...f.lines[0], amount: "1,234.50" }] }, true).lines[0].amountSen, 123450);
});

// ---- the scan card ---------------------------------------------------------------------------------------------------------------
const MEMORY = buildMemory(
  [
    V({ id: "pv-a", pvNo: "HPV-1", status: "POSTED", approvalState: "APPROVED", payee: "TENAGA NASIONAL BERHAD", billNo: "TNB-77", lines: [{ accountCode: "900-0100", description: "ELECTRICITY OCT", amountSen: 5000 }] }),
    V({ id: "pv-b", pvNo: "DRAFT-9", status: "DRAFT", payee: "SYARIKAT AIR", billNo: "AIR-5", lines: [{ accountCode: "900-0200", description: "WATER", amountSen: 100 }] }),
  ],
  [{ partyName: "LANDLORD", billNo: "OCB-1", referenceNo: "RENT-11", lifecycleState: "ACTIVE", items: [{ description: "RENT", counterAccount: "900-0200" }] }],
  [{ piNo: "PI-1", supplierName: "FOAM CO", supplierInvoiceNo: "INV-900", status: "CONFIRMED" }],
);
const DOC = { partyName: "Tenaga Nasional Berhad", docType: "INVOICE", docNo: "TNB-88", docDate: "2026-11-01", lines: [{ description: "ELECTRICITY NOV", amountSen: 12000 }], taxSen: 720, totalSen: 12720 };

test("a scanned bill becomes an editable draft card: account learned from this payee's earlier line, SST as its own line, default bank, bill fields", () => {
  const c = buildPvCard(DOC, MEMORY, COA, { today: "2026-11-04", fileName: "tnb.jpg" });
  assert.equal(c.payee, "Tenaga Nasional Berhad");
  assert.equal(c.billNo, "TNB-88");
  assert.equal(c.billDate, "2026-11-01");
  assert.equal(c.date, "2026-11-04");
  assert.equal(c.payFrom, "300-0001", "the default bank (HLBB) — editable, a draft posts nothing");
  assert.equal(c.accrued, false);
  assert.deepEqual(c.lines.map((l) => [l.accountCode, l.amount]), [["900-0100", "120.00"], ["706-0000", "7.20"]]);
  assert.equal(c.meta.l0.guess.source, "payee-description");
  assert.equal(c.meta.l1.isTax, true);
  assert.equal(c.totalSen, 12720);
  assert.deepEqual(scanBlockers(c, COA), []);
});

test("a bill number already on the books is flagged (voucher, creditor bill, purchase invoice, a draft says so); a new one is not", () => {
  const dup = buildPvCard({ ...DOC, docNo: "TNB-77" }, MEMORY, COA, { today: "2026-11-04", fileName: "x" });
  assert.equal(dup.duplicateOf, "HPV-1");
  assert.equal(buildPvCard({ ...DOC, partyName: "Syarikat Air", docNo: "AIR-5" }, MEMORY, COA, { today: "2026-11-04", fileName: "x" }).duplicateOf, "a draft voucher");
  assert.equal(buildPvCard({ ...DOC, partyName: "Foam Co", docNo: "INV-900" }, MEMORY, COA, { today: "2026-11-04", fileName: "x" }).duplicateOf, "PI-1");
  assert.equal(buildPvCard(DOC, MEMORY, COA, { today: "2026-11-04", fileName: "x" }).duplicateOf, null);
});

test("a bill with no printed lines uses its total; one with no amount at all is not a card; an unknown payee gets only a suggestion (or none)", () => {
  const totalOnly = buildPvCard({ partyName: "Nobody Ltd", docNo: "N-1", totalSen: 5000 }, MEMORY, COA, { today: "2026-11-04", fileName: "n.pdf" });
  assert.deepEqual(totalOnly.lines.map((l) => [l.description, l.amount]), [["N-1", "50.00"]]);
  assert.equal(buildPvCard({ partyName: "x" }, MEMORY, COA, { today: "2026-11-04", fileName: "n.pdf" }), null);
  assert.ok(["suggested", undefined].includes(totalOnly.meta.l0.guess?.source));
  assert.ok(scanBlockers({ ...totalOnly, lines: [{ ...totalOnly.lines[0], accountCode: "" }] }, COA).some((m) => /pick an account/.test(m)), "an unguessed line must be picked by hand");
});

test("after an unknown outcome, the same DRAFT in the list is adopted (same payee, bill, total); another state, kind or total is not", () => {
  const c = buildPvCard(DOC, MEMORY, COA, { today: "2026-11-04", fileName: "x" });
  const body = pvBody(c, true);
  const twin = V({ id: "pv-twin", payee: "TENAGA NASIONAL BERHAD", billNo: "TNB-88", totalSen: 12720 });
  assert.equal(findDraftTwin([V(), twin], body)?.id, "pv-twin");
  assert.equal(findDraftTwin([{ ...twin, approvalState: "PREPARED" }], body), null);
  assert.equal(findDraftTwin([{ ...twin, status: "VOID" }], body), null);
  assert.equal(findDraftTwin([{ ...twin, totalSen: 1 }], body), null);
  assert.equal(findDraftTwin([{ ...twin, pvKind: "AP" }], body), null);
});

// ---- wiring (source-level: no network, no OCR) -------------------------------------------------------------------------------------
test("the PV tile is live behind accounting:create and opens the PV sheet", () => {
  const s = read("screens/dashboard/ScanToCreate.tsx");
  assert.match(s, /hasPermission\("accounting", "create"\), live: true/);
  assert.match(s, /<ScanPvSheet/);
});

test("the scan sheet uses the synchronous finance extract, saves ONLY a draft, and never prepares / checks / approves / posts / settles", () => {
  const src = read("screens/finance/ScanPvSheet.tsx");
  const code = codeOf(src);
  assert.match(code, /\/api\/scan-finance\/extract/);
  assert.doesNotMatch(code, /scan-queue/, "the finance scan is not on the queue");
  assert.match(code, /pvBody\(c as PvForm, true\)/, "created as saveAs:draft");
  assert.doesNotMatch(code, /\/approval|\/lifecycle|\/settle|\/restate|"approve"|"check"|"prepare"/, "a scan never moves a voucher along the ladder");
  assert.doesNotMatch(code, /status: "POSTED"|approvalState/);
});

test("create: success only for a real id, an unknown outcome makes the next tap look for the draft first, the document is attached once after create", () => {
  const code = codeOf(read("screens/finance/ScanPvSheet.tsx"));
  const create = code.slice(code.indexOf("const createDraft"), code.indexOf("const finish ="));
  assert.match(create, /if \(!data\?\.id\)/);
  assert.match(create, /ambiguousRef\.current = true/);
  assert.match(create, /findDraftTwin/);
  assert.ok(create.indexOf("findDraftTwin") < create.indexOf('"POST", body'), "the look-first happens before the POST");
  assert.match(create, /res\.status === 0 \|\| res\.status >= 500/);
  assert.match(code, /attachPvFileOnce\(s\.id, file\)/);
  assert.match(read("screens/finance/pv-data.ts"), /r\.filename === file\.name/, "attach looks for the same file first");
});

test("the voucher screens: one ladder call per tap, reject needs a reason, approve says it books the ledger, actions gated by the server's permission keys", () => {
  const code = codeOf(read("screens/finance/VoucherScreens.tsx"));
  assert.match(code, /hasPermission\(\.\.\.PV_ACTION_PERM\[k\]\)/);
  assert.match(code, /disabled=\{!reason\.trim\(\)\}/);
  assert.match(code, /This is the step that books it/);
  assert.match(code, /approval`, \{ action, reason \}/);
  const run = code.slice(code.indexOf("const run = async"), code.indexOf("const onPickFile"));
  assert.equal((run.match(/await ladder\(/g) ?? []).length, 1, "a single ladder call site, no chaining prepare → check → approve");
  assert.match(code, /restate`/);
  assert.match(code, /\/download\?inline=1/);
});

test("a voucher with no formal number yet says so (the number is issued at Check, not at Prepare)", () => {
  assert.match(read("screens/finance/VoucherScreens.tsx"), /\"No number yet\"/);
});

test("the Finance menu row and routes exist, gated like the desktop Payment Vouchers page", () => {
  assert.match(read("finance-menu.ts"), /screen: "vouchers", label: "Payment Vouchers", icon: WalletCards, navGate: "\/accounting\?tab=payments"/);
  assert.match(read("MobileLayout.tsx"), /path="finance\/:screen\/:id"/);
  assert.match(read("screens/finance/FinanceRoute.tsx"), /VoucherDetailScreen id=\{id\}/);
});
