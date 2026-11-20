import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Tasks = await import(pathToFileURL(resolve(process.cwd(), "src/lib/outsource-issue-format.ts")).href);

const t = (key) => ({
  "tasks.toFinish": "to finish",
  "tasks.waitingForOffice": "waiting for office",
  "tasks.oldest": "Oldest",
  "tasks.heldToday": "Issued today",
}[key] ?? key);
const now = new Date().toISOString();
const open = (status) => ({ status, issuedAt: now, completedAt: null });

test("countTasks splits items still to sew from items waiting for the office", () => {
  assert.equal(Tasks.countTasks(t, [open("INCOMPLETE"), open("PENDING_APPROVAL")]), "1 to finish · 1 waiting for office");
  assert.equal(Tasks.countTasks(t, [open("INCOMPLETE"), open("INCOMPLETE")]), "2 to finish");
  assert.equal(Tasks.countTasks(t, []), "0 to finish");
});

test("summarizeTasks ages only the items still to sew", () => {
  assert.equal(Tasks.summarizeTasks(t, [open("PENDING_APPROVAL")]), "0 to finish · 1 waiting for office");
  assert.equal(
    Tasks.summarizeTasks(t, [open("PENDING_APPROVAL"), open("INCOMPLETE")]),
    "1 to finish · 1 waiting for office · Oldest: Issued today",
  );
});

test("a scan the office must approve returns the worker to My task, from either scan button", () => {
  const scan = readFileSync("src/pages/worker/scan.tsx", "utf8");
  assert.match(scan, /else if \(data\.data\.pendingApproval\) \{\s*navigate\("\/worker\/tasks"/);
  const home = readFileSync("src/pages/worker/index.tsx", "utf8");
  const layout = readFileSync("src/layouts/WorkerLayout.tsx", "utf8");
  assert.match(home, /to="\/worker\/scan"/);
  assert.match(layout, /to="\/worker\/scan\?camera=1"/);
  const tasks = readFileSync("src/pages/worker/tasks.tsx", "utf8");
  assert.match(tasks, /sentForApproval/);
});
