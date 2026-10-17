// ---------------------------------------------------------------------------
// BUG-2026-10-16-303 — a payment voucher's printout never showed its bill date.
// `buildPvVoucher` only adds "dated dd/mm/yyyy" after "Bill no. …" when the
// bill date looks like YYYY-MM-DD, but the check was written `/^d{4}-d{2}-d{2}$/`
// (the backslashes were lost when the line was written through a shell), so it
// matched the letters "dddd-dd-dd" and never a real date.
//   - the check is a real digit pattern again;
//   - class guard: no regex in src/ quantifies a bare `d` (a `\d` that lost its
//     backslash), so the same slip cannot come back elsewhere unnoticed.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("the voucher printout adds the bill date when it is a YYYY-MM-DD date", () => {
  const src = read("src/pages/accounting/index.tsx");
  const at = src.indexOf("function buildPvVoucher(");
  assert.ok(at >= 0, "buildPvVoucher is gone");
  const body = src.slice(at, at + 4000);
  // Since the 1a print layout (2026-10-17) the bill no. / date print as facts
  // under the payee; the date check moved with them.
  const line = body.split("\n").find((l) => l.includes("const billDateText"));
  assert.ok(line, "the bill date line is gone");
  assert.ok(line.includes("/^\\d{4}-\\d{2}-\\d{2}$/.test(billDate)"), `bill date check: ${line.trim()}`);
  // The pattern itself: a real date passes, the letters it used to match do not.
  const re = /^\d{4}-\d{2}-\d{2}$/;
  assert.equal(re.test("2026-10-01"), true);
  assert.equal(re.test("dddd-dd-dd"), false);
});

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

test("no regex in src/ quantifies a bare d (a \\d that lost its backslash)", () => {
  // A regex-ish line: a literal handed to test/match/replace/split/exec, or a
  // RegExp. Inside it, `d{2}` with no backslash before the `d` is the slip.
  const regexLine = /\.(test|match|matchAll|replace|replaceAll|split|exec|search)\(|new RegExp\(|=\s*\/[^/\s]/;
  const bareD = /(^|[^\\A-Za-z0-9_$])d\{\d+(,\d*)?\}/;
  const hits = [];
  for (const file of sourceFiles("src")) {
    read(file).split("\n").forEach((l, i) => {
      if (regexLine.test(l) && bareD.test(l)) hits.push(`${file}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], "a digit pattern lost its backslash");
});
