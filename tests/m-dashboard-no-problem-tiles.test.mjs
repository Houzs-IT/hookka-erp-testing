import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Owner 2026-11-11: "整个手机版本dashboard都不要看到这个上面的" — the /m
// dashboard shows no "Today's problems" tiles on any tab.
test("/m dashboard renders no Today's problems tiles", () => {
  const src = readFileSync("src/pages/m/screens/dashboard/DashboardScreen.tsx", "utf8");
  assert.doesNotMatch(src, /useProblemTiles/);
  assert.doesNotMatch(src, /aria-label="Today's problems"/);
});
