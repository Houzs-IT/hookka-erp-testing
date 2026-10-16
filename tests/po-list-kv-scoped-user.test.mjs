// ---------------------------------------------------------------------------
// po-list-kv-scoped-user.test.mjs (BUG-2026-10-16-296, docs/BUG-CLASSES.md C22 row 4)
//
// The KV keys for GET /api/production-orders are org + query string only. A
// customer-scoped user (SALES) gets a list narrowed to their customers, so on a
// MISS, a stale refresh or a paginated MISS that narrowed body landed in the
// shared org entry and every other user on the same URL was served it. The
// snapshot layer already kept scoped payloads out; the KV layer in front of it
// did not. Source-level guard, same pattern as production-fresh-po-direct-db.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "src/api/routes/production-orders.ts"), "utf8");

function listHandler() {
  const start = src.indexOf('app.get("/", async (c)');
  assert.ok(start > 0, 'app.get("/") handler not found in production-orders.ts');
  const after = src.slice(start);
  const next = after.slice(1).search(/\napp\.(get|post|put|patch|delete)\(/);
  return next < 0 ? after : after.slice(0, next + 1);
}

test("the list's KV block is skipped entirely for customer-scoped users", () => {
  const h = listHandler();
  const guard = h.search(/if \(kvCache && !isCustomerScoped\(c\)\) \{/);
  assert.ok(
    guard > 0,
    "GET / must open its KV block with `if (kvCache && !isCustomerScoped(c))`: the KV keys carry no user scope, so a scoped user's narrowed list would be written to the shared org entry",
  );
  // Every KV read, write key and the background refresh must sit behind it.
  for (const marker of [
    "bodyKeyForWrite = bodyKey",
    "cacheKeyForWrite = cacheKey",
    "schedulePoListBodyRefresh(",
    "kvCache.getWithMetadata(",
    "kvCache.get(cacheKey)",
  ]) {
    const at = h.indexOf(marker);
    assert.ok(at > guard, `\`${marker}\` must come after the scoped-user guard`);
  }
});
