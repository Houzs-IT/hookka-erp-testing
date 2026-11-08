// Paged reads need a unique last sort key, or rows that tie on the date can show
// on two pages or on none (same fix as Houzs PR #4894).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const files = ["src/api/routes", "src/api/lib"].flatMap((dir) =>
  readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => `${dir}/${f}`),
);

test("every LIMIT/OFFSET page ends its ORDER BY on the id", () => {
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/ORDER BY([^`;]*?)LIMIT \? OFFSET \?/g)) {
      const last = m[1].trim().split(",").pop().trim();
      if (!/^id\s+(DESC|ASC)$/i.test(last)) bad.push(`${f}: ORDER BY ${m[1].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});
