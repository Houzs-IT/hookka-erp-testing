import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// `new Date().toISOString().slice(0, 10)` is the UTC date: before 08:00 in
// Malaysia it is YESTERDAY. Every "today" in src must come from todayYmdMY()
// (src/lib/utils.ts), the one place allowed to do the +8h shift.
test("no UTC 'today' left in src", () => {
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["grep", "-nE", String.raw`new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\]|substring\(0, ?10\))`, "--", "src", ":!src/lib/utils.ts"],
      { encoding: "utf8" },
    );
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no match, the passing case
  }
  assert.equal(out.trim(), "", `UTC today found — use todayYmdMY():\n${out}`);
});
