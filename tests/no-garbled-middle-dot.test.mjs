// ---------------------------------------------------------------------------
// no-garbled-middle-dot.test.mjs — a "·" saved through the wrong encoding
// becomes "Â·" and shows on screen (Employees dashboard, 2026-11-19).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const garbledMiddleDot = "Â·";

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("no source file shows a garbled middle dot", () => {
  const offendingFiles = listSourceFiles(resolve(process.cwd(), "src")).filter((path) =>
    readFileSync(path, "utf8").includes(garbledMiddleDot),
  );
  assert.deepEqual(offendingFiles, []);
});
