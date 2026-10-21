// ---------------------------------------------------------------------------
// Setup › Currency & FX (owner 2026-10-20 「要」; plan docs/superpowers/plans/
// 2026-10-20-currency-fx.md, step 2). His rulings: a month's rate is only a
// default (each document keeps its own); FX gain and loss both to 530-0000
// for now; the yuan is CNY. The rules (src/lib/fx.ts), the /api/fx routes
// against an in-memory database, and where the posting reads the accounts.
// Made-up rates only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const fx = await import(href("src/lib/fx.ts"));
const { default: fxApp } = await import(href("src/api/routes/fx.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test("a rate is a number above 0 with at most six decimals", () => {
  assert.equal(fx.parseFxRate("4.45"), 4.45);
  assert.equal(fx.parseFxRate(" 0.652 "), 0.652);
  assert.equal(fx.parseFxRate("1,234.5"), 1234.5);
  assert.equal(fx.parseFxRate(0.6234), 0.6234);
  assert.equal(fx.parseFxRate("4.123456"), 4.123456);
  assert.equal(fx.parseFxRate("4.1234567"), null, "seven decimals");
  for (const bad of ["0", "-1", "abc", "", "4.4.4", null, undefined, Number.NaN]) assert.equal(fx.parseFxRate(bad), null, String(bad));
});

test("stored settings read defensively: defaults, RMB as CNY, nothing bad kept", () => {
  assert.deepEqual(fx.parseFxSettings(null), { currencies: [], rates: {}, gainAccount: "530-0000", lossAccount: "530-0000" });
  const s = fx.parseFxSettings({
    currencies: [{ code: "usd", name: "US Dollar" }, { code: "RMB", name: "Yuan" }, { code: "MYR" }, { code: "USD" }, { code: "TOOLONG" }],
    rates: { USD: { "2026-09": 4.5, "2026-13": 4, "2026-10": "bad" }, RMB: { "2026-10": "0.61" } },
    gainAccount: " 530-0000 ",
    lossAccount: "",
  });
  assert.deepEqual(s.currencies, [{ code: "USD", name: "US Dollar" }, { code: "CNY", name: "Yuan" }]);
  assert.deepEqual(s.rates, { USD: { "2026-09": 4.5 }, CNY: { "2026-10": 0.61 } });
  assert.equal(s.gainAccount, "530-0000");
  assert.equal(s.lossAccount, "530-0000", "blank keeps the default");
});

test("months: this one in Malaysia time, the six to it, a date's month", () => {
  assert.equal(fx.fxThisMonth(Date.parse("2026-10-31T17:00:00Z")), "2026-11", "01:00 MYT on 1 Nov");
  assert.equal(fx.fxThisMonth(Date.parse("2026-10-31T15:00:00Z")), "2026-10");
  assert.deepEqual(fx.fxMonthsTo("2026-02"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(fx.fxMonthsTo("2026-10", 2), ["2026-09", "2026-10"]);
  assert.deepEqual(fx.fxMonthsTo("bad"), []);
  assert.equal(fx.fxMonthOf("2026-10-20T08:00:00Z"), "2026-10");
  assert.equal(fx.fxMonthOf(""), "");
  assert.equal(fx.fxMonthLabel("2026-10"), "Oct 2026");
  assert.equal(fx.fxMonthLabel("bad"), "bad");
});

test("the default for a document: MYR is 1, the month's rate, else none", () => {
  const s = { rates: { USD: { "2026-10": 4.45 }, CNY: { "2026-10": 0.62 } } };
  assert.equal(fx.fxRateFor(s, "MYR", "2026-10-20"), 1);
  assert.equal(fx.fxRateFor(s, "usd", "2026-10-20"), 4.45);
  assert.equal(fx.fxRateFor(s, "RMB", "2026-10-01"), 0.62, "RMB reads as CNY");
  assert.equal(fx.fxRateFor(s, "USD", "2026-09-30"), null, "no September rate");
  assert.equal(fx.fxRateFor(s, "SGD", "2026-10-20"), null);
  assert.deepEqual(fx.fxMissingFor({ currencies: [{ code: "USD" }, { code: "SGD" }], rates: s.rates }, "2026-10"), ["SGD"]);
});

test("a new currency: three letters, not MYR, not twice", () => {
  const s = { currencies: [{ code: "USD", name: "" }] };
  assert.equal(fx.fxNewCodeError(s, "cny"), "");
  assert.equal(fx.fxNewCodeError(s, "RMB"), "", "RMB is added as CNY");
  assert.match(fx.fxNewCodeError(s, "usd"), /already on the list/);
  assert.match(fx.fxNewCodeError(s, "MYR"), /home currency/);
  assert.match(fx.fxNewCodeError(s, "US"), /three letters/);
});

test("a realised difference: a gain credits the gain account, a loss debits the loss account", () => {
  const split = { gainAccount: "530-0000", lossAccount: "905-0000" };
  assert.equal(fx.fxLegAccount(1250, split), "530-0000");
  assert.equal(fx.fxLegAccount(-1250, split), "905-0000");
  assert.deepEqual(fx.fxLegAccounts(split), ["530-0000", "905-0000"]);
  assert.deepEqual(fx.fxLegAccounts({ gainAccount: "530-0000", lossAccount: "530-0000" }), ["530-0000"]);
  assert.deepEqual(fx.fxLegAccounts({ gainAccount: "531-0000", lossAccount: "905-0000" }), ["530-0000", "531-0000", "905-0000"], "older legs on 530-0000 stay recognised");
  assert.equal(fx.fmtFxRate(4.45), "4.45");
  assert.equal(fx.fmtFxRate(0.6234), "0.6234");
  assert.equal(fx.fmtFxRate(4), "4.00");
});

// ---------------------------------------------------------------------------
// The routes, against an in-memory database
// ---------------------------------------------------------------------------

function makeDb({ kv = null, accounts = [] } = {}) {
  const store = { kv, accounts: new Map(accounts.map((a) => [a.code, a])), audits: [] };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    let b = [];
    const stmt = {
      bind(...a) { b = a; return stmt; },
      async first() {
        if (s === "SELECT value FROM kv_config WHERE key = ?") {
          assert.equal(b[0], "fx_settings");
          return store.kv === null ? null : { value: store.kv };
        }
        if (/^SELECT code, isActive, CASE WHEN EXISTS \(SELECT 1 FROM chart_of_accounts k WHERE k\.parentCode = chart_of_accounts\.code\) THEN 0 ELSE isPostable END AS is_postable FROM chart_of_accounts WHERE code = \?$/.test(s)) {
          const a = store.accounts.get(b[0]);
          return a ? { code: a.code, isActive: a.isActive ?? 1, isPostable: a.postable === false ? 0 : 1 } : null;
        }
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        if (/^INSERT INTO kv_config \(key, value, updated_at\) VALUES \(\?, \?, \?\) ON CONFLICT \(key\) DO UPDATE SET value = EXCLUDED\.value, updated_at = EXCLUDED\.updated_at$/.test(s)) {
          assert.equal(b[0], "fx_settings");
          store.kv = b[1];
        } else if (/^INSERT INTO audit_events/.test(s)) {
          store.audits.push({ resource: b[4], resourceId: b[5], action: b[6], before: b[7] && JSON.parse(b[7]), after: b[8] && JSON.parse(b[8]) });
        }
        return { success: true };
      },
    };
    return stmt;
  }
  return { db: { prepare, batch: async (stmts) => { for (const st of stmts) await st.run(); return []; } }, store };
}

function mount(db, role = "FINANCE") {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", role);
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/api/fx", fxApp);
  return async (method, path, body) => {
    const res = await parent.request(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, {});
    return { status: res.status, body: await res.json() };
  };
}

test("an empty book: no currencies, both accounts 530-0000, six months to this one", async () => {
  const { db } = makeDb();
  const call = mount(db, "SUPER_ADMIN");
  const r = await call("GET", "/api/fx");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.currencies, []);
  assert.equal(r.body.data.gainAccount, "530-0000");
  assert.equal(r.body.data.lossAccount, "530-0000");
  assert.equal(r.body.data.months.length, 6);
  assert.equal(r.body.data.months[5], r.body.data.thisMonth);
  assert.deepEqual(r.body.data.missing, []);
});

test("add a currency, key its rates, clear one, remove it — each change audited", async () => {
  const { db, store } = makeDb();
  const call = mount(db);
  assert.equal((await call("POST", "/api/fx/currency", { code: "rmb", name: "Chinese Yuan" })).status, 200);
  assert.deepEqual(JSON.parse(store.kv).currencies, [{ code: "CNY", name: "Chinese Yuan" }], "RMB is kept as CNY");
  assert.equal((await call("POST", "/api/fx/currency", { code: "CNY" })).status, 400, "not twice");
  let r = await call("PUT", "/api/fx/rate", { currency: "CNY", month: "2026-10", rate: "0.6215" });
  assert.equal(r.status, 200);
  r = await call("PUT", "/api/fx/rate", { currency: "CNY", month: "2026-09", rate: 0.6301 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(store.kv).rates, { CNY: { "2026-10": 0.6215, "2026-09": 0.6301 } });
  assert.equal((await call("PUT", "/api/fx/rate", { currency: "CNY", month: "2026-10", rate: "0" })).status, 400);
  assert.equal((await call("PUT", "/api/fx/rate", { currency: "CNY", month: "2026-13", rate: "1" })).status, 400);
  assert.equal((await call("PUT", "/api/fx/rate", { currency: "USD", month: "2026-10", rate: "4.4" })).status, 404, "not on the list");
  r = await call("PUT", "/api/fx/rate", { currency: "CNY", month: "2026-09", rate: "" });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(store.kv).rates, { CNY: { "2026-10": 0.6215 } }, "an empty cell clears");
  r = await call("DELETE", "/api/fx/currency/CNY");
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(store.kv), { currencies: [], rates: {}, gainAccount: "530-0000", lossAccount: "530-0000" });
  assert.deepEqual(store.audits.map((a) => `${a.resource} ${a.action} ${a.resourceId}`), [
    "fx-settings create CNY",
    "fx-settings update CNY 2026-10",
    "fx-settings update CNY 2026-09",
    "fx-settings update CNY 2026-09",
    "fx-settings delete CNY",
  ]);
  assert.deepEqual(store.audits[4].before, { code: "CNY", name: "Chinese Yuan", rates: { "2026-10": 0.6215 } }, "the removed rates are on the record");
});

test("the FX accounts: active accounts that take postings, audited", async () => {
  const { db, store } = makeDb({ accounts: [{ code: "530-0000" }, { code: "905-0000" }, { code: "900-0000", postable: false }, { code: "906-0000", isActive: 0 }] });
  const call = mount(db);
  assert.equal((await call("PUT", "/api/fx/accounts", { gainAccount: "530-0000", lossAccount: "900-0000" })).status, 400, "a parent account");
  assert.equal((await call("PUT", "/api/fx/accounts", { gainAccount: "530-0000", lossAccount: "906-0000" })).status, 400, "inactive");
  assert.equal((await call("PUT", "/api/fx/accounts", { gainAccount: "530-0000", lossAccount: "999-9999" })).status, 404);
  const r = await call("PUT", "/api/fx/accounts", { gainAccount: "530-0000", lossAccount: "905-0000" });
  assert.equal(r.status, 200);
  const s = JSON.parse(store.kv);
  assert.equal(s.lossAccount, "905-0000");
  assert.deepEqual(store.audits.at(-1).before, { gainAccount: "530-0000", lossAccount: "530-0000" });
});

test("only Finance or a Super Admin changes it; anyone who reads the books sees it", async () => {
  const { db } = makeDb();
  const call = mount(db, "PRODUCTION");
  assert.equal((await call("POST", "/api/fx/currency", { code: "USD" })).status, 403);
  assert.equal((await call("PUT", "/api/fx/rate", { currency: "USD", month: "2026-10", rate: "4" })).status, 403);
  assert.equal((await call("PUT", "/api/fx/accounts", { gainAccount: "530-0000", lossAccount: "530-0000" })).status, 403);
  assert.equal((await call("DELETE", "/api/fx/currency/USD")).status, 403);
});

// ---------------------------------------------------------------------------
// Where the posting and the pages read it
// ---------------------------------------------------------------------------

test("the posting reads the accounts: supplier payment, its restate, PI Mark Paid", () => {
  const sp = read("src/api/routes/supplier-payments.ts");
  assert.doesNotMatch(sp, /FX_GAIN_ACCT/, "no hard-coded FX account left");
  assert.match(sp, /accountCode: fxLegAccount\(totalFx, await getFxSettings\(db\)\),\n\s+debitSen: totalFx < 0 \? -totalFx : 0,\n\s+creditSen: totalFx > 0 \? totalFx : 0,/);
  assert.match(sp, /legNo: 3, accountCode: fxLegAccount\(totalFx, await getFxSettings\(db\)\), debitSen: totalFx < 0 \? -totalFx : 0, creditSen: totalFx > 0 \? totalFx : 0,/);
  const pi = read("src/api/routes/purchase-invoices.ts");
  assert.doesNotMatch(pi, /FX_GAIN_ACCT/);
  assert.match(pi, /accountCode: fxLegAccount\(fxDiff, await getFxSettings\(db\)\),\n\s+debitSen: fxDiff < 0 \? -fxDiff : 0,/);
  const worker = read("src/api/worker.ts");
  assert.match(worker, /app\.route\("\/api\/fx", fx\);/);
});

test("the page: Setup › Currency & FX, its two cards; the forms open on the month's rate", () => {
  const side = read("src/components/layout/sidebar.tsx");
  assert.match(side, /\{ name: "Chart of Accounts", href: "\/accounting\?tab=coa", icon: List \},\n\s+\{ name: "Currency & FX", href: "\/accounting\?tab=fx", icon: Wallet \},/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /\{tab === "fx" && <FxTab accounts=\{accounts\} \/>\}/);
  const tab = read("src/pages/accounting/tabs/FxTab.tsx");
  assert.match(tab, /FX Gain \/ Loss Accounts/);
  assert.match(tab, /Monthly Rates <span className="font-normal text-\[#6B7280\]">· 1 unit = RM<\/span>/);
  assert.match(tab, /rate not set: <b>\{data\.missing\.join\(", "\)\}<\/b>/);
  const spui = read("src/pages/invoices/supplier-payments.tsx");
  assert.match(spui, /const setupRate = \(ccy: string\): number \| null => \(fxSettings \? fxRateFor\(fxSettings, ccy, date\) : null\);/);
  assert.match(spui, /if \(row\.rateStr\.trim\(\)\) return \{\};/, "a rate already typed is never overwritten");
  assert.match(spui, /<td className="px-3 py-2 text-right text-gray-500">\{formatCurrency\(pi\.paidAmountSen\)\}<\/td>/, "booked RM shown as RM, not under the foreign code");
  assert.match(read("src/pages/procurement/pi.tsx"), /const setup = await fetchFxRate\(ccy, todayYmdMY\(\)\);/);
  assert.match(read("src/pages/procurement/grn-detail.tsx"), /const setup = await fetchFxRate\(currency, new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]\);/);
});
