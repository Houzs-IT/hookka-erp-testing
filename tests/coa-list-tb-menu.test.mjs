// ---------------------------------------------------------------------------
// Chart of Accounts — the design's list, with the drag tree kept as a second
// view (owner 2026-10-20 「运用设计稿那样，单拖动的树状图也需要」), and the Trial
// Balance's row menu View Ledger / Edit Account (「要」). Made-up accounts and
// figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
const L = await import(pathToFileURL(resolve(process.cwd(), "src/lib/coa-list.ts")).href);
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const acc = (code, type, parentCode, balance = 0, extra = {}) => ({ code, name: `N ${code}`, type, ...(parentCode ? { parentCode } : {}), balance, isActive: true, ...extra });
const COA = [
  acc("900-0000", "EXPENSE", null, 0, { isPostable: false }),
  acc("900-0020", "EXPENSE", "900-0000", 500),
  acc("900-0010", "EXPENSE", "900-0000", 1500),
  acc("901-0000", "EXPENSE", null, 0, { isPostable: false }),
  acc("901-0010", "EXPENSE", "901-0000", -200, { isActive: false }),
  // Re-parented by drag across prefixes: still listed under its parent.
  acc("903-T001", "EXPENSE", "900-0000", 100),
  acc("310-0000", "ASSET", null, 0, { isPostable: false }),
  acc("310-0010", "ASSET", "310-0000", 99900, { specialAccountType: "SBK", cashFlowCategory: "O" }),
  acc("200-0000", "ASSET", null, 5000),
];

test("rows: by section in the chart's order, tree order inside, depth for the indent, a group's balance is what sits under it", () => {
  const rows = L.coaListRows(COA);
  assert.deepEqual(rows.map((r) => [r.section, r.account.code, r.depth, r.balanceSen, r.isGroup]), [
    ["NCA", "200-0000", 0, 5000, false],
    ["CA", "310-0000", 0, 99900, true],
    ["CA", "310-0010", 1, 99900, false],
    ["EXP", "900-0000", 0, 2100, true],
    ["EXP", "900-0010", 1, 1500, false],
    ["EXP", "900-0020", 1, 500, false],
    ["EXP", "903-T001", 1, 100, false],
    ["EXP", "901-0000", 0, -200, true],
    ["EXP", "901-0010", 1, -200, false],
  ]);
  assert.equal(rows[0].sectionLabel, "Non-Current Assets");
});

test("a cycle in the data never loops; every account still shows once", () => {
  const rows = L.coaListRows([acc("900-0001", "EXPENSE", "900-0002", 1), acc("900-0002", "EXPENSE", "900-0001", 2)]);
  assert.deepEqual(rows.map((r) => r.account.code).sort(), ["900-0001", "900-0002"]);
});

test("balances read Dr / Cr; an account with a balance is cleared before it goes inactive", () => {
  const fmt = (sen) => (sen / 100).toFixed(2);
  assert.equal(L.coaBalanceLabel(150000, fmt), "1500.00 Dr");
  assert.equal(L.coaBalanceLabel(-20000, fmt), "200.00 Cr");
  assert.equal(L.coaBalanceLabel(0, fmt), "-");
  assert.equal(L.coaInactiveBlock({ balanceSen: 500, account: { code: "900-0020" } }), "900-0020 still has a balance — clear it first");
  assert.equal(L.coaInactiveBlock({ balanceSen: 0, account: { code: "900-0020" } }), null);
});

test("the tab: List (the default) or Tree, remembered; KPIs; the list's menu; the edit form; the deep link", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const coa = ui.slice(ui.indexOf("function COATab("), ui.indexOf("\n}\n", ui.indexOf("function COATab(")));
  assert.match(coa, /localStorage\.getItem\("hookka\.coa\.view"\) === "tree" \? "tree" : "list"/);
  assert.match(coa, /<SegmentedSwitch label="Chart of accounts view" options=\{\[\{ key: "list", label: "List" \}, \{ key: "tree", label: "Tree" \}\]\} value=\{view\} onChange=\{pickView\} \/>/);
  assert.match(coa, /\{view === "tree" && SECTIONS\.map\(\(section\) => \{/, "the drag tree is kept");
  assert.match(coa, /fetch\("\/api\/accounting\/coa\?includeInactive=1"/);
  assert.match(coa, /\{ label: "Accounts", value: String\(listRows\.length\), note: `\$\{listRows\.filter\(\(r\) => !r\.account\.isActive\)\.length\} inactive` \}/);
  assert.match(coa, /const code = searchParams\.get\("edit"\);/);
  assert.match(coa, /if \(block\) \{ toast\.error\(block\); return; \}/, "Set Inactive refuses an account with a balance");
  assert.match(coa, /body: JSON\.stringify\(\{ code: a\.code, isActive: !a\.isActive \}\),/);
  const view = read("src/pages/accounting/tabs/CoaListView.tsx");
  assert.match(view, /\{ label: "Edit", action: \(\) => onEdit\(r\.account\) \},\n\s+\{ label: "View Ledger", action: \(\) => onViewLedger\(r\.account\.code\) \},/);
  assert.match(view, /\.\.\.\(r\.isGroup \|\| r\.account\.isPostable === false \? \[\{ label: "Add Sub-account", action: \(\) => onAddSub\(r\.account\) \}\] : \[\]\),/, "only under a group");
  assert.match(view, /label: r\.account\.isActive \? "Set Inactive" : "Set Active"/);
  assert.match(view, /onDoubleClick=\{\(\) => onEdit\(a\)\}/);
  // The edit form: PUT /coa with the reporting fields; a parent of its own section, never itself or below.
  assert.match(view, /fetch\("\/api\/accounting\/coa", \{\n\s+method: "PUT",/);
  assert.match(view, /const parents = groupParentsIn\(accounts, section\)\.filter\(\(g\) => !below\.has\(g\.code\)\);/);
  // The pickers still read only the active accounts.
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /`SELECT \* FROM chart_of_accounts\$\{includeInactive \? "" : " WHERE isActive = 1"\} ORDER BY code`/);
});

test("Trial Balance: right-click View Ledger / Edit Account", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const tb = ui.slice(ui.indexOf("function TrialBalanceTab("), ui.indexOf("\n}\n", ui.indexOf("function TrialBalanceTab(")));
  assert.match(tb, /\{ label: "View Ledger", action: \(\) => openLedger\(code\) \},\n\s+\{ label: "Edit Account", action: \(\) => navigate\(`\/accounting\?tab=coa&edit=\$\{encodeURIComponent\(code\)\}`\) \},/);
  assert.match(tb, /onContextMenu=\{rowMenu\.onContextMenu\(r\.accountCode, \(\) => tbRowMenu\(r\.accountCode\)\)\}/);
  assert.match(tb, /\{rowMenu\.element\}/);
  assert.match(tb, /onDoubleClick=\{\(\) => openLedger\(r\.accountCode\)\}/, "double-click still opens the ledger");
});
