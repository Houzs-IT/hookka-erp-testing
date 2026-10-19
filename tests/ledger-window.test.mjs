// ---------------------------------------------------------------------------
// ledger-window.test.mjs — the ledger walked once per request, each window a
// sum of its months (2026-10-19, owner 「优化加载速度」). The old per-window
// loop is kept here as the reference: same figures, same account order, same
// opening legs, for every window, on made-up legs.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { prepareLedger, windowNet } from "../src/lib/ledger-window.ts";

// The loop glWindowSigned ran for every window before 2026-10-19.
function referenceWindow(legs, o, startYm, endYm) {
  const net = new Map();
  const openingNet = new Map();
  for (const l of legs) {
    const dd = o.docDate(l.sourceType, l.sourceId, l.postedAt);
    if (o.isBeforeOpening(l.sourceType, dd)) continue;
    if (o.isOpening(l.sourceType)) {
      const code = o.resolve(l.accountCode);
      openingNet.set(code, (openingNet.get(code) ?? 0) + (Number(l.debitSen) || 0) - (Number(l.creditSen) || 0));
      continue;
    }
    if (l.sourceType === "closing_stock" || l.sourceType === "closing_stock_reversal") continue;
    const ym = dd.slice(0, 7);
    if (startYm && ym < startYm) continue;
    if (endYm && ym > endYm) continue;
    const code = o.resolve(l.accountCode);
    net.set(code, (net.get(code) ?? 0) + (Number(l.debitSen) || 0) - (Number(l.creditSen) || 0));
  }
  return { net, openingNet };
}

// A small deterministic random source (no Math.random — the test must repeat).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function makeCase(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const accounts = ["500-0000", "500-0020", "701-0010", "900-0001", "310-0010", "410-0010", "OLD-1", "OLD-2"];
  const aliases = { "OLD-1": "900-0001", "OLD-2": "OLD-1" }; // chained rename
  const types = ["invoice", "payment_voucher", "manual", "opening_balance", "opening_balance_reversal", "closing_stock", "closing_stock_reversal", "purchase_invoice"];
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const docDates = new Map();
  const legs = [];
  for (let i = 0; i < 400; i++) {
    const ym = pick(months);
    const day = String(1 + Math.floor(r() * 28)).padStart(2, "0");
    const sourceId = `doc-${Math.floor(r() * 120)}`;
    const sourceType = pick(types);
    // A document's own date can differ from the posting date.
    if (!docDates.has(sourceId) && r() < 0.5) docDates.set(sourceId, `${pick(months)}-${day}`);
    const amount = Math.floor(r() * 100000) - (r() < 0.1 ? 0 : 0);
    const dr = r() < 0.5;
    legs.push({
      accountCode: pick(accounts), sourceType, sourceId,
      debitSen: dr ? amount : 0, creditSen: dr ? 0 : amount,
      postedAt: `${ym}-${day}T10:00:00Z`,
    });
  }
  const resolve = (code) => { let c = code; for (let i = 0; i < 10 && aliases[c]; i++) c = aliases[c]; return c; };
  const opening = "2026-05-01";
  const o = {
    docDate: (st, id, postedAt) => (st.startsWith("opening_balance") ? opening : docDates.get(id) ?? String(postedAt ?? "").slice(0, 10)),
    resolve,
    isBeforeOpening: (st, dd) => !st.startsWith("opening_balance") && dd < opening,
    isOpening: (st) => st === "opening_balance" || st === "opening_balance_reversal",
  };
  return { legs, o };
}

const windows = [
  [null, null], ["2026-05", "2026-05"], ["2026-06", "2026-08"], [null, "2026-07"], ["2026-09", null],
  ["2026-10", "2026-10"], ["2026-01", "2026-02"], ["2026-04", "2026-10"], ["2026-08", "2026-06"],
];

test("every window: the same figures and the same account order as the old per-window loop", () => {
  for (const seed of [1, 7, 42, 2026, 99991]) {
    const { legs, o } = makeCase(seed);
    const prep = prepareLedger(legs, o);
    for (const [s, e] of windows) {
      const ref = referenceWindow(legs, o, s, e);
      assert.deepEqual([...windowNet(prep, s, e).entries()], [...ref.net.entries()], `seed ${seed} window ${s}..${e}`);
      assert.deepEqual([...prep.openingNet.entries()], [...ref.openingNet.entries()], `seed ${seed} opening legs`);
    }
  }
});

test("a window's map is the caller's own: adding to it leaves the prepared ledger alone", () => {
  const { legs, o } = makeCase(5);
  const prep = prepareLedger(legs, o);
  const a = windowNet(prep, "2026-06", "2026-06");
  const before = [...windowNet(prep, "2026-06", "2026-06").entries()];
  for (const k of a.keys()) a.set(k, 1);
  a.set("NEW", 5);
  assert.deepEqual([...windowNet(prep, "2026-06", "2026-06").entries()], before);
});

test("an account whose legs cancel out still appears, at zero — as before", () => {
  const legs = [
    { accountCode: "A", sourceType: "manual", sourceId: "1", debitSen: 500, creditSen: 0, postedAt: "2026-06-02" },
    { accountCode: "B", sourceType: "manual", sourceId: "1", debitSen: 0, creditSen: 500, postedAt: "2026-06-02" },
    { accountCode: "A", sourceType: "manual", sourceId: "2", debitSen: 0, creditSen: 500, postedAt: "2026-06-09" },
  ];
  const o = { docDate: (_s, _i, p) => String(p).slice(0, 10), resolve: (c) => c, isBeforeOpening: () => false, isOpening: () => false };
  assert.deepEqual([...windowNet(prepareLedger(legs, o), "2026-06", "2026-06").entries()], [["A", 0], ["B", -500]]);
});

test("glWindowSigned walks the ledger once per read request and sums each window's months", () => {
  const api = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");
  const gw = api.slice(api.indexOf("async function glWindowSignedUntimed("), api.indexOf("const glWindowSigned = timedFn("));
  assert.match(gw, /const prep = await requestMemo\("ledger-prepared", async \(\) => prepareLedger\(legRes\.results \?\? \[\], \{\n\s+docDate,\n\s+resolve,\n\s+isBeforeOpening: \(sourceType, dd\) => legBeforeOpening\(sourceType, dd, obDate\),\n\s+isOpening: isOpeningSource,/);
  assert.match(gw, /net = windowNet\(prep, startYm, endYm\);\n\s+openingNet = prep\.openingNet;/);
  assert.match(gw, /requestMemo\("ledger-recorded-salary", async \(\) => recordedSalaryAccounts\(salaryLegsIn\(legRes\.results \?\? \[\], resolve, docDate, obDate\), LABOUR_ACCRUAL_ACCT\)\)/);
  // A drill (trace) still walks the legs itself — it lists them one by one.
  assert.match(gw, /if \(trace\) for \(const l of legRes\.results \?\? \[\]\) \{/);
  // The shared opening legs are only read (the opening slice adds to the window's own map).
  assert.match(readFileSync("src/lib/opening-slice.ts", "utf8"), /openingNet: ReadonlyMap<string, number>,/);
});
