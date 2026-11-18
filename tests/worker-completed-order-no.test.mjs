// HK-0160 (Violet, 2026-11-18): each Completed Products row on the worker
// portal Home must carry its order number (SO-2610-400-01, the number printed
// on the job-card sticker), so a worker can match a row to a sticker.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("history sends each completed card's production order number", () => {
  const route = read("src/api/routes/worker.ts");
  assert.match(route, /orderPoNo: po\?\.poNo \?\? ""/);
});

test("Home renders the order number on each Completed Products row", () => {
  const home = read("src/pages/worker/index.tsx");
  const section = home.slice(home.indexOf('t("home.completedProducts")'));
  assert.match(section, /\{c\.orderPoNo\}/);
});
