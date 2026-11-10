// ---------------------------------------------------------------------------
// table-import-more-importers.test.mjs — the second round of importers moved
// onto the shared CSV / Excel parser src/lib/table-import.ts (O6 follow-up,
// WORK-TRACKER item 121; first round: tests/table-import-round-trip.test.mjs).
//
// Rule: an import writes exactly what it wrote before for every file that
// imported before. Each converted importer is pinned by sample files run
// through the OLD code (kept below as the oracle) and the new code.
//
//   1. Bank-statement CSV paste (Cash Book tab): the line splitter moved
//      verbatim into table-import (`splitCsvLine`). Money — so strict parity:
//      every sample line must split identically.
//   2. Bought lead list (scripts/import-leads-from-xlsx.mjs → src/lib/lead-sheet.ts):
//      the Google-Maps headers are the column labels, so such a file maps
//      exactly as before; the plan the server would make is identical too.
//
// Left on their own parser (money / stock / payroll with no provable parity,
// or not a table) — see docs/CODEBASE-MAP.md, O6 bullet.
// Run: node --import tsx/esm --test tests/table-import-more-importers.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

import { splitCsvLine } from "../src/lib/table-import.ts";
import { LEAD_SHEET_COLUMNS, leadRowsFromSheet } from "../src/lib/lead-sheet.ts";
import { planImport } from "../src/lib/lead-import.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── 1. Bank-statement CSV ────────────────────────────────────────────────
// The OLD `parseCsvLine` from src/pages/accounting/index.tsx (origin/main
// before item 121) — oracle.
function oldParseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Statements as banks write them: HLBB / Maybank / CIMB-style exports, a
// quoted amount with a thousands comma, a CR/DR marker, an escaped quote, an
// empty trailing cell, a stray quote, a tab, unicode.
const STATEMENTS = [
  `Date,Description,Withdrawal,Deposit,Balance
01/10/2026,"IBG TRANSFER TO ABC SDN BHD",1200.00,,"45,300.12"
02/10/2026,DUITNOW FROM "JOHN" LIM,,"2,500.00",47800.12
03/10/2026,"CHQ 004512 ""RETURNED""",350.00 DR,,47450.12
04/10/2026,SERVICE CHARGE,0.50,,47449.62,
05/10/2026,"INTEREST, CREDIT",,1.20 CR,47450.82`,
  `Transaction Date,Posting Date,Description,Amount
2026-10-01,2026-10-02,FPX PAYMENT  TNB,-245.10
2026-10-03,2026-10-03,"SALARY OCT 2026 – 薪水",8000
2026-10-04,2026-10-04,  spaces around  ,  12.00
,,,
"unterminated, quote,5`,
  `a,b\tc,"",""""
"","x"y,"z""",`,
];

test("bank CSV: splitCsvLine splits every sample line exactly as the old parseCsvLine", () => {
  let n = 0;
  for (const csv of STATEMENTS) {
    for (const line of csv.split(/\r?\n/)) {
      assert.deepEqual(splitCsvLine(line), oldParseCsvLine(line), `line: ${line}`);
      n++;
    }
  }
  assert.ok(n >= 14);
});

test("bank CSV: CRLF statements split identically line by line", () => {
  const crlf = STATEMENTS[0].replace(/\n/g, "\r\n");
  for (const line of crlf.trim().split(/\r?\n/)) assert.deepEqual(splitCsvLine(line), oldParseCsvLine(line));
});

test("bank CSV: the Cash Book tab uses the shared splitter and its row loop is unchanged", () => {
  const ACC = read("src/pages/accounting/index.tsx");
  assert.match(ACC, /import \{ splitCsvLine \} from "@\/lib\/table-import";/);
  assert.doesNotMatch(ACC, /function parseCsvLine\(/, "the private copy is gone");
  assert.match(ACC, /const cells = splitCsvLine\(rawLines\[i\]\);\n\s*const date = parseDate\(cells\[di\] \?\? ""\);/);
  // The money rules after the split are untouched.
  assert.match(ACC, /moneyFieldToSen\(s\.trim\(\)\.replace\(\/\\s\*\(\?:DR\|CR\)\\s\*\$\/i, ""\)\) \?\? 0;/);
});

// ── 2. Bought lead list ──────────────────────────────────────────────────
// The OLD inline mapping from scripts/import-leads-from-xlsx.mjs — oracle.
function oldLeadRows(json, industry) {
  const rows = [];
  for (const r of json) {
    if (!r || Object.values(r).every((v) => v === null || v === "")) continue;
    rows.push({
      company: r["Business Name"] ?? null,
      phone: r["Business Phone"] ?? null,
      email: r["Business Email"] ?? null,
      website: r["Business Website"] ?? null,
      location: r["Location"] ?? null,
      industry,
    });
  }
  return rows;
}

// The way the script reads a sheet.
function sheetRecords(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

const PENANG_LIKE = [
  ["No", "Business Name", "Business Phone", "Business Email", "Business Website", "Location", "job", "Rating"],
  [1, "Meiko Upholstery Specialist, Sofa Repair, Customize, baik pulih, Penang, Malaysia", "+60 10-248 6699", null, "https://meiko.example/&opi\\u003d79508299", "Meiko Upholstery Specialist, Jalan Air Itam, Penang", "Sofa", 4.6],
  [2, "Carte Kitchen Cabinet (Bayan Lepas Showroom)", "04-6412345", "", "", "Bayan Lepas", "Kitchen", 4.1],
  [3, "Carte Kitchen Cabinet (Bukit Mertajam Showroom)", "046412345", null, null, "Bukit Mertajam", "Kitchen", null],
  [null, null, null, null, null, null, null, null],
  [5, "ABC Trading, Penang", 60124567890, "abc@example.com", "abc.example", "Georgetown", "Retail", 3],
  [6, "", "012-345 6789", null, null, null, null, null],
  [7, "No Phone Sdn Bhd", null, null, null, "Butterworth", null, null],
];

const SAMPLES = [
  ["Google-Maps export", PENANG_LIKE],
  ["columns in another order, no email / website columns", [
    ["Location", "Business Phone", "Business Name"],
    ["Ipoh", "05-2551234", "Perak Sofa House"],
    ["", "", ""],
    ["Taiping", "0105556666", "Taiping Deco"],
  ]],
  ["no recognised columns at all", [
    ["Shop", "Tel No"],
    ["X", "0123"],
  ]],
];

test("lead list: sample files map exactly as the old inline mapping did", () => {
  for (const [name, aoa] of SAMPLES) {
    const json = sheetRecords(aoa);
    assert.deepEqual(leadRowsFromSheet(json, "Furniture Retail"), oldLeadRows(json, "Furniture Retail"), name);
  }
});

test("lead list: the server's plan for the sample files is identical", () => {
  for (const [name, aoa] of SAMPLES) {
    const json = sheetRecords(aoa);
    const before = planImport(oldLeadRows(json, "Renovation"), ["60102486699"]);
    const after = planImport(leadRowsFromSheet(json, "Renovation"), ["60102486699"]);
    assert.deepEqual(after, before, name);
  }
});

test("lead list: a phone typed as a number stays a number (planImport cleans it)", () => {
  const rows = leadRowsFromSheet(sheetRecords(PENANG_LIKE), "Retail");
  assert.equal(rows.find((r) => r.company === "ABC Trading, Penang")?.phone, 60124567890);
});

test("lead list: other spellings of the headers are read now", () => {
  const json = sheetRecords([
    ["company name", "PHONE", "e-mail", "Website", "Address *"],
    ["New Shop", "012-999 8888", "a@b.c", "x.example", "Seberang"],
  ]);
  assert.deepEqual(leadRowsFromSheet(json, "Retail"), [
    { company: "New Shop", phone: "012-999 8888", email: "a@b.c", website: "x.example", location: "Seberang", industry: "Retail" },
  ]);
});

test("lead list: a column's own label beats an alias", () => {
  const json = sheetRecords([
    ["Company", "Business Name", "Phone", "Business Phone"],
    ["alias co", "Label Co", "0111", "0122-333 4444"],
  ]);
  const [row] = leadRowsFromSheet(json, "Retail");
  assert.equal(row.company, "Label Co");
  assert.equal(row.phone, "0122-333 4444");
  assert.deepEqual(LEAD_SHEET_COLUMNS.map((c) => c.label), ["Business Name", "Business Phone", "Business Email", "Business Website", "Location"]);
});

test("lead list: the script reads sheets through the shared mapping", () => {
  const SCRIPT = read("scripts/import-leads-from-xlsx.mjs");
  assert.match(SCRIPT, /import \{ leadRowsFromSheet \} from "\.\.\/src\/lib\/lead-sheet\.ts";/);
  assert.match(SCRIPT, /rows\.push\(\.\.\.leadRowsFromSheet\(json, INDUSTRY_FROM_SHEET\(sheet\)\)\);/);
  assert.doesNotMatch(SCRIPT, /r\["Business Name"\]/, "the inline mapping is gone");
});

test("BUG-2026-11-10-461: a phone or name typed as a number no longer throws in planImport", () => {
  const plan = planImport([{ company: 12345, phone: 60124567890, location: 10450 }]);
  assert.equal(plan.summary.insert, 1);
  assert.equal(plan.insert[0].phone, "60124567890");
  assert.equal(plan.insert[0].phoneKey, "60124567890");
  assert.equal(plan.insert[0].company, "12345");
  assert.equal(plan.insert[0].location, "10450");
  // Text cells are unchanged by the fix.
  const text = planImport([{ company: "  Shop  ", phone: " 012-345 6789 ", email: "", notes: " n " }]);
  assert.equal(text.insert[0].company, "Shop");
  assert.equal(text.insert[0].phone, "012-345 6789");
  assert.equal(text.insert[0].email, null);
  assert.equal(text.insert[0].notes, "n");
});
