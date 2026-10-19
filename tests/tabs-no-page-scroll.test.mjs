// BUG-2026-10-19-343: the scrollable pill tabs must scroll their own row, never the page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/components/ui/tabs.tsx", import.meta.url), "utf8");
const code = src.replace(/\/\/.*$/gm, "");

test("tabs.tsx never calls scrollIntoView", () => {
  assert.ok(!code.includes("scrollIntoView"), "scrollIntoView scrolls every ancestor, including the page");
});

test("active pill is centred by setting the row's scrollLeft", () => {
  assert.match(code, /row\.scrollLeft \+=/);
});
