// ---------------------------------------------------------------------------
// scan-job-card-events.test.mjs — a shop-floor scan writes the job card
// history (job_card_events) with source "scan", like an office edit writes
// it with source "ui". Before this, only office edits were ever logged.
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
  /* native type-stripping on Node 22+ */
}

const events = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/lib/job-card-events.ts")).href
);

function createFakeDb({ shouldBatchFail = false } = {}) {
  const batches = [];
  const singleRuns = [];
  return {
    batches,
    singleRuns,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            run: async () => {
              singleRuns.push({ sql, values });
            },
          };
        },
      };
    },
    async batch(statements) {
      if (shouldBatchFail) throw new Error("batch refused");
      batches.push(statements);
    },
  };
}

const waitingCard = {
  id: "jc-1",
  productionOrderId: "po-1",
  status: "WAITING",
  completedDate: null,
  pic1Id: null,
  pic1Name: "",
  pic2Id: null,
  pic2Name: "",
};
const completedCard = {
  ...waitingCard,
  status: "COMPLETED",
  completedDate: "2026-11-20",
  pic1Id: "w-7",
  pic1Name: "ZIN MIN NWE",
};

const eventTypeIndex = 3;
const actorUserIdIndex = 5;
const actorNameIndex = 6;
const sourceIndex = 7;

test("a scan that completes a card logs status, date and PIC with source scan", async () => {
  const db = createFakeDb();
  await events.recordScanEvents(db, waitingCard, completedCard, {
    workerName: "ZIN MIN NWE",
    sessionUserId: undefined,
  });
  assert.equal(db.batches.length, 1);
  const rows = db.batches[0].map((statement) => statement.values);
  assert.deepEqual(
    rows.map((values) => values[eventTypeIndex]),
    ["STATUS_CHANGED", "COMPLETED_DATE_SET", "PIC_ASSIGNED"],
  );
  for (const values of rows) {
    assert.equal(values[sourceIndex], "scan");
    assert.equal(values[actorNameIndex], "ZIN MIN NWE");
    assert.equal(values[actorUserIdIndex], null);
  }
});

test("an office scanner logged in on the dashboard is recorded as the actor user", async () => {
  const db = createFakeDb();
  await events.recordScanEvents(db, waitingCard, completedCard, {
    workerName: "ZIN MIN NWE",
    sessionUserId: "user-ec21ff02",
  });
  for (const statement of db.batches[0]) {
    assert.equal(statement.values[actorUserIdIndex], "user-ec21ff02");
  }
});

test("a scan that changes nothing on the card writes no event", async () => {
  const db = createFakeDb();
  await events.recordScanEvents(db, completedCard, { ...completedCard }, {
    workerName: "ZIN MIN NWE",
    sessionUserId: null,
  });
  assert.equal(db.batches.length, 0);
  assert.equal(db.singleRuns.length, 0);
});

test("a failed event batch is dead-lettered for replay, never thrown", async () => {
  const db = createFakeDb({ shouldBatchFail: true });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await events.recordScanEvents(db, waitingCard, completedCard, {
      workerName: "ZIN MIN NWE",
      sessionUserId: null,
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(db.singleRuns.length, 1);
  const [deadLetter] = db.singleRuns;
  assert.match(deadLetter.sql, /INSERT INTO audit_dlq/);
  assert.equal(deadLetter.values[3], "job_card_events.batch_failed");
  assert.equal(JSON.parse(deadLetter.values[1]).length, 3);
});

test("every scan handler that updates a job card also records its events", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/api/routes/production-orders.ts"),
    "utf8",
  );
  const cardUpdates = source.split("UPDATE job_cards SET status = ?, completedDate = ?").slice(1);
  // 3 scan endpoints + the pillow-carton fan-out (completeCartonPillows, 2026-11-20).
  assert.equal(cardUpdates.length, 4);
  for (const afterUpdate of cardUpdates) {
    const untilNextStatement = afterUpdate.slice(0, afterUpdate.indexOf("scheduleFireAndForget"));
    assert.match(untilNextStatement, /await recordScanEvents\(db, /);
  }
});
