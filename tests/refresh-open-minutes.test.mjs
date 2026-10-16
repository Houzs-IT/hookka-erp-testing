// Saving a WIP time on WIP Production Times also updates the unfinished job
// cards of the changed products in that department (saveBomAndSyncCards), but
// only cards still at the time the BOM had before the save.
// Finished cards are never selected, a blank BOM step never zeroes a card,
// every write is guarded on still-open + still-at-the-old-minutes, and only
// real changes are audited. A sync failure is reported, not hidden, and never
// undoes the saved BOM.
// Run: node --import tsx/esm --test tests/refresh-open-minutes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { refreshDecision } from "../src/api/routes/jobcard-sync.ts";
import wipTimes from "../src/api/routes/wip-times.ts";
import { breakBomIntoWips } from "../src/api/lib/bom-wip-breakdown.ts";

// ---- Part 1: decision rule -------------------------------------------------

const expected = [
  { wipKey: "K1", deptCode: "FAB_SEW", estMinutes: 42 },
  { wipKey: "K1", deptCode: "FAB_CUT", estMinutes: 15 },
  { wipKey: "K2", deptCode: "FAB_CUT", estMinutes: 5 },
  { wipKey: "K2", deptCode: "FOAM", estMinutes: 0 },
];
const base = { poId: "pord-1", partialLine: false };

test("TC-01 a card whose BOM minutes changed gets the new minutes", () => {
  assert.deepEqual(refreshDecision({ ...base, wipKey: "K1", deptCode: "FAB_SEW", oldMinutes: 38 }, expected), { minutes: 42 });
});

test("TC-02 a card already at the BOM minutes is unchanged", () => {
  assert.deepEqual(refreshDecision({ ...base, wipKey: "K1", deptCode: "FAB_SEW", oldMinutes: 42 }, expected), { unchanged: true });
});

test("TC-03 a blank BOM step never wipes minutes a card has", () => {
  assert.deepEqual(refreshDecision({ ...base, wipKey: "K2", deptCode: "FOAM", oldMinutes: 20 }, expected), { skip: "bomZero" });
});

test("TC-04 merged Fab Cut card sums the PO's Fab Cut steps", () => {
  assert.deepEqual(
    refreshDecision({ ...base, wipKey: "pord-1::M::F::FAB_CUT", deptCode: "FAB_CUT", oldMinutes: 18 }, expected),
    { minutes: 20 },
  );
});

test("TC-05 merged Fab Cut card on a headboard-only / repair line is skipped", () => {
  assert.deepEqual(
    refreshDecision({ ...base, partialLine: true, wipKey: "pord-1::M::F::FAB_CUT", deptCode: "FAB_CUT", oldMinutes: 18 }, expected),
    { skip: "specialOrder" },
  );
});

test("TC-06 sofa Fab Cut merge across POs is skipped", () => {
  assert.deepEqual(
    refreshDecision({ ...base, wipKey: "SO-1::5531::F::FAB_CUT", deptCode: "FAB_CUT", oldMinutes: 18 }, expected),
    { skip: "sofaFabCutMerge" },
  );
});

// ---- Part 2: saving through the real WIP times routes ----------------------

const TREE = [
  {
    wipCode: "{PRODUCT_CODE}",
    wipType: "FG_MAIN",
    processes: [
      { deptCode: "FAB_SEW", category: "", minutes: 10 },
      { deptCode: "FOAM", category: "", minutes: 35 },
    ],
  },
];
const KEY = breakBomIntoWips(JSON.stringify(TREE), "SQUARE PILLOW", null)[0].wipKey;
const OPEN = ["WAITING", "IN_PROGRESS", "PAUSED", "BLOCKED"];

const card = (jcId, over = {}) => ({
  id: "pord-1", salesOrderId: "so-1", productCode: "SQUARE PILLOW", itemCategory: "ACCESSORY", quantity: 1,
  currentDepartment: null, targetEndDate: null, startDate: null, sizeCode: "", sizeLabel: "",
  fabricCode: "F1", gapInches: null, divanHeightInches: null, legHeightInches: null,
  specialOrder: null, repairScope: null,
  jcId, wipKey: KEY, deptCode: "FAB_SEW", status: "WAITING", oldMinutes: 10, ...over,
});

// A small in-memory database. Reads made through batch() are counted, because
// the sync must read around Hyperdrive's cache (batch = transaction = uncached).
function makeDb(cards, { raceIds = [], failCardRead = false, lockTimeouts = 0 } = {}) {
  let locksLeft = lockTimeouts;
  const bom = { id: "bt-1", productCode: "SQUARE PILLOW", baseModel: "SQUARE PILLOW", wipComponents: JSON.stringify(TREE) };
  const log = { cardReads: [], bomReadsViaBatch: 0, updates: [], audits: [], batches: [] };
  function rowsFor(s, bound) {
    if (/FROM bom_templates bt LEFT JOIN products/.test(s)) {
      return [{ ...bom, category: "ACCESSORY", defaultVariants: null, sizeCode: "", sizeLabel: "" }];
    }
    if (/FROM bom_templates WHERE productCode = \?/.test(s)) {
      return bound[0] === bom.productCode ? [{ wipComponents: bom.wipComponents, l1Processes: null, baseModel: bom.baseModel }] : [];
    }
    if (/FROM job_cards jc JOIN production_orders/.test(s)) {
      if (failCardRead) throw new Error("connection reset");
      return cards
        .filter((c) => OPEN.includes(c.status) && bound.includes(c.productCode))
        .map((c) => ({ ...c, oldMinutes: c.oldMinutes }));
    }
    return [];
  }
  function prepare(sql) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    const stmt = {
      sql: s,
      bound: [],
      bind(...a) { stmt.bound = a; return stmt; },
      async all() { return { results: rowsFor(s, stmt.bound) }; },
      async first() { return rowsFor(s, stmt.bound)[0] ?? null; },
      async run() {
        if (/^UPDATE bom_templates/.test(s)) bom.wipComponents = stmt.bound[0];
        return { success: true };
      },
    };
    return stmt;
  }
  // batch() is a transaction: if any statement throws, every write in it is undone.
  async function batch(stmts) {
    log.batches.push(stmts.map((st) => st.sql));
    const saved = { wip: bom.wipComponents, mins: cards.map((c) => c.oldMinutes), audits: log.audits.length };
    try {
      return stmts.map(runInTx);
    } catch (e) {
      bom.wipComponents = saved.wip;
      cards.forEach((c, i) => (c.oldMinutes = saved.mins[i]));
      log.audits.length = saved.audits;
      throw e;
    }
  }
  function runInTx(st) {
      if (/^SET LOCAL lock_timeout/.test(st.sql)) return { results: [], success: true, meta: { changes: 0 } };
      if (/^UPDATE bom_templates/.test(st.sql)) {
        bom.wipComponents = st.bound[0];
        return { results: [], success: true, meta: { changes: 1 } };
      }
      if (/^UPDATE job_cards/.test(st.sql)) {
        if (locksLeft > 0) {
          locksLeft--;
          throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
        }
        const [m, , id, old] = st.bound;
        const c = cards.find((x) => x.jcId === id);
        const ok = c && OPEN.includes(c.status) && c.oldMinutes === old && !raceIds.includes(id);
        log.updates.push({ sql: st.sql, bound: st.bound });
        if (ok) c.oldMinutes = m;
        return { results: [], success: true, meta: { changes: ok ? 1 : 0 } };
      }
      if (/INSERT INTO audit_events/.test(st.sql)) {
        // Conditional insert: written only if the card now holds the new minutes.
        if (st.sql.includes("WHERE EXISTS (SELECT 1 FROM job_cards WHERE id = ? AND productionTimeMinutes = ?)")) {
          const [id, m] = st.bound.slice(-2);
          if (cards.find((x) => x.jcId === id)?.oldMinutes !== m) return { results: [], success: true, meta: { changes: 0 } };
        }
        log.audits.push(st.bound);
        return { results: [], success: true, meta: { changes: 1 } };
      }
      if (/FROM job_cards jc JOIN production_orders/.test(st.sql)) log.cardReads.push(st.sql);
      if (/FROM bom_templates WHERE productCode/.test(st.sql)) log.bomReadsViaBatch++;
      return { results: rowsFor(st.sql, st.bound), success: true, meta: { changes: 0 } };
  }
  return { log, bom, db: { prepare, batch } };
}

async function call(db, method, path, body) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", wipTimes);
  const res = await parent.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a thrown error comes back as plain text */ }
  return { status: res.status, body: json, text };
}

const SAVE = { wipLabel: "SQUARE PILLOW", deptCode: "FAB_SEW", minutes: 12 };

test("TC-07 saving a time updates the unfinished cards and audits each one", async () => {
  const cards = [
    card("waiting"),
    card("started", { status: "IN_PROGRESS" }),
    card("done", { status: "COMPLETED" }),
    card("foam", { deptCode: "FOAM", oldMinutes: 30 }), // other dept: not part of this save
  ];
  const f = makeDb(cards);
  const { status, body } = await call(f.db, "PUT", "/", SAVE);
  assert.equal(status, 200);
  assert.equal(body.updatedBomCount, 1);
  assert.deepEqual(body.jobCards, { updated: 2, leftAlone: 0, skipped: 0, outOfDate: 0 });
  assert.equal(cards.find((c) => c.jcId === "waiting").oldMinutes, 12);
  assert.equal(cards.find((c) => c.jcId === "started").oldMinutes, 12);
  assert.equal(cards.find((c) => c.jcId === "done").oldMinutes, 10, "a finished card keeps its minutes");
  assert.equal(cards.find((c) => c.jcId === "foam").oldMinutes, 30, "another department is not touched");
  assert.equal(f.log.audits.length, 2);
  assert.ok(f.log.audits.every((a) => a.includes("refresh-open-minutes-from-bom")));
});

test("TC-08 the sync reads the just-saved BOM and the cards around the cache", async () => {
  const f = makeDb([card("waiting")]);
  await call(f.db, "PUT", "/", SAVE);
  assert.equal(f.log.cardReads.length, 1, "job card read must go through batch()");
  assert.match(f.log.cardReads[0], /jc\.status IN \('WAITING','IN_PROGRESS','PAUSED','BLOCKED'\)/);
  assert.ok(f.log.bomReadsViaBatch >= 1, "BOM read must go through batch()");
});

test("TC-09 a card finished between the read and the write is left alone and not audited", async () => {
  const f = makeDb([card("waiting"), card("raced")], { raceIds: ["raced"] });
  const { body } = await call(f.db, "PUT", "/", SAVE);
  assert.deepEqual(body.jobCards, { updated: 1, leftAlone: 1, skipped: 0, outOfDate: 0 });
  assert.equal(f.log.audits.length, 1);
  for (const u of f.log.updates) {
    assert.match(u.sql, /status IN \('WAITING','IN_PROGRESS','PAUSED','BLOCKED'\)/);
    assert.match(u.sql, /COALESCE\(productionTimeMinutes, 0\) = \?/);
  }
});

test("TC-10 a failure before the write saves nothing at all", async () => {
  const cards = [card("waiting")];
  const f = makeDb(cards, { failCardRead: true });
  const { status } = await call(f.db, "PUT", "/", SAVE);
  assert.equal(status, 500);
  assert.equal(JSON.parse(f.bom.wipComponents)[0].processes[0].minutes, 10, "the BOM is not saved on its own");
  assert.equal(cards[0].oldMinutes, 10);
});

test("TC-11 Excel import: a dry run leaves cards alone, a real import updates them", async () => {
  const cards = [card("waiting")];
  const f = makeDb(cards);
  const items = [{ wipLabel: "SQUARE PILLOW", deptCode: "FAB_SEW", minutes: 12 }];
  const dry = await call(f.db, "POST", "/bulk-import", { items, dryRun: true });
  assert.equal(dry.body.jobCards.details.willChange.length, 1, "the dry run previews the card");
  assert.equal(cards[0].oldMinutes, 10);
  assert.equal(JSON.parse(f.bom.wipComponents)[0].processes[0].minutes, 10, "and saves nothing");
  const live = await call(f.db, "POST", "/bulk-import", { items, dryRun: false });
  assert.deepEqual(live.body.jobCards, { updated: 1, leftAlone: 0, skipped: 0, outOfDate: 0 });
  assert.equal(cards[0].oldMinutes, 12);
});

test("TC-12 a card that was already out of date keeps its time", async () => {
  // BOM was 10 before the save; this card was at 8, so it is not following the BOM.
  const cards = [card("follows"), card("drifted", { oldMinutes: 8 }), card("drifted-started", { status: "IN_PROGRESS", oldMinutes: 15 })];
  const f = makeDb(cards);
  const { body } = await call(f.db, "PUT", "/", SAVE);
  assert.deepEqual(body.jobCards, { updated: 1, leftAlone: 0, skipped: 0, outOfDate: 2 });
  assert.equal(cards[0].oldMinutes, 12);
  assert.equal(cards[1].oldMinutes, 8, "an out-of-date card is not moved");
  assert.equal(cards[2].oldMinutes, 15);
  assert.equal(f.log.updates.length, 1, "no UPDATE is even attempted for out-of-date cards");
  assert.equal(f.log.audits.length, 1);
});

test("TC-13 Excel import also leaves out-of-date cards alone", async () => {
  const cards = [card("follows"), card("drifted", { oldMinutes: 8 })];
  const f = makeDb(cards);
  const items = [{ wipLabel: "SQUARE PILLOW", deptCode: "FAB_SEW", minutes: 12 }];
  const { body } = await call(f.db, "POST", "/bulk-import", { items, dryRun: false });
  assert.deepEqual(body.jobCards, { updated: 1, leftAlone: 0, skipped: 0, outOfDate: 1 });
  assert.equal(cards[1].oldMinutes, 8);
});

test("TC-14 the BOM, each card update and its audit row go out in one transaction", async () => {
  const cards = [card("a"), card("b"), card("raced")];
  const f = makeDb(cards, { raceIds: ["raced"] });
  await call(f.db, "PUT", "/", SAVE);
  const writeBatches = f.log.batches.filter((b) => b.some((q) => /^UPDATE job_cards/.test(q)));
  assert.equal(writeBatches.length, 1);
  const kindsAll = writeBatches[0].map((q) => (/^SET LOCAL lock_timeout = '5s'/.test(q) ? "S" : /^UPDATE bom_templates/.test(q) ? "B" : /^UPDATE job_cards/.test(q) ? "U" : /INSERT INTO audit_events/.test(q) ? "A" : "?"));
  assert.deepEqual(kindsAll, ["S", "B", "U", "A", "U", "A", "U", "A"], "lock limit, BOM, then each UPDATE with its audit, all in one batch");
  assert.ok(writeBatches[0].filter((q) => /INSERT INTO audit_events/.test(q)).every((q) => q.includes(") SELECT ") && q.includes("WHERE EXISTS")));
  assert.equal(f.log.audits.length, 2, "the raced card's audit row is not written");
});

test("TC-15 busy job cards: nothing is saved, the page is told, and a retry works", async () => {
  const cards = [card("waiting")];
  const f = makeDb(cards, { lockTimeouts: 1 });
  const busy = await call(f.db, "PUT", "/", SAVE);
  assert.equal(busy.status, 503);
  assert.equal(busy.body.success, false);
  assert.match(busy.body.error, /busy right now, so nothing was saved/);
  assert.equal(JSON.parse(f.bom.wipComponents)[0].processes[0].minutes, 10, "BOM rolled back with the cards");
  assert.equal(cards[0].oldMinutes, 10);
  assert.equal(f.log.audits.length, 0);
  const again = await call(f.db, "PUT", "/", SAVE);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.jobCards, { updated: 1, leftAlone: 0, skipped: 0, outOfDate: 0 });
  assert.equal(cards[0].oldMinutes, 12, "the same save, retried, moves the card");
});

test("TC-16 busy job cards during an Excel import: the whole import is undone", async () => {
  const cards = [card("waiting")];
  const f = makeDb(cards, { lockTimeouts: 1 });
  const items = [{ wipLabel: "SQUARE PILLOW", deptCode: "FAB_SEW", minutes: 12 }];
  const res = await call(f.db, "POST", "/bulk-import", { items, dryRun: false });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(f.bom.wipComponents)[0].processes[0].minutes, 10);
  assert.equal(cards[0].oldMinutes, 10);
});

test("TC-17 a save preview lists the cards in detail and writes nothing", async () => {
  const cards = [
    card("follows", { companySOId: "SO-2610-003", poNo: "SO-2610-003-01", customerName: "TEST COMPANY", deptName: "Fabric Sewing", wipLabel: "SQUARE PILLOW MODENZA-01", pic1Name: "Ali", dueDate: "2026-10-20" }),
    card("drifted", { oldMinutes: 8, poNo: "SO-2609-198-04" }),
  ];
  const f = makeDb(cards);
  const { status, body } = await call(f.db, "PUT", "/", { ...SAVE, dryRun: true });
  assert.equal(status, 200);
  assert.equal(body.dryRun, true);
  const { willChange, keep } = body.jobCards.details;
  assert.equal(willChange.length, 1);
  assert.deepEqual(
    { so: willChange[0].soNo, po: willChange[0].poNo, cust: willChange[0].customerName, dept: willChange[0].deptName, wip: willChange[0].wipLabel, who: willChange[0].workers, due: willChange[0].dueDate, from: willChange[0].oldMinutes, to: willChange[0].newMinutes },
    { so: "SO-2610-003", po: "SO-2610-003-01", cust: "TEST COMPANY", dept: "Fabric Sewing", wip: "SQUARE PILLOW MODENZA-01", who: "Ali", due: "2026-10-20", from: 10, to: 12 },
  );
  assert.deepEqual(keep.map((k) => [k.poNo, k.reason, k.oldMinutes]), [["SO-2609-198-04", "outOfDate", 8]]);
  assert.equal(JSON.parse(f.bom.wipComponents)[0].processes[0].minutes, 10, "BOM not saved");
  assert.deepEqual(cards.map((c) => c.oldMinutes), [10, 8], "no card moved");
  assert.ok(!f.log.batches.some((b) => b.some((q) => /^UPDATE /.test(q))), "no write was sent");
});

test("TC-18 a real save carries no preview details", async () => {
  const f = makeDb([card("follows")]);
  const { body } = await call(f.db, "PUT", "/", SAVE);
  assert.equal(body.dryRun, false);
  assert.equal(body.jobCards.details, undefined);
  assert.equal(body.jobCards.updated, 1);
});
