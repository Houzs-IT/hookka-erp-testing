// ---------------------------------------------------------------------------
// accounting-ui-truthfulness.test.mjs — the first audit of
// `src/pages/accounting/index.tsx` (11k lines, ~25 tabs, never opened before
// 2026-08-13). Pins five defects found in it, across three classes in
// docs/BUG-CLASSES.md:
//
//   BUG-2026-08-13-090  C15 — an ACTION that cannot do what it says.
//                       "Record Payment" on Debtor/Creditor Aging POSTed
//                       /api/accounting/aging, whose handler UPDATEs the
//                       `ar_aging` / `ap_aging` tables. GET /aging does not
//                       read them — it computes the aging live from `invoices`
//                       / `purchase_invoices`, and three separate places in the
//                       API call those tables "dead". No payment_records row,
//                       no GL leg, no paid_amount change; and the bare
//                       `await fetch(...)` checked neither `res.ok` nor the
//                       body, so the dead table's 404 closed the form as if it
//                       had saved. Same shape as the four `action: () => {}`
//                       context-menu items on the Overview journal grid.
//
//   BUG-2026-08-13-091  C15 — a FIGURE that reads as measured and is not.
//                       "Revenue (MTD)" / "Expenses (MTD)" / "Net Profit" were
//                       Σ chart_of_accounts.balanceSen. The only writers of
//                       that column anywhere in src/api are the manual-JV paths
//                       (accounting.ts PUT /journals/:id at :1378 and :1447,
//                       POST /journals/:id/lifecycle at :1640). Every real
//                       posting writes `ledger_journal_entries`. So the cards
//                       reported hand-keyed journals as the company's revenue —
//                       "(MTD)" with no date filter in sight, and with the COST
//                       account type dropped from the expense side, overstating
//                       Net Profit by the whole cost-of-sales block.
//
//   BUG-2026-08-13-092  C15 — a statement that cannot be computed, rendered.
//                       Cash Flow offered "2026-Q1" / "2026" periods; fyMonths
//                       parses YYYY-MM, so every column key became "2026-NaN".
//                       No leg matched a column and inFy() was false for every
//                       month, so every income and expense line read "-" —
//                       while balBefore("2026-NaN") string-compared TRUE
//                       against every real month and printed a large, real Bank
//                       b/f and c/f in all 14 columns.
//
//   BUG-2026-08-13-093  C15 — a VERIFICATION that cannot fail. Stock Summary
//                       showed a green ✓ per material group off
//                       `balanced = opening + purchases − consumption ===
//                       closing`, while consumption IS defined as
//                       `opening + purchase − closing` (materialWindow, mapped
//                       straight through by stockSummaryRange). The check
//                       reduces to `closing === closing`.
//
//   BUG-2026-08-13-094  "a total that disagrees with its own rows" — four
//                       instances of ONE shape: the figure the operator reads
//                       reduced over EVERY line while the request body filtered
//                       to lines carrying an account. Payment Voucher, Official
//                       Receipt, Other-Party Bill and the Journal Entry
//                       balanced-check. The backend recomputes each header from
//                       the lines it receives, so "Total RM 1,000.00" posted
//                       RM 800.00 with no warning.
//
// STRUCTURAL, for the reason every sibling no-fabricated-* file gives: none of
// these is a runtime error. A plausible number, a green tick and a button that
// closes cleanly are exactly what they produce. Comments are stripped before
// matching so this header — which quotes each bug verbatim — can neither
// satisfy nor trip a guard, and every read normalises CRLF (this file is
// CRLF + BOM on disk) so the assertions are EOL-agnostic.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (rel) =>
  readFileSync(join(root, rel), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

// Strip comments — a comment must be free to quote the bug it replaced.
//
// Block comments are anchored to the START OF A LINE on purpose. The
// unanchored pattern the sibling guard files use silently ate ~200 lines of
// this page: the scan-upload control carries an accept attribute whose value
// ends in a star-slash-star wildcard, which reads as a block-comment opener,
// so everything up to the next real closer vanished and the assertions below
// passed against text that was no longer being checked. That is the failure
// mode BUG-CLASSES.md warns about — a guard nobody has watched fail is not a
// guard. Every real block comment in these files begins its own line
// (optionally as a JSX comment), so anchoring is both safe and strictly
// narrower. Proved by reintroducing each bug and watching these go red.
function stripComments(src) {
  return src
    .replace(/^[ \t]*\{?\/\*[\s\S]*?\*\/\}?[ \t]*$/gm, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/** assert.match dumps the whole 400 KB file on failure; this reports the rule. */
function has(src, re, msg) {
  assert.ok(re.test(src), msg);
}
function lacks(src, re, msg) {
  assert.ok(!re.test(src), msg);
}

const PAGE = "src/pages/accounting/index.tsx";
const ENGINE = "src/lib/cashflow-engine.ts";
const page = () => stripComments(read(PAGE));

// ===========================================================================
// BUG-2026-08-13-090 — no control that cannot do what it says
// ===========================================================================

test("the aging tabs never write to the dead ar_aging / ap_aging tables", () => {
  const src = page();
  // The ONLY legitimate traffic to /api/accounting/aging from this page is the
  // GET that reads the live aging. Any mutating call means the dead-table
  // write path is back.
  assert.ok(
    !(/"\/api\/accounting\/aging"\s*,\s*\{[\s\S]{0,200}?method:\s*"(POST|PUT|PATCH|DELETE)"/.test(src)),
    'a mutating call to /api/accounting/aging is back — that endpoint UPDATEs ar_aging/ap_aging, which GET /aging does not read',
  );
  assert.ok(
    !(src.includes('type: "ar", id: customerId')),
    "the debtor-aging Record Payment body is back",
  );
  assert.ok(
    !(src.includes('type: "ap", id: supplierId')),
    "the creditor-aging Record Payment body is back",
  );
  // The affordance itself must be gone from both aging tabs.
  assert.ok(
    !(src.includes("Record Payment")),
    "a Record Payment control is back on an aging tab; receipts belong on /invoices/payments and /invoices/supplier-payments",
  );
});

test("no context-menu item on this page is a no-op", () => {
  const src = page();
  const noops = [...src.matchAll(/\{\s*label:\s*"([^"]+)"[^}]*?action:\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g)]
    .map((m) => m[1])
    .filter((label) => label !== ""); // a separator carries no label and no action
  assert.deepEqual(
    noops,
    [],
    `context-menu items that do nothing when clicked: ${noops.join(", ")}`,
  );
});

// ===========================================================================
// BUG-2026-08-13-091 — the Overview's figures come from the books
// ===========================================================================
// The KPI cards this bug fixed were replaced by the owner's Overview on
// 2026-10-14 (src/pages/accounting/overview-tab.tsx: sales orders vs invoices,
// gross / net profit, raw-material and labour share, most-produced models).
// The rule the bug taught still holds: no figure from chart_of_accounts.balanceSen
// (only manual JVs move it), and a month with no P&L shows a dash, never 0.00.

test("the Overview does not sum chart_of_accounts.balanceSen", () => {
  const src = page();
  const ov = stripComments(read("src/pages/accounting/overview-tab.tsx"));
  for (const s of [src, ov]) {
    // NOTE the lazy `[\s\S]{0,40}?` after `reduce(` — a `[^)]*` cannot cross
    // the reducer's own `(s, a) =>` and would pass with the bug put back.
    assert.ok(
      !(/type === "REVENUE"[\s\S]{0,160}?reduce\([\s\S]{0,40}?a\.balance/.test(s)),
      "Overview revenue is summing chart_of_accounts.balanceSen again — only manual JVs move that column",
    );
    assert.ok(
      !(/type === "EXPENSE"[\s\S]{0,160}?reduce\([\s\S]{0,40}?a\.balance/.test(s)),
      "Overview expenses are summing chart_of_accounts.balanceSen again",
    );
  }
  // It takes the aging and nothing else — no chart of accounts, no journals.
  assert.ok(
    /<OverviewTab arData=\{arData\} apData=\{apData\} \/>/.test(src),
    "OverviewTab took another list back as a prop — its figures come from /overview-trend",
  );
});

test("the Overview's P&L figures are the P&L page's own, and a month without one shows a dash", () => {
  const ov = stripComments(read("src/pages/accounting/overview-tab.tsx"));
  const api = stripComments(read("src/api/routes/accounting.ts"));
  has(ov, /`\/api\/accounting\/overview-trend\?months=\$\{range\}`/, "the Overview must read /overview-trend");
  const at = api.indexOf('app.get("/overview-trend"');
  assert.ok(at >= 0, "the /overview-trend route is gone");
  const route = api.slice(at, at + 6000);
  has(route, /await computePnlWindow\(db, orgId, ym, ym, "all", matData, dc, override\)/,
    "the month's P&L must be the statement's own window, not a re-derived figure");
  // A month before the books with no history keyed has no P&L → "—", not 0.00.
  has(ov, /m\.pnl \? cell\(m, "np", <Amount sen=\{m\.pnl\.netProfitSen\} \/>\) : "—"/, "a month with no P&L must read —");
  // The fabricated "(MTD)" caption over an unfiltered running balance stays gone.
  assert.equal(page().includes("(MTD)") || ov.includes("(MTD)"), false, 'the unfiltered "(MTD)" caption is back');
});

// ===========================================================================
// BUG-2026-08-13-092 — no period the cash-flow engine cannot compute
// ===========================================================================

test("the Cash Flow tab offers only YYYY-MM periods", () => {
  const src = page();
  // Scope to CashFlowTab. The P&L Statement tab's identical-looking selector
  // is CORRECT and must keep its Quarter / Full-year options: /pl and
  // /pl-statement route the period through `ymInPeriod` / `periodStartYm` /
  // `periodEndYm` (accounting.ts:5382-5416), which understand "2026-Q1" and
  // "2026". Only the cash-flow path goes through `fyMonths`, which does not.
  // A page-wide assertion here would have deleted a working feature.
  const start = src.indexOf("function CashFlowTab()");
  assert.ok(start > 0, "CashFlowTab was renamed — re-anchor this guard");
  const rest = src.slice(start + 1);
  const end = rest.search(/\nfunction /);
  const tab = end === -1 ? rest : rest.slice(0, end);

  assert.ok(
    !/value=\{`\$\{yr\}-Q\$\{q\}`\}/.test(tab),
    'the Quarter options are back on Cash Flow — fyMonths parses YYYY-MM, so "2026-Q1" builds 13 columns keyed "2026-NaN"',
  );
  assert.ok(
    !/<optgroup label="Full year">/.test(tab),
    "the Full-year options are back on Cash Flow — same NaN-column failure",
  );
  assert.ok(
    /<optgroup label="Monthly">/.test(tab),
    "Cash Flow lost its Monthly period options",
  );
  // The sibling P&L selector must still be there — this fix is Cash-Flow-only.
  assert.ok(
    /<optgroup label="Full year">/.test(src),
    "the P&L Statement's Full-year option was removed too; /pl-statement handles quarters and years correctly",
  );
});

test("fyMonths refuses a period it cannot parse, loudly", async () => {
  const engine = stripComments(read(ENGINE));
  has(engine,
    /if \(!\/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(period\)\) \{\s*\n\s*throw new Error/,
    "fyMonths lost its YYYY-MM guard",
  );
  // Behavioural half — run the real function.
  const { fyMonths } = await import("../src/lib/cashflow-engine.ts");
  assert.deepEqual(
    fyMonths("2026-08", 8).slice(0, 3),
    ["2026-08", "2026-07", "2026-06"],
    "a valid period must still produce real months",
  );
  for (const bad of ["2026-Q1", "2026", "2026-13", "2026-00", "", "not-a-period"]) {
    assert.throws(
      () => fyMonths(bad, 8),
      /period must be YYYY-MM/,
      `fyMonths("${bad}") must refuse rather than emit NaN column keys`,
    );
  }
});

// ===========================================================================
// BUG-2026-08-13-093 — no verification that cannot fail
// ===========================================================================

test("Stock Summary renders no ✓ column off the tautological `balanced` flag", () => {
  const src = page();
  assert.ok(
    !(/r\.balanced \?/.test(src)),
    "the per-group ✓/! column is back; `balanced` is `closing === closing` by construction",
  );
  assert.ok(
    !(src.includes("anyUnbalanced")),
    'the "some groups show !" footnote is back, and that branch is unreachable',
  );
  // The Trial Balance's own `balanced` is a REAL check (server-computed ΣDR vs
  // ΣCR over independent columns) and must survive this cleanup.
  has(src,
    /tb\.balanced \? "Balanced ✓" : "OUT OF BALANCE"/,
    "the Trial Balance balanced badge was removed — that one is a real cross-check",
  );
});

// ===========================================================================
// BUG-2026-08-13-094 — a total may only sum the rows that will be saved
// ===========================================================================

test("every voucher/bill/journal total sums exactly the lines the save sends", () => {
  const src = page();

  // Each of the four forms declares ONE predicate and derives BOTH the figure
  // and the payload from it. Pinning the pair per site is what stops a future
  // edit from re-splitting them (the shape that produced all four instances).
  const sites = [
    {
      name: "Other-Party Bill",
      predicate: /const billLineWillPost = \(l: BillLineDraft\) => !!l\.counterAccount && toSen\(l\.amountStr\) > 0;/,
      derived: [
        /const postableBillLines = form\.lines\.filter\(billLineWillPost\);/,
        /const subtotalSen = postableBillLines\.reduce\(\(s, l\) => s \+ toSen\(l\.amountStr\), 0\);/,
        /const items = postableBillLines/,
      ],
    },
    {
      name: "Payment Voucher",
      predicate: /const pvLineWillPost = \(l: \{ accountCode: string; amount: string \}\) =>\s*\n?\s*!!l\.accountCode && toSen\(l\.amount\) > 0;/,
      derived: [
        /const postableLines = lines\.filter\(pvLineWillPost\);/,
        /const totalSen = postableLines\.reduce\(\(s, l\) => s \+ toSen\(l\.amount\), 0\);/,
      ],
    },
    {
      name: "Official Receipt",
      predicate: /const orLineWillPost = \(l: \{ accountCode: string; amount: string \}\) =>\s*\n?\s*!!l\.accountCode && toSen\(l\.amount\) > 0;/,
      derived: [
        /const postableLines = lines\.filter\(orLineWillPost\);/,
        /const totalSen = postableLines\.reduce\(\(s, l\) => s \+ toSen\(l\.amount\), 0\);/,
      ],
    },
    {
      name: "Journal Entry",
      predicate: /const jeLineWillPost = \(l: JournalLineRow\) => !!l\.accountCode && \(l\.debitSen > 0 \|\| l\.creditSen > 0\);/,
      derived: [
        /const postableJeLines = lines\.filter\(jeLineWillPost\);/,
        /const totalDebit = postableJeLines\.reduce\(\(s, l\) => s \+ l\.debitSen, 0\);/,
        /const totalCredit = postableJeLines\.reduce\(\(s, l\) => s \+ l\.creditSen, 0\);/,
        /const validLines = postableJeLines;/,
      ],
    },
  ];

  for (const site of sites) {
    has(src, site.predicate, `${site.name}: the single will-post predicate is gone`);
    for (const d of site.derived) {
      has(src, d, `${site.name}: a figure or payload no longer derives from that predicate`);
    }
  }

  // And the specific pre-fix expressions must not come back: a reduce over the
  // WHOLE line array feeding a displayed total.
  for (const bad of [
    /const totalSen = lines\.reduce\(\(s, l\) => s \+ toSen\(l\.amount\), 0\);/,
    /const subtotalSen = form\.lines\.reduce\(\(s, l\) => s \+ toSen\(l\.amountStr\), 0\);/,
    /const totalDebit = lines\.reduce\(\(s, l\) => s \+ l\.debitSen, 0\);/,
  ]) {
    assert.ok(
      !(bad.test(src)),
      `a total is being reduced over every line again, including ones the payload drops: ${bad}`,
    );
  }
});

test("a filled line that will not post is disclosed, never silently dropped", () => {
  const src = page();
  for (const counter of [
    /const droppedBillLines = form\.lines\.filter\(\(l\) => !billLineWillPost\(l\) && toSen\(l\.amountStr\) > 0\)\.length;/,
    /const droppedLines = lines\.filter\(\(l\) => !pvLineWillPost\(l\) && toSen\(l\.amount\) > 0\)\.length;/,
    /const droppedLines = lines\.filter\(\(l\) => !orLineWillPost\(l\) && toSen\(l\.amount\) > 0\)\.length;/,
    /const droppedJeLines = lines\.filter\(\(l\) => !jeLineWillPost\(l\) && \(l\.debitSen > 0 \|\| l\.creditSen > 0\)\)\.length;/,
  ]) {
    has(src, counter, `a dropped-line counter is gone: ${counter}`);
  }
  // Each counter must actually reach the screen.
  assert.equal(
    (src.match(/droppedBillLines > 0 && \(/g) ?? []).length,
    1,
    "the bill form no longer surfaces its dropped lines",
  );
  assert.equal(
    (src.match(/droppedLines > 0 && \(/g) ?? []).length,
    2,
    "the payment-voucher and official-receipt forms must each surface their dropped lines",
  );
  assert.equal(
    (src.match(/droppedJeLines > 0 && \(/g) ?? []).length,
    1,
    "the journal form no longer surfaces its dropped lines",
  );
});
