// refresh-open-minutes: the WIP Production Times "Sync open job cards" button.
// Unfinished cards whose minutes differ from the CURRENT BOM get the BOM's
// minutes; finished cards are never selected; apply recomputes on the server
// and only touches the ticked cards that are still open and unchanged.
// Run: node --import tsx/esm --test tests/refresh-open-minutes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import app, { refreshDecision } from "../src/api/routes/jobcard-sync.ts";
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
  const r = refreshDecision({ ...base, wipKey: "K1", deptCode: "FAB_SEW", oldMinutes: 38 }, expected);
  assert.deepEqual(r, { minutes: 42 });
});

test("TC-02 a card already at the BOM minutes is unchanged", () => {
  const r = refreshDecision({ ...base, wipKey: "K1", deptCode: "FAB_SEW", oldMinutes: 42 }, expected);
  assert.deepEqual(r, { unchanged: true });
});

test("TC-03 a blank BOM step never wipes minutes a card has", () => {
  const r = refreshDecision({ ...base, wipKey: "K2", deptCode: "FOAM", oldMinutes: 20 }, expected);
  assert.deepEqual(r, { skip: "bomZero" });
});

test("TC-04 merged Fab Cut card sums the PO's Fab Cut steps", () => {
  const r = refreshDecision({ ...base, wipKey: "pord-1::M::F::FAB_CUT", deptCode: "FAB_CUT", oldMinutes: 18 }, expected);
  assert.deepEqual(r, { minutes: 20 });
});

test("TC-05 merged Fab Cut card on a headboard-only / repair line is skipped", () => {
  const r = refreshDecision(
    { ...base, partialLine: true, wipKey: "pord-1::M::F::FAB_CUT", deptCode: "FAB_CUT", oldMinutes: 18 },
    expected,
  );
  assert.deepEqual(r, { skip: "specialOrder" });
});

test("TC-06 sofa Fab Cut merge across POs is skipped", () => {
  const r = refreshDecision({ ...base, wipKey: "SO-1::5531::F::FAB_CUT", deptCode: "FAB_CUT", oldMinutes: 18 }, expected);
  assert.deepEqual(r, { skip: "sofaFabCutMerge" });
});

// ---- Part 2: the endpoint against a fake DB --------------------------------

const BOMS = {
  "5530-3S": {
    wipComponents: JSON.stringify([
      {
        wipCode: "{PRODUCT_CODE} -Base",
        wipType: "SOFA_BASE",
        processes: [{ deptCode: "FAB_SEW", category: "", minutes: 42 }],
      },
    ]),
    l1Processes: JSON.stringify([{ deptCode: "PACKING", category: "", minutes: 10 }]),
    baseModel: "5530",
  },
};
const KEY = breakBomIntoWips(BOMS["5530-3S"].wipComponents, "5530-3S", null)[0].wipKey;

const card = (jcId, over = {}) => ({
  id: "pord-1", salesOrderId: "so-1", productCode: "5530-3S", itemCategory: "SOFA", quantity: 1,
  currentDepartment: null, targetEndDate: null, startDate: null, sizeCode: "", sizeLabel: "",
  fabricCode: "F1", gapInches: null, divanHeightInches: null, legHeightInches: null,
  jcId, wipKey: KEY, deptCode: "FAB_SEW", deptName: "Fab Sew", wipLabel: "5530-3S -Base",
  wipQty: 1, status: "WAITING", dueDate: "2026-10-20", pic1Name: "Ali", pic2Name: null,
  oldMinutes: 38, poNo: "PO-1", companySOId: "SO-2610-001", customerName: "Test Co",
  specialOrder: null, repairScope: null, ...over,
});

const CARDS = [
  card("sew"), // 38 -> 42
  card("same", { oldMinutes: 42 }), // unchanged
  card("pack", { wipKey: "FG", deptCode: "PACKING", oldMinutes: 8 }), // dept not in scope
];

function makeDb(cards = CARDS, changesFor = () => 1) {
  const selects = [];
  const writes = [];
  function prepare(sql) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    let bound = [];
    const rows = () => {
      if (/FROM bom_templates/.test(s)) return BOMS[bound[0]] ? [BOMS[bound[0]]] : [];
      if (/FROM job_cards jc JOIN production_orders/.test(s)) {
        if (/jc\.id IN/.test(s)) return cards.filter((c) => bound.includes(c.jcId));
        return cards.filter((c) => bound.includes(c.productCode));
      }
      return [];
    };
    const stmt = {
      sql: s,
      bind(...a) { bound = a; stmt.bound = a; return stmt; },
      async first() { return rows()[0] ?? null; },
      async all() {
        if (/FROM job_cards jc/.test(s)) selects.push({ sql: s, bound });
        return { results: rows() };
      },
    };
    return stmt;
  }
  return {
    selects,
    writes,
    db: {
      prepare,
      async batch(stmts) {
        return stmts.map((st) => {
          writes.push({ sql: st.sql, bound: st.bound });
          const changes = /^UPDATE job_cards/.test(st.sql) ? changesFor(st.bound[2]) : 1;
          return { results: [], success: true, meta: { changes } };
        });
      },
    },
  };
}

async function call(db, body, role = "SUPER_ADMIN") {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", role);
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", app);
  const res = await parent.request("/refresh-open-minutes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const SCOPE = [{ deptCode: "FAB_SEW", productCodes: ["5530-3S"] }];

test("TC-07 preview lists the changed card with its details and writes nothing", async () => {
  const f = makeDb();
  const { status, body } = await call(f.db, { dryRun: true, scope: SCOPE });
  assert.equal(status, 200);
  assert.equal(f.writes.length, 0, "a preview must not write");
  assert.equal(body.changes.length, 1);
  const r = body.changes[0];
  assert.equal(r.jcId, "sew");
  assert.equal(r.soNo, "SO-2610-001");
  assert.equal(r.poNo, "PO-1");
  assert.equal(r.deptName, "Fab Sew");
  assert.equal(r.dueDate, "2026-10-20");
  assert.equal(r.workers, "Ali");
  assert.equal(r.oldMinutes, 38);
  assert.equal(r.newMinutes, 42);
  assert.equal(body.unchanged, 1);
  assert.ok(!body.changes.some((x) => x.jcId === "pack"), "a dept outside the scope is not listed");
});

test("TC-08 only unfinished cards are selected", async () => {
  const f = makeDb();
  await call(f.db, { dryRun: true, scope: SCOPE });
  assert.match(f.selects[0].sql, /jc\.status IN \('WAITING','IN_PROGRESS','PAUSED','BLOCKED'\)/);
  assert.doesNotMatch(f.selects[0].sql, /COMPLETED|TRANSFERRED/);
});

test("TC-09 apply recomputes, writes guarded updates and audits only real changes", async () => {
  // "gone" was finished by a worker after the preview: the guard leaves it alone.
  const cards = [card("sew"), card("gone", { oldMinutes: 30 })];
  const f = makeDb(cards, (id) => (id === "gone" ? 0 : 1));
  const { status, body } = await call(f.db, { dryRun: false, jcIds: ["sew", "gone"] });
  assert.equal(status, 200);
  assert.equal(body.updated, 1);
  assert.equal(body.leftAlone, 1);
  const updates = f.writes.filter((w) => /^UPDATE job_cards/.test(w.sql));
  assert.deepEqual(updates.map((u) => u.bound), [[42, 42, "sew", 38], [42, 42, "gone", 30]]);
  for (const u of updates) {
    assert.match(u.sql, /status IN \('WAITING','IN_PROGRESS','PAUSED','BLOCKED'\)/);
    assert.match(u.sql, /COALESCE\(productionTimeMinutes, 0\) = \?/);
  }
  const audits = f.writes.filter((w) => /INSERT INTO audit_events/.test(w.sql));
  assert.equal(audits.length, 1, "only the card that really changed is audited");
  assert.ok(audits[0].bound.includes("refresh-open-minutes-from-bom"));
});

test("TC-10 apply ignores minutes sent by the client", async () => {
  const f = makeDb();
  await call(f.db, { dryRun: false, jcIds: ["sew"], minutes: 999, changes: [{ jcId: "sew", newMinutes: 999 }] });
  const updates = f.writes.filter((w) => /^UPDATE job_cards/.test(w.sql));
  assert.deepEqual(updates[0].bound, [42, 42, "sew", 38]);
});

test("TC-11 missing scope or ids is refused before any query", async () => {
  const f = makeDb();
  assert.equal((await call(f.db, { dryRun: true })).status, 400);
  assert.equal((await call(f.db, { dryRun: false, jcIds: [] })).status, 400);
  assert.equal(f.selects.length, 0);
});

test("TC-12 a role without production-orders:update is refused", async () => {
  const f = makeDb();
  const { status } = await call(f.db, { dryRun: true, scope: SCOPE }, "SALES");
  assert.equal(status, 403);
  assert.equal(f.selects.length, 0);
});
