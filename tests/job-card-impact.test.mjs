// BUG-2026-11-11-497: before a BOM / WIP Times minutes save, the page shows
// how many job cards the save changes and asks to confirm.
// Run: node --import tsx/esm --test tests/job-card-impact.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmJobCardImpact,
  describeJobCardPreview,
  jobCardImpactConfirmOptions,
  readJobCardImpact,
} from "../src/lib/job-card-impact.ts";

const cards = (toUpdate, unfinished, completedThisMonth) => ({
  kind: "cards",
  preview: { toUpdate, unfinished, completedThisMonth },
});

test("readsAPreviewFromTheServerReply", () => {
  const reply = { success: true, jobCardPreview: { toUpdate: 12, unfinished: 9, completedThisMonth: 3 } };
  assert.deepEqual(readJobCardImpact(reply), cards(12, 9, 3));
});

test("aPreviewErrorBecomesUnknownWithItsReason", () => {
  assert.deepEqual(readJobCardImpact({ jobCardPreview: { error: "connection reset" } }), {
    kind: "unknown",
    reason: "connection reset",
  });
  assert.deepEqual(readJobCardImpact({ success: false, error: "Forbidden" }), { kind: "unknown", reason: "Forbidden" });
  assert.equal(readJobCardImpact(null).kind, "unknown");
});

test("noCardsMeansNoQuestion", async () => {
  assert.equal(jobCardImpactConfirmOptions(cards(0, 0, 0)), null);
  let asked = false;
  const shouldSave = await confirmJobCardImpact(async () => { asked = true; return false; }, cards(0, 0, 0));
  assert.equal(shouldSave, true);
  assert.equal(asked, false);
});

test("cardsAskWithTheSplitAndPayrollWarning", () => {
  const options = jobCardImpactConfirmOptions(cards(12, 9, 3));
  assert.equal(options.title, "Update job card times?");
  assert.equal(options.confirmLabel, "Save and update 12 cards");
  assert.equal(options.cancelLabel, "Back");
  assert.match(options.message, /Prod Time on 12 job cards:/);
  assert.match(options.message, /• 9 unfinished/);
  assert.match(options.message, /• 3 completed this month \(changes this month's efficiency and payroll\)/);
  assert.match(options.message, /Cards completed before this month are not changed\./);
});

test("emptyGroupsAreLeftOutAndOneCardIsSingular", () => {
  const lines = describeJobCardPreview({ toUpdate: 1, unfinished: 1, completedThisMonth: 0 });
  assert.equal(lines[0], "This save also changes Prod Time on 1 job card:");
  assert.ok(!lines.some((line) => line.includes("completed this month (")));
  assert.equal(jobCardImpactConfirmOptions(cards(1, 1, 0)).confirmLabel, "Save and update 1 card");
  assert.equal(describeJobCardPreview({ toUpdate: 2, unfinished: 0, completedThisMonth: 2 }, "import")[0],
    "This import also changes Prod Time on 2 job cards:");
});

test("anUnknownPreviewStillLetsTheUserSaveAfterAsking", async () => {
  const options = jobCardImpactConfirmOptions({ kind: "unknown", reason: "HTTP 500" });
  assert.equal(options.title, "Couldn't check job cards");
  assert.equal(options.confirmLabel, "Save anyway");
  assert.match(options.message, /\(HTTP 500\)/);
  assert.equal(await confirmJobCardImpact(async () => false, { kind: "unknown", reason: "HTTP 500" }), false);
  assert.equal(await confirmJobCardImpact(async () => true, { kind: "unknown", reason: "HTTP 500" }), true);
});
