// ---------------------------------------------------------------------------
// datagrid-number-filter.test.mjs — the column funnel's "Number Filters" tab
// for amount columns (finance v2 "PV table" rule: Values + Condition, where the
// condition for numbers is a From / To range; plan 2026-10-16-finance-v2-
// foundation Task 3). The range rides the grid's text-filter slot as
// "range:<lo>..<hi>" in the column's raw units — sen for a currency column —
// so it persists and clears like every other column filter.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("src/components/ui/data-grid.tsx", "utf8").replace(/\r\n/g, "\n");
const fnBody = (name) => {
  const at = src.indexOf(`function ${name}`);
  assert.ok(at >= 0, `${name} missing`);
  return src.slice(at, src.indexOf("\n}\n", at));
};

test("a range filter is decoded before the text matching lower-cases it", () => {
  const m = fnBody("matchesFilter(");
  const at = m.indexOf("const range = decodeRange(filter);");
  assert.ok(at >= 0, "matchesFilter decodes a range filter");
  assert.match(m, /if \(range\) return inRange\(value, range\);/);
  assert.ok(at < m.indexOf(".toLowerCase()"), "decoded before lower-casing");
  assert.match(src, /import \{[^}]*decodeRange[^}]*\} from "@\/lib\/grid-layout";/);
});

test("amount columns get a Number Filters tab with From / To", () => {
  const d = fnBody("ColumnFilterDropdown<T>(");
  assert.match(d, /const isNumCol = columnType === "currency" \|\| columnType === "number";/);
  assert.match(d, /\{isDateCol \? "Date Filters" : isNumCol \? "Number Filters" : "Text Filters"\}/);
  assert.match(d, /\) : isNumCol \? \(/, "the number panel sits between the date and the text panels");
  assert.match(d, /\["From", numLo, setNumLo\], \["To", numHi, setNumHi\]/, "From and To inputs");
  assert.match(d, /inputMode="decimal"/);
  assert.match(d, /parseAmount\(numLo\)/);
  assert.match(d, /parseAmount\(numHi\)/);
});

test("a currency column compares in sen; Apply stores range:<lo>..<hi>; blank both = clear", () => {
  const d = fnBody("ColumnFilterDropdown<T>(");
  assert.match(d, /const numScale = columnType === "currency" \? 100 : 1;/);
  assert.match(d, /Math\.round\(x \* numScale\)/);
  assert.match(d, /onApplyText\(rangeTerm\(toRaw\(lo\), toRaw\(hi\)\), RANGE_MODE\)/);
  assert.match(d, /if \(lo == null && hi == null\) \{ onApplyText\("", "contains"\); onClose\(\); return; \}/);
  // Reopening shows the current range in RM, not sen.
  assert.match(d, /decodeRange\(textFilter\)/);
  assert.match(d, /String\(r\.lo \/ numScale\)/);
});
