import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const f = await import(pathToFileURL(resolve(process.cwd(), "src/lib/fabric-fifo.ts")).href);

const layers = [
  { date: "2026-08-01", qty: 100, unitSen: 800 },
  { date: "2026-09-01", qty: 100, unitSen: 1000 },
  { date: "2026-10-01", qty: 100, unitSen: 1200 },
];

test("closing stock is the newest metres, usage comes from before it", () => {
  const m = f.fifoCostByMonth(layers, new Map([["2026-10", 50]]), "2026-10", 100);
  assert.deepEqual(m.get("2026-10"), { pricedMeters: 50, costSen: 50000 });
});

test("a month can straddle two layers", () => {
  const m = f.fifoCostByMonth(layers, new Map([["2026-10", 100]]), "2026-10", 50);
  assert.deepEqual(m.get("2026-10"), { pricedMeters: 100, costSen: 50 * 1000 + 50 * 1200 });
});

test("earlier months sit before later ones", () => {
  const usage = new Map([["2026-09", 100], ["2026-10", 100]]);
  const m = f.fifoCostByMonth(layers, usage, "2026-10", 100);
  assert.equal(m.get("2026-09").costSen, 80000);
  assert.equal(m.get("2026-10").costSen, 100000);
});

test("a month after the count runs forward into the closing stock", () => {
  const m = f.fifoCostByMonth(layers, new Map([["2026-11", 30]]), "2026-10", 100);
  assert.deepEqual(m.get("2026-11"), { pricedMeters: 30, costSen: 36000 });
});

test("usage with no receipt behind it stays unpriced", () => {
  const m = f.fifoCostByMonth(layers.slice(0, 1), new Map([["2026-10", 150]]), "2026-10", 0);
  assert.deepEqual(m.get("2026-10"), { pricedMeters: 100, costSen: 80000 });
});

test("the invoice and the order name the same fabric", () => {
  assert.equal(f.fabricCodeKey("HOK-BO315-21"), f.fabricCodeKey("BO315-21"));
  assert.equal(f.fabricCodeKey(" fabricHR805-90"), "HR805-90");
  assert.equal(f.fabricCodeKey("FAB 51BLK-A"), "FAB 51BLK-A");
});

test("an opening batch far above every purchase is not a layer", () => {
  assert.equal(f.openingIsCredible(3500, [850, 1200]), false);
  assert.equal(f.openingIsCredible(2500, [2100]), true);
  assert.equal(f.openingIsCredible(2500, []), true);
});

test("a count in rolls becomes metres through its value", () => {
  assert.equal(f.countedMeters({ qty: 19, uom: "ROLL", valueSen: 1254000 }, 1200), 1045);
  assert.equal(f.countedMeters({ qty: 54, uom: "MTR", valueSen: 113400 }, 2100), 54);
});
