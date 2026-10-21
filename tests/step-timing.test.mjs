// ---------------------------------------------------------------------------
// step-timing.test.mjs — where a slow request spends its time (2026-10-19,
// owner 「优化加载速度」). timed() records a step under the current request;
// the timing middleware sends the steps as s-<name> Server-Timing entries.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { STEP_LIMIT, requestMemo, stepTimingEntries, timed, timedFn, withStepTiming } from "../src/api/lib/step-timing.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("outside a request a timed step just runs", async () => {
  assert.equal(await timed("x", async () => 7), 7);
  await assert.rejects(timed("x", async () => { throw new Error("boom"); }), /boom/);
});

test("inside a request every step is recorded — a failed one too — and nothing else changes", async () => {
  const marks = [];
  const out = await withStepTiming(marks, async () => {
    const a = await timed("gl-window", async () => 1);
    const b = await timed("gl-window", async () => 2);
    const f = timedFn("pnl-window", async (x, y) => x * y);
    const c = await f(3, 4);
    await timed("broken", async () => { throw new Error("no"); }).catch(() => null);
    return a + b + c;
  });
  assert.equal(out, 15);
  assert.deepEqual(marks.map((m) => m.name), ["gl-window", "gl-window", "pnl-window", "broken"]);
  assert.ok(marks.every((m) => Number.isInteger(m.ms) && m.ms >= 0));
});

test("two requests keep their own steps", async () => {
  const m1 = [];
  const m2 = [];
  await Promise.all([
    withStepTiming(m1, async () => { await timed("one", async () => new Promise((r) => setTimeout(r, 5))); }),
    withStepTiming(m2, async () => { await timed("two", async () => new Promise((r) => setTimeout(r, 1))); }),
  ]);
  assert.deepEqual(m1.map((m) => m.name), ["one"]);
  assert.deepEqual(m2.map((m) => m.name), ["two"]);
});

test("Server-Timing entries: one per step, time added up, the slowest first, at most STEP_LIMIT", () => {
  const marks = [
    { name: "gl-window", ms: 100 }, { name: "gl-window", ms: 50 },
    { name: "material-replay", ms: 400 }, { name: "bad name!", ms: 1 },
  ];
  assert.deepEqual(stepTimingEntries(marks), [
    's-material-replay;dur=400;desc="1x"',
    's-gl-window;dur=150;desc="2x"',
    's-bad_name_;dur=1;desc="1x"',
  ]);
  const many = Array.from({ length: STEP_LIMIT + 5 }, (_, i) => ({ name: `s${i}`, ms: i }));
  assert.equal(stepTimingEntries(many).length, STEP_LIMIT);
  assert.deepEqual(stepTimingEntries([]), []);
});

test("a read request loads a memoised thing once; a write, a test or cron loads it every time", async () => {
  let loads = 0;
  const load = () => requestMemo("k", async () => { loads += 1; return { n: loads }; });
  // Outside a request (and in a write: no memo) every call loads.
  await load(); await load();
  assert.equal(loads, 2);
  await withStepTiming([], async () => { await load(); await load(); }, { memo: false });
  assert.equal(loads, 4, "a write never shares a copy taken before it wrote");
  // A read: one load, every caller the same result — at the same time too.
  loads = 0;
  const [a, b, c] = await withStepTiming([], async () => Promise.all([load(), load(), load()]), { memo: true });
  assert.equal(loads, 1);
  assert.equal(a, b);
  assert.equal(b, c);
  // Two reads keep their own copies.
  loads = 0;
  await Promise.all([withStepTiming([], load, { memo: true }), withStepTiming([], load, { memo: true })]);
  assert.equal(loads, 2);
});

test("a failed memoised load is forgotten, so the next caller tries again", async () => {
  let tries = 0;
  const flaky = () => requestMemo("f", async () => { tries += 1; if (tries === 1) throw new Error("blip"); return "ok"; });
  const out = await withStepTiming([], async () => {
    await assert.rejects(flaky(), /blip/);
    await new Promise((r) => setTimeout(r, 0));
    return flaky();
  }, { memo: true });
  assert.equal(out, "ok");
  assert.equal(tries, 2);
});

test("the middleware runs each request with its own marks and sends them", () => {
  const obs = read("src/api/lib/observability.ts");
  assert.match(obs, /const stepMarks: StepMark\[\] = \[\];\n\s+try \{\n[\s\S]{0,400}await withStepTiming\(stepMarks, \(\) => next\(\), \{ memo: c\.req\.method === "GET" \}\);/, "reads only get the memo");
  assert.match(obs, /parts\.push\(\.\.\.stepTimingEntries\(stepMarks\)\);\n\s+c\.res\.headers\.set\("Server-Timing", parts\.join\(", "\)\);/);
});

test("the slow reports' helpers are timed (names as they appear in Server-Timing)", () => {
  const api = read("src/api/routes/accounting.ts");
  for (const [fn, label] of [
    ["glWindowSigned", "gl-window"], ["loadMaterialCostData", "material-replay"], ["computePnlWindow", "pnl-window"],
    ["blankMonthStock", "blank-month-stock"], ["runningMonthEstimates", "running-estimates"], ["costByLineWindow", "cost-by-line"],
    ["loadBankRecoState", "bank-reco-state"], ["loadHistoricalPnl", "pnl-history"],
  ]) {
    assert.match(api, new RegExp(`\\nconst ${fn} = timedFn\\("${label}", ${fn}Untimed\\);\\n`), fn);
    assert.match(api, new RegExp(`\\nasync function ${fn}Untimed\\(`), `${fn}: the body is unchanged under a new name`);
  }
  assert.match(read("src/api/lib/production-stock.ts"), /\nexport const loadPreparedProduction = timedFn\("prod-orders", loadPreparedProductionUntimed\);\n/);
  assert.match(api, /\nasync function loadDocDateResolverUntimed\(/);
  assert.match(read("src/api/lib/trade-finance.ts"), /\nexport const loadTfDraws = timedFn\("tf-draws", loadTfDrawsUntimed\);\n/);
});

test("loaded once per read request: document dates, account aliases, labour to date, the ledger's live legs", () => {
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /const loadDocDateResolver = \(db: Env\["Variables"\]\["DB"\]\): Promise<DocDateCtx> =>\n\s+requestMemo\("doc-dates", \(\) => timed\("doc-dates", \(\) => loadDocDateResolverUntimed\(db\)\)\);/);
  assert.match(read("src/api/lib/account-resolver.ts"), /return requestMemo\("account-resolver", \(\) => loadAccountResolverFresh\(db\)\);/);
  assert.match(read("src/api/lib/labour-to-date.ts"), /requestMemo\(`labour-to-date:\$\{orgId\}:\$\{ym\}`, \(\) => timed\("labour-to-date", \(\) => loadLabourToDateUntimed\(db, orgId, ym\)\)\);/);
  const gw = api.slice(api.indexOf("async function glWindowSignedUntimed("), api.indexOf("const glWindowSigned = timedFn("));
  assert.match(gw, /requestMemo\(trace \? "ledger-legs:trace" : "ledger-legs", \(\) => db\.prepare\(trace/);
  assert.match(gw, /requestMemo\("coa-name-type", \(\) => db\.prepare\("SELECT code, name, type FROM chart_of_accounts"\)/);
  // The document dates go out together, not one family after another.
  const dd = api.slice(api.indexOf("async function loadDocDateResolverUntimed("), api.indexOf("const loadDocDateResolver = "));
  assert.match(dd, /Promise\.all\(families\.map\(\(\[, cfg\]\) =>/);
  assert.doesNotMatch(dd, /for \(const \[fam, cfg\] of Object\.entries\(DOC_DATE_FAMILIES\)\)/);
});

test("Daily Cash Position: the bank accounts at once, the trade-finance names in one query", () => {
  const api = read("src/api/routes/accounting.ts");
  const cp = api.slice(api.indexOf('app.get("/cash-position"'), api.indexOf('app.post("/bank-reco/finalize"'));
  assert.match(cp, /const perAccount = await timed\("cp-accounts", \(\) => Promise\.all\(bankAccounts\.map\(async \(a\) => \{\n\s+const warnings: typeof tickWarnings = \[\];/);
  assert.match(cp, /await timed\("cp-open-docs", \(\) => Promise\.all\(\[/);
  assert.match(cp, /await timed\("cp-trade-finance", async \(\) => \{/);
  assert.match(cp, /return \{ row: \{ code: a\.code, name: a\.name, reconciled, bookSen, pendingSen, unbookedSen, unbookedCount, bankEstSen, availableSen, oldPendingSen, oldPendingCount, pending \}, warnings \};/);
  assert.match(cp, /for \(const p of perAccount\) \{\n\s+accounts\.push\(p\.row\);\n\s+tickWarnings\.push\(\.\.\.p\.warnings\);/, "same rows, same order");
  assert.doesNotMatch(cp, /for \(const a of bankAccounts\)/);
  assert.match(cp, /SELECT DISTINCT paymentNo, supplierName FROM supplier_payments WHERE paymentNo IN \(/);
  assert.doesNotMatch(cp, /WHERE paymentNo = \?/, "no query per draw");
});

test("/pl reads the ledger's live legs through the same memo; the stock valuation's rows load once", () => {
  const api = read("src/api/routes/accounting.ts");
  const pl = api.slice(api.indexOf('app.get("/pl",'), api.indexOf("\napp.", api.indexOf('app.get("/pl",') + 10));
  // Without a company filter it is exactly the ledger windows' query.
  assert.match(pl, /const legRes = await \(coFilter\.active \? legQuery\(\) : requestMemo\("ledger-legs", legQuery\)\);/);
  assert.match(pl, /`SELECT accountCode, sourceId, debitSen, creditSen, postedAt, sourceType FROM ledger_journal_entries WHERE hidden = 0\$\{legWhere\}`/);
  assert.match(api, /: "SELECT accountCode, sourceId, debitSen, creditSen, postedAt, sourceType FROM ledger_journal_entries WHERE hidden = 0"\)/, "the windows' query — the same columns, the same rows");
  const li = api.slice(api.indexOf("async function liveInventory("), api.indexOf("\n}\n", api.indexOf("async function liveInventory(")));
  assert.match(li, /requestMemo\("cost-ledger:live-inventory", \(\) => db/);
  assert.match(li, /requestMemo\("raw-materials:groups", \(\) => db/);
});
