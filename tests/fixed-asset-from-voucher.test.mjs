// ---------------------------------------------------------------------------
// fixed-asset-from-voucher.test.mjs — "Add New Asset" when a payment voucher
// or an other-creditor (AP) bill puts money on a fixed-asset account
// (finance backlog item 11, owner 2026-10-17 「这个要」). After the save, the
// Fixed Assets page opens its Add Asset form filled in from each such line —
// name, date, cost, cost account, its accumulated-depreciation account, a
// depreciation expense account — to check and save, or skip. Registering
// posts nothing. Made-up figures; a generic chart.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const fa = await import(pathToFileURL(resolve(process.cwd(), "src/lib/fixed-asset-prompt.ts")).href);

const A = (code, name, type = "ASSET", isPostable = true) => ({ code, name, type, isPostable });
const COA = [
  A("200-0010", "FURNITURES & FITTINGS"), A("200-0015", "ACCUM. DEPRN. - FURNITURES & FITTINGS"),
  A("200-0020", "OFFICE EQUIPMENT"), A("200-0025", "ACCUM. DEPRN. - OFFICE EQUIPMENT"),
  A("200-0030", "PLANT & MACHINERY"), A("200-0035", "ACCUM. DEPRN. - PLANT & MACHINERY"),
  A("200-0040", "FACTORY EQUIPMENT"), A("200-0045", "ACCUM. DEPRN. - FACTORY EQUIPMENT"),
  A("200-0050", "RENOVATION"), A("200-0055", "ACCUM. DEPRN. RENOVATION"),
  A("210-0000", "GOODWILL"), A("200-0000", "FIXED ASSETS", "ASSET", false),
  A("310-0010", "CASH AT BANK"),
  A("780-0080", "DEPRECIATION OF PLANT & MACHINERY", "COST"), A("780-0090", "DEPRECIATION OF FACTORY & EQUIPMENT", "COST"),
  A("900-D001", "DEPRECIATION OF FIXED ASSETS", "EXPENSE"), A("900-0010", "REPAIRS", "EXPENSE"),
];

test("which accounts are fixed-asset cost accounts", () => {
  for (const c of ["200-0010", "200-0020", "200-0030", "200-0040", "200-0050"]) assert.equal(fa.isFixedAssetCostAccount(COA.find((a) => a.code === c)), true, c);
  for (const c of ["200-0015", "200-0055", "210-0000", "200-0000", "310-0010", "900-0010"]) assert.equal(fa.isFixedAssetCostAccount(COA.find((a) => a.code === c)), false, c);
  assert.equal(fa.isFixedAssetCostAccount(undefined), false);
});

test("the paired accumulated-depreciation account and a depreciation expense account", () => {
  assert.equal(fa.pairedAccumAccount("200-0010", COA), "200-0015");
  assert.equal(fa.pairedAccumAccount("200-0050", COA), "200-0055");
  assert.equal(fa.pairedAccumAccount("200-0030", COA), "200-0035");
  assert.equal(fa.pairedAccumAccount("200-0010", COA.filter((a) => a.code !== "200-0015")), "", "none → the user picks");
  assert.equal(fa.suggestedDepreciationAccount("200-0030", COA), "780-0080", "every word matches");
  assert.equal(fa.suggestedDepreciationAccount("200-0040", COA), "780-0090");
  assert.equal(fa.suggestedDepreciationAccount("200-0020", COA), "900-D001", "one word in common is not a match → the general account");
  assert.equal(fa.suggestedDepreciationAccount("200-0010", COA), "900-D001");
  assert.equal(fa.suggestedDepreciationAccount("200-0010", COA.filter((a) => !/DEPRECIATION/.test(a.name))), "");
});

test("one prefill per fixed-asset line; other lines are left alone", () => {
  const p = fa.fixedAssetPrefills({
    ref: "HPV-2610-001", date: "2026-10-05", description: "Workshop kit",
    lines: [
      { accountCode: "200-0030", description: "Edge banding machine", amountSen: 1250000 },
      { accountCode: "900-0010", description: "Delivery", amountSen: 30000 },
      { accountCode: "200-0010", description: "", amountSen: 80000 },
    ],
  }, COA);
  assert.deepEqual(p, [
    { name: "Edge banding machine", purchaseDate: "2026-10-05", costSen: 1250000, assetAccount: "200-0030", accumAccount: "200-0035", expenseAccount: "780-0080", sourceRef: "HPV-2610-001" },
    { name: "Workshop kit", purchaseDate: "2026-10-05", costSen: 80000, assetAccount: "200-0010", accumAccount: "200-0015", expenseAccount: "900-D001", sourceRef: "HPV-2610-001" },
  ]);
  assert.deepEqual(fa.fixedAssetPrefills({ ref: "X", date: "2026-10-05", description: "", lines: [{ accountCode: "900-0010", description: "", amountSen: 1 }] }, COA), []);
});

test("already registered (same document, account, cost) is not asked again — counting duplicates", () => {
  const two = fa.fixedAssetPrefills({ ref: "OCB-2610-003", date: "2026-10-05", description: "Chair", lines: [
    { accountCode: "200-0010", description: "Chair", amountSen: 50000 },
    { accountCode: "200-0010", description: "Chair", amountSen: 50000 },
  ] }, COA);
  const reg = [{ remarks: fa.faRemarkFor("OCB-2610-003"), assetAccount: "200-0010", costSen: 50000 }];
  assert.equal(fa.withoutRegistered(two, reg).length, 1, "one of two identical chairs is in — ask for the other");
  assert.equal(fa.withoutRegistered(two, [...reg, ...reg]).length, 0);
  assert.equal(fa.withoutRegistered(two, [{ remarks: "From OTHER", assetAccount: "200-0010", costSen: 50000 }]).length, 2);
  assert.equal(fa.faRemarkFor("HPV-2610-001"), "From HPV-2610-001");
});

test("the waiting queue: put, read (pure), clear; blocked storage never throws", () => {
  const mem = new Map();
  const store = { setItem: (k, v) => mem.set(k, v), getItem: (k) => mem.get(k) ?? null, removeItem: (k) => mem.delete(k) };
  const p = [{ name: "x", purchaseDate: "2026-10-05", costSen: 100, assetAccount: "200-0010", accumAccount: "", expenseAccount: "", sourceRef: "R" }];
  assert.equal(fa.putFaQueue(store, []), false, "nothing to ask → nothing stored");
  assert.equal(fa.putFaQueue(store, p), true);
  assert.deepEqual(fa.readFaQueue(store), p);
  assert.deepEqual(fa.readFaQueue(store), p, "reading does not consume");
  fa.clearFaQueue(store);
  assert.deepEqual(fa.readFaQueue(store), []);
  const blocked = { setItem: () => { throw new Error("blocked"); }, getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(fa.putFaQueue(blocked, p), false);
  assert.deepEqual(fa.readFaQueue(blocked), []);
  fa.clearFaQueue(blocked);
  assert.deepEqual(fa.readFaQueue(null), []);
  store.setItem(fa.FA_QUEUE_KEY, "not json");
  assert.deepEqual(fa.readFaQueue(store), []);
});

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const body = (name) => { const a = ui.indexOf(`function ${name}(`); assert.ok(a > 0, name); return ui.slice(a, ui.indexOf("\n}\n", a)); };

test("payment voucher save: fixed-asset lines → the register, minus what is already there", () => {
  const pv = body("PaymentsTab");
  assert.match(pv, /const faPrefills = isTransfer \? \[\] : fixedAssetPrefills\(\{/);
  assert.match(pv, /const faFresh = faPrefills\.length \? withoutRegistered\(faPrefills, await fetchFaRegister\(\)\) : \[\];\n\s*if \(putFaQueue\(sessionStore\(\), faFresh\)\) \{/);
  assert.match(pv, /navigate\("\/accounting\?tab=assets"\);/);
});

test("other creditor bill save: the same, creditor side only, never mid-scan", () => {
  const bills = body("OtherPartyBillsManager");
  assert.match(bills, /const faPrefills = side === "CREDITOR" && !keepOpen \? fixedAssetPrefills\(\{/);
  assert.match(bills, /lines: items\.map\(\(i\) => \(\{ accountCode: i\.counterAccount, description: i\.description, amountSen: i\.amountSen \}\)\),/);
  assert.match(bills, /if \(putFaQueue\(sessionStore\(\), faFresh\)\) \{/);
});

test("Fixed Assets: the queue read once, cleared after mounting, one keyed form per line; Skip asks first", () => {
  const tab = body("FixedAssetsTab");
  assert.match(tab, /const \[faQueue\] = useState<FaPrefill\[\]>\(\(\) => readFaQueue\(sessionStore\(\)\)\);/);
  assert.match(tab, /useEffect\(\(\) => \{ clearFaQueue\(sessionStore\(\)\); \}, \[\]\);/);
  assert.match(tab, /<FixedAssetAddForm\n\s*key=\{faCurrent \? `doc-\$\{faAt\}` : "manual"\}/);
  assert.match(tab, /onSaved=\{\(\) => \{ load\(\); if \(faCurrent\) setFaAt\(\(i\) => i \+ 1\); else setShowForm\(false\); \}\}/);
  assert.match(tab, /title: "Skip this asset\?"/);
  const form = body("FixedAssetAddForm");
  assert.match(form, /\.\.\.\(initial \? \{ remarks: faRemarkFor\(initial\.sourceRef\) \} : \{\}\),/);
  assert.match(form, /\{initial \? "Skip for now" : "Cancel"\}/);
  assert.match(form, /this payment went to a fixed-asset account/);
  // The money rule stays (BUG-2026-08-13-095).
  assert.match(form, /if \(faMoneyError\) \{ toast\.error\(faMoneyError\); return; \}/);
});
