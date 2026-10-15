// BUG-2026-10-15-289: bulk-generated BOMs are saved DRAFT and no screen could
// make them ACTIVE, so ACTIVE-only pages (WIP times) never saw them. The BOM
// page must show DRAFT and its Activate button must save versionStatus ACTIVE,
// which the template PUT must accept.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/bom.tsx", "utf8");
const route = readFileSync("src/api/routes/bom.ts", "utf8");

test("BOM page shows DRAFT and wires Activate to versionStatus ACTIVE", () => {
  assert.match(page, /onActivate=\{\(\) => handleBOMEdited\(\{ \.\.\.selectedTemplate, versionStatus: "ACTIVE" \}\)\}/);
  assert.match(page, /template\.versionStatus === "DRAFT" && \(\s*<button\s+onClick=\{onActivate\}/);
  assert.match(page, /hasBOM && !activeCodes\.has\(p\.code\) && \(/);
});

test("template PUT accepts versionStatus ACTIVE", () => {
  assert.match(route, /body\.versionStatus === "ACTIVE" \|\|/);
  assert.match(route, /patch\.versionStatus = body\.versionStatus;/);
});
