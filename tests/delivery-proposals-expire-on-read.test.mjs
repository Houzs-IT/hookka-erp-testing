// HK-0033 finding 2: stale PENDING Delivery Agent proposals must clear even
// when the agent has not regenerated (they sat for 134 days on prod).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expireStalePendingProposals } from "../src/api/lib/delivery-agent.ts";

function fakeDb(pendingCount) {
  const log = [];
  return {
    log,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => ({ n: pendingCount }),
            run: async () => { log.push({ sql, args }); },
          };
        },
      };
    },
  };
}

test("expire marks PENDING rows older than 1 day as EXPIRED", async () => {
  const db = fakeDb(2);
  const now = "2026-10-27T00:00:00.000Z";
  assert.equal(await expireStalePendingProposals(db, now), 2);
  assert.match(db.log[0].sql, /SET status = 'EXPIRED'/);
  assert.equal(db.log[0].args[1], "2026-10-26T00:00:00.000Z");
});

test("expire writes nothing when no stale rows", async () => {
  const db = fakeDb(0);
  assert.equal(await expireStalePendingProposals(db, "2026-10-27T00:00:00.000Z"), 0);
  assert.equal(db.log.length, 0);
});

test("GET /proposals and the brief count expire stale rows first", () => {
  const route = readFileSync(new URL("../src/api/routes/delivery-agent.ts", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/api/lib/delivery-agent.ts", import.meta.url), "utf8");
  const list = route.slice(route.indexOf('app.get("/proposals"'), route.indexOf("// ── Approve"));
  assert.match(list, /status === "PENDING"[\s\S]{0,80}expireStalePendingProposals/);
  const cnt = lib.slice(lib.indexOf("async function collectPendingProposalCounts"));
  assert.match(cnt.slice(0, 600), /expireStalePendingProposals/);
});
