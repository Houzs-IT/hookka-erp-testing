// ---------------------------------------------------------------------------
// finance-report-snapshot.test.mjs — the P&L hub's views and the Balance Sheet
// kept in a snapshot like the Overview (owner 2026-10-19: asked whether to
// 「也像 Overview 那样存结果」 → 「要」). The last copy is served at once and
// refreshed in the background when a source table changes or it is older than
// 15 minutes; Edit Layout stays live; a report-setting write clears the copies.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { withSnapshot } from "../src/api/lib/snapshot.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");

// A tiny SQL-routing mock (the shape tests/snapshot-swr.test.mjs uses): the
// freshness probe says the sources have not changed since the copy was built.
function makeDb(snapshotRow) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return sql.includes("SELECT * FROM") ? snapshotRow : null; },
        async all() {
          if (sql.includes("information_schema")) return { results: [{ tableName: "ledger_journal_entries", columnName: "updated_at" }] };
          if (sql.includes("AS t")) return { results: [{ t: "2020-01-01T00:00:00.000Z" }] };
          return { results: [] };
        },
        async run() { return {}; },
      };
    },
  };
}
const CONFIG = { tableName: "accounting_report_snapshot", sourceTables: ["ledger_journal_entries"] };
const row = (builtAt) => ({ data: { v: "stored" }, builtFrom: "2030-01-01T00:00:00.000Z", builtAt, refreshCount: 1 });
const run = async (snapshotRow, maxAgeMs) => {
  const bg = [];
  let computed = 0;
  const out = await withSnapshot(
    makeDb(snapshotRow), CONFIG, "org1",
    async () => { computed += 1; return { v: "fresh" }; },
    "k", { env: {}, executionCtx: { waitUntil: (p) => bg.push(p) } },
    { staleWhileRevalidate: true, maxAgeMs },
  );
  await Promise.all(bg);
  return { out, refreshes: bg.length, computed };
};

test("a copy the sources call current but older than the age limit is served once and refreshed behind", async () => {
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const r = await run(row(old), 15 * 60 * 1000);
  assert.deepEqual(r.out, { v: "stored" }, "the stored copy, at once");
  assert.equal(r.refreshes, 1);
  assert.equal(r.computed, 1);
});

test("within the age limit the copy is simply served; without a limit, age never counts", async () => {
  const recent = new Date(Date.now() - 60 * 1000).toISOString();
  const a = await run(row(recent), 15 * 60 * 1000);
  assert.deepEqual([a.out, a.refreshes, a.computed], [{ v: "stored" }, 0, 0]);
  const b = await run(row("2020-01-01T00:00:00.000Z"), undefined);
  assert.deepEqual([b.out, b.refreshes, b.computed], [{ v: "stored" }, 0, 0], "the other snapshots are unchanged");
});

test("an unreadable build time counts as too old — refresh, never trust", async () => {
  const r = await run(row("not a date"), 15 * 60 * 1000);
  assert.equal(r.refreshes, 1);
});

test("the four views go through the snapshot; their own handlers are unchanged bodies", () => {
  assert.match(api, /app\.get\("\/pl-statement", \(c\) => reportSnapshot\(c, "pl-statement", plStatementResponse, c\.req\.query\("editable"\) === "1"\)\);\nasync function plStatementResponse\(c: AccountingCtx\) \{/, "Edit Layout stays live");
  assert.match(api, /app\.get\("\/pl-monthly", \(c\) => reportSnapshot\(c, "pl-monthly", plMonthlyResponse\)\);\nasync function plMonthlyResponse\(c: AccountingCtx\) \{/);
  assert.match(api, /app\.get\("\/cost-structure", \(c\) => reportSnapshot\(c, "cost-structure", costStructureResponse\)\);\nasync function costStructureResponse\(c: AccountingCtx\) \{/);
  assert.match(api, /app\.get\("\/pl", \(c\) => reportSnapshot\(c, "pl", plBalanceSheetResponse\)\);\nasync function plBalanceSheetResponse\(c: AccountingCtx\) \{/);
  // Daily Cash Position stays live (ticked daily).
  assert.match(api, /app\.get\("\/cash-position", async \(c\) => \{/);
});

test("the snapshot layer: the same gate first, every query parameter in the key, errors never stored", () => {
  const fn = api.slice(api.indexOf("async function reportSnapshot("), api.indexOf("async function clearReportSnapshots("));
  assert.ok(fn.indexOf('requirePermission(c, "accounting", "read")') < fn.indexOf("withSnapshot("), "the gate before any stored copy");
  assert.match(fn, /if \(live\) return respond\(c\);/);
  assert.match(fn, /\.sort\(\(\[a, av\], \[b, bv\]\) => a\.localeCompare\(b\) \|\| av\.localeCompare\(bv\)\)/);
  assert.match(fn, /const key = `\$\{REPORT_SNAPSHOT_V\}:\$\{view\}:\$\{runningMonthYm\(\)\}:\$\{params\}:\$\{orgId\}`;/);
  assert.match(fn, /if \(res\.status !== 200\) throw new ReportNotStored\(res\.status, text\);/);
  assert.match(fn, /if \(json\.success === false\) throw new ReportNotStored\(res\.status, text\);/);
  assert.match(fn, /\{ staleWhileRevalidate: true, maxAgeMs: REPORT_SNAPSHOT_MAX_AGE_MS \}/);
  assert.match(api, /const REPORT_SNAPSHOT_MAX_AGE_MS = 15 \* 60 \* 1000;/);
  const tables = api.slice(api.indexOf("const reportSnapshotSourceTables = (): readonly string[] => ["), api.indexOf("];", api.indexOf("const reportSnapshotSourceTables")));
  assert.match(tables, /\.\.\.PNL_REPLAY_SOURCE_TABLES,/);
  for (const t of ["chart_of_accounts", "account_aliases", "invoice_items", "purchase_invoice_items", "raw_materials", "material_opening_stock", "inventory_opening", "fixed_assets"]) {
    assert.ok(tables.includes(`"${t}"`), t);
  }
});

test("a report-setting write clears the stored copies; a day-to-day posting does not", () => {
  const list = api.slice(api.indexOf("const REPORT_SETTING_WRITES: readonly RegExp[] = ["), api.indexOf("];", api.indexOf("const REPORT_SETTING_WRITES")));
  const res = [...list.matchAll(/\/\^(.+?)\$\//g)].map((m) => new RegExp(`^${m[1]}$`));
  const clears = (p) => res.some((re) => re.test(p));
  for (const p of ["/pnl/section-map", "/bs/section-map", "/coa", "/coa/rename", "/stock-take", "/fg-valuation-mode", "/rm-valuation-mode",
    "/material-opening-stock", "/opening-balance/post", "/opening-balance/ar/x1", "/opening-date", "/year-close", "/fiscal-years/close", "/fiscal-years/year-end", "/stock/close-post"]) {
    assert.ok(clears(p), `${p} clears`);
  }
  for (const p of ["/payment-vouchers", "/journals", "/official-receipts", "/cash-position/tick", "/bank-reco/match", "/stock-take-item-alias-seed"]) {
    assert.ok(!clears(p), `${p} keeps the copies (refreshed behind, the owner's trade-off)`);
  }
  // Registered before the routes, after a successful non-GET only.
  const app = api.indexOf("const app = new Hono<Env>();");
  const mw = api.indexOf('app.use("*", async (c, next) => {');
  assert.ok(mw > app && mw < api.indexOf('app.get("/aging"'), "the middleware wraps every accounting route");
  assert.match(api, /if \(c\.req\.method === "GET" \|\| c\.res\.status >= 400\) return;/);
  assert.match(api, /async function clearReportSnapshots\(db: Env\["Variables"\]\["DB"\], orgId: string\): Promise<void> \{\n\s+await db\.prepare\(`DELETE FROM \$\{REPORT_SNAPSHOT_TABLE\} WHERE org_id = \?`\)\.bind\(orgId\)\.run\(\)\.catch\(\(\) => \{\}\);/);
});
