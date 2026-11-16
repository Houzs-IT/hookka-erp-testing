// HK-0150: siti@hookka.com was never read because a box with no
// HOSTINGER_PW_<NAME> secret was skipped with a log line nobody saw. A missing
// password must now fail the run (exit 1) while the other boxes are still tried.
// Runs mail-sync/sync.mjs against stub imapflow / postal-mime packages, so no
// network and no mail-sync install are needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stubPackage(root, name, source) {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  writeFileSync(join(dir, "index.js"), source);
}

test("a box with no password fails the run; the other boxes are still tried", () => {
  const root = mkdtempSync(join(tmpdir(), "mail-sync-"));
  try {
    copyFileSync("mail-sync/sync.mjs", join(root, "sync.mjs"));
    // Reaching the IMAP client means the box was attempted; stop right there.
    stubPackage(root, "imapflow", 'export class ImapFlow { constructor(o) { throw new Error("IMAP reached for " + o.auth.user); } }');
    stubPackage(root, "postal-mime", "export default class PostalMime {}");

    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("HOSTINGER_PW_")) delete env[k];
    Object.assign(env, {
      MAIL_INBOUND_SECRET: "x".repeat(16),
      ERP_INBOUND_URL: "http://127.0.0.1:9/never-called",
      MAILBOXES: "siti@hookka.com,support@hookka.com",
      HOSTINGER_PW_SUPPORT: "stub",
    });
    const r = spawnSync(process.execPath, ["sync.mjs"], { cwd: root, env, encoding: "utf8" });

    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /siti@hookka\.com FAILED: no password in HOSTINGER_PW_SITI/);
    assert.match(r.stderr, /IMAP reached for support@hookka\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
