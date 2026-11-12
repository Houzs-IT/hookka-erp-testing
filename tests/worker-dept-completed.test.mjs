// Worker portal › "Department completed today" on the Scan screen (owner 2026-11-12).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("route: worker-authenticated, the scanned-into department first, leaders see all, holidays show the last working day", () => {
  const r = read("src/api/routes/worker.ts");
  const i = r.indexOf('app.get("/dept-completed"');
  assert.ok(i > 0, "route registered");
  const body = r.slice(i, r.indexOf("\n});\n", i));
  assert.match(body, /const auth = await getWorker\(c\);\n\s+if \(!auth\.ok\) return auth\.response;/);
  assert.match(body, /add\(now\);\n\s+own\.forEach\(add\);/, "current department first, then the worker's own set");
  assert.match(body, /\(auth\.worker\.position \?\? ""\) === "Operator Leader"/);
  assert.match(body, /getUTCDay\(\) === 0 \|\| holidays\.has\(d\)/, "Sunday or public holiday = not a working day");
  assert.match(body, /loadDeptCompletedByDay\(db, null\)/, "same counting as Floor Live (outsourced excluded)");
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/);
});

test("Scan screen carries the card; history pages through months; every string in four languages", () => {
  assert.match(read("src/pages/worker/scan.tsx"), /<h1 className="text-xl font-bold">\{t\("scan\.title"\)\}<\/h1>\n\n\s+\{\/\*[^\n]*\*\/\}\n\s+<DeptCompletedCard \/>/);
  const card = read("src/pages/worker/dept-completed-card.tsx");
  assert.match(card, /\/api\/worker\/dept-completed/);
  assert.match(card, /shiftMonth\(month, -1\)/);
  assert.match(card, /disabled=\{busy \|\| !canNext\}/, "no paging into the future");
  const keys = [...card.matchAll(/t\("(deptDone\.[a-zA-Z]+)"\)/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10);
  const i18n = read("src/lib/worker-i18n.ts");
  for (const k of new Set(keys)) {
    const at = i18n.indexOf(`'${k}': {`);
    assert.ok(at > 0, `missing ${k}`);
    const entry = i18n.slice(at, i18n.indexOf("},", at));
    for (const lang of ["en", "ms", "zh", "my"]) assert.match(entry, new RegExp(`\\n\\s+${lang}: '`), `${k} needs ${lang}`);
  }
});
