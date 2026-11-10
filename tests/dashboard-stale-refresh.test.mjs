// ---------------------------------------------------------------------------
// dashboard-stale-refresh.test.mjs — the Financial Dashboard swaps in the new
// figures by itself when the server first answered with its older copy.
//
// Owner 2026-11-10, after clearing a test figure on the Forecast P&L:
// 「要，改」 to "the first Dashboard open after a save can still show the old
// figures". /api/accounting/dashboard is a serve-stale-while-revalidate
// snapshot: once any source table changes, the next read gets the copy built
// before the change (~250 ms) while the server rebuilds it behind (~5–9 s).
// The page could not tell, so it kept the old copy until it was reloaded.
//
// Now withSnapshot reports a stale copy it serves (onServedStale). The route
// says so beside `data` (`stale: { builtFrom, sourceMax }`). The desktop page
// and the phone screen then ask again on a fixed schedule until the copy covers
// everything up to the first answer. That takes one retry in the normal case,
// even while the factory keeps writing job cards, which keep the snapshot
// "stale" all day.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on Node 22+.
}

const { withSnapshot } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/lib/snapshot.ts")).href
);
const { staleCopyOf, planStaleRetry, NO_STALE_RUN, STALE_RETRY_DELAYS_MS } = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/stale-refresh.ts")).href
);

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── withSnapshot reports the stale copy it serves ───────────────────────────
// The same SQL-routing mock as snapshot-swr.test.mjs.
const CONFIG = { tableName: "accounting_dashboard_snapshot", sourceTables: ["kv_config", "job_cards"] };

function makeDb({ snapshotRow = null, currentMax = "2030-01-01T00:00:00.000Z" } = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes('"maxUpdatedAt"')) return { maxUpdatedAt: currentMax };
          if (sql.includes("SELECT * FROM") || sql.includes('"builtFrom"')) return snapshotRow;
          return null;
        },
        async all() {
          if (sql.includes("information_schema")) {
            return {
              results: [
                { tableName: "kv_config", columnName: "updated_at" },
                { tableName: "job_cards", columnName: "updated_at" },
              ],
            };
          }
          if (sql.includes("AS t")) return { results: [{ t: currentMax }] };
          return { results: [] };
        },
        async run() {
          return {};
        },
      };
    },
  };
}

const row = (builtFrom, v) => ({ data: { v }, builtFrom, builtAt: builtFrom, refreshCount: 1 });
const worker = (bg) => ({ env: {}, executionCtx: { waitUntil: (p) => bg.push(p) } });

test("withSnapshot: a stale copy served while it rebuilds is reported, with both watermarks", async () => {
  const db = makeDb({ snapshotRow: row("2020-01-01T00:00:00.000Z", "old"), currentMax: "2030-01-01T00:00:00.000Z" });
  const seen = [];
  const bg = [];
  const out = await withSnapshot(db, CONFIG, "org1", async () => ({ v: "new" }), "k-stale-reported", worker(bg), {
    staleWhileRevalidate: true,
    onServedStale: (info) => seen.push(info),
  });
  assert.deepEqual(out, { v: "old" }, "the old copy is still served at once");
  assert.deepEqual(seen, [{ builtFrom: "2020-01-01T00:00:00.000Z", sourceMax: "2030-01-01T00:00:00.000Z" }]);
  await Promise.all(bg);
});

test("withSnapshot: a fresh, a cold and a synchronously rebuilt answer are never reported stale", async () => {
  const seen = [];
  const opts = { staleWhileRevalidate: true, onServedStale: (info) => seen.push(info) };
  const bg = [];
  // Fresh: built after the newest source change.
  await withSnapshot(
    makeDb({ snapshotRow: row("2030-06-01T00:00:00.000Z", "cached"), currentMax: "2030-01-01T00:00:00.000Z" }),
    CONFIG, "org1", async () => ({ v: "new" }), "k-fresh-quiet", worker(bg), opts,
  );
  // Cold: nothing stored, computed in the request.
  await withSnapshot(makeDb({ snapshotRow: null }), CONFIG, "org1", async () => ({ v: "new" }), "k-cold-quiet", worker(bg), opts);
  // Stale but no Worker runtime: recomputed in the request, so the answer is new.
  await withSnapshot(
    makeDb({ snapshotRow: row("2020-01-01T00:00:00.000Z", "old") }),
    CONFIG, "org1", async () => ({ v: "new" }), "k-sync-quiet", { env: {} }, opts,
  );
  await Promise.all(bg);
  assert.deepEqual(seen, []);
});

// ── The retry schedule, shared by the desktop page and the phone screen ─────
const T_BUILT = "2026-11-10T09:30:00.000Z"; // the old copy
const T_SAVE = "2026-11-10T09:35:00.000Z"; // the newest change at the first answer (e.g. a Forecast save)
const T_LATER = "2026-11-10T09:36:00.000Z"; // a job card scanned after that
const answer = (builtFrom, sourceMax) => ({ success: true, data: { rows: [] }, stale: { builtFrom, sourceMax } });

test("staleCopyOf reads only the route's `stale` beside data", () => {
  assert.equal(staleCopyOf(null), null);
  assert.equal(staleCopyOf({ success: true, data: { rows: [] } }), null);
  assert.equal(staleCopyOf({ success: true, data: {}, stale: false }), null);
  assert.equal(staleCopyOf({ success: true, data: { stale: { builtFrom: T_BUILT } } }), null, "inside data is the report's business");
  assert.deepEqual(staleCopyOf(answer(T_BUILT, T_SAVE)), { builtFrom: T_BUILT, sourceMax: T_SAVE });
  assert.deepEqual(staleCopyOf({ success: true, stale: true }), { builtFrom: null, sourceMax: null });
});

test("one retry after the first stale answer; a copy that covers that answer ends the run", () => {
  let p = planStaleRetry(NO_STALE_RUN, answer(T_BUILT, T_SAVE));
  assert.equal(p.retryInMs, STALE_RETRY_DELAYS_MS[0]);
  assert.deepEqual(p.run, { tries: 1, firstMax: T_SAVE });
  // The rebuild has not landed yet: the same old copy → ask again.
  p = planStaleRetry(p.run, answer(T_BUILT, T_SAVE));
  assert.equal(p.retryInMs, STALE_RETRY_DELAYS_MS[1]);
  assert.deepEqual(p.run, { tries: 2, firstMax: T_SAVE });
  // Landed, but a job card moved on since: still "stale", yet the copy holds
  // everything up to the first answer (the save) → stop, show it.
  p = planStaleRetry(p.run, answer(T_SAVE, T_LATER));
  assert.equal(p.retryInMs, null);
  assert.deepEqual(p.run, NO_STALE_RUN);
});

test("a fresh answer ends the run at once", () => {
  const p = planStaleRetry({ tries: 1, firstMax: T_SAVE }, { success: true, data: { rows: [] } });
  assert.equal(p.retryInMs, null);
  assert.deepEqual(p.run, NO_STALE_RUN);
});

test("the first stale answer is retried once even when its copy looks current (a deleted row)", () => {
  // A delete moves no timestamp: only the row count marks the copy stale.
  const p = planStaleRetry(NO_STALE_RUN, answer(T_SAVE, T_SAVE));
  assert.equal(p.retryInMs, STALE_RETRY_DELAYS_MS[0]);
  assert.equal(planStaleRetry(p.run, answer(T_SAVE, T_SAVE)).retryInMs, null, "then the copy covers it");
});

test("never more than three retries, even with no dates to compare", () => {
  assert.deepEqual([...STALE_RETRY_DELAYS_MS], [10_000, 10_000, 15_000]);
  let run = NO_STALE_RUN;
  const waits = [];
  for (let i = 0; i < 4; i++) {
    const p = planStaleRetry(run, { success: true, stale: { builtFrom: null, sourceMax: "not a date" } });
    waits.push(p.retryInMs);
    run = p.run;
  }
  assert.deepEqual(waits, [10_000, 10_000, 15_000, null]);
  assert.deepEqual(run, NO_STALE_RUN);
});

// ── The route says so; the pages act on it ─────────────────────────────────
const acct = read("src/api/routes/accounting.ts");
const hStart = acct.indexOf('app.get("/dashboard", async (c) => {');
const handler = acct.slice(hStart, acct.indexOf("\napp.", hStart + 10));

test("/api/accounting/dashboard reports a stale copy beside data, not inside the stored payload", () => {
  assert.ok(hStart > 0, "dashboard handler found");
  assert.match(handler, /onServedStale:/, "asks withSnapshot to report a stale copy");
  const ret = handler.slice(handler.lastIndexOf("return c.json("));
  assert.match(ret, /data: dashPayload/);
  assert.match(ret, /stale/, "the flag rides beside data, so DASH_PAYLOAD_V needs no bump");
});

const page = read("src/pages/finance-dashboard.tsx");
const eStart = page.indexOf("/api/accounting/dashboard?granularity=");
const effect = page.slice(page.lastIndexOf("useEffect(", eStart), page.indexOf("}, [granularity, fromYm, toYm]);", eStart));

test("desktop: the dashboard asks again on the shared schedule and shows Updating…", () => {
  assert.match(page, /from "@\/lib\/stale-refresh"/);
  assert.match(effect, /planStaleRetry\(/);
  assert.match(effect, /setTimeout\(/);
  assert.match(effect, /clearTimeout\(/, "a pending retry dies with the effect (range change, unmount)");
  assert.match(page, /data-testid="dash-updating"/);
  assert.match(page, /role="status"/);
  assert.match(page, /Updating…/);
});

const cached = read("src/lib/cached-fetch.ts");
const phone = read("src/pages/m/screens/finance/DashScreen.tsx");

test("phone: useCachedJson's opt-in retryStale drives the same schedule; the dashboard opts in", () => {
  assert.match(cached, /retryStale\?: boolean/);
  assert.match(cached, /const retryStale = options\.retryStale === true;/, "off unless asked — no other screen changes");
  assert.match(cached, /planStaleRetry\(/);
  assert.match(cached, /updating: boolean/);
  assert.match(phone, /retryStale: true/);
  assert.match(phone, /Updating…/);
});
