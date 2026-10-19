// ---------------------------------------------------------------------------
// fiscal-year-lock.test.mjs — closed-year lock (finance backlog item 9 part
// B; the design's "Close Year: the P&L moves into Retained Earnings and the
// year is locked"). Close Year posts the year-end close and locks the year;
// from then on nothing dated in it can be posted, edited, voided or restored
// (every ledger posting passes buildJournalEntryStatements with its document
// date; void / restore / delete pass applyLifecycle the same), and its stock
// take can't change; a Super Admin's Reopen takes the lock off. The routes
// run against the in-memory ledger of tests/_ledger-mock.mjs. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { makeLedgerDb, mountAccounting, post, visible } from "./_ledger-mock.mjs";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fy = await import(pathToFileURL(resolve(process.cwd(), "src/lib/fiscal-year.ts")).href);
const fiscal = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/fiscal.ts")).href);
const jh = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/journal-hash.ts")).href);

const AUG = { fyeMonth: 8, changes: [] };

test("which locked year holds a date; what a refusal says", () => {
  const locked = new Set(["2026-08"]);
  assert.equal(fy.lockedYearFor("2026-07-31", AUG, locked).name, "FY 2025/26");
  assert.equal(fy.lockedYearFor("2025-09", AUG, locked).name, "FY 2025/26", "a month too");
  assert.equal(fy.lockedYearFor("2026-09-01", AUG, locked), null, "the next year is open");
  assert.equal(fy.lockedYearFor("2025-08-31", AUG, locked), null, "the year before is not locked");
  assert.equal(fy.lockedYearFor("", AUG, locked), null);
  assert.equal(fy.lockedYearFor("2026-07-31", AUG, new Set()), null);
  assert.match(fy.closedYearMessage({ name: "FY 2025/26" }), /^FY 2025\/26 is closed — documents dated in it can't be posted or changed\. A Super Admin can reopen it in Settings › Financial Years\.$/);
});

// A minimal db: kv reads, and the chain head for buildJournalEntryStatements.
const kvDb = (kv) => ({
  prepare(sql) {
    return {
      bind(...a) {
        return {
          first: async () => {
            if (/FROM kv_config WHERE key = \?/.test(sql)) return kv[a[0]] === undefined ? null : { value: kv[a[0]] };
            if (/SELECT rowHash FROM ledger_journal_entries/.test(sql)) return null;
            return null;
          },
          all: async () => ({ results: [] }),
        };
      },
    };
  },
});

test("the check every posting runs: a date in a locked year is refused; open years and undated postings pass", async () => {
  const db = kvDb({ fye_month: JSON.stringify({ month: 8 }), fy_locked_ends: JSON.stringify(["2026-08"]) });
  assert.match(await fiscal.closedYearError(db, "2026-05-10"), /FY 2025\/26 is closed/);
  assert.match(await fiscal.closedYearError(db, ["2026-09-10", "2026-05-10"]), /FY 2025\/26 is closed/, "an edit: the old date counts too");
  assert.equal(await fiscal.closedYearError(db, "2026-09-10"), null);
  assert.equal(await fiscal.closedYearError(db, null), null, "the year-end close itself has no document date");
  assert.equal(await fiscal.closedYearError(kvDb({}), "2026-05-10"), null, "nothing locked");
  const leg = { id: "lje-1", sourceType: "manual", sourceId: "je-1", legNo: 1, accountCode: "600-1000", debitSen: 100, creditSen: 0, orgId: "hookka" };
  await assert.rejects(() => jh.buildJournalEntryStatements(db, "hookka", [leg], { docDate: "2026-05-10" }), (e) => e.name === "ClosedYearError" && /FY 2025\/26 is closed/.test(e.message));
  const ok = await jh.buildJournalEntryStatements(db, "hookka", [leg], { docDate: "2026-09-10" });
  assert.equal(ok.stamped.length, 1);
  assert.deepEqual(await jh.buildJournalEntryStatements(db, "hookka", [], { docDate: "2026-05-10" }), { statements: [], stamped: [] }, "nothing to post, nothing refused");
});

const KV = { fye_month: JSON.stringify({ month: 8 }) };
const receipt = (date) => ({ date, receivedFrom: "A buyer", description: "Scrap sale", payTo: "310-0001", lines: [{ accountCode: "520-0001", description: "scrap", amountSen: 50000 }] });

test("routes: a closed year takes no new receipt, edit, void or restore; Reopen lets them through again", async () => {
  const db = makeLedgerDb({ kv: KV });
  const app = mountAccounting(db);
  const created = await post(app, "/official-receipts", receipt("2026-07-05"));
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = (await created.json()).data;

  // FY 2025/26 (to 31 Aug 2026) is closed.
  db.st.kv.set("fy_locked_ends", JSON.stringify(["2026-08"]));
  const legs = db.st.legs.length;
  const add = await post(app, "/official-receipts", receipt("2026-08-20"));
  assert.equal(add.status, 400);
  assert.match((await add.json()).error, /FY 2025\/26 is closed/);
  const edit = await post(app, `/official-receipts/${id}/restate`, receipt("2026-07-06"));
  assert.equal(edit.status, 400);
  assert.match((await edit.json()).error, /FY 2025\/26 is closed/);
  const moveOut = await post(app, `/official-receipts/${id}/restate`, receipt("2026-09-02"));
  assert.equal(moveOut.status, 400, "moving it out of the closed year changes the closed year too");
  const voided = await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.equal(voided.status, 400);
  assert.match((await voided.json()).error, /FY 2025\/26 is closed/);
  assert.equal(db.st.legs.length, legs, "nothing written");
  assert.equal(visible(db.st, id).length, 2, "the receipt stands as it was");
  // The next year is open.
  const next = await post(app, "/official-receipts", receipt("2026-09-10"));
  assert.equal(next.status, 201, await next.clone().text());

  // Reopened: the void goes through.
  db.st.kv.set("fy_locked_ends", JSON.stringify([]));
  const v2 = await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.equal(v2.status, 200, await v2.clone().text());
  // Closed again: no restore.
  db.st.kv.set("fy_locked_ends", JSON.stringify(["2026-08"]));
  const un = await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.equal(un.status, 400);
});

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("every posting names its document date; void / restore / delete too", () => {
  // The compiler holds every call to it (the 4th argument is required); spot-check the families.
  assert.match(read("src/api/lib/journal-hash.ts"), /export type PostingContext = \{ docDate: string \| null \| readonly \(string \| null\)\[\] \};/);
  assert.match(read("src/api/lib/journal-hash.ts"), /await assertYearOpen\(db as unknown as Parameters<typeof assertYearOpen>\[0\], ctx\?\.docDate \?\? null\);/);
  assert.match(read("src/api/lib/document-lifecycle.ts"), /docDate: string \| null;\n\s*\},\n\): Promise<\{ statements: D1PreparedStatement\[\]; newState: DocState; prevState: DocState \}> \{\n\s*const \{[^}]*docDate \} = opts;\n\s*await assertYearOpen\(db, docDate\);/);
  for (const [f, re] of [
    ["src/api/routes/accounting.ts", /buildJournalEntryStatements\(c\.var\.DB, orgId, \[\.\.\.revLegs, \.\.\.newLegs\], \{ docDate: \[pv\.date \?\? null, date\] \}\)/],
    ["src/api/routes/accounting.ts", /lc = await applyLifecycle\(c\.var\.DB, \{ orgId, docDate: entry\.date, baseSourceTypes: \["manual"\]/],
    ["src/api/routes/accounting.ts", /buildJournalEntryStatements\(c\.var\.DB, orgId, legs, \{ docDate: month \}\)/],
    ["src/api/routes/supplier-payments.ts", /buildJournalEntryStatements\(db, orgId, legs, \{ docDate: date \}\)/],
    ["src/api/routes/payments.ts", /docDate: existing\.date \?\? null,\n\s*baseSourceTypes: \["payment"\],/],
    ["src/api/routes/purchase-invoices.ts", /buildJournalEntryStatements\(db, legOrgId \?\? getOrgId\(c\), revLegs, \{ docDate: pi\.invoiceDate \?\? null \}\)/],
    ["src/api/routes/invoices.ts", /buildJournalEntryStatements\(db, legOrg \?\? fallbackOrgId, legs, \{ docDate: invDate \}\)/],
    ["src/api/routes/credit-notes.ts", /buildJournalEntryStatements\(c\.var\.DB, orgId, legs, \{ docDate: existing\.date \?\? null \}\)/],
  ]) assert.match(read(f), re, f);
  // A refusal anywhere is a 400 with its reason.
  assert.match(read("src/api/worker.ts"), /if \(err && \(err as \{ name\?: string \}\)\.name === "ClosedYearError"\) \{\n\s*return c\.json\(\{ success: false, error: \(err as Error\)\.message \}, 400\);/);
  // The stock take of a closed year keeps its figures.
  assert.match(slice(api, 'app.put("/stock-take",', 'app.post("/stock-take-item-alias-seed"'), /const lockedYear = await closedYearError\(c\.var\.DB, ym\);\n\s*if \(lockedYear\) return c\.json\(\{ success: false, error: lockedYear \}, 400\);/);
});

test("Close Year posts the close then locks; Reopen (Super Admin) only unlocks; the list says which", () => {
  const close = slice(api, 'app.post("/fiscal-years/close"', 'app.post("/fiscal-years/reopen"');
  assert.match(close, /requirePermission\(c, "accounting", "create"\)/);
  assert.match(close, /if \(fy\.endYm >= runningMonthYm\(\)\) return c\.json\(\{ success: false, error: `\$\{fy\.name\} has not ended yet\.` \}, 400\);/);
  assert.match(close, /const sourceId = n === 0 \? `fyclose-\$\{fyEndIso\}` : `fyclose-\$\{fyEndIso\}-r\$\{n \+ 1\}`;/, "after a reopen, only what was added since");
  assert.ok(close.indexOf("await db.batch(statements);") < close.indexOf("await setFyLocked(db, fy.endYm, true);"), "posted first, locked after");
  const reopen = slice(api, 'app.post("/fiscal-years/reopen"', "\napp.");
  assert.match(reopen, /if \(role !== "SUPER_ADMIN"\) return c\.json\(\{ success: false, error: "Only a Super Admin can reopen a closed year\." \}, 403\);/);
  assert.match(reopen, /const locked = await setFyLocked\(db, endYm, false\);/);
  assert.doesNotMatch(reopen, /buildJournalEntryStatements|year_close/, "the close entry stays");
  // The Balance Sheet's Year-End Close locks the year too.
  assert.match(slice(api, 'app.post("/year-close"', 'app.post("/fiscal-years/close"'), /await setFyLocked\(c\.var\.DB, fyEndIso\.slice\(0, 7\), true\);/);
  const list = slice(api, 'app.get("/fiscal-years"', 'app.put("/fiscal-years/year-end"');
  assert.match(list, /status: locked\.has\(y\.endYm\) \? "closed" : posted\.has\(y\.endYm\) \? "reopened" :/);
  const card = read("src/pages/accounting/tabs/FinancialYearsCard.tsx");
  assert.match(card, /\{\(y\.status === "open" \|\| y\.status === "reopened"\) && data\?\.canCloseYear && \(/);
  assert.match(card, /\{y\.status === "closed" && data\?\.canReopenYear && \(/);
});
