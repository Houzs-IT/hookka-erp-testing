// ---------------------------------------------------------------------------
// users-org-columns-memo.test.mjs — BUG-CLASS C9, BUG-2026-10-19-334.
//
// ensureUserOrgColumns runs at the top of GET /api/users. It cached its
// in-flight promise, so while one request's ALTERs were pending every other
// /api/users in the isolate awaited that request's socket and hung until the
// app's 30 s timeout. A boolean memo lets each request run its own round.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureUserOrgColumns,
  _resetUserOrgColumnsMemoForTests,
} from "../src/api/routes/users.ts";

/** D1-ish stub. mode: "ok" counts runs, "fail" throws, "hang" never settles. */
function makeDb(mode) {
  const state = { runs: 0 };
  const db = {
    prepare() {
      return {
        run: () => {
          state.runs++;
          if (mode === "hang") return new Promise(() => {});
          if (mode === "fail") return Promise.reject(new Error("simulated DDL failure"));
          return Promise.resolve({ success: true });
        },
        bind() {
          return this;
        },
      };
    },
  };
  return { db, state };
}

const within = (p, ms) =>
  Promise.race([
    p.then(() => "settled"),
    new Promise((r) => setTimeout(() => r("timed out"), ms)),
  ]);

test("a second request does not wait on another request's pending ALTERs", async () => {
  _resetUserOrgColumnsMemoForTests();
  const stuck = makeDb("hang");
  void ensureUserOrgColumns(stuck.db);
  const ok = makeDb("ok");
  assert.equal(await within(ensureUserOrgColumns(ok.db), 1000), "settled");
  assert.equal(ok.state.runs, 4, "the second request must run its own round");
});

test("a failed round is retried, then the memo sticks", async () => {
  _resetUserOrgColumnsMemoForTests();
  await assert.rejects(ensureUserOrgColumns(makeDb("fail").db));
  const ok = makeDb("ok");
  await ensureUserOrgColumns(ok.db);
  assert.equal(ok.state.runs, 4, "a failed round must not be remembered as done");
  const again = makeDb("ok");
  await ensureUserOrgColumns(again.db);
  assert.equal(again.state.runs, 0, "a landed round must not re-run per request");
});
