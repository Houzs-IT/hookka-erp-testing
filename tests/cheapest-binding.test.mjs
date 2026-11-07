import test from "node:test";
import assert from "node:assert/strict";
import { bindingIdForLine, cheapestBinding, monthsBefore, sortCheapestFirst, uniqueSkuOptions } from "../src/lib/cheapest-binding.ts";

const today = "2026-11-07";
const b = (id, unitPrice, extra = {}) => ({ id, unitPrice, currency: "MYR", priceValidTo: "", isMainSupplier: false, lastOrderedAt: "2026-10-20", ...extra });

test("the cheapest supplier comes up, not the Main one", () => {
  assert.equal(cheapestBinding([b("main", 1200, { isMainSupplier: true }), b("low", 1050)], today).id, "low");
});

test("a price from the API as text compares as a number", () => {
  assert.equal(cheapestBinding([b("a", "1000.0000"), b("b", "900.0000")], today).id, "b");
});

test("an expired price, a zero price and a foreign currency do not compete", () => {
  const list = [b("old", 500, { priceValidTo: "2026-01-31" }), b("zero", 0), b("cny", 100, { currency: "CNY" }), b("ok", 1200)];
  assert.equal(cheapestBinding(list, today).id, "ok");
});

test("a price valid through today still competes", () => {
  assert.equal(cheapestBinding([b("x", 500, { priceValidTo: today }), b("y", 600)], today).id, "x");
});

test("a tie goes to the Main supplier", () => {
  assert.equal(cheapestBinding([b("other", 1000), b("main", 1000, { isMainSupplier: true })], today).id, "main");
});

test("with no usable price the Main supplier still comes up", () => {
  assert.equal(cheapestBinding([b("x", 0), b("main", 0, { isMainSupplier: true })], today).id, "main");
  assert.equal(cheapestBinding([], today), undefined);
});

test("the dropdown lists cheapest first and does not touch the input", () => {
  const list = [b("c", 300), b("a", 100), b("none", 0)];
  assert.deepEqual(sortCheapestFirst(list, today).map((x) => x.id), ["a", "c", "none"]);
  assert.equal(list[0].id, "c");
});

test("a supplier not ordered from in 4 months does not come up, however cheap", () => {
  const list = [b("stale", 100, { lastOrderedAt: "2026-07-06" }), b("recent", 900, { lastOrderedAt: "2026-07-07" })];
  assert.equal(cheapestBinding(list, today).id, "recent");
});

test("a supplier never ordered from does not come up", () => {
  assert.equal(cheapestBinding([b("never", 100, { lastOrderedAt: "" }), b("recent", 900)], today).id, "recent");
});

test("nobody ordered from lately: the Main supplier still comes up", () => {
  const list = [b("x", 100, { lastOrderedAt: "" }), b("main", 900, { lastOrderedAt: "", isMainSupplier: true })];
  assert.equal(cheapestBinding(list, today).id, "main");
});

test("four months back keeps to a real date", () => {
  assert.equal(monthsBefore("2026-11-07", 4), "2026-07-07");
  assert.equal(monthsBefore("2026-06-30", 4), "2026-02-28");
  assert.equal(monthsBefore("2026-02-15", 4), "2025-10-15");
});

const opt = (id, supplierId, supplierSku) => ({ id, supplierId, supplierSku });

test("one supplier keeps both its SKUs; the same SKU stored twice is one option", () => {
  const list = [opt("a", "M", "COMFY-01"), opt("b", "M", "IVORY"), opt("c", "M", "IVORY"), opt("d", "A", "4047-1")];
  assert.deepEqual(uniqueSkuOptions(list).map((b) => b.id), ["a", "b", "d"]);
});

test("a PO line sits on its own SKU, and falls back to its supplier's first", () => {
  const list = [opt("a", "M", "COMFY-01"), opt("b", "M", "IVORY")];
  assert.equal(bindingIdForLine(list, { supplierId: "M", supplierSku: "IVORY" }), "b");
  assert.equal(bindingIdForLine(list, { supplierId: "M", supplierSku: "OLD" }), "a");
  assert.equal(bindingIdForLine(list, { supplierId: "X", supplierSku: "" }), "");
});
