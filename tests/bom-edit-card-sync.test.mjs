// BUG-2026-11-11-497: saving BOM minutes (Edit BOM, bulk process edit, WIP
// Times inline edit, WIP Times Excel import) updates that product's job cards
// that are live or were completed this Malaysian month (payroll not run yet):
// a card at 0 gets the BOM minutes, and a card whose BOM step the save changed
// follows the new minutes. Cards completed earlier, cancelled cards and cards
// on steps the save did not change are never touched.
// Run: node --import tsx/esm --test tests/bom-edit-card-sync.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import bomApp from "../src/api/routes/bom.ts";
import wipTimesApp from "../src/api/routes/wip-times.ts";
import { breakBomIntoWips } from "../src/api/lib/bom-wip-breakdown.ts";
import {
  currentMonthStartMY,
  decideCardMinutes,
  syncJobCardMinutesToBomChanges,
} from "../src/api/lib/bom-edit-card-sync.ts";
import { todayYmdMY } from "../src/lib/utils.ts";

const coverBom = (code, { sew = 15, upholstery = 20 } = {}) =>
  JSON.stringify([
    {
      wipCode: `${code} Cover`,
      wipType: "HEADBOARD",
      processes: [
        { deptCode: "FAB_SEW", category: "", minutes: sew },
        { deptCode: "UPHOLSTERY", category: "", minutes: upholstery },
      ],
    },
  ]);
const wipKeyOf = (code) => breakBomIntoWips(coverBom(code), code, null)[0].wipKey;
const LIVE = ["WAITING", "IN_PROGRESS", "PAUSED", "BLOCKED"];

const productionOrder = (id, productCode) => ({
  id, poNo: `SO-${id}`, salesOrderId: "so-1", productCode, itemCategory: "BEDFRAME", quantity: 1,
  currentDepartment: null, targetEndDate: null, startDate: null, sizeCode: "", sizeLabel: "",
  fabricCode: "", gapInches: null, divanHeightInches: null, legHeightInches: null,
});

const bomTemplate = (id, productCode) => ({
  id, productCode, baseModel: productCode, category: "BEDFRAME", versionStatus: "ACTIVE", orgId: "hookka",
  wipComponents: coverBom(productCode), l1Processes: "[]", version: "1.0", effectiveFrom: "2026-01-01",
  effectiveTo: null, changeLog: null,
});

function makeStore({ failCardSelect = false } = {}) {
  const boms = [bomTemplate("bom-bc05", "BC05"), bomTemplate("bom-5567", "5567")];
  const orders = { "po-1": productionOrder("po-1", "BC05"), "po-2": productionOrder("po-2", "5567") };
  const card = (jcId, poId, deptCode, status, minutes, extra = {}) => ({
    jcId, poId, deptCode, status, minutes, completedDate: null,
    wipKey: wipKeyOf(orders[poId].productCode), ...extra,
  });
  const cards = [
    card("live-15", "po-1", "FAB_SEW", "WAITING", 15),
    card("live-0", "po-1", "FAB_SEW", "IN_PROGRESS", 0),
    card("done-this-month-15", "po-1", "FAB_SEW", "COMPLETED", 15, { completedDate: todayYmdMY() }),
    card("done-earlier-15", "po-1", "FAB_SEW", "COMPLETED", 15, { completedDate: "2020-01-15" }),
    card("cancelled-15", "po-1", "FAB_SEW", "CANCELLED", 15),
    card("upholstery-manual-12", "po-1", "UPHOLSTERY", "WAITING", 12),
    card("old-fg-main-sew", "po-1", "FAB_SEW", "WAITING", 15, { wipKey: "BC05::FG_MAIN" }),
    card("other-product-15", "po-2", "FAB_SEW", "WAITING", 15),
  ];
  const cardSelects = [];
  const cardUpdates = [];
  const audits = [];

  function selectCandidates(sql, bound) {
    cardSelects.push({ sql, bound });
    if (failCardSelect) throw new Error("connection reset");
    const [completedFrom, ...productCodes] = bound;
    const isInWindow = (c) => LIVE.includes(c.status) || (c.completedDate !== null && c.completedDate >= completedFrom);
    return cards
      .filter((c) => c.status !== "CANCELLED" && isInWindow(c))
      .filter((c) => productCodes.includes(orders[c.poId].productCode))
      .map((c) => ({ ...orders[c.poId], jcId: c.jcId, wipKey: c.wipKey, deptCode: c.deptCode, minutes: c.minutes }));
  }

  function rowsFor(sql, bound) {
    if (/FROM bom_templates bt LEFT JOIN products/.test(sql)) {
      return boms.map((b) => ({ ...b, defaultVariants: null, sizeCode: "", sizeLabel: "" }));
    }
    if (/SELECT \* FROM bom_templates WHERE id = \?/.test(sql)) {
      return boms.filter((b) => b.id === bound[0]).map((b) => ({ ...b }));
    }
    if (/FROM job_cards jc JOIN production_orders/.test(sql)) return selectCandidates(sql, bound);
    if (/FROM job_cards WHERE productionOrderId = \?/.test(sql)) {
      return cards.filter((c) => c.poId === bound[0] && c.status !== "CANCELLED")
        .map((c) => ({ wipKey: c.wipKey, deptCode: c.deptCode }));
    }
    return [];
  }

  function execute(sql, bound) {
    const bomUpdate = sql.match(/^UPDATE bom_templates SET (.+) WHERE id = \?/);
    if (bomUpdate) {
      const columns = bomUpdate[1].split(",").map((part) => part.split("=")[0].trim());
      const bom = boms.find((b) => b.id === bound[columns.length]);
      columns.forEach((column, i) => { bom[column] = bound[i]; });
    }
    if (/^UPDATE job_cards SET productionTimeMinutes/.test(sql)) {
      cardUpdates.push({ sql, bound });
      const [toMinutes, , jcId, fromMinutes] = bound;
      const target = cards.find((c) => c.jcId === jcId && c.minutes === fromMinutes);
      if (target) target.minutes = toMinutes;
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
  const setBom = (id, fields) => Object.assign(boms.find((b) => b.id === id), fields);
  return { db, minutesOf, setBom, cardSelects, cardUpdates, audits };
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

const editWipTime = (store, wipLabel, deptCode, minutes) =>
  send(wipTimesApp, store.db, "PUT", "/", { wipLabel, deptCode, minutes });

function assertUntouchedOutsideTheWindow(store) {
  assert.equal(store.minutesOf("done-earlier-15"), 15, "a card completed before this month keeps its minutes (pay already ran)");
  assert.equal(store.minutesOf("cancelled-15"), 15, "a cancelled card is never touched");
  assert.equal(store.minutesOf("upholstery-manual-12"), 12, "a card on a step the save did not change keeps its minutes");
  assert.equal(store.minutesOf("old-fg-main-sew"), 15, "an old FG_MAIN card that would double-count its dept is skipped");
}

test("wipTimesEditMovesUnfinishedAndThisMonthCardsOfTheEditedStep", async () => {
  const store = makeStore();
  const { status, body } = await editWipTime(store, "BC05 Cover", "FAB_SEW", 25);
  assert.equal(status, 200);
  assert.deepEqual(body.jobCardMinutes, { updated: 3, scanned: 5 });
  assert.equal(store.minutesOf("live-15"), 25, "an unfinished card follows the edited step");
  assert.equal(store.minutesOf("live-0"), 25, "an unfinished card at 0 gets the minutes");
  assert.equal(store.minutesOf("done-this-month-15"), 25, "this month's payroll has not run yet");
  assert.equal(store.minutesOf("other-product-15"), 15, "another product's card is out of scope");
  assertUntouchedOutsideTheWindow(store);
});

test("wipTimesExcelImportMovesCardsOfEveryEditedProduct", async () => {
  const store = makeStore();
  const { body } = await send(wipTimesApp, store.db, "POST", "/bulk-import", {
    items: [
      { wipLabel: "BC05 Cover", deptCode: "FAB_SEW", minutes: 25 },
      { wipLabel: "5567 Cover", deptCode: "FAB_SEW", minutes: 40 },
    ],
  });
  assert.deepEqual(body.jobCardMinutes, { updated: 4, scanned: 6 });
  assert.equal(store.minutesOf("live-15"), 25);
  assert.equal(store.minutesOf("other-product-15"), 40);
  assertUntouchedOutsideTheWindow(store);
});

test("wipTimesExcelImportDryRunTouchesNoCard", async () => {
  const store = makeStore();
  const { body } = await send(wipTimesApp, store.db, "POST", "/bulk-import", {
    dryRun: true,
    items: [{ wipLabel: "BC05 Cover", deptCode: "FAB_SEW", minutes: 25 }],
  });
  assert.deepEqual(body.jobCardMinutes, { updated: 0, scanned: 0 });
  assert.equal(store.cardSelects.length, 0);
  assert.equal(store.minutesOf("live-15"), 15);
});

test("settingAStepToZeroNeverZeroesCards", async () => {
  const store = makeStore();
  const { body } = await editWipTime(store, "BC05 Cover", "FAB_SEW", 0);
  assert.deepEqual(body.jobCardMinutes, { updated: 0, scanned: 5 });
  assert.equal(store.minutesOf("live-15"), 15);
});

test("editBomSaveMovesCardsAndAuditsEachChangeAsSystem", async () => {
  const store = makeStore();
  const { status, body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05",
    { wipComponents: JSON.parse(coverBom("BC05", { sew: 18 })) });
  assert.equal(status, 200);
  assert.deepEqual(body.jobCardMinutes, { updated: 3, scanned: 5 });
  assert.equal(store.minutesOf("live-15"), 18);
  assert.equal(store.audits.length, 3);
  assert.ok(store.audits.every((audit) => audit.includes("sync-minutes-from-bom-edit")));
  assert.ok(store.audits.every((audit) => audit.includes("system")));
  assertUntouchedOutsideTheWindow(store);
});

test("eachCardWriteOnlyLandsIfTheCardStillHasTheMinutesThatWereRead", async () => {
  const store = makeStore();
  await editWipTime(store, "BC05 Cover", "FAB_SEW", 25);
  for (const update of store.cardUpdates) {
    assert.match(update.sql, /WHERE id = \? AND COALESCE\(productionTimeMinutes, 0\) = \?/);
  }
  const liveUpdate = store.cardUpdates.find((update) => update.bound[2] === "live-15");
  assert.deepEqual(liveUpdate.bound, [25, 25, "live-15", 15]);
});

test("editingADraftBomTouchesNoCard", async () => {
  const store = makeStore();
  store.setBom("bom-bc05", { versionStatus: "DRAFT" });
  const { body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05",
    { wipComponents: JSON.parse(coverBom("BC05", { sew: 18 })) });
  assert.deepEqual(body.jobCardMinutes, { updated: 0, scanned: 0 });
  assert.equal(store.cardSelects.length, 0);
});

test("editBomSaveWithoutProcessFieldsTouchesNoCard", async () => {
  const store = makeStore();
  const { body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05", { changeLog: "rename" });
  assert.equal(body.jobCardMinutes, null);
  assert.equal(store.cardSelects.length, 0);
});

test("bulkProcessEditMovesCardsOfTheEditedStep", async () => {
  const store = makeStore();
  const { body } = await send(bomApp, store.db, "POST", "/templates/bulk-process-edit", {
    edits: [{ templateId: "bom-bc05", path: [0], processIndex: 0, newCategory: "CAT 1", newMinutes: 30 }],
  });
  assert.deepEqual(body.jobCardMinutes, { updated: 3, scanned: 5 });
  assert.equal(store.minutesOf("done-this-month-15"), 30);
  assertUntouchedOutsideTheWindow(store);
});

test("aFailedCardUpdateIsReportedAndTheBomSaveStillSucceeds", async () => {
  const store = makeStore({ failCardSelect: true });
  const { status, body } = await send(bomApp, store.db, "PUT", "/templates/bom-bc05",
    { wipComponents: JSON.parse(coverBom("BC05", { sew: 18 })) });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.jobCardMinutes, { error: "connection reset" });
});

test("cardsAreReadFromTheFirstOfTheCurrentMalaysianMonth", async () => {
  const store = makeStore();
  await editWipTime(store, "BC05 Cover", "FAB_SEW", 25);
  const [select] = store.cardSelects;
  assert.match(select.sql, /OR jc\.completedDate >= \?/);
  assert.match(select.sql, /jc\.status <> 'CANCELLED'/);
  assert.deepEqual(select.bound, [currentMonthStartMY(), "BC05"]);
  assert.match(currentMonthStartMY(), /^\d{4}-\d{2}-01$/);
  assert.equal(currentMonthStartMY().slice(0, 7), todayYmdMY().slice(0, 7));
});

test("noSavedChangesMeansNoQuery", async () => {
  const store = makeStore();
  const outcome = await syncJobCardMinutesToBomChanges({ var: { DB: store.db } }, []);
  assert.deepEqual(outcome, { updated: 0, scanned: 0 });
  assert.equal(store.cardSelects.length, 0);
});

test("decideCardMinutesRules", () => {
  assert.equal(decideCardMinutes(15, 15, 25), 25, "step changed: card follows");
  assert.equal(decideCardMinutes(12, 15, 25), 25, "step changed: card follows even if it differed before");
  assert.equal(decideCardMinutes(0, 0, 25), 25, "card at 0 gets the minutes");
  assert.equal(decideCardMinutes(0, null, 25), 25, "card at 0 gets the minutes with no earlier BOM");
  assert.equal(decideCardMinutes(12, 20, 20), null, "step unchanged: card keeps its own minutes");
  assert.equal(decideCardMinutes(12, null, 20), null, "no earlier BOM: only zeros are filled");
  assert.equal(decideCardMinutes(25, 15, 25), null, "already at the new minutes");
  assert.equal(decideCardMinutes(15, 15, 0), null, "a step set to 0 never zeroes a card");
  assert.equal(decideCardMinutes(15, 15, null), null, "the card no longer matches a BOM step");
});
