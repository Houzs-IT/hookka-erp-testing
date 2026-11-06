import test from "node:test";
import assert from "node:assert/strict";
import { cheapestBinding, sortCheapestFirst } from "../src/lib/cheapest-binding.ts";

const today = "2026-11-07";
const b = (id, unitPrice, extra = {}) => ({ id, unitPrice, currency: "MYR", priceValidTo: "", isMainSupplier: false, ...extra });

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
