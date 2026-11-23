// Owner 2026-11-24 「forecast 的pNL 没有L1，L2那些？」: the Forecast P&L (Edit
// forecast) gets the same detail levels as the Monthly P&L.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/pages/accounting/monthly-pl-forecast-editor.tsx", import.meta.url), "utf8");

test("detail levels L1..Ln fold every group at depth >= L-1, like the Monthly P&L", () => {
  assert.match(src, /const maxLevel = matrix\.rows\.reduce\(\(m, r\) => Math\.max\(m, r\.depth\), 0\) \+ 1;/);
  assert.match(src, /r\.kind === "group" && r\.groupId && r\.depth >= level - 1/);
  assert.match(src, /const shown = foldStatementRows\(matrix\.rows, folded\);/);
  assert.match(src, /<DetailLevels levels=\{Array\.from\(\{ length: maxLevel \}, \(_, i\) => i \+ 1\)\}/);
});

test("a folded group shows its own figures on its heading and hides its detail rows", () => {
  assert.match(src, /figure\(c, r\.values\[j\] \?\? 0, r\.pctValues\[j\] \?\? 0, !!\(r\.groupId && folded\.has\(r\.groupId\)\)\)/);
  assert.match(src, /\{k && !\(r\.groupId && folded\.has\(r\.groupId\)\) && details\(k, r\.depth \+ 1\)\}/);
});
