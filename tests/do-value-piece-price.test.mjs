// ---------------------------------------------------------------------------
// do-value-piece-price.test.mjs — HK-0120 / BUG-2026-10-28-398.
//
// SV-2610-035: six SERVICE CHARGE lines share product, size and fabric at six
// prices. `priceForItem`'s first-one-wins key priced all eight pieces at line
// 1's RM270 (invoice RM2,160 against an order of RM1,950). `buildPiecePrices`
// replays the builder's per-piece PO counter to send each piece to its own line.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try {
  register("tsx/esm", pathToFileURL("./"));
} catch {}

const { buildPiecePrices, priceForItem } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/lib/do-value.ts")).href
);

const SO = "so-84d8299b";
const line = (lineNo, quantity, unitPriceSen, extra = {}) => ({
  salesOrderId: SO,
  productCode: "SERVICE CHARGE ",
  sizeCode: "-",
  fabricCode: "RANDOM",
  unitPriceSen,
  lineNo,
  quantity,
  itemCategory: "SERVICE",
  ...extra,
});
const po = (n, extra = {}) => ({
  id: `pord-${SO}-${String(n).padStart(2, "0")}`,
  salesOrderId: SO,
  productCode: "SERVICE CHARGE ",
  sizeCode: "-",
  fabricCode: "RANDOM",
  lineNo: n,
  ...extra,
});

const SV_035 = [
  line(1, 2, 27000),
  line(2, 2, 25000),
  line(3, 1, 22000),
  line(4, 1, 21000),
  line(5, 1, 25000),
  line(6, 1, 23000),
];

function index(items, pos) {
  const poById = new Map(pos.map((p) => [p.id, p]));
  const byFull = new Map();
  for (const si of items) {
    const fk = `${si.salesOrderId}|${si.productCode}|${si.sizeCode}|${si.fabricCode}`;
    if (!byFull.has(fk)) byFull.set(fk, si.unitPriceSen);
  }
  return {
    poById,
    byFull,
    byCode: new Map(),
    byAnyCode: new Map(),
    byPiece: buildPiecePrices(pos, items),
  };
}

test("SV-2610-035: each piece bills its own line, total equals the order", () => {
  const pos = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => po(n));
  const idx = index(SV_035, pos);
  const prices = pos.map((p) => priceForItem(idx, p.id, SO, p.productCode));
  assert.deepEqual(prices, [27000, 27000, 25000, 25000, 22000, 21000, 25000, 23000]);
  assert.equal(prices.reduce((a, b) => a + b, 0), 195000);
});

test("lines that agree on price stay on the existing tiers", () => {
  const items = [line(1, 1, 30000), line(2, 1, 30000)];
  const pos = [po(1), po(2)];
  assert.equal(buildPiecePrices(pos, items).size, 0);
});

test("a SOFA line is one PO whatever its quantity", () => {
  const items = [
    line(1, 3, 90000, { itemCategory: "SOFA", productCode: "S1" }),
    line(2, 1, 40000),
    line(3, 1, 45000),
  ];
  const pos = [po(1, { productCode: "S1" }), po(2), po(3)];
  const m = buildPiecePrices(pos, items);
  assert.equal(m.get(pos[1].id), 40000);
  assert.equal(m.get(pos[2].id), 45000);
});

test("a replayed slot that does not carry the PO's own key is not used", () => {
  const items = [line(1, 1, 27000), line(2, 1, 25000)];
  // Counter drifted: slot 2 now holds another product.
  const drifted = [line(1, 1, 27000), line(2, 1, 99000, { productCode: "OTHER" }), line(3, 1, 25000)];
  const pos = [po(1), po(2)];
  assert.equal(buildPiecePrices(pos, items).get(pos[1].id), 25000);
  assert.equal(buildPiecePrices(pos, drifted).has(pos[1].id), false);
});

test("no lineNo on the PO falls through", () => {
  const pos = [po(1, { lineNo: null })];
  assert.equal(buildPiecePrices(pos, SV_035).size, 0);
});

test("an index without byPiece prices as before (admin repair sweep)", () => {
  const pos = [1, 2, 3].map((n) => po(n));
  const idx = index(SV_035, pos);
  delete idx.byPiece;
  assert.deepEqual(
    pos.map((p) => priceForItem(idx, p.id, SO, p.productCode)),
    [27000, 27000, 27000],
  );
});
