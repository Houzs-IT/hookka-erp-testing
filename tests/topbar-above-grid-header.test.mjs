// BUG-2026-10-14-288: the DataGrid sticky header painted over the top bar's
// dropdowns (notifications). The top bar wrapper must stack above the grid
// header and below the phone menu backdrop.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const z = (file, re) => {
  const m = readFileSync(file, "utf8").match(re);
  assert.ok(m, `no z-index found in ${file}`);
  return Number(m[1]);
};

test("top bar wrapper stacks above the grid header and below the phone menu", () => {
  const bar = z("src/layouts/DashboardLayout.tsx", /ref=\{stickyRef\} className="sticky top-0 z-\[?(\d+)\]?/);
  const head = z("src/components/ui/data-grid.tsx", /<thead className=\{cn\(stickyHeader && "sticky top-0 z-\[?(\d+)\]?/);
  const backdrop = z("src/components/layout/sidebar.tsx", /fixed inset-0 z-\[?(\d+)\]? bg-black\/40/);
  assert.ok(bar > head, `top bar z-${bar} must be above grid header z-${head}`);
  assert.ok(bar < backdrop, `top bar z-${bar} must be below phone menu backdrop z-${backdrop}`);
});
