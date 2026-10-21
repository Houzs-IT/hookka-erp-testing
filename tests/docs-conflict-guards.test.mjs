// ---------------------------------------------------------------------------
// docs-conflict-guards.test.mjs — 2026-10-21. Every merge to main put every
// other open PR into conflict, only in docs: each branch added a `Last verified`
// line under the title of CODEBASE-MAP / a module guide / BUG-HISTORY, inserted
// its bug entry at the top of BUG-HISTORY, and committed a regenerated API.md.
// check-docs-freshness.mjs now fails a branch that does any of those; this
// drives it against a throwaway repo, one branch per case.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("scripts/check-docs-freshness.mjs");
const STAMP = "> **Last verified: 2026-10-21** against nothing\n";
// Under the pre-commit hook git exports GIT_DIR / GIT_INDEX_FILE, which would
// point every child git below at the real repo instead of the throwaway one.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const LEDGER = "# Bug History\n\n## BUG-2026-10-20-001 — old `x` 🟡\n\nbody\n";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "docs-guard-"));
  const git = (...a) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...a], { cwd: dir, env });
  const put = (f, s) => (mkdirSync(join(dir, f, ".."), { recursive: true }), writeFileSync(join(dir, f), s));
  git("init", "-q", "-b", "main");
  put("docs/CODEBASE-MAP.md", `# Map\n${STAMP}\nbody\n`);
  put("docs/API.md", `# API\n> **Last generated: 2026-10-21**\n`);
  put("docs/BUG-HISTORY.md", LEDGER);
  git("add", "-A");
  git("commit", "-qm", "base");
  return { dir, git, put };
}

function check(r, edit) {
  r.git("switch", "-q", "-c", "b");
  edit(r);
  r.git("add", "-A");
  r.git("commit", "-qm", "branch");
  const out = spawnSync(process.execPath, [SCRIPT, "--base", "main"], { cwd: r.dir, env, encoding: "utf8" });
  rmSync(r.dir, { recursive: true, force: true });
  return out;
}

test("a new bug as its own file in docs/bugs/ passes", () => {
  const out = check(repo(), (r) => r.put("docs/bugs/BUG-2026-10-21-002.md", "## BUG-2026-10-21-002 — new `x` 🟡\n"));
  assert.equal(out.status, 0, out.stdout);
});

test("flipping an archived entry to ✅ in place passes", () => {
  const out = check(repo(), (r) =>
    r.put("docs/BUG-HISTORY.md", LEDGER.replace("old `x` 🟡", "old `x` ✅")),
  );
  assert.equal(out.status, 0, out.stdout);
});

test("a new entry in BUG-HISTORY.md fails", () => {
  const out = check(repo(), (r) =>
    r.put("docs/BUG-HISTORY.md", LEDGER.replace("\n\n## BUG", "\n\n## BUG-2026-10-21-002 — new\n\n## BUG")),
  );
  assert.equal(out.status, 1);
  assert.match(out.stdout, /new entry was added to docs\/BUG-HISTORY\.md/);
});

test("a per-branch Last verified line on CODEBASE-MAP fails", () => {
  const out = check(repo(), (r) =>
    r.put("docs/CODEBASE-MAP.md", readFileSync(join(r.dir, "docs/CODEBASE-MAP.md"), "utf8").replace("# Map\n", `# Map\n${STAMP}`)),
  );
  assert.equal(out.status, 1);
  assert.match(out.stdout, /CODEBASE-MAP\.md: this branch adds a "Last verified" line/);
});

test("committing docs/API.md on a branch fails", () => {
  const out = check(repo(), (r) => r.put("docs/API.md", "# API\n> **Last generated: 2026-10-22**\n"));
  assert.equal(out.status, 1);
  assert.match(out.stdout, /this branch changes docs\/API\.md/);
});
