// Production orders must price from their real sales/consignment-order line.
// production_orders.lineNo is the builder's running PIECE number across the
// whole order (SB02 x4 -> pieces 3-6), so joining it to the order line priced
// SO-2610-074's SB02 at RM 180 / 80 / 150 / 0 and its A01 at 0 / 0 instead of
// RM 180 x4 and RM 80 x2. source_line_no now holds the real line.
// Run: node --import tsx/esm --test tests/production-order-line.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import {
  PRODUCTION_ORDER_LINE_SQL,
  assignSourceLines,
  lineByPieceSequence,
} from "../src/api/lib/production-order-line.ts";
import { planSourceLineBackfill } from "../src/api/lib/production-order-line-backfill.ts";
import orderLinesApp from "../src/api/routes/production-order-lines.ts";

const item = (lineNo, productCode, quantity, itemCategory, unitPriceSen) =>
  ({ lineNo, productCode, quantity, itemCategory, unitPriceSen });

const SO_2610_074 = [
  item(1, "8211-6FT", 1, "BEDFRAME", 82500),
  item(2, "8211-7FT", 1, "BEDFRAME", 82500),
  item(3, "SB02", 4, "ACCESSORY", 18000),
  item(4, "A01", 2, "ACCESSORY", 8000),
  item(5, "BC05-MF", 4, "ACCESSORY", 15000),
];
const PIECE_PRODUCTS = ["8211-6FT", "8211-7FT", "SB02", "SB02", "SB02", "SB02", "A01", "A01",
  "BC05-MF", "BC05-MF", "BC05-MF", "BC05-MF"];
const productionOrdersByPiece = (orderKey = "SO:so-74") =>
  PIECE_PRODUCTS.map((productCode, index) => ({
    id: `pord-74-${String(index + 1).padStart(2, "0")}`,
    poNo: `SO-2610-074-${String(index + 1).padStart(2, "0")}`,
    lineNo: index + 1,
    productCode,
    quantity: 1,
    orderKey,
  }));

test("piecesFollowTheBuilderFanOut", () => {
  const bySequence = lineByPieceSequence([...SO_2610_074, item(6, "5567-1A(LHF)", 1, "SOFA", 0)]);
  assert.equal(bySequence.size, 13, "4 SB02 + 2 A01 + 4 BC05 + 2 beds + 1 sofa set");
  assert.equal(bySequence.get(13).productCode, "5567-1A(LHF)", "a sofa line is one piece");
});

test("eachPieceOfSo2610074MapsBackToItsOwnLine", () => {
  const assignments = assignSourceLines(SO_2610_074, productionOrdersByPiece());
  assert.deepEqual(assignments.map((a) => a.sourceLineNo), [1, 2, 3, 3, 3, 3, 4, 4, 5, 5, 5, 5]);
  assert.ok(assignments.every((a) => a.method === "pieceSequence"));
});

test("oldOrdersNumberedByLineKeepTheirLine", () => {
  const legacy = SO_2610_074.map((line) => ({ id: `old-${line.lineNo}`, lineNo: line.lineNo, productCode: line.productCode }));
  const assignments = assignSourceLines(SO_2610_074, legacy);
  assert.deepEqual(assignments.map((a) => a.sourceLineNo), [1, 2, 3, 4, 5]);
  assert.ok(assignments.every((a) => a.method === "sameLineNo"));
});

test("aStrayNumberFallsBackToTheOnlyLineWithThatProduct", () => {
  const [assignment] = assignSourceLines(SO_2610_074, [{ id: "x", lineNo: 99, productCode: "A01" }]);
  assert.deepEqual(assignment, { productionOrderId: "x", sourceLineNo: 4, method: "onlyLineForProduct" });
});

test("aProductNotOnTheOrderStaysUnresolved", () => {
  const [assignment] = assignSourceLines(SO_2610_074, [{ id: "y", lineNo: 3, productCode: "NOT-ON-ORDER" }]);
  assert.deepEqual(assignment, { productionOrderId: "y", sourceLineNo: null, method: "unresolved" });
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const PRICE_LOOKUP_FILES = [
  "src/api/lib/production-revenue.ts",
  "src/api/lib/dept-revenue.ts",
  "src/api/routes/dashboard-overview.ts",
  "src/api/routes/working-hour-entries.ts",
];

test("everyPriceLookupMatchesTheRealLineNotThePieceNumber", () => {
  assert.equal(PRODUCTION_ORDER_LINE_SQL, "COALESCE(po.source_line_no, po.lineNo)");
  for (const file of PRICE_LOOKUP_FILES) {
    const source = read(file);
    assert.doesNotMatch(source, /lineNo = po\.lineNo/, `${file} still joins on the piece number`);
    assert.match(source, /soi\.lineNo = \$\{PRODUCTION_ORDER_LINE_SQL\}/, file);
    assert.match(source, /coi\.lineNo = \$\{PRODUCTION_ORDER_LINE_SQL\}/, file);
    assert.match(source, /await ensureProductionOrderSourceLine\(/, `${file} must make sure the column exists`);
  }
});

test("newProductionOrdersStoreTheirRealLine", () => {
  const builder = read("src/api/routes/_shared/production-builder.ts");
  assert.match(builder, /created_at, updated_at, source_line_no\)/);
  assert.match(builder, /nowIso,\s+nowIso,\s+item\.lineNo,\s+\),/);
  assert.match(builder, /await ensureProductionOrderSourceLine\(db\);/);
});

function makeDb() {
  const writes = [];
  const audits = [];
  const items = SO_2610_074.map((line) => ({ ...line, orderKey: "SO:so-74" }));
  const prepare = (rawSql) => {
    const sql = String(rawSql).replace(/\s+/g, " ").trim();
    let bound = [];
    const rows = () => {
      if (/FROM production_orders WHERE source_line_no IS NULL AND/.test(sql)) return productionOrdersByPiece();
      if (/FROM sales_order_items/.test(sql)) return items;
      return [];
    };
    const record = () => {
      if (/^UPDATE production_orders SET source_line_no/.test(sql)) writes.push({ sql, bound });
      if (/INSERT INTO audit_events/.test(sql)) audits.push(bound);
    };
    const statement = {
      bind(...values) { bound = values; return statement; },
      async all() { return { results: rows() }; },
      async first() { return rows()[0] ?? null; },
      async run() { record(); return { success: true }; },
      record,
    };
    return statement;
  };
  return { writes, audits, db: { prepare, async batch(statements) { statements.forEach((s) => s.record()); return []; } } };
}

async function callBackfill(db, query) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", orderLinesApp);
  const response = await parent.request(`/backfill-source-lines${query}`, { method: "POST" });
  return response.json();
}

test("backfillPlanShowsSo2610074PriceGap", async () => {
  const { db } = makeDb();
  const plan = await planSourceLineBackfill(db);
  assert.equal(plan.scanned, 12);
  assert.equal(plan.lineChanged, 9, "pieces 4-12 move to their real line");
  assert.equal(plan.priceBasisDeltaSen, 107000, "RM 1,070 of price basis was on the wrong line or missing");
  const piece6 = plan.fills.find((fill) => fill.poNo === "SO-2610-074-06");
  assert.deepEqual([piece6.oldUnitPriceSen, piece6.newUnitPriceSen], [null, 18000]);
});

test("dryRunWritesNothing", async () => {
  const fake = makeDb();
  const body = await callBackfill(fake.db, "?dryRun=true");
  assert.equal(body.dryRun, true);
  assert.equal(body.toFill, 12);
  assert.equal(body.lineChangedSamples.length, 9);
  assert.equal(fake.writes.length, 0);
});

test("liveRunFillsOnlyEmptyRowsAndAuditsEveryMovedLine", async () => {
  const fake = makeDb();
  const body = await callBackfill(fake.db, "");
  assert.equal(body.updated, 12);
  assert.equal(fake.writes.length, 12);
  assert.ok(fake.writes.every((w) => /WHERE id = \? AND source_line_no IS NULL/.test(w.sql)));
  assert.equal(fake.audits.length, 9, "only orders whose line actually moved get an audit row");
  assert.ok(fake.audits.every((a) => a.includes("backfill-source-line")));
});
