// ---------------------------------------------------------------------------
// finance-v2-overview.test.mjs — the Overview's range switch on the page's
// title row (plan 2026-10-16-finance-v2-reports Task 9): the same 3 / 6 / 12
// months, three by default, the same data call.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const ov = readFileSync("src/pages/accounting/overview-tab.tsx", "utf8").replace(/\r\n/g, "\n");

test("the range switch sits on the title row; same months, same call", () => {
  const bar = ov.slice(ov.indexOf("<FinanceTitleActions>"), ov.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /<SegmentedSwitch\n\s*label="Months shown"/);
  assert.match(bar, /options=\{RANGES\.map\(\(r\) => \(\{ key: String\(r\), label: `\$\{r\} months` \}\)\)\}/);
  assert.match(ov, /const RANGES = \[3, 6, 12\] as const;/);
  assert.match(ov, /const \[range, setRange\] = useState<Range>\(3\);/);
  assert.match(ov, /`\/api\/accounting\/overview-trend\?months=\$\{range\}`/);
});
