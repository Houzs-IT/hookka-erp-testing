// O7 (cross-system review 2026-11-10, ported from Houzs#5516): this repository
// is PUBLIC, so a workflow artifact can be downloaded by anyone with a GitHub
// account. No workflow may carry production rows out as an artifact. The only
// upload-artifact step allowed is one that cannot hold production data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = ".github/workflows";
// workflow file → why its upload cannot contain production data
const ALLOWED = {
  "ios-build.yml": "unsigned iOS app archive built from the repo; no database access",
};

const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

test("no workflow uploads an artifact except the allowlisted, data-free ones", () => {
  const offenders = workflows.filter((f) => {
    const src = readFileSync(`${DIR}/${f}`, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    return /uses:\s*actions\/upload-artifact/.test(src) && !ALLOWED[f];
  });
  assert.deepEqual(
    offenders,
    [],
    "These workflows upload an artifact. On a public repo that is public — keep production data in the database instead.",
  );
});

test("wip-reset keeps its pre-write snapshot in the database and prints totals only", () => {
  const wf = readFileSync(`${DIR}/wip-reset.yml`, "utf8");
  assert.match(wf, /--apply --i-have-read-the-report --backup-to-db/);
  assert.doesNotMatch(wf, /uses:\s*actions\/upload-artifact/);
  assert.doesNotMatch(wf, /inputs\.limit/);
  assert.match(wf, /reset-wip-quantities\.mjs --limit 0/);
  const script = readFileSync("scripts/reset-wip-quantities.mjs", "utf8");
  const backupAt = script.indexOf("INSERT INTO wip_reset_backups");
  const firstUpdate = script.indexOf("UPDATE wip_items SET stock_qty");
  assert.ok(backupAt > 0 && firstUpdate > backupAt, "the DB snapshot must land before the first UPDATE");
});
