// ---------------------------------------------------------------------------
// finance-v2-selfcheck-corrections.test.mjs — Self-check and Corrections in the
// v2 Monthly look (plan 2026-10-16-finance-v2-monthly Task 2). Same reads;
// Self-check becomes one list (result pill, area, check, detail with its items
// opening under the row, a link to where it is fixed) under a "N of M OK" card;
// Corrections becomes a DataGrid under a count card, the last 90 days by
// default or one month at a time.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const body = (name) => { const a = ui.indexOf(`function ${name}() {`); return ui.slice(a, ui.indexOf("\n}\n", a)); };
const sc = body("SelfCheckTab");
const corr = body("CorrectionsTab");

test("Self-check: the same probes; a result pill per check; items open under the row; fix links kept", () => {
  for (const p of ["/api/accounting/ap-control", "/api/accounting/ar-control", "/api/accounting/ap-reconciliation", "/api/accounting/ar-reconciliation", "/api/accounting/trial-balance", "/api/accounting/payment-vouchers", "/api/accounting/coa"]) {
    assert.ok(sc.includes(`"${p}"`), p);
  }
  assert.match(sc, /ok === true \? <FinPill tone="ok">OK<\/FinPill> : ok === false \? <FinPill tone="err">FIX<\/FinPill> : <FinPill tone="warn">CHECK<\/FinPill>/);
  assert.match(sc, /<table data-fin-list className="w-full text-sm">/);
  assert.match(sc, /\{open && k\.items\?\.map\(\(it, i\) => \(/, "the items behind a check open under it");
  assert.match(sc, /\{k\.fixHref && k\.ok !== true && \(\n\s*<Link to=\{k\.fixHref\}/);
  assert.match(sc, /value: `\$\{okCount\} of \$\{cards\.length\} OK`/);
  const bar = sc.slice(sc.indexOf("<FinanceTitleActions>"), sc.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /onClick=\{run\}>\{running \? "Checking…" : "Run again"\}/, "Run again on the title row");
});

test("Corrections: same read; DataGrid with memoised rows and columns; 90 days by default, or a month", () => {
  assert.match(corr, /fetch\(`\/api\/accounting\/corrections\$\{month \? `\?month=\$\{month\}` : ""\}`\)/);
  assert.match(corr, /const \[month, setMonth\] = useState\(""\);/, "the last 90 days by default");
  assert.match(corr, /const gridRows = useMemo<CorrGridRow\[\]>\(/);
  assert.match(corr, /const columns = useMemo<Column<CorrGridRow>\[\]>\(\(\) => \[/);
  assert.match(corr, /gridId="accounting-corrections"/);
  assert.match(corr, /onChange=\{\(k\) => setMonth\(k === "month" \? today\.slice\(0, 7\) : ""\)\}/);
  assert.match(corr, /\{month && <PeriodStepper value=\{month\} options=\{monthOpts\} onChange=\{setMonth\} today=\{today\} \/>\}/);
  assert.match(corr, /label: `Corrections · \$\{month \? periodLabel\(month, ""\) : "last 90 days"\}`/);
});
