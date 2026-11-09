// ---------------------------------------------------------------------------
// no-native-confirm.test.mjs — React screens ask via useConfirm(), never the
// browser's native window.confirm().
//
// 2026-11-08 (owner-approved item 22). The owner rule in
// src/components/ui/confirm-dialog.tsx is that a destructive / posting action
// asks in the ERP's own dialog. Five components still called window.confirm():
// scan-po-modal (create SOs without a hub), accounting cash book (strict month
// lock, finalise unbalanced month), trade-finance setup, purchase returns
// (delete / remove from stock / issue Debit Note) and the /m Sales detail
// (cancel / undo cancel). They were swept onto useConfirm(). This test fails
// if a new native confirm appears under src/pages or src/components.
//
// ALLOWLIST — files deliberately left, each with the reason:
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ALLOW = new Map([
  // The provider's own last-resort fallback when no <ConfirmProvider> is
  // mounted. It is the one place a native confirm is the correct behaviour.
  ["src/components/ui/confirm-dialog.tsx", "fallbackConfirm when the provider is missing"],
  // Plain config objects (extraActions[].onClick), not components — there is
  // no hook scope to call useConfirm() from. Converting needs a confirm
  // function threaded through the /m action runner; tracked as a follow-up.
  ["src/pages/m/config/modules.ts", "non-component /m config; no hook scope"],
]);

const ROOTS = ["src/pages", "src/components"];
// `window.confirm(` / `globalThis.confirm(` or a bare `confirm("...")` /
// confirm(`...`) call with a string literal (the destructured useConfirm()
// `confirm({...})` takes an object, so it never matches).
const NATIVE = /\b(?:window|globalThis)\s*\.\s*confirm\s*\(|(?<![\w.$])confirm\s*\(\s*["'`]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

test("no native window.confirm() in src/pages or src/components", () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(".", file).split(sep).join("/");
      if (ALLOW.has(rel)) continue;
      // Blank out /* block */ comments (keeping their newlines so line numbers
      // stay true) — prose ABOUT window.confirm is not a call.
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        const code = line.replace(/^\s*\/\/.*$/, "");
        if (NATIVE.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Use `const { confirm } = useConfirm()` + `await confirm({ title, message, danger })` " +
      "from src/components/ui/confirm-dialog.tsx instead of the native dialog:\n" + offenders.join("\n"),
  );
});

test("the allowlist is not stale — every allowlisted file still exists", () => {
  for (const rel of ALLOW.keys()) {
    assert.ok(statSync(rel).isFile(), `${rel} is allowlisted but missing — drop it from ALLOW`);
  }
});

test("the swept components now use useConfirm()", () => {
  for (const rel of [
    "src/components/scan-po-modal.tsx",
    "src/pages/accounting/index.tsx",
    "src/pages/accounting/tabs/TradeFinanceBlock.tsx",
    "src/pages/purchase-returns/index.tsx",
    "src/pages/m/screens/SalesDetailScreen.tsx",
  ]) {
    assert.match(readFileSync(rel, "utf8"), /useConfirm\(\)/, rel);
  }
});
