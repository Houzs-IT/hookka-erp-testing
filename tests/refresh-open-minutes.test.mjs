// Saving a WIP time on WIP Production Times also updates the unfinished job
// cards of the changed products in that department (syncOpenCardsToBom), but
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
function makeDb(cards, { raceIds = [], failCardRead = false } = {}) {
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
  async function batch(stmts) {
    log.batches.push(stmts.map((st) => st.sql));
    return stmts.map((st) => {
      if (/^UPDATE job_cards/.test(st.sql)) {
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
    });
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
  return { status: res.status, body: await res.json() };
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

test("TC-10 a sync failure is reported and the BOM save still stands", async () => {
  const f = makeDb([card("waiting")], { failCardRead: true });
  const { status, body } = await call(f.db, "PUT", "/", SAVE);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.updatedBomCount, 1);
  assert.match(body.jobCardsError, /connection reset/);
  assert.equal(JSON.parse(f.bom.wipComponents)[0].processes[0].minutes, 12);
});

test("TC-11 Excel import: a dry run leaves cards alone, a real import updates them", async () => {
  const cards = [card("waiting")];
  const f = makeDb(cards);
  const items = [{ wipLabel: "SQUARE PILLOW", deptCode: "FAB_SEW", minutes: 12 }];
  const dry = await call(f.db, "POST", "/bulk-import", { items, dryRun: true });
  assert.equal(dry.body.jobCards, undefined);
  assert.equal(cards[0].oldMinutes, 10);
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

test("TC-14 each card update and its audit row go out in the same transaction", async () => {
  const cards = [card("a"), card("b"), card("raced")];
  const f = makeDb(cards, { raceIds: ["raced"] });
  await call(f.db, "PUT", "/", SAVE);
  const writeBatches = f.log.batches.filter((b) => b.some((q) => /^UPDATE job_cards/.test(q)));
  assert.equal(writeBatches.length, 1);
  const kinds = writeBatches[0].map((q) => (/^UPDATE job_cards/.test(q) ? "U" : /INSERT INTO audit_events/.test(q) ? "A" : "?"));
  assert.deepEqual(kinds, ["U", "A", "U", "A", "U", "A"], "every UPDATE is followed by its audit in one batch");
  assert.ok(writeBatches[0].filter((q) => /INSERT INTO audit_events/.test(q)).every((q) => q.includes(") SELECT ") && q.includes("WHERE EXISTS")));
  assert.equal(f.log.audits.length, 2, "the raced card's audit row is not written");
});
