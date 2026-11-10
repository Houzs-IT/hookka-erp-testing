// BUG-2026-11-11-497: saving BOM minutes (Edit BOM, bulk process edit, WIP
// Times inline edit, WIP Times Excel import) fills that product's job cards
// still at 0: live ones, and ones completed this Malaysian month (payroll not
// run yet). Cards completed earlier and cards with minutes are never touched.
// Run: node --import tsx/esm --test tests/bom-minutes-fill-zero-cards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import bomApp from "../src/api/routes/bom.ts";
import wipTimesApp from "../src/api/routes/wip-times.ts";
import { breakBomIntoWips } from "../src/api/lib/bom-wip-breakdown.ts";
import {
  currentMonthStartMY,
  fillZeroMinuteCardsForProducts,
  planZeroMinuteFills,
} from "../src/api/lib/fill-zero-minutes.ts";
import { todayYmdMY } from "../src/lib/utils.ts";

const coverBom = (code, minutes) =>
  JSON.stringify([
    { wipCode: `${code} Cover`, wipType: "HEADBOARD", processes: [{ deptCode: "FAB_SEW", category: "", minutes }] },
  ]);
const wipKeyOf = (code) => breakBomIntoWips(coverBom(code, 0), code, null)[0].wipKey;

const productionOrder = (id, productCode) => ({
  id, poNo: `SO-${id}`, salesOrderId: "so-1", productCode, itemCategory: "BEDFRAME", quantity: 1,
  currentDepartment: null, targetEndDate: null, startDate: null, sizeCode: "", sizeLabel: "",
  fabricCode: "", gapInches: null, divanHeightInches: null, legHeightInches: null,
});

function makeStore({ failCardSelect = false } = {}) {
  const boms = [
    { id: "bom-bc05", productCode: "BC05", baseModel: "BC05", category: "BEDFRAME", versionStatus: "ACTIVE",
      orgId: "hookka", wipComponents: coverBom("BC05", 0), l1Processes: "[]" },
    { id: "bom-5567", productCode: "5567", baseModel: "5567", category: "SOFA", versionStatus: "ACTIVE",
      orgId: "hookka", wipComponents: coverBom("5567", 0), l1Processes: "[]" },
  ];
  const orders = { "po-1": productionOrder("po-1", "BC05"), "po-2": productionOrder("po-2", "5567") };
  const bc05Card = (jcId, status, minutes, completedDate = null) =>
    ({ jcId, poId: "po-1", wipKey: wipKeyOf("BC05"), deptCode: "FAB_SEW", status, minutes, completedDate });
  const cards = [
    bc05Card("live", "WAITING", 0),
    bc05Card("done-this-month", "COMPLETED", 0, todayYmdMY()),
    bc05Card("done-earlier", "COMPLETED", 0, "2020-01-15"),
    bc05Card("has-minutes", "IN_PROGRESS", 12),
    { jcId: "other-product", poId: "po-2", wipKey: wipKeyOf("5567"), deptCode: "FAB_SEW", status: "WAITING", minutes: 0, completedDate: null },
  ];
  const cardSelects = [];
  const audits = [];

  function rowsFor(sql, bound) {
    if (/FROM bom_templates bt LEFT JOIN products/.test(sql)) {
      return boms.map((b) => ({ ...b, defaultVariants: null, sizeCode: "", sizeLabel: "" }));
    }
    if (/SELECT \* FROM bom_templates WHERE id = \?/.test(sql)) return boms.filter((b) => b.id === bound[0]);
    if (/FROM bom_templates WHERE productCode = \?/.test(sql)) return boms.filter((b) => b.productCode === bound[0]);
    if (/FROM job_cards jc JOIN production_orders/.test(sql)) {
      cardSelects.push({ sql, bound });
      if (failCardSelect) throw new Error("connection reset");
      const completedFrom = /completedDate >= \?/.test(sql) ? bound[0] : null;
      const codes = completedFrom ? bound.slice(1) : bound;
      const isLive = (c) => ["WAITING", "IN_PROGRESS", "PAUSED", "BLOCKED"].includes(c.status);
      const isDoneInRange = (c) => completedFrom !== null && c.completedDate !== null && c.completedDate >= completedFrom;
      return cards
        .filter((c) => c.minutes === 0 && (isLive(c) || isDoneInRange(c)))
        .filter((c) => codes.length === 0 || codes.includes(orders[c.poId].productCode))
        .map((c) => ({ ...orders[c.poId], jcId: c.jcId, wipKey: c.wipKey, deptCode: c.deptCode, status: c.status, completedDate: c.completedDate }));
    }
    if (/FROM job_cards WHERE productionOrderId = \?/.test(sql)) {
      return cards.filter((c) => c.poId === bound[0]).map((c) => ({ wipKey: c.wipKey, deptCode: c.deptCode }));
    }
    return [];
  }

  function execute(sql, bound) {
    const bomUpdate = sql.match(/^UPDATE bom_templates SET (.+) WHERE id = \?/);
    if (bomUpdate) {
      const bom = boms.find((b) => b.id === bound[bomUpdate[1].split(",").length]);
      bomUpdate[1].split(",").forEach((part, i) => { bom[part.split("=")[0].trim()] = bound[i]; });
    }
    if (/^UPDATE job_cards SET productionTimeMinutes/.test(sql)) {
      const card = cards.find((c) => c.jcId === bound[2] && c.minutes === 0);
      if (card) card.minutes = bound[0];
    }
    if (/INSERT INTO audit_events/.test(sql)) audits.push(bound);
  }

  function prepare(rawSql) {
    const sql = String(rawSql).replace(/\s+/g, " ").trim();
    let bound = [];
    const statement = {
      bind(...values) { bound = values; return statement; },
      async first() { return rowsFor(sql, bound)[0] ?? null; },
      async all() { return { results: rowsFor(sql, bound) }; },
      async run() { execute(sql, bound); return { success: true, meta: { changes: 1 } }; },
      runSync() { execute(sql, bound); },
    };
    return statement;
  }
  const db = { prepare, async batch(statements) { for (const s of statements) s.runSync(); return []; } };
  const minutesOf = (jcId) => cards.find((c) => c.jcId === jcId).minutes;
  return { db, minutesOf, cardSelects, audits };
}

function mount(routeApp, db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", routeApp);
  return parent;
}

async function send(routeApp, db, method, path, body) {
  const res = await mount(routeApp, db).request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("wipTimesInlineEditFillsLiveAndThisMonthCompletedZeroCardsOfThatProductOnly", async () => {
  const store = makeStore();
  const { status, body } = await send(wipTimesApp, store.db, "PUT", "/",
    { wipLabel: "BC05 Cover", deptCode: "FAB_SEW", minutes: 25 });
  assert.equal(status, 200);
  assert.deepEqual(body.zeroMinuteCards, { filled: 2, scanned: 2 });
  assert.equal(store.minutesOf("live"), 25);
  assert.equal(store.minutesOf("done-this-month"), 25, "this month's payroll has not run yet");
  assert.equal(store.minutesOf("done-earlier"), 0, "a card completed before this month keeps its minutes (pay already ran)");
  assert.equal(store.minutesOf("has-minutes"), 12, "a card with minutes is never overwritten");
  assert.equal(store.minutesOf("other-product"), 0, "another product's card is out of scope");
});

test("wipTimesExcelImportFillsZeroCardsOfEveryAppliedProduct", async () => {
  const store = makeStore();
  const { body } = await send(wipTimesApp, store.db, "POST", "/bulk-import", {
    items: [
      { wipLabel: "BC05 Cover", deptCode: "FAB_SEW", minutes: 25 },
      { wipLabel: "5567 Cover", deptCode: "FAB_SEW", minutes: 40 },
    ],
  });
  assert.deepEqual(body.zeroMinuteCards, { filled: 3, scanned: 3 });
  assert.equal(store.minutesOf("live"), 25);
  assert.equal(store.minutesOf("done-this-month"), 25);
  assert.equal(store.minutesOf("other-product"), 40);
});

test("wipTimesExcelImportDryRunFillsNothing", async () => {
  const store = makeStore();
  const { body } = await send(wipTimesApp, store.db, "POST", "/bulk-import", {
    dryRun: true,
    items: [{ wipLabel: "BC05 Cover", deptCode: "FAB_SEW", minutes: 25 }],
  });
  assert.deepEqual(body.zeroMinuteCards, { filled: 0, scanned: 0 });
  assert.equal(store.minutesOf("live"), 0);
  assert.equal(store.cardSelects.length, 0);
});

test("editBomSaveWithMinutesFillsZeroCardsAndAuditsAsSystem", async () => {
  const store = makeStore();
  const { status, body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05",
    { wipComponents: JSON.parse(coverBom("BC05", 18)) });
  assert.equal(status, 200);
  assert.deepEqual(body.zeroMinuteCards, { filled: 2, scanned: 2 });
  assert.equal(store.minutesOf("live"), 18);
  assert.equal(store.minutesOf("done-this-month"), 18);
  assert.equal(store.audits.length, 2);
  assert.ok(store.audits.every((audit) => audit.includes("fill-zero-minutes-from-bom")));
  assert.ok(store.audits.every((audit) => audit.includes("system")));
});

test("editBomSaveWithoutProcessFieldsDoesNotTouchCards", async () => {
  const store = makeStore();
  const { body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05", { changeLog: "rename" });
  assert.equal(body.zeroMinuteCards, null);
  assert.equal(store.cardSelects.length, 0);
});

test("bulkProcessEditFillsZeroCardsOfEditedTemplates", async () => {
  const store = makeStore();
  const { body } = await send(bomApp, store.db, "POST", "/templates/bulk-process-edit", {
    edits: [{ templateId: "bom-bc05", path: [0], processIndex: 0, newCategory: "CAT 1", newMinutes: 30 }],
  });
  assert.deepEqual(body.zeroMinuteCards, { filled: 2, scanned: 2 });
  assert.equal(store.minutesOf("live"), 30);
  assert.equal(store.minutesOf("done-earlier"), 0);
});

test("autoFillReachesBackToTheFirstOfTheCurrentMalaysianMonth", async () => {
  const store = makeStore();
  await fillZeroMinuteCardsForProducts({ var: { DB: store.db } }, ["BC05"]);
  const [select] = store.cardSelects;
  assert.match(select.sql, /OR jc\.completedDate >= \?/);
  assert.deepEqual(select.bound, [currentMonthStartMY(), "BC05"]);
  assert.match(currentMonthStartMY(), /^\d{4}-\d{2}-01$/);
  assert.equal(currentMonthStartMY().slice(0, 7), todayYmdMY().slice(0, 7));
});

test("aFailedFillIsReportedAndTheBomSaveStillSucceeds", async () => {
  const store = makeStore({ failCardSelect: true });
  const { status, body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05",
    { wipComponents: JSON.parse(coverBom("BC05", 18)) });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.zeroMinuteCards, { error: "connection reset" });
});

test("productScopedPlanSelectsOnlyLiveZeroCardsOfTheGivenProducts", async () => {
  const store = makeStore();
  await planZeroMinuteFills(store.db, { productCodes: ["BC05", "BC05", ""] });
  const [select] = store.cardSelects;
  assert.match(select.sql, /AND po\.productCode IN \(\?\)/);
  assert.deepEqual(select.bound, ["BC05"]);
  assert.match(select.sql, /jc\.status IN \('WAITING','IN_PROGRESS','PAUSED','BLOCKED'\)/);
  assert.doesNotMatch(select.sql, /completedDate >=/);
});

test("noProductsMeansNoQuery", async () => {
  const store = makeStore();
  const outcome = await fillZeroMinuteCardsForProducts({ var: { DB: store.db } }, []);
  assert.deepEqual(outcome, { filled: 0, scanned: 0 });
  assert.equal(store.cardSelects.length, 0);
});
