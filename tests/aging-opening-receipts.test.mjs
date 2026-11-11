// Debtor Aging: opening-period receipts not knocked off stay out of the
// columns (owner 2026-11-11, with a screenshot of the 3+ months column:
// 「可以帮我把houzs 和 conts 的还之前的的invoice的数额不要显示吗？」 → the
// proposal → 「可以」). Such a receipt pays invoices from before the opening
// that the system does not hold; the Cash Flow forecast already leaves it out
// (openingCreditCutoffYm / splitOpeningCredits). The Debtor Aging and the
// Daily Cash Position's TO RECEIVE now do too, and name the total under the
// table, since the ledger still counts it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const oc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/aging-opening-credits.ts")).href);
const ex = await import(pathToFileURL(resolve(process.cwd(), "src/lib/aging-export.ts")).href);
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("isOpeningCredit: dated up to the end of the cutoff month; no cutoff, nothing", () => {
  assert.equal(oc.isOpeningCredit("2026-06-30", "2026-06"), true);
  assert.equal(oc.isOpeningCredit("2026-05-02", "2026-06"), true);
  assert.equal(oc.isOpeningCredit("2026-07-01", "2026-06"), false);
  assert.equal(oc.isOpeningCredit("2026-06-30", null), false);
  assert.equal(oc.isOpeningCredit("", "2026-06"), false);
});

const row = (name, buckets, docs) => ({ customerId: name, customerName: name, customerCode: "300-X", currentSen: buckets[0], days30Sen: buckets[1], days60Sen: buckets[2], days90Sen: buckets[3], over90Sen: buckets[4], docs });

test("splitArOpeningCredits: only receipts on account dated in the opening period leave; their bucket goes back up; the rest stays", () => {
  const rows = [
    // An invoice from May (3+ months), two June receipts on account, a credit note in June, a receipt from August.
    row("Cust A", [10_000, 0, 0, 0, 5_000 - 30_000 - 20_000 - 1_000], [
      { no: "INV-1", date: "2026-11-02", mo: 0, amountSen: 10_000 },
      { no: "INV-0", date: "2026-05-30", mo: 4, amountSen: 5_000 },
      { no: `HOR-1${oc.ADVANCE_DOC_SUFFIX}`, date: "2026-06-03", mo: 4, amountSen: -30_000 },
      { no: `HOR-2${oc.ADVANCE_DOC_SUFFIX}`, date: "2026-06-30", mo: 4, amountSen: -20_000 },
      { no: "CN-1", date: "2026-06-10", mo: 4, amountSen: -1_000 },
    ]),
    row("Cust B", [0, 0, -4_000, 0, 0], [{ no: `HOR-3${oc.ADVANCE_DOC_SUFFIX}`, date: "2026-08-20", mo: 2, amountSen: -4_000 }]),
    // Nothing but an opening-period receipt: the row goes.
    row("Cust C", [0, 0, 0, 0, -700], [{ no: `HOR-4${oc.ADVANCE_DOC_SUFFIX}`, date: "2026-06-12", mo: 4, amountSen: -700 }]),
  ];
  const before = JSON.stringify(rows);
  const r = oc.splitArOpeningCredits(rows, "2026-06");
  assert.equal(JSON.stringify(rows), before, "the input is not changed");
  assert.deepEqual(r.rows.map((x) => [x.customerName, x.currentSen, x.over90Sen, x.days60Sen, x.docs.map((d) => d.no)]), [
    ["Cust A", 10_000, 5_000 - 1_000, 0, ["INV-1", "INV-0", "CN-1"]],
    ["Cust B", 0, 0, -4_000, [`HOR-3${oc.ADVANCE_DOC_SUFFIX}`]],
  ]);
  assert.equal(r.openingCredits.receivedSen, 30_000 + 20_000 + 700);
  assert.deepEqual(r.openingCredits.items, [
    { customerName: "Cust A", no: "HOR-1", date: "2026-06-03", sen: 30_000 },
    { customerName: "Cust A", no: "HOR-2", date: "2026-06-30", sen: 20_000 },
    { customerName: "Cust C", no: "HOR-4", date: "2026-06-12", sen: 700 },
  ]);
  assert.deepEqual(oc.splitArOpeningCredits(rows, null), { rows, openingCredits: { receivedSen: 0, items: [] } }, "no opening date: as before");
});

test("the Excel / PDF export names what was left out under the grand total", () => {
  const aoa = ex.buildGroupedAgingExportAoa("Customer", [{ label: "Trade customers", parties: [] }], "Not in the columns: 1 receipt");
  assert.deepEqual(aoa[aoa.length - 1][0], "Not in the columns: 1 receipt");
  const plain = ex.buildGroupedAgingExportAoa("Customer", [{ label: "Trade customers", parties: [] }]);
  assert.equal(plain[plain.length - 1][0], "GRAND TOTAL", "no note, no extra row");
});

const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const slice = (src, start, end) => { const a = src.indexOf(start); assert.ok(a >= 0, start); return src.slice(a, src.indexOf(end, a + start.length)); };

test("GET /aging: the split runs on the cached result (the snapshot is unchanged) with the forecast's cutoff; the total left out rides along", () => {
  const g = slice(api, 'app.get("/aging"', 'app.post("/aging"');
  assert.match(g, /const cacheKey = coFilter\.active \? `company:\$\{coFilter\.orgId\}\|due\|notes\|code` : "\|due\|notes\|code";/, "same snapshot");
  assert.match(g, /const openingCut = openingCreditCutoffYm\(String\(\(await getOpeningDate\(c\.var\.DB\)\) \?\? ""\)\.slice\(0, 7\) \|\| null\);/);
  assert.match(g, /const split = splitArOpeningCredits\(data\.data\.ar, openingCut\);/);
  assert.match(g, /data: \{ \.\.\.data\.data, ar: split\.rows, arOpeningCredits: split\.openingCredits \}/);
  // The aging labels its receipts on account with the shared suffix.
  assert.match(api, /no: `\$\{it\.receiptNumber\}\$\{ADVANCE_DOC_SUFFIX\}`/);
});

test("TO RECEIVE leaves the same receipts out and says how much", () => {
  assert.match(api, /if \(isOpeningCredit\(it\.date, recvCutoffYm\)\) \{ receiveOpeningCreditsSen \+= it\.sen; continue; \}/);
  assert.match(api, /receive, receiveOpeningCreditsSen, planned,/);
  const panel = slice(ui, "function CashPosPartyPanel(", "\nfunction ");
  assert.match(panel, /\{note && <div /);
  assert.match(ui, /note=\{\(cur\.receiveOpeningCreditsSen \?\? 0\) > 0 \?/);
  assert.match(ui, /Left out, as on Debtor Aging:/);
});

test("Debtor Aging: the note under the table, the export's note, and the as-at check still ties to the ledger", () => {
  const ar = slice(ui, "function ARTab(", "\nfunction ");
  assert.match(ar, /footNote=\{openingNote\}/);
  assert.match(ar, /buildGroupedAgingExportAoa\("Customer", groups\.map\(\(g\) => \(\{ label: g\.label, parties: g\.rows \}\)\), openingText \|\| undefined\)/);
  assert.match(ar, /- \(tradeList0 - openingSen\)\)/, "the ledger counts the receipts left out of the list");
  assert.match(ui, /Not in the columns: \$\{/);
  const t = slice(ui, "function AgingListTable(", "const AGING_TYPE_TAG");
  assert.match(t, /\{footNote && \(/);
});
