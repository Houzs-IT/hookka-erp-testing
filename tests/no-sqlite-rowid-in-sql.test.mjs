// ---------------------------------------------------------------------------
// no-sqlite-rowid-in-sql.test.mjs — BUG-2026-10-16-300.
//
// `rowid` is a SQLite pseudo-column. Prod runs Postgres, where it does not
// exist, so any query naming it throws and the route 500s. The PO edit save
// ordered its stored lines by `line_no, rowid` and every PO edit failed with a
// generic toast. Fails on any new `rowid` in non-comment API code.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../src/api/", import.meta.url);
// Known open instance, logged in BUG-CLASSES C32: needs a line order invoice_items does not have.
const KNOWN_OPEN = new Set(["routes/admin.ts"]);

test("no API query names the SQLite-only rowid column", () => {
  const hits = [];
  for (const f of readdirSync(root, { recursive: true })) {
    const rel = String(f).replace(/\\/g, "/");
    if (!rel.endsWith(".ts") || KNOWN_OPEN.has(rel)) continue;
    readFileSync(new URL(rel, root), "utf8").split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*")) return;
      if (/\browid\b/.test(line)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("PO edit save orders stored lines by line_no, id", () => {
  const src = readFileSync(new URL("routes/purchase-orders.ts", root), "utf8");
  assert.match(src, /FROM purchase_order_items WHERE purchaseOrderId = \? ORDER BY line_no, id"/);
});
