// ---------------------------------------------------------------------------
// self-apply-memo-is-boolean.test.mjs — a runtime migration must never be
// memoised as a PROMISE.
//
// Migrations are inert on deploy in this repo (CLAUDE.md): a new column reaches
// production ONLY via an `ALTER TABLE … IF NOT EXISTS` awaited at the top of the
// first write. Every one of those was memoised like this:
//
//     let _mig: Promise<void> | null = null;
//     export function ensureX(db) {
//       if (_mig) return _mig;
//       _mig = (async () => { … })();
//       return _mig;
//     }
//
// Two separate defects live in that shape.
//
//   1. A REJECTED promise stays cached. One transient DDL blip on the first
//      write after an isolate boots leaves the column unapplied and never
//      retried for the life of that isolate. Every later write in that isolate
//      then fails on a missing column and nothing says why. Several sites made
//      it worse by swallowing the error outright — the memo resolves, so the
//      failure is remembered as SUCCESS.
//   2. A PENDING promise holds the socket of the request that created it.
//      src/api/lib/db-pg.ts forbids sharing that across requests in capitals
//      ("Cannot perform I/O on behalf of a different request"). On 2026-08-02 a
//      cache change that did exactly this took Sales Orders down in production.
//
// A boolean memo has neither problem, which is why src/api/lib/payment-columns.ts
// was written that way and why the sweep converted the rest. Two shapes are
// acceptable and both are checked for below:
//
//   * `let _x = false;` … set true only after the DDL actually lands.
//   * a Promise memo handled by memoizeSelfApply, which sets it only after the
//     round lands and never hands out the in-flight promise.
//
// "Cleared on failure" (`_x = null` in a catch) used to count as fixed. It is
// not: while the round is in flight the promise is shared, and if the request
// that made it ends first the runtime drops the settle — every other request
// fails with "This promise was created by a request that has since ended" and
// the catch that would clear the memo never runs (BUG-2026-11-24-553, Purchase
// Invoice create from the scan flow, prod).
//
// This test exists because the class had already been "closed" once: #222 swept
// 26 sites on the morning of 2026-08-02 and 38 more were still live that
// evening. A class is not closed until something fails when it comes back.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Every `let x: Promise<…> | null = null` in src/api, with how it is guarded. */
function promiseMemos() {
  const found = [];
  for (const file of walk("src/api")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(
      /(?:export\s+)?let\s+(\w+)\s*:\s*Promise<[^>]*>\s*\|\s*null\s*=\s*null/g,
    )) {
      const name = m[1];
      const after = src.slice(m.index + m[0].length);
      found.push({
        file,
        name,
        // Handed to the helper, which sets it only once the round lands.
        viaHelper:
          new RegExp(`memoizeSelfApply\\([\\s\\S]{0,300}?${name}`).test(src) &&
          // …and not ALSO assigned an in-flight promise somewhere else.
          !new RegExp(`\\b${name}\\s*=(?!=)(?!\\s*(?:SELF_APPLY_DONE|null|p)\\b)`).test(after),
        // …or only ever set to SELF_APPLY_DONE (or reset to null), never to a
        // promise of its own: the shape for rounds that swallow their errors.
        doneOnly:
          new RegExp(`\\b${name}\\s*=\\s*SELF_APPLY_DONE`).test(after) &&
          !new RegExp(`\\b${name}\\s*=(?!=)(?!\\s*(?:SELF_APPLY_DONE|null)\\b)`).test(after),
      });
    }
  }
  return found;
}

// Not a schema memo: a data single-flight (#1582). Same cross-request hazard,
// tracked as its own follow-up; listed here so it cannot be copied silently.
const NOT_SELF_APPLY = new Set(["stockStatusInflight"]);

test("no runtime migration shares an in-flight promise across requests", () => {
  const bad = promiseMemos()
    .filter((m) => !m.viaHelper && !m.doneOnly && !NOT_SELF_APPLY.has(m.name))
    .map(
      (m) =>
        `${m.file}: \`${m.name}\` is a cached Promise not handled by memoizeSelfApply.\n` +
        `    While in flight it is shared across requests; if its request ends first,\n` +
        `    every waiter fails and the memo never clears (BUG-2026-11-24-553).\n` +
        `    Use a boolean memo (src/api/lib/payment-columns.ts) or memoizeSelfApply.`,
    );
  assert.deepEqual(bad, [], `\n\n${bad.join("\n\n")}\n`);
});

test("a boolean memo is only set AFTER the statement it guards", () => {
  // `let _x = false` followed by `_x = true` BEFORE any await is the shape that
  // looks converted but still remembers a failure as success.
  //
  // Scoped deliberately narrowly. The first draft matched every `let x = false`
  // in src/api and reported 16 ordinary local flags — `inQuotes`, `hasMore`,
  // `fallback` — as migration bugs. A test that cries wolf on unrelated code
  // gets muted, and then it is not protecting anything. Two conditions:
  // declared at MODULE level (column 0), and the window up to the setter
  // actually contains a prepared statement, i.e. it really does guard DDL.
  const bad = [];
  for (const file of walk("src/api")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^let\s+(\w+)\s*=\s*false;$/gm)) {
      const name = m[1];
      const rest = src.slice(m.index);
      const setTrue = rest.search(new RegExp(`\\b${name}\\s*=\\s*true`));
      if (setTrue < 0) continue;
      // "Is this a DDL guard?" must be decided over the region AFTER the
      // declaration, not the region before the setter — the first draft used
      // the latter, and the premature-flag bug empties exactly that window, so
      // the check skipped the case it was written for. Verified by putting the
      // bug back and watching this go red.
      const scope = rest.slice(0, 3000);
      if (!/\.prepare\s*\(/.test(scope)) continue; // not a DDL guard
      const between = rest.slice(0, setTrue);
      if (!/await\s/.test(between)) {
        bad.push(
          `${file}: \`${name}\` is set true with no await before it — ` +
            `the memo claims the DDL landed without running it.`,
        );
      }
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join("\n")}\n`);
});

test("the sweep actually happened — boolean memos exist in numbers", () => {
  // A guard against the inverse mistake: a regex that matches nothing passes
  // vacuously. If this count collapses, the first test above is not testing
  // anything either.
  const n = walk("src/api").reduce(
    (acc, f) =>
      acc + (readFileSync(f, "utf8").match(/^let \w+ = false;$/gm) ?? []).length,
    0,
  );
  assert.ok(
    n >= 30,
    `expected the converted boolean memos to still be there, found ${n}`,
  );
});

test("memoizeSelfApply never hands out an in-flight promise", async () => {
  const { memoizeSelfApply, SELF_APPLY_DONE } = await import("../src/api/lib/self-apply.ts");
  let memo = null;
  const get = () => memo;
  const set = (p) => { memo = p; };
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = async () => { runs++; await gate; };

  const a = memoizeSelfApply(get, set, run);
  const b = memoizeSelfApply(get, set, run);
  assert.equal(memo, null, "nothing is remembered while the round is in flight");
  assert.notEqual(a, b, "a second request must not await the first request's promise");
  assert.equal(runs, 2, "each cold request runs its own (idempotent) round");
  release();
  await Promise.all([a, b]);
  assert.equal(memo, SELF_APPLY_DONE, "remembered only once the round landed");
  assert.equal(await memoizeSelfApply(get, set, run), undefined);
  assert.equal(runs, 2, "a landed round is not run again");

  memo = null;
  await assert.rejects(memoizeSelfApply(get, set, async () => { throw new Error("ddl blip"); }), /ddl blip/);
  assert.equal(memo, null, "a failed round is not remembered");
});

test("no module-level Map caches promises across requests", () => {
  // The same hazard keyed by name: archive-union.ts held `Map<string, Promise>`
  // of in-flight DDL + SQL builds (BUG-2026-11-24-553 review). A Map handed to
  // memoizeSelfApply is fine; data caches with the same shape are listed below
  // as known follow-ups so they cannot be copied silently.
  const KNOWN = new Set([
    "src/api/lib/snapshot.ts:inFlightComputes",
    "src/api/lib/worker-perf.ts:effMemo",
  ]);
  const bad = [];
  for (const file of walk("src/api")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=\s*new Map<[^>]*Promise</gm)) {
      const id = `${file.split("\\").join("/")}:${m[1]}`;
      if (KNOWN.has(id) || /memoizeSelfApply\(/.test(src)) continue;
      bad.push(`${id} caches promises in a module-level Map; cache the settled value instead.`);
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join("\n")}\n`);
});
