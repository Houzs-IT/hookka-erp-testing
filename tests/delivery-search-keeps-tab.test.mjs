// Owner 2026-11-20: searching on Delivered also listed the Pending Dispatch DO
// ("没有分层？"). Search reads the whole table; each tab shows its own stage;
// the "Matches for" bar carries the other tabs' counts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a DO tab's search results stay inside that tab's statuses", () => {
  const s = readFileSync("src/pages/delivery/index.tsx", "utf8");
  assert.match(s, /if \(search\.trim\(\)\) return searchResults\.filter\(\(d\) => statuses\.includes\(d\.status\)\);/);
  assert.match(s, /Matches for <span/);
});
