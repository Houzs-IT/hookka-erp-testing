// ---------------------------------------------------------------------------
// lint-staged-no-cmd-shim.test.mjs — BUG-2026-10-21-380. On Windows,
// lint-staged (via tinyexec) runs a bare `node_modules/.bin` name such as
// `eslint` through cmd.exe as `eslint.cmd`, quoting each file as ^^^"…^^^".
// cmd.exe on this Windows build hangs with no CPU once that line holds 9 or
// more such arguments, so every commit with 9+ staged ts/tsx files hung in
// pre-commit. A command that starts with `node` runs node.exe directly.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("every lint-staged command runs node.exe directly, not a .bin shim through cmd.exe", () => {
  const config = JSON.parse(readFileSync("package.json", "utf8"))["lint-staged"];
  for (const [glob, cmds] of Object.entries(config)) {
    for (const cmd of [cmds].flat()) {
      assert.match(cmd, /^node /, `lint-staged "${glob}": "${cmd}" goes through cmd.exe on Windows`);
    }
  }
});
