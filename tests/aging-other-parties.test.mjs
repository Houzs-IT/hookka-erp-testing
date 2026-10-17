// ---------------------------------------------------------------------------
// Debtor Aging includes the other debtors (owner 2026-10-17, Finance v2
// 「这些都做」). Their open bills come from /other-party-aging, each carrying
// `mo` — the same calendar-month bucket /aging gives an invoice — so they sit
// in the trade rows' columns. Under "All" each kind is a section with its own
// subtotal; the export is grouped the same way. Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { otherPartyAgingRows } from "../src/lib/other-party-aging-rows.ts";
import { buildGroupedAgingExportAoa, agingRowKind } from "../src/lib/aging-export.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("other-party bills become aging rows: one per party, bucketed by mo, by name", () => {
  const rows = otherPartyAgingRows([
    { partyId: "p2", partyName: "Zed Transport", billNo: "ODB-3", billDate: "2026-07-02", outstandingSen: 5000, mo: 3 },
    { partyId: "p1", partyName: "Alpha Deposit", billNo: "ODB-1", billDate: "2026-10-01", outstandingSen: 12000, mo: 0 },
    { partyId: "p1", partyName: "Alpha Deposit", billNo: "ODB-2", billDate: "2026-05-15", outstandingSen: 3000, mo: 9 },
    { partyId: "p1", partyName: "Alpha Deposit", billNo: "ODB-4", billDate: "2026-10-09", outstandingSen: 1000, mo: 0 },
    { partyId: "p3", partyName: "Nil Co", billNo: "ODB-5", billDate: "2026-10-01", outstandingSen: 0, mo: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.partyName), ["Alpha Deposit", "Zed Transport"], "zero bills skipped, rows by name");
  const a = rows[0];
  assert.deepEqual([a.currentSen, a.days30Sen, a.days60Sen, a.days90Sen, a.over90Sen], [13000, 0, 0, 0, 3000], "mo above 4 lands in 3+");
  assert.deepEqual(a.docs.map((d) => d.no), ["ODB-4", "ODB-1", "ODB-2"], "bucket first, newest first inside");
  assert.equal(rows[1].days90Sen, 5000);
});

test("the grouped export: a band per group, its parties, its total, then the grand total; an empty group is left out", () => {
  const p = (name, cur, over) => ({ name, currentSen: cur, days30Sen: 0, days60Sen: 0, days90Sen: 0, over90Sen: over, docs: [] });
  const aoa = buildGroupedAgingExportAoa("Customer", [
    { label: "Trade customers", parties: [p("Cust A", 10000, 0), p("Cust B", 0, 2500)] },
    { label: "Other debtors", parties: [p("Other X", 5000, 0)] },
    { label: "Nobody", parties: [] },
  ]);
  const firsts = aoa.map((r) => r[0]);
  assert.deepEqual(firsts, ["Customer", "TRADE CUSTOMERS", "Cust A", "Cust B", "Trade customers — Total", "OTHER DEBTORS", "Other X", "Other debtors — Total", "GRAND TOTAL"]);
  assert.equal(agingRowKind(aoa[1]), "section", "a group band styles as a section");
  assert.equal(agingRowKind(aoa[4]), "subtotal", "a group total styles as a subtotal");
  assert.deepEqual(aoa[4].slice(3), [100, "", "", "", 25, 125]);
  assert.deepEqual(aoa.at(-1).slice(3), [150, 0, 0, 0, 25, 175]);
});

test("/other-party-aging gives each bill the /aging month bucket", () => {
  const api = read("src/api/routes/accounting.ts");
  const at = api.indexOf('app.get("/other-party-aging"');
  const body = api.slice(at, api.indexOf("\n});\n", at));
  // As at a past date (2026-10-17) the bill is rolled back and aged at the date.
  assert.match(body, /outstandingSen: owedAt\(r\.amt, paidBack\?\.get\(r\.id\) \?\? 0\), mo: agingBucketIdx\(monthsOverdue\(r\.billDate, asOf \? asAtNow\(asOf\) : undefined\)\) \}\)\)/);
});

test("Debtor Aging lists trade customers and other debtors, chips and sections, and the other-debtor card", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const a = ui.indexOf("function ARTab(");
  const ar = ui.slice(a, ui.indexOf("\n}\n", a));
  assert.match(ar, /fetch\(`\/api\/accounting\/other-party-aging\?type=DEBTOR\$\{at\.isPast \? `&asOf=\$\{at\.asOf\}` : ""\}`\)/);
  assert.match(ar, /\{ key: "trade", label: "Trade customers", rows: tradeList \},\n\s*\{ key: "other", label: "Other debtors", rows: otherList \},/);
  assert.match(ar, /\{ key: "other", label: "Other debtors", count: otherList\.length \},/);
  assert.match(ar, /label: "Other debtors · 305-0000",/);
  assert.match(ar, /controlDriftNote\(odControl\.balanceSen - otherTotal\)/);
  assert.match(ar, /sectioned=\{show === "all"\}/);
  const g = ui.slice(ui.indexOf("function agingGroupsFor("), ui.indexOf("const AGING_BUCKET_TONE"));
  assert.match(g, /return show === "all" \? all\.filter\(\(g\) => g\.rows\.length\) : all\.filter\(\(g\) => g\.key === show\);/);
});

test("the phone's Debtor Aging lists the other debtors too (Creditor Aging its other creditors)", () => {
  const m = read("src/pages/m/screens/finance/AgingScreen.tsx");
  assert.match(m, /useCachedJson<OtherResp>\(`\/api\/accounting\/other-party-aging\?type=\$\{side === "debtor" \? "DEBTOR" : "CREDITOR"\}`\)/);
  assert.match(m, /otherPartyAgingRows\(other\.data\?\.bills \?\? \[\]\)/);
  assert.match(m, /data-m-fin=\{`\$\{p\.kind\}-tag`\}/);
});
