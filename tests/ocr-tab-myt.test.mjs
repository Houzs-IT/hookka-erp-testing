// BUG-2026-10-19-329: the OCR tab showed and filtered scans on the UTC clock.
// A scan at 10:05 MYT read "02:05", and a scan before 08:00 MYT counted on
// the previous day's date filter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  /* native type-stripping on Node 22+ */
}

const { formatTimestampMY } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/utils.ts")).href);

test("When column renders the stored UTC time in Malaysia time", () => {
  assert.equal(formatTimestampMY("2026-10-19T02:05:00.000Z", { withYear: true }), "19/10/2026 10:05");
  assert.equal(formatTimestampMY("2026-10-18T17:30:00.000Z", { withYear: true }), "19/10/2026 01:30");
  const page = readFileSync("src/pages/dashboards/OcrView.tsx", "utf8");
  assert.match(page, /formatTimestampMY\(p\.createdAt/);
  assert.doesNotMatch(page, /p\.createdAt\.slice\(/);
});

test("OCR date filters compare on the Malaysia calendar date", () => {
  const route = readFileSync("src/api/routes/ocr-accuracy.ts", "utf8");
  assert.doesNotMatch(route, /substr\([a-z.]*created_?at::text/i);
  assert.doesNotMatch(route, /parts\.push\(`\$\{col\} >= \?`\)/);
  assert.match(route, /mytDateSql\("created_at"\)/);
  assert.match(route, /mytDateSql\("q\.created_at"\)/);
  assert.match(route, /mytDateSql\(col\)/);
});
