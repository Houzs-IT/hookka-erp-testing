import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvCell, csvSafeText } from "../src/lib/csv-cell.ts";

test("text a spreadsheet would run as a formula is neutralised", () => {
  for (const s of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "=HYPERLINK(\"http://x\")"]) assert.equal(csvSafeText(s)[0], "'", s);
});

test("numbers, including negative text numbers, stay numeric", () => {
  assert.equal(csvSafeText("-12.50"), "-12.50");
  assert.equal(csvSafeText("+60123456789"), "+60123456789");
  assert.equal(csvCell(-12.5), "-12.5");
  assert.equal(csvSafeText("PC151-01"), "PC151-01");
});

test("quoting still follows RFC 4180", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=a,b"), '"\'=a,b"');
  assert.equal(csvCell(null), "");
});

test("no hand-built CSV left outside the shared cell rule", () => {
  for (const f of ["src/pages/consignment/index.tsx", "src/pages/procurement/pi.tsx", "src/pages/consignment/note.tsx", "src/pages/inventory/stock-value.tsx", "src/pages/rd/index.tsx", "src/pages/reports.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /csvBlob\(/, f);
    assert.doesNotMatch(src, /new Blob\(\[csv/, f);
  }
});
