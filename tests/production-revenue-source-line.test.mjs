// BUG-2026-11-11-426: production orders store a running piece number in
// lineNo, so revenue priced later pieces of a multi-qty line from the wrong
// order line (or none). Runs the real loader SQL against node:sqlite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  /* older Node, every SQL case below skips */
}
const needsSqlite = DatabaseSync ? {} : { skip: "node:sqlite requires Node 22+" };

const { loadProductionRevenue } = await import("../src/api/lib/production-revenue.ts");
const { PO_SOURCE_LINE_JOINS } = await import("../src/api/lib/po-source-line.ts");
const { translateSql } = await import("../src/api/lib/supabase-compat.ts");

const DAY = "2026-10-20";

function makeDb({ soLines = [], coLines = [], orders = [], products = [] }) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE production_orders (id TEXT PRIMARY KEY, salesOrderId TEXT, salesOrderNo TEXT,
    consignmentOrderId TEXT, companyCOId TEXT, lineNo INTEGER, productCode TEXT, productName TEXT,
    customerName TEXT, itemCategory TEXT, quantity INTEGER, status TEXT)`);
  db.exec(`CREATE TABLE sales_order_items (id TEXT PRIMARY KEY, salesOrderId TEXT, lineNo INTEGER,
    productCode TEXT, itemCategory TEXT, quantity INTEGER, unitPriceSen INTEGER)`);
  db.exec(`CREATE TABLE consignment_order_items (id TEXT PRIMARY KEY, consignmentOrderId TEXT, lineNo INTEGER,
    productCode TEXT, itemCategory TEXT, quantity INTEGER, unitPriceSen INTEGER)`);
  db.exec(`CREATE TABLE job_cards (id TEXT PRIMARY KEY, productionOrderId TEXT, departmentCode TEXT,
    status TEXT, completedDate TEXT)`);
  db.exec(`CREATE TABLE products (id TEXT PRIMARY KEY, code TEXT, basePriceSen INTEGER, price1Sen INTEGER)`);

  const insertLine = (table, orderColumn) =>
    db.prepare(`INSERT INTO ${table} (id, ${orderColumn}, lineNo, productCode, itemCategory, quantity, unitPriceSen)
                VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertSoLine = insertLine("sales_order_items", "salesOrderId");
  const insertCoLine = insertLine("consignment_order_items", "consignmentOrderId");
  for (const line of soLines) insertSoLine.run(line.id, line.orderId, line.lineNo, line.code, line.category ?? "BEDFRAME", line.qty, line.priceSen);
  for (const line of coLines) insertCoLine.run(line.id, line.orderId, line.lineNo, line.code, line.category ?? "BEDFRAME", line.qty, line.priceSen);

  const insertOrder = db.prepare(`INSERT INTO production_orders (id, salesOrderId, salesOrderNo, consignmentOrderId,
    companyCOId, lineNo, productCode, productName, customerName, itemCategory, quantity, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Cust', ?, 1, ?)`);
  const insertCard = db.prepare(`INSERT INTO job_cards VALUES (?, ?, 'UPHOLSTERY', 'COMPLETED', ?)`);
  for (const order of orders) {
    insertOrder.run(order.id, order.soId ?? null, order.soId ?? null, order.coId ?? null, order.coId ?? null,
      order.pieceNo, order.code, order.code, order.category ?? "BEDFRAME", order.status ?? "COMPLETED");
    insertCard.run(`jc-${order.id}`, order.id, DAY);
  }
  const insertProduct = db.prepare(`INSERT INTO products VALUES (?, ?, ?, NULL)`);
  for (const product of products) insertProduct.run(`p-${product.code}`, product.code, product.priceSen);

  return {
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      }),
    }),
  };
}

async function unitPriceByOrder(fixture) {
  const rows = await loadProductionRevenue(makeDb(fixture), DAY, DAY);
  return Object.fromEntries(rows.map((row) => [row.poId, row.unitPriceSen]));
}

test("SO-2610-074 shape: all four SB02 pieces price at their own RM 180 line", needsSqlite, async () => {
  const soLines = [
    { id: "l1", orderId: "so", lineNo: 1, code: "X1", qty: 1, priceSen: 10000 },
    { id: "l2", orderId: "so", lineNo: 2, code: "X2", qty: 1, priceSen: 12000 },
    { id: "l3", orderId: "so", lineNo: 3, code: "SB02", qty: 4, priceSen: 18000 },
    { id: "l4", orderId: "so", lineNo: 4, code: "A01", qty: 1, priceSen: 8000 },
    { id: "l5", orderId: "so", lineNo: 5, code: "BC05-MF", qty: 1, priceSen: 15000 },
  ];
  const codes = ["X1", "X2", "SB02", "SB02", "SB02", "SB02", "A01", "BC05-MF"];
  const orders = codes.map((code, index) => ({ id: `po${index + 1}`, soId: "so", pieceNo: index + 1, code }));
  const prices = await unitPriceByOrder({ soLines, orders });
  assert.deepEqual(
    [prices.po3, prices.po4, prices.po5, prices.po6, prices.po7, prices.po8],
    [18000, 18000, 18000, 18000, 8000, 15000],
  );
});

test("a qty-3 line followed by a dearer line: each piece takes its own line", needsSqlite, async () => {
  const prices = await unitPriceByOrder({
    soLines: [
      { id: "l1", orderId: "so", lineNo: 1, code: "BED", qty: 3, priceSen: 30000 },
      { id: "l2", orderId: "so", lineNo: 2, code: "KING", qty: 1, priceSen: 83000 },
    ],
    orders: [
      { id: "po1", soId: "so", pieceNo: 1, code: "BED" },
      { id: "po2", soId: "so", pieceNo: 2, code: "BED" },
      { id: "po3", soId: "so", pieceNo: 3, code: "BED" },
      { id: "po4", soId: "so", pieceNo: 4, code: "KING" },
    ],
  });
  assert.deepEqual(prices, { po1: 30000, po2: 30000, po3: 30000, po4: 83000 });
});

test("a piece whose product is on no line keeps today's price", needsSqlite, async () => {
  const prices = await unitPriceByOrder({
    soLines: [{ id: "l1", orderId: "so", lineNo: 1, code: "BED", qty: 1, priceSen: 30000 }],
    orders: [{ id: "po1", soId: "so", pieceNo: 1, code: "OTHER" }],
  });
  assert.equal(prices.po1, 30000);
});

test("a piece with no line falls back to the catalogue, never a silent RM 0", needsSqlite, async () => {
  const prices = await unitPriceByOrder({
    soLines: [{ id: "l1", orderId: "so", lineNo: 1, code: "BED", qty: 1, priceSen: 30000 }],
    orders: [
      { id: "po1", soId: "so", pieceNo: 1, code: "BED" },
      { id: "po2", soId: "so", pieceNo: 2, code: "BED" },
    ],
    products: [{ code: "BED", priceSen: 25000 }],
  });
  assert.deepEqual(prices, { po1: 30000, po2: 25000 });
});

test("pieces taken from stock on an earlier line do not shift later lines", needsSqlite, async () => {
  const prices = await unitPriceByOrder({
    soLines: [
      { id: "l1", orderId: "so", lineNo: 1, code: "BED", qty: 3, priceSen: 10000 },
      { id: "l2", orderId: "so", lineNo: 2, code: "SOFA9", qty: 1, priceSen: 50000, category: "SOFA" },
    ],
    orders: [
      { id: "po1", soId: "so", pieceNo: 1, code: "BED" },
      { id: "po2", soId: "so", pieceNo: 2, code: "BED" },
      { id: "po3", soId: "so", pieceNo: 3, code: "SOFA9", category: "SOFA" },
    ],
  });
  assert.deepEqual(prices, { po1: 10000, po2: 10000, po3: 50000 });
});

test("a cancelled piece does not take a live piece's slot", needsSqlite, async () => {
  const prices = await unitPriceByOrder({
    soLines: [
      { id: "l1", orderId: "so", lineNo: 1, code: "BED", qty: 1, priceSen: 10000 },
      { id: "l2", orderId: "so", lineNo: 2, code: "BED", qty: 1, priceSen: 20000 },
    ],
    orders: [
      { id: "po1", soId: "so", pieceNo: 1, code: "BED", status: "CANCELLED" },
      { id: "po2", soId: "so", pieceNo: 2, code: "BED" },
      { id: "po3", soId: "so", pieceNo: 3, code: "BED" },
    ],
  });
  assert.equal(prices.po2, 10000);
  assert.equal(prices.po3, 20000);
});

test("consignment orders replay their own lines the same way", needsSqlite, async () => {
  const prices = await unitPriceByOrder({
    coLines: [
      { id: "c1", orderId: "co", lineNo: 1, code: "BED", qty: 2, priceSen: 40000 },
      { id: "c2", orderId: "co", lineNo: 2, code: "HB", qty: 1, priceSen: 90000 },
    ],
    orders: [
      { id: "po1", coId: "co", pieceNo: 1, code: "BED" },
      { id: "po2", coId: "co", pieceNo: 2, code: "BED" },
      { id: "po3", coId: "co", pieceNo: 3, code: "HB" },
    ],
  });
  assert.deepEqual(prices, { po1: 40000, po2: 40000, po3: 90000 });
});

test("the shared join translates to Postgres column names", () => {
  const translated = translateSql(PO_SOURCE_LINE_JOINS);
  assert.match(translated, /sales_order_id/);
  assert.match(translated, /consignment_order_id/);
  assert.doesNotMatch(translated, /salesOrderId|unitPriceSen|productCode|lineNo/);
});

test("every production revenue query prices from the replayed source line", () => {
  const files = [
    "src/api/lib/production-revenue.ts",
    "src/api/lib/dept-revenue.ts",
    "src/api/routes/dashboard-overview.ts",
    "src/api/routes/working-hour-entries.ts",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    const pieceNumberJoins = (source.match(/lineNo = po\.lineNo|line_no = po\.line_no/g) ?? []).length / 2;
    const replayJoins = (source.match(/\$\{PO_SOURCE_LINE_JOINS\}/g) ?? []).length;
    const replayPrices = (source.match(/\$\{PO_SOURCE_LINE_PRICES\}/g) ?? []).length;
    assert.ok(pieceNumberJoins > 0, `${file}: expected a revenue query`);
    assert.equal(replayJoins, pieceNumberJoins, `${file}: every revenue query needs PO_SOURCE_LINE_JOINS`);
    assert.equal(replayPrices, pieceNumberJoins, `${file}: every revenue query needs PO_SOURCE_LINE_PRICES`);
  }
});
