import { test } from "node:test";
import assert from "node:assert/strict";
import { isHyperdriveUrl } from "../src/api/lib/db-pg.ts";

test("old Hyperdrive host is detected", () => {
  assert.equal(isHyperdriveUrl("postgresql://u:p@abc123.hyperdrive.local:5432/postgres?sslmode=disable"), true);
});

test("new Hyperdrive host (.workers.alt) is detected", () => {
  assert.equal(isHyperdriveUrl("postgresql://u:p@0123456789abcdef0123456789abcdef.workers.alt:5432/postgres"), true);
});

test("direct Supabase hosts are not Hyperdrive", () => {
  assert.equal(isHyperdriveUrl("postgresql://postgres.ref:p@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"), false);
  assert.equal(isHyperdriveUrl("postgresql://postgres:p@db.ref.supabase.co:5432/postgres"), false);
});
