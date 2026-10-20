// ---------------------------------------------------------------------------
// Fixed Assets: undo a month's depreciation, restore a disposed asset, export
// the month's depreciation list (owner 2026-10-20, from the design list
// 「这个要做」). An undo reverses each run of the month leg by leg under
// depreciation_reversal (the labour undo's shape — Journal Entries folds the
// pair into one REVERSED · UNDONE row, the reports net the month to nothing),
// drops the month's register rows so the month can be run again, and is
// allowed on the latest posted month only. A restore posts nothing (neither
// does a dispose). Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const { depreciationUndoLegs, depreciationUndoBlock } = await import(src("src/lib/fixed-asset-undo.ts"));
const { foldUndone, buildSystemJournals } = await import(src("src/lib/system-journals.ts"));
const { stripLegSuffix, parseSourceIdDate } = await import(src("src/lib/doc-date.ts"));
const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const leg = (sourceType, sourceId, accountCode, debitSen, creditSen, description = "Depreciation 2026-09 · Lorry") =>
  ({ sourceType, sourceId, accountCode, debitSen, creditSen, description });

test("the undo legs: every standing run of the month, mirrored leg by leg; other months and undone runs left alone", () => {
  const legs = [
    leg("depreciation", "dep-2026-09-100", "780-0080", 5000, 0),
    leg("depreciation", "dep-2026-09-100", "290-0010", 0, 5000),
    leg("depreciation", "dep-2026-09-200", "900-D001", 1200, 0, "Depreciation 2026-09 · Laptop"),
    leg("depreciation", "dep-2026-09-200", "290-0020", 0, 1200, "Depreciation 2026-09 · Laptop"),
    // An earlier run of the month already undone — not reversed twice.
    leg("depreciation", "dep-2026-09-050", "780-0080", 700, 0),
    leg("depreciation", "dep-2026-09-050", "290-0010", 0, 700),
    leg("depreciation_reversal", "dep-2026-09-050", "780-0080", 0, 700),
    leg("depreciation_reversal", "dep-2026-09-050", "290-0010", 700, 0),
    // Another month.
    leg("depreciation", "dep-2026-08-100", "780-0080", 5000, 0),
  ];
  assert.deepEqual(depreciationUndoLegs(legs, "2026-09"), [
    { sourceId: "dep-2026-09-100", accountCode: "780-0080", debitSen: 0, creditSen: 5000, description: "Depreciation 2026-09 · Lorry · undone" },
    { sourceId: "dep-2026-09-100", accountCode: "290-0010", debitSen: 5000, creditSen: 0, description: "Depreciation 2026-09 · Lorry · undone" },
    { sourceId: "dep-2026-09-200", accountCode: "900-D001", debitSen: 0, creditSen: 1200, description: "Depreciation 2026-09 · Laptop · undone" },
    { sourceId: "dep-2026-09-200", accountCode: "290-0020", debitSen: 1200, creditSen: 0, description: "Depreciation 2026-09 · Laptop · undone" },
  ]);
  assert.deepEqual(depreciationUndoLegs(legs, "2026-07"), []);
});

test("months are undone latest first, and only a month with a posting", () => {
  assert.equal(depreciationUndoBlock("2026-09", "2026-09", true), null);
  assert.equal(depreciationUndoBlock("2026-08", "2026-09", true), "Undo 2026-09 first — months are undone latest first.");
  assert.equal(depreciationUndoBlock("2026-10", "2026-09", false), "No depreciation is posted for 2026-10.");
  assert.equal(depreciationUndoBlock("2026-09", null, false), "No depreciation is posted for 2026-09.");
});

test("the undo dates on the month and folds with its run on Journal Entries", () => {
  assert.equal(stripLegSuffix("depreciation_reversal"), "depreciation");
  assert.equal(parseSourceIdDate("depreciation_reversal", "dep-2026-09-100"), "2026-09-30", "dated to the month's last day, like the run");
  const legs = [
    { ...leg("depreciation", "dep-2026-09-100", "780-0080", 5000, 0), postedAt: "2026-10-01T01:00:00Z" },
    { ...leg("depreciation", "dep-2026-09-100", "290-0010", 0, 5000), postedAt: "2026-10-01T01:00:00Z" },
    { ...leg("depreciation_reversal", "dep-2026-09-100", "780-0080", 0, 5000), postedAt: "2026-10-02T01:00:00Z" },
    { ...leg("depreciation_reversal", "dep-2026-09-100", "290-0010", 5000, 0), postedAt: "2026-10-02T01:00:00Z" },
  ];
  const list = buildSystemJournals(legs, () => "", () => "2026-09-30");
  assert.equal(list.length, 1, "one row for the pair");
  assert.equal(list[0].status, "REVERSED");
  assert.equal(list[0].system.label, "Depreciation");
  assert.ok(list[0].system.undoneAt);
  assert.equal(typeof foldUndone, "function");
});

// ---------------------------------------------------------------------------
// The routes, against an in-memory database that throws on any SQL it does
// not know (a route that starts sending something new fails loudly).
// ---------------------------------------------------------------------------

function makeDb({ assets = [], depRows = [], legs = [] } = {}) {
  const st = { assets: assets.map((a) => ({ ...a })), depRows: depRows.map((d) => ({ ...d })), legs: legs.map((l) => ({ hidden: 0, orgId: "hookka", legNo: 1, ...l })), audits: [] };
  const exec = (raw, a, mode) => {
    const s = raw.replace(/\s+/g, " ").trim();
    if (/FROM kv_config/.test(s)) return mode === "all" ? [] : null;
    if (s === "SELECT * FROM fixed_assets WHERE id = ?") return st.assets.find((x) => x.id === a[0]) ?? null;
    if (s === "UPDATE fixed_assets SET disposedAt = NULL, updated_at = ? WHERE id = ?") {
      const x = st.assets.find((y) => y.id === a[1]); if (x) x.disposedAt = null; return null;
    }
    if (s === "UPDATE fixed_assets SET disposedAt = ?, updated_at = ? WHERE id = ?") {
      const x = st.assets.find((y) => y.id === a[2]); if (x) x.disposedAt = a[0]; return null;
    }
    if (s === "SELECT id, assetId, amountSen FROM fixed_asset_depreciation WHERE month = ?") return st.depRows.filter((d) => d.month === a[0]);
    if (s === "SELECT MAX(month) AS m FROM fixed_asset_depreciation") return { m: st.depRows.map((d) => d.month).sort().pop() ?? null };
    if (s === "DELETE FROM fixed_asset_depreciation WHERE month = ?") { st.depRows = st.depRows.filter((d) => d.month !== a[0]); return null; }
    if (/^SELECT sourceType, sourceId, accountCode, debitSen, creditSen, description FROM ledger_journal_entries WHERE orgId = \? AND sourceType IN \('depreciation', 'depreciation_reversal'\) AND sourceId LIKE \? AND hidden = 0$/.test(s)) {
      const pre = String(a[1]).replace(/%$/, "");
      return st.legs.filter((l) => l.orgId === a[0] && (l.sourceType === "depreciation" || l.sourceType === "depreciation_reversal") && l.sourceId.startsWith(pre) && l.hidden === 0);
    }
    if (/^SELECT COALESCE\(MAX\(legNo\), 0\) AS n FROM ledger_journal_entries WHERE orgId = \? AND sourceType = \? AND sourceId = \?$/.test(s)) {
      return { n: Math.max(0, ...st.legs.filter((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]).map((l) => l.legNo)) };
    }
    if (/^SELECT rowHash FROM ledger_journal_entries/.test(s)) return null;
    if (/^SELECT pg_advisory_xact_lock/.test(s)) return null;
    if (/^INSERT INTO ledger_journal_entries/.test(s)) {
      st.legs.push({ id: a[0], sourceType: a[1], sourceId: a[2], legNo: a[3], accountCode: a[4], debitSen: a[5], creditSen: a[6], description: a[7], orgId: a[11], hidden: 0 });
      return null;
    }
    if (/^SELECT displayName FROM users/.test(s)) return null;
    if (/^INSERT INTO audit_events/.test(s)) { st.audits.push({ resource: a[4], resourceId: a[5], action: a[6] }); return null; }
    throw new Error(`fake db: unknown SQL: ${s}`);
  };
  const prepare = (sql) => {
    let args = [];
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() { return exec(sql, args, "first"); },
      async all() { return { results: exec(sql, args, "all") ?? [] }; },
      async run() { exec(sql, args, "run"); return { success: true }; },
    };
    return stmt;
  };
  return { db: { prepare, batch: async (stmts) => { for (const x of stmts) await x.run(); return []; } }, st };
}

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/api/accounting", accountingApp);
  return async (method, path, body) => {
    const res = await parent.request(`/api/accounting${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, {});
    return { status: res.status, body: await res.json() };
  };
}

const runLegs = [
  { sourceType: "depreciation", sourceId: "dep-2026-09-100", legNo: 1, accountCode: "780-0080", debitSen: 5000, creditSen: 0, description: "Depreciation 2026-09 · Lorry" },
  { sourceType: "depreciation", sourceId: "dep-2026-09-100", legNo: 2, accountCode: "290-0010", debitSen: 0, creditSen: 5000, description: "Depreciation 2026-09 · Lorry" },
  { sourceType: "depreciation", sourceId: "dep-2026-08-100", legNo: 1, accountCode: "780-0080", debitSen: 5000, creditSen: 0, description: "Depreciation 2026-08 · Lorry" },
  { sourceType: "depreciation", sourceId: "dep-2026-08-100", legNo: 2, accountCode: "290-0010", debitSen: 0, creditSen: 5000, description: "Depreciation 2026-08 · Lorry" },
];
const depRows = [
  { id: "fad-1", assetId: "fa-1", month: "2026-08", amountSen: 5000 },
  { id: "fad-2", assetId: "fa-1", month: "2026-09", amountSen: 5000 },
];

test("Undo the latest month: its run reversed, its register rows gone, audited; an earlier month waits", async () => {
  const { db, st } = makeDb({ depRows, legs: runLegs });
  const call = mount(db);
  const early = await call("POST", "/fixed-assets/depreciation-undo", { month: "2026-08" });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /Undo 2026-09 first/);
  const r = await call("POST", "/fixed-assets/depreciation-undo", { month: "2026-09" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data, { month: "2026-09", assets: 1, totalSen: 5000, reversedLegs: 2 });
  const rev = st.legs.filter((l) => l.sourceType === "depreciation_reversal");
  assert.deepEqual(rev.map((l) => [l.sourceId, l.legNo, l.accountCode, l.debitSen, l.creditSen]), [
    ["dep-2026-09-100", 1, "780-0080", 0, 5000],
    ["dep-2026-09-100", 2, "290-0010", 5000, 0],
  ]);
  assert.deepEqual(st.depRows.map((d) => d.month), ["2026-08"], "the month can be run again; August stays");
  assert.ok(st.legs.filter((l) => l.sourceType === "depreciation").length === 4, "the run's own legs are kept");
  assert.deepEqual(st.audits, [{ resource: "fixed-assets", resourceId: "dep-2026-09", action: "unpost" }]);
  // Now August is the latest — and September has nothing left to undo.
  const again = await call("POST", "/fixed-assets/depreciation-undo", { month: "2026-09" });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /No depreciation is posted for 2026-09/);
  assert.equal((await call("POST", "/fixed-assets/depreciation-undo", { month: "9/2026" })).status, 400);
});

test("Restore a disposed asset: back in use, nothing posted, audited; one in use cannot be restored", async () => {
  const asset = { id: "fa-1", name: "Lorry", disposedAt: "2026-09-15T00:00:00Z" };
  const { db, st } = makeDb({ assets: [asset, { id: "fa-2", name: "Laptop", disposedAt: null }] });
  const call = mount(db);
  const r = await call("PUT", "/fixed-assets/fa-1", { restore: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(st.assets[0].disposedAt, null);
  assert.equal(st.legs.length, 0, "a restore posts nothing");
  assert.deepEqual(st.audits, [{ resource: "fixed-assets", resourceId: "fa-1", action: "restore" }]);
  const live = await call("PUT", "/fixed-assets/fa-2", { restore: true });
  assert.equal(live.status, 409);
  assert.match(live.body.error, /Laptop is not disposed/);
});

test("the page: the posted month's list with Undo (latest month only), restore on a disposed asset, the month's Excel", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const fa = ui.slice(ui.indexOf("function FixedAssetsTab("), ui.indexOf("// =============== TAB: CASH BOOK"));
  assert.match(fa, /\{preview\.latestPostedMonth === runMonth \? \(\n\s+<Button variant="outline" size="sm" disabled=\{undoing\} onClick=\{handleUndo\}>/);
  assert.match(fa, /fetch\("\/api\/accounting\/fixed-assets\/depreciation-undo", \{\n\s+method: "POST",/);
  assert.match(fa, /confirmLabel: "Undo",\n\s+danger: true,/);
  assert.match(fa, /<button onClick=\{\(\) => handleRestore\(r\)\}[^>]*>restore<\/button>/);
  assert.match(fa, /body: JSON\.stringify\(\{ restore: true \}\),/);
  assert.match(fa, /\["Month", "Asset", "Asset account", "DR expense", "CR accum\. depn", "Amount \(RM\)", "Status"\]/);
  assert.match(fa, /label: `\$\{mLabel\} depreciation \(Excel\)`/);
  assert.match(read("src/lib/system-journals.ts"), /depreciation_reversal: \{ label: "Depreciation undone", tab: "assets" \},/);
  assert.match(read("src/lib/change-log.ts"), /restore: "Restored",/);
});
