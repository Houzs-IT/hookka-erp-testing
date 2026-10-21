// ---------------------------------------------------------------------------
// finance-overview-speed.test.mjs — loading speed, phone and desktop (owner
// 2026-10-19 「优化加载速度，手机和网页版，尤其是overview 和dashboard」).
//
// Measured on prod before the change: /overview-trend took 5.6–7.8 s (84–107
// queries) on EVERY call, phone and desktop; and every accounting tab waited
// for ALL journals with their lines (1.2 s) plus the aging (0.9 s) before it
// could start its own fetch. Now:
//   · /overview-trend keeps its last copy in a snapshot and refreshes it in the
//     background when a source table changes (the /dashboard pattern);
//   · the accounting page loads the journals for the Journals tab only, the
//     aging for Overview / AR / AP only, and a tab waits only for what it is
//     handed.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const ov = read("src/pages/accounting/overview-tab.tsx");
const slice = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `marker ${to}`);
  return src.slice(a, b);
};

test("/overview-trend serves its last copy and refreshes it in the background", () => {
  const route = slice(api, 'app.get("/overview-trend"', "\n});\n");
  assert.match(route, /const \{ withSnapshot \} = await import\("\.\.\/lib\/snapshot"\);/);
  // The table exists before withSnapshot reads it — the dashboard snapshot's shape.
  assert.match(route, /CREATE TABLE IF NOT EXISTS accounting_overview_snapshot \(\n\s+org_id TEXT NOT NULL,\n\s+cache_key TEXT NOT NULL DEFAULT '',\n\s+data TEXT NOT NULL,\n\s+built_from TEXT NOT NULL,\n\s+built_at TEXT NOT NULL DEFAULT '',\n\s+refresh_count INTEGER NOT NULL DEFAULT 0,\n\s+PRIMARY KEY \(org_id, cache_key\)/);
  assert.ok(route.indexOf("CREATE TABLE IF NOT EXISTS accounting_overview_snapshot") < route.indexOf("await withSnapshot("), "created before it is read");
  assert.match(route, /\{ tableName: "accounting_overview_snapshot", sourceTables: \[\.\.\.PNL_REPLAY_SOURCE_TABLES, "sales_orders"\] \}/);
  assert.match(route, /\(\) => computeOverviewTrend\(db, snapOrgId, runYm, months\),/);
  // The range and the running month are in the key: a new month is a new window.
  assert.match(route, /`\$\{OVERVIEW_PAYLOAD_V\}:\$\{n\}:\$\{runYm\}:\$\{snapOrgId\}`,\n\s+c,\n\s+\{ staleWhileRevalidate: true \},/);
  assert.match(route, /return c\.json\(\{ success: true, data: payload \}\);/, "the same envelope as before");
  // The figures themselves are unchanged — the compute is the old body.
  const compute = slice(api, "async function computeOverviewTrend(", "\n}\n");
  assert.match(compute, /await computePnlWindow\(db, orgId, ym, ym, "all", matData, dc, override\)/);
  assert.match(compute, /return \{ months: out, runningYm: runYm \};/);
});

test("one list of the P&L replay's source tables, shared by /dashboard and /overview-trend", () => {
  const list = slice(api, "const PNL_REPLAY_SOURCE_TABLES: readonly string[] = [", "];");
  const names = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  for (const t of ["ledger_journal_entries", "invoices", "purchase_invoices", "kv_config", "payslips", "working_hour_entries", "job_cards", "products", "stock_take", "pnl_historical"]) {
    assert.ok(names.includes(t), `a write to ${t} must refresh the P&L snapshots`);
  }
  assert.equal(new Set(names).size, names.length, "no table twice");
  const dash = slice(api, 'app.get("/dashboard"', 'app.get("/forecast"');
  assert.match(dash, /tableName: "accounting_dashboard_snapshot",[\s\S]{0,400}sourceTables: PNL_REPLAY_SOURCE_TABLES,/);
});

test("the accounting page loads the journals for the Journals tab and the aging for Overview / AR / AP only", () => {
  const page = slice(ui, "export default function AccountingPage() {", "\n}\n");
  assert.match(page, /const needsJournals = tab === "journals";/);
  assert.match(page, /const needsAging = tab === "overview" \|\| tab === "ar" \|\| tab === "ap";/);
  assert.match(page, /useCachedJson<\{ success\?: boolean; data\?: JournalEntry\[\] \}>\(needsJournals \? "\/api\/accounting\/journals" : null\)/);
  assert.match(page, /\(needsAging \? "\/api\/accounting\/aging" : null\)/);
  // A tab waits only for what it is handed; the Overview never waits for the
  // aging (its cards say Loading… instead).
  assert.match(page, /const loading = \(TABS_WITH_ACCOUNTS\.has\(tab\) && coaLoading\) \|\| jePending \|\| \(agingPending && tab !== "overview"\);/);
  assert.match(page, /const jePending = needsJournals && \(jeLoading \|\| \(!jeResp && !jeError\)\);/, "a load just switched on still reads as loading");
  assert.match(page, /<OverviewTab arData=\{arData\} apData=\{apData\} agingLoading=\{agingPending\} \/>/);
});

test("every tab handed the chart of accounts waits for it — and only those", () => {
  const page = slice(ui, "export default function AccountingPage() {", "\n}\n");
  const renders = page.slice(page.indexOf('{tab === "overview" && ('));
  const handed = new Set();
  const all = new Set();
  for (const chunk of renders.split('{tab === "').slice(1)) {
    const key = chunk.slice(0, chunk.indexOf('"'));
    all.add(key);
    // The chunk runs to the next tab's render.
    if (/accounts=\{accounts\}/.test(chunk)) handed.add(key);
  }
  const listed = new Set([...slice(ui, "const TABS_WITH_ACCOUNTS = new Set<TabKey>([", "]);").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(all.size > 30, "the renders were found");
  assert.deepEqual([...listed].sort(), [...handed].sort(), "TABS_WITH_ACCOUNTS = the tabs rendered with accounts={accounts}");
});

test("the Overview's aging cards say Loading… while the aging loads, never zero buckets", () => {
  assert.match(ov, /export function OverviewTab\(\{ arData, apData, agingLoading = false \}/);
  assert.match(ov, /\{loading \? <div className="py-6 text-center text-sm text-\[#9CA3AF\]">Loading…<\/div> : \(/);
  assert.equal((ov.match(/loading=\{agingLoading\} \/>/g) ?? []).length, 2, "both cards");
});
