// ---------------------------------------------------------------------------
// no-query-in-loop.test.mjs — stop NEW database round-trips inside loops.
//
// Why (hardening batch, owner-approved 2026-11-08)
// ------------------------------------------------
// `for (const line of items) { await db.prepare(...).run(); }` costs one
// round-trip to Postgres per line. On a 40-line order that is 40 trips through
// Hyperdrive, and it is the commonest cause of slow saves and Worker CPU-limit
// failures in this codebase. The fix is usually a single batched statement
// (`db.batch([...])`, `WHERE id IN (...)`, `INSERT ... VALUES (...), (...)`).
//
// This test does NOT refactor the loops that already exist. It counts them per
// file, and fails only when a file has MORE than its recorded baseline — so a
// new query-in-loop is caught at review time, and the existing ones are a
// visible, countable debt.
//
// What it counts
//   In every `src/api/routes/*.ts` file (top level, not sub-folders): an
//   `await` whose statement reaches `.prepare(`, `.first(`, `.all(` or `.run(`
//   and that sits inside the body of a `for` / `while` / `do` loop. Nested
//   loops are counted once per call site, not once per loop level.
//
// What it does NOT see (by design — keep the scanner simple)
//   * `.forEach(async ...)`, `.map(async ...)` + `Promise.all` — a different
//     shape (parallel, not serial); not counted.
//   * a query inside a helper function that is CALLED from a loop.
//   Comments and '...' / "..." strings are blanked before scanning so a loop or
//   an `await` mentioned in a comment does not count.
//
// When this test fails
//   1. Best: batch the query (see above) so the count goes back down.
//   2. If the loop is genuinely needed (e.g. chunked writes of a bounded,
//      small list), raise that file's number in
//      tests/no-query-in-loop.baseline.json IN THE SAME PR and say why in the
//      PR description — the baseline diff is the review signal.
//   A file whose count DROPS below baseline only prints a note; lower the
//   number when convenient so the ratchet tightens.
//
// Regenerate the baseline (only when deliberately accepting the current state):
//   node tests/no-query-in-loop.test.mjs --write-baseline
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '..', 'src', 'api', 'routes');
const BASELINE_PATH = join(HERE, 'no-query-in-loop.baseline.json');

/** Replace comments and '...' / "..." string bodies with spaces (length-preserving). */
export function blankCommentsAndStrings(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === '/' && nx === '/') {
      const end = src.indexOf('\n', i);
      const e = end === -1 ? n : end;
      blank(i, e);
      i = e;
    } else if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const e = end === -1 ? n : end + 2;
      blank(i, e);
      i = e;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Index just past the bracket matching the opener at `open` (`(` or `{`). */
function matchBracket(s, open) {
  const o = s[open];
  const c = o === '(' ? ')' : '}';
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === o) depth++;
    else if (s[k] === c) {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return s.length;
}

/** [start, end) ranges of every loop body in already-blanked source. */
export function loopBodyRanges(s) {
  const ranges = [];
  const re = /\b(for|while)\s*\(|\bdo\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    let bodyStart;
    if (m[0].startsWith('do')) {
      bodyStart = m.index + m[0].length - 1;
    } else {
      const parenOpen = m.index + m[0].length - 1;
      const afterParen = matchBracket(s, parenOpen);
      bodyStart = afterParen;
      while (bodyStart < s.length && /\s/.test(s[bodyStart])) bodyStart++;
      // `} while (cond);` closing a do-loop — no body of its own.
      if (m[1] === 'while' && s[bodyStart] === ';') continue;
    }
    if (s[bodyStart] === '{') {
      ranges.push([bodyStart, matchBracket(s, bodyStart)]);
    } else {
      // Brace-less single-statement body: up to the next `;`.
      const semi = s.indexOf(';', bodyStart);
      ranges.push([bodyStart, semi === -1 ? s.length : semi + 1]);
    }
  }
  return ranges;
}

/** Count `await ... .prepare(/.first(/.all(/.run(` call sites inside any loop body. */
export function countQueriesInLoops(src) {
  const s = blankCommentsAndStrings(src);
  const ranges = loopBodyRanges(s);
  if (ranges.length === 0) return 0;
  const re = /\bawait\b[^;]*?\.(prepare|first|all|run)\s*\(/g;
  let count = 0;
  let m;
  while ((m = re.exec(s))) {
    const at = m.index;
    if (ranges.some(([a, b]) => at >= a && at < b)) count++;
  }
  return count;
}

function scanRoutes() {
  const counts = {};
  for (const f of readdirSync(ROUTES).sort()) {
    if (!f.endsWith('.ts')) continue;
    const n = countQueriesInLoops(readFileSync(join(ROUTES, f), 'utf8'));
    if (n > 0) counts[f] = n;
  }
  return counts;
}

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(scanRoutes(), null, 2) + '\n');
  console.log(`wrote ${BASELINE_PATH}`);
} else {
  test('scanner: counts an awaited query inside a for-loop body', () => {
    const src = `
      for (const it of items) {
        await db.prepare("UPDATE t SET a = ? WHERE id = ?").bind(1, it.id).run();
      }`;
    assert.equal(countQueriesInLoops(src), 1);
  });

  test('scanner: nested loops count each call site once', () => {
    const src = `
      for (const a of as) {
        while (more) {
          const r = await c.var.DB.prepare("SELECT 1").first();
        }
      }`;
    assert.equal(countQueriesInLoops(src), 1);
  });

  test('scanner: ignores queries outside loops, in comments, and do-while tails', () => {
    const src = `
      const rows = await db.prepare("SELECT * FROM t").all();
      // for (const x of xs) { await db.prepare("x").run(); }
      /* while (true) { await db.prepare("y").run(); } */
      do { i++; } while (i < 3);
      await db.prepare("DELETE FROM t").run();`;
    assert.equal(countQueriesInLoops(src), 0);
  });

  test('scanner: a brace-less loop body is one statement', () => {
    const src = `
      for (const id of ids) await db.prepare("DELETE FROM t WHERE id = ?").bind(id).run();
      await db.prepare("SELECT 1").first();`;
    assert.equal(countQueriesInLoops(src), 1);
  });

  test('no file in src/api/routes adds a NEW awaited query inside a loop', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const counts = scanRoutes();
    const grew = [];
    for (const [file, n] of Object.entries(counts)) {
      const allowed = baseline[file] ?? 0;
      if (n > allowed) grew.push(`${file}: ${n} (baseline ${allowed})`);
    }
    for (const [file, allowed] of Object.entries(baseline)) {
      const n = counts[file] ?? 0;
      if (n < allowed) {
        console.log(`[no-query-in-loop] ${file} is down to ${n} (baseline ${allowed}) — lower the baseline.`);
      }
    }
    assert.deepEqual(
      grew,
      [],
      'New awaited DB call(s) inside a loop. Batch the query, or — if the loop is ' +
        'genuinely needed — raise the file in tests/no-query-in-loop.baseline.json ' +
        'and justify it in the PR. Offenders:\n  ' +
        grew.join('\n  '),
    );
  });
}
