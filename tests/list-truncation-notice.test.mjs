import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capList, LIST_TRUNCATED_HEADER } from "../src/api/lib/list-cap.ts";

function fakeCtx() {
  const headers = {};
  return { headers, header: (k, v) => { headers[k] = v; } };
}

test("a list that fits is returned whole and unflagged", () => {
  const c = fakeCtx();
  assert.deepEqual(capList(c, [1, 2, 3], 3), [1, 2, 3]);
  assert.equal(c.headers[LIST_TRUNCATED_HEADER], undefined);
  assert.deepEqual(capList(c, null, 3), []);
});

test("the N+1th row means the list was cut: N rows back, header set", () => {
  const c = fakeCtx();
  assert.deepEqual(capList(c, [1, 2, 3, 4], 3), [1, 2, 3]);
  assert.equal(c.headers[LIST_TRUNCATED_HEADER], "3");
});

// Every capped list route fetches one extra row and passes through capList,
// so the cut is reported instead of silent.
const ROUTES = {
  "accounting.ts": 2,
  "delivery-returns.ts": 1,
  "qc-inspections.ts": 1,
  "stock-adjustments.ts": 1,
  "warehouse.ts": 1,
  "worker-penalties.ts": 1,
  "service-orders.ts": 1,
  "service-cases.ts": 1,
  "outsource-piece.ts": 1,
};

test("capped list routes ask for N+1 and report the cut", () => {
  for (const [f, n] of Object.entries(ROUTES)) {
    const src = readFileSync(`src/api/routes/${f}`, "utf8");
    const calls = src.match(/capList\(c, /g) ?? [];
    assert.equal(calls.length, n, `${f}: capList calls`);
    assert.doesNotMatch(src, /DESC LIMIT 500`/, `${f}: a silent LIMIT 500 is left`);
  }
});

test("the browser turns the header into a one-time warning", () => {
  const client = readFileSync("src/lib/api-client.ts", "utf8");
  assert.match(client, /X-List-Truncated/);
  assert.match(client, /hookka:list-truncated/);
  const toast = readFileSync("src/components/ui/toast.tsx", "utf8");
  assert.match(toast, /addEventListener\("hookka:list-truncated"/);
  assert.match(toast, /warnedTruncated/);
});
