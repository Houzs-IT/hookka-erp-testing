// Security audit C1 (owner-approved 2026-07-23; built 2026-11-19): the
// assistant's run_select_query must never read credentials or sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { scrubSensitiveColumns, sensitiveSqlIdentifier } from "../src/api/lib/assistant-tools.ts";

test("queries naming a credential table or column are refused, in any spelling", () => {
  for (const q of [
    "SELECT token FROM user_sessions",
    'SELECT * FROM "userSessions"',
    "SELECT totp_secret FROM users",
    "SELECT u.passwordHash FROM users u",
    "WITH x AS (SELECT * FROM worker_tokens) SELECT * FROM x",
    "SELECT pin FROM worker_pins",
    "select * from password_reset_tokens",
    "SELECT * FROM worker_sessions",
  ]) assert.ok(sensitiveSqlIdentifier(q), q);
});

test("ordinary business queries are not caught", () => {
  for (const q of [
    "SELECT company_so_id, total_sen FROM sales_orders LIMIT 5",
    "SELECT name, email, role FROM users",
    "SELECT qr_token FROM delivery_orders",
    "SELECT * FROM job_cards WHERE status = 'COMPLETED'",
    "SELECT spinner FROM products",
  ]) assert.equal(sensitiveSqlIdentifier(q), null, q);
});

test("SELECT * rows lose credential columns before they reach the model", () => {
  const row = scrubSensitiveColumns({ id: "u1", name: "Lim", password_hash: "x", totpSecret: "y", token: "z", email: "a@b" });
  assert.deepEqual(row, { id: "u1", name: "Lim", email: "a@b" });
});
