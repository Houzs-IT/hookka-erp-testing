// ---------------------------------------------------------------------------
// Settings › Trade Finance Lines (owner 2026-10-20 「暂时rm300,000」 — the
// design list's "Trade Finance limit per lender line"): each line's default
// tenor and a limit the owner keys himself. Used = drawn and not repaid (the
// line's account balance); Available = limit − used. Creditor Aging's block
// shows them; the AP Payment form warns (never blocks) when a drawdown goes
// over. Saving posts nothing. Made-up figures only.
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
const { tfLineRoom, tfOverLimitWarning } = await import(src("src/lib/trade-finance.ts"));
const { getTfSources, parseTfLimitSen } = await import(src("src/api/lib/trade-finance.ts"));
const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const fmt = (sen) => `RM ${(sen / 100).toFixed(2)}`;

test("a line's room: limit − what is drawn and not repaid; no limit, no figure", () => {
  assert.deepEqual(tfLineRoom(30000000, 12500000), { limitSen: 30000000, usedSen: 12500000, availableSen: 17500000 });
  assert.deepEqual(tfLineRoom(10000, 15000), { limitSen: 10000, usedSen: 15000, availableSen: -5000 }, "over the limit reads negative");
  assert.equal(tfLineRoom(null, 5000), null);
  assert.equal(tfLineRoom(undefined, 5000), null);
});

test("the drawdown warning: only past the limit, never without one", () => {
  const base = { limitSen: 30000000, usedSen: 29000000, lenderName: "Test Lender", fmt };
  assert.equal(tfOverLimitWarning({ ...base, drawSen: 1000000 }), null, "exactly at the limit is fine");
  assert.equal(
    tfOverLimitWarning({ ...base, drawSen: 1500000 }),
    "Over the Test Lender limit of RM 300000.00: RM 10000.00 is left and this drawdown is RM 15000.00.",
  );
  assert.equal(tfOverLimitWarning({ ...base, limitSen: null, drawSen: 99999999 }), null);
  assert.equal(tfOverLimitWarning({ ...base, drawSen: 0 }), null);
  assert.match(tfOverLimitWarning({ ...base, usedSen: 31000000, drawSen: 100 }), /RM 0\.00 is left/, "already over: nothing left, never a negative");
});

test("the stored limit: whole sen or nothing", async () => {
  assert.equal(parseTfLimitSen(30000000), 30000000);
  assert.equal(parseTfLimitSen(0), 0);
  assert.equal(parseTfLimitSen(null), null);
  assert.equal(parseTfLimitSen(""), null);
  assert.equal(parseTfLimitSen(12.5), null);
  assert.equal(parseTfLimitSen(-1), null);
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ value: JSON.stringify([
    { accountCode: "310-0020", lenderSupplierId: "sup-l", lenderName: "Test Lender", tenorDays: 90, limitSen: 30000000 },
    { accountCode: "310-0030", lenderSupplierId: "sup-m", lenderName: "Other Lender", tenorDays: 120 },
  ]) }) }) }) };
  const sources = await getTfSources(db);
  assert.deepEqual(sources.map((s) => [s.accountCode, s.limitSen]), [["310-0020", 30000000], ["310-0030", null]], "a line set up before limits reads no limit");
});

// The save, against an in-memory kv.
function makeDb(sources) {
  const st = { kv: new Map([["trade_finance_sources", JSON.stringify(sources)]]), audits: [] };
  const exec = (raw, a) => {
    const s = raw.replace(/\s+/g, " ").trim();
    if (s === "SELECT value FROM kv_config WHERE key = ?") return st.kv.has(a[0]) ? { value: st.kv.get(a[0]) } : null;
    if (/^INSERT INTO kv_config \(key, value, updated_at\) VALUES \(\?, \?, \?\)/.test(s)) { st.kv.set(a[0], a[1]); return null; }
    if (/^SELECT displayName FROM users/.test(s)) return null;
    if (/^INSERT INTO audit_events/.test(s)) { st.audits.push({ resource: a[4], resourceId: a[5], action: a[6], before: JSON.parse(a[7]), after: JSON.parse(a[8]) }); return null; }
    throw new Error(`fake db: unknown SQL: ${s}`);
  };
  const prepare = (sql) => {
    let args = [];
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() { return exec(sql, args); },
      async all() { return { results: exec(sql, args) ?? [] }; },
      async run() { exec(sql, args); return { success: true }; },
    };
    return stmt;
  };
  return { db: { prepare, batch: async (stmts) => { for (const x of stmts) await x.run(); return []; } }, st };
}

function mount(db, role = "SUPER_ADMIN") {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db); c.set("orgId", "hookka"); c.set("userRole", role); c.set("userId", "user-1");
    await next();
  });
  parent.route("/api/accounting", accountingApp);
  return async (body) => {
    const res = await parent.request("/api/accounting/trade-finance/line", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, {});
    return { status: res.status, body: await res.json() };
  };
}

const line = { accountCode: "310-0020", lenderSupplierId: "sup-l", lenderName: "Test Lender", tenorDays: 90 };

test("Save a line's tenor and limit: kept with the line, audited; the other lines untouched", async () => {
  const other = { accountCode: "310-0030", lenderSupplierId: "sup-m", lenderName: "Other Lender", tenorDays: 60, limitSen: 500000 };
  const { db, st } = makeDb([line, other]);
  const r = await mount(db)({ accountCode: "310-0020", tenorDays: 120, limitSen: 30000000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const saved = JSON.parse(st.kv.get("trade_finance_sources"));
  assert.deepEqual(saved[0], { ...line, tenorDays: 120, limitSen: 30000000 });
  assert.deepEqual(saved[1], other);
  assert.deepEqual(st.audits.map((a) => [a.resource, a.resourceId, a.action, a.before.limitSen, a.after.limitSen]), [["trade-finance", "310-0020", "update", null, 30000000]]);
  // Clearing the limit: null = no limit.
  const cleared = await mount(db)({ accountCode: "310-0020", tenorDays: 120, limitSen: null });
  assert.equal(cleared.status, 200);
  assert.equal(JSON.parse(st.kv.get("trade_finance_sources"))[0].limitSen, null);
});

test("Save refuses: a bad tenor, a bad limit, an account that is not a line, a role outside finance", async () => {
  const { db, st } = makeDb([line]);
  const before = st.kv.get("trade_finance_sources");
  const call = mount(db);
  assert.equal((await call({ accountCode: "310-0020", tenorDays: 0, limitSen: 1 })).status, 400);
  assert.equal((await call({ accountCode: "310-0020", tenorDays: 90, limitSen: 12.5 })).status, 400);
  assert.equal((await call({ accountCode: "310-0020", tenorDays: 90, limitSen: -100 })).status, 400);
  assert.equal((await call({ accountCode: "999-9999", tenorDays: 90, limitSen: 100 })).status, 404);
  assert.equal((await mount(db, "SALES")({ accountCode: "310-0020", tenorDays: 90, limitSen: 100 })).status, 403);
  assert.equal(st.kv.get("trade_finance_sources"), before, "nothing saved");
  assert.equal(st.audits.length, 0);
});

test("the screens: Settings lists the lines, Creditor Aging shows the room, the AP Payment form warns", () => {
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /<DocNumberingCard accounts=\{accounts\} \/>\n\s+<TradeFinanceLinesCard \/>/);
  const card = read("src/pages/accounting/tabs/TradeFinanceLinesCard.tsx");
  assert.match(card, /fetch\("\/api\/accounting\/trade-finance\/line", \{\n\s+method: "PUT",/);
  assert.match(card, /limitSen: d\.limitRm == null \? null : Math\.round\(d\.limitRm \* 100\)/);
  assert.match(card, /<MoneyInput/);
  const blk = read("src/pages/accounting/tabs/TradeFinanceBlock.tsx");
  assert.match(blk, /limit \{rm\(s\.limitSen\)\} · available \{rm\(s\.availableSen\)\}/);
  assert.match(ui, /const warn = editingId \? null : tfOverLimitWarning\(\{ limitSen: apTfDraw\.limitSen, usedSen: apTfDraw\.accountNetSen, drawSen: apTotalSen \+ \(apSen\(apForm\.tfInterest\) \|\| 0\)/);
  assert.match(ui, /Limit \{formatCurrency\(room\.limitSen\)\} · drawn \{formatCurrency\(room\.usedSen\)\} · available \{formatCurrency\(room\.availableSen\)\}/);
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /availableSen: tfLineRoom\(s\.limitSen, derived\.accountNetSen\)\?\.availableSen \?\? null,/);
  assert.match(api, /limitSen: sources\.find\(\(s\) => s\.accountCode === accountCode\)\?\.limitSen \?\? null \}/, "re-running setup keeps the limit");
});
