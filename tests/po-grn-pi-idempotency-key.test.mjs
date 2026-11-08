// The PO, GRN and PI create screens send an Idempotency-Key, and the PO create
// route honours one, so a retry after a lost response replays the document
// instead of making a second one (Houzs sends the same key from its create pages).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

for (const [page, endpoint] of [
  ["src/pages/procurement/create.tsx", "/api/purchase-orders"],
  ["src/pages/procurement/grn/create.tsx", "/api/grn"],
  ["src/pages/procurement/pi/create.tsx", "/api/purchase-invoices"],
]) {
  test(`${page} sends an Idempotency-Key on create`, () => {
    const src = read(page);
    const posts = [...src.matchAll(new RegExp(`fetch\\("${endpoint.replace(/\//g, "\\/")}", \\{[\\s\\S]*?\\}\\)`, "g"))];
    assert.ok(posts.length > 0, "create POST not found");
    for (const p of posts) assert.match(p[0], /"Idempotency-Key": key/);
  });
}

test("PO create route is wrapped in idempotent()", () => {
  assert.match(read("src/api/routes/purchase-orders.ts"), /app\.post\("\/", idempotent\(\), async \(c\) => \{/);
});
