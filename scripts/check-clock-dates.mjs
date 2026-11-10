#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-clock-dates.mjs — no server-clock calendar days in src/api.
//
// The Worker runs in UTC. Any calendar day / month / year read straight off the
// clock — `new Date().getMonth()`, or `const now = new Date(); … now.getMonth()`
// — is the UTC day, which is YESTERDAY in Malaysia before 08:00 (and last month
// on the 1st). tests/no-utc-today.test.mjs only catches the one-line
// `new Date().toISOString().slice(0, 10)`; the document-number bug fixed in
// #1247 slipped past it because the clock and the read were on different lines.
//
// This pass (cross-system review P2, ported from Houzs#5517) tracks, per file,
// every identifier bound to the clock — `const x = new Date()`, a default
// parameter `(now = new Date())`, `new Date(Date.now())`, `new Date(Date.now() -
// n)` — and flags a calendar read on it: get[UTC]FullYear/Month/Date/Day,
// toLocaleDateString('en-CA'), toISOString().slice(0, 7|10) / .split('T').
// `new Date(Date.now() + 8 * …)` (the Malaysia shift) is NOT a clock binding.
//
// Use todayYmdMY() (src/lib/utils.ts) or mytYymm() (src/lib/doc-number.ts).
// A site that genuinely needs the UTC day goes in
// scripts/data/clock-date-allowlist.json with the reason.
//
//   node scripts/check-clock-dates.mjs        # exit 1 on a new finding
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const IDENT = String.raw`[A-Za-z_$][\w$]*`;
// new Date()  |  new Date(Date.now())  |  new Date(Date.now() - <expr>)
const CLOCK = String.raw`new\s+Date\s*\(\s*(?:Date\.now\(\)\s*(?:-\s*[^()]*(?:\([^()]*\)[^()]*)*)?)?\)`;
const DAY_READ = String.raw`\.\s*(?:get(?:UTC)?(?:FullYear|Month|Date|Day)\s*\(\s*\)|toLocaleDateString\(\s*["'\`]en-CA["'\`]|toISOString\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*(?:7|10)\s*\)|toISOString\(\)\s*\.\s*split\(\s*["'\`]T["'\`]\s*\))`;

const BIND = new RegExp(String.raw`(?<![\w$.])(${IDENT})\s*(?::\s*Date\s*)?=\s*${CLOCK}(?=\s*[;,)\n])`, "g");
const DIRECT = new RegExp(CLOCK + String.raw`\s*` + DAY_READ);

/** Line numbers (1-based) and text of every clock-day read in `text`. */
export function findClockDayReads(text) {
  const lines = text.split("\n");
  const hits = new Map();
  const add = (i) => hits.set(i + 1, lines[i].trim());

  // Strip line comments so prose about the bug is not itself a finding.
  const code = lines.map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ""));

  code.forEach((l, i) => {
    if (DIRECT.test(l)) add(i);
  });

  const names = new Set();
  code.forEach((l) => {
    for (const m of l.matchAll(BIND)) names.add(m[1]);
  });
  for (const name of names) {
    const n = name.replace(/\$/g, "\\$");
    const read = new RegExp(String.raw`(?<![\w$.])${n}\s*${DAY_READ}`);
    const clockBind = new RegExp(String.raw`(?<![\w$.])${n}\s*(?::\s*Date\s*)?=\s*${CLOCK}(?=\s*[;,)\n])`);
    // Any other binding of the same name (`const d = new Date(iso)`, a
    // parameter `(d: Date)`, `d = parse(x)`) ends the tracking until the name
    // is bound to the clock again — names like `d` / `now` are reused.
    const otherBind = new RegExp(
      String.raw`(?:(?:const|let|var)\s+${n}\s*(?::[^=]+)?=(?![=>])|(?<![\w$.])${n}\s*=(?![=>])|[(,]\s*${n}\s*:\s*[A-Za-z])`,
    );
    let live = false;
    for (let i = 0; i < code.length; i++) {
      const l = code[i];
      if (clockBind.test(l)) live = true;
      else if (otherBind.test(l)) live = false;
      if (live && read.test(l)) add(i);
    }
  }
  return [...hits].sort((a, b) => a[0] - b[0]).map(([line, src]) => ({ line, src }));
}

const ALLOWLIST_PATH = "scripts/data/clock-date-allowlist.json";

/** Every finding in src/api that is not allowlisted (matched by file + line text). */
export function scanSrcApi() {
  const files = execFileSync("git", ["ls-files", "src/api"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\./.test(f));
  const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).entries;
  const findings = [];
  const used = new Set();
  for (const file of files) {
    for (const hit of findClockDayReads(readFileSync(file, "utf8"))) {
      const ok = allow.findIndex((a) => a.file === file && a.src === hit.src);
      if (ok >= 0) used.add(ok);
      else findings.push({ file, ...hit });
    }
  }
  const stale = allow.filter((_, i) => !used.has(i));
  return { findings, stale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { findings, stale } = scanSrcApi();
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.src}`);
  for (const s of stale) console.log(`stale allowlist entry: ${s.file}  ${s.src}`);
  if (findings.length || stale.length) {
    console.error(
      `\n${findings.length} server-clock calendar read(s), ${stale.length} stale allowlist entr(ies).\n` +
        "Use todayYmdMY() / mytYymm(), or allowlist a genuinely-UTC site in " + ALLOWLIST_PATH,
    );
    process.exit(1);
  }
  console.log("check-clock-dates: clean");
}
