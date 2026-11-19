import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Format = await import(pathToFileURL(resolve(process.cwd(), "src/lib/outsource-issue-format.ts")).href);

test("issue date and time are shown in Malaysia time", () => {
  assert.equal(Format.formatIssueDateTime("2026-11-19T03:54:00Z"), "19 Nov 2026 11:54");
  assert.equal(Format.formatIssueDateTime("2026-11-18T17:05:00Z"), "19 Nov 2026 01:05");
});

test("a missing or broken timestamp shows a dash", () => {
  assert.equal(Format.formatIssueDateTime(null), "—");
  assert.equal(Format.formatIssueDateTime("not a date"), "—");
});

test("the phone tracking card and the worker's My task show the issue time, not only the date", () => {
  const phoneCard = readFileSync("src/pages/m/screens/OutsourceIssueScreen.tsx", "utf8");
  const myTask = readFileSync("src/pages/worker/tasks.tsx", "utf8");
  assert.match(phoneCard, /Issued \{formatIssueDateTime\(item\.issuedAt\)\}/);
  assert.match(myTask, /\$\{formatIssueDateTime\(issue\.issuedAt\)\}/);
});
