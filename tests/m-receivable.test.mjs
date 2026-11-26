// ---------------------------------------------------------------------------
// m-receivable.test.mjs — the phone's Receivable app (Batch 3, approved
// prototype "Receivable (standalone)", 2026-11-26). Six read-only views, each
// gated like its desktop page; Debtor Aging is the shared Finance screen; no
// write of any kind; the Receipts "Cancelled" chip is "lifecycle not ACTIVE".
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dir = "src/pages/m/screens/receivable/";
const route = read(dir + "ReceivableRoute.tsx");
const rowsSrc = read(dir + "rcv-rows.ts");

test("the hub: six views in the prototype's order, each with its desktop gate", () => {
  const rows = [...rowsSrc.matchAll(/\{ k: "(\w+)", l: "([^"]+)", s: "[^"]+", icon: \w+, c: "#\w+", bg: "#\w+", gates: \[([^\]]+)\] \}/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows.map((r) => r[0]), ["debt", "rlist", "rinv", "rstmt", "rcpt", "rnote"]);
  assert.deepEqual(rows.map((r) => r[1]), ["Debtor Aging", "Debtor List", "AR Invoices", "Customer Statement", "Receipts", "Credit & Debit Notes"]);
  assert.equal(rows[0][2], '"/accounting?tab=ar"');
  assert.equal(rows[1][2], '"/accounting?tab=debtors"');
  assert.equal(rows[2][2], '"/accounting?tab=arinvoices"');
  assert.equal(rows[4][2], '"/accounting?tab=receipts"');
  assert.equal(rows[5][2], '"/invoices/credit-notes", "/invoices/debit-notes"');
  assert.match(rowsSrc, /return RCV_ROWS\.filter\(\(r\) => r\.gates\.some\(\(g\) => isAllowed\(g\)\)\);/, "no permission, no row");
  assert.match(route, /if \(!row\) return <NoAccess/, "a deep link without permission says No access");
});

test("Debtor Aging is the shared Finance screen; the Invoices AR Aging is not used", () => {
  assert.match(route, /<AgingScreen side="debtor" onBack=\{toHub\} nav=\{nav\} \/>/);
  for (const f of readdirSync(dir)) assert.doesNotMatch(read(dir + f), /\/api\/invoices\/aging/, f);
});

test("routes: /m/receivables, /:view, /:view/:id, code-split; the generic list is no longer routed", () => {
  const layout = read("src/pages/m/MobileLayout.tsx");
  assert.match(layout, /const ReceivableRoute = lazy\(\(\) => import\("\.\/screens\/receivable\/ReceivableRoute"\)\);/);
  for (const p of ["receivables", "receivables/:view", "receivables/:view/:id"]) {
    assert.ok(layout.includes(`<Route path="${p}" element={<ReceivableRouteShell />} />`), p);
  }
  assert.match(layout, /MODULE_CONFIGS\.filter\(\(cfg\) => cfg\.slug !== "receivables"\)\.map/);
  // The More / drawer row is unchanged.
  assert.match(read("src/pages/m/nav.ts"), /\{ label: "Receivables", icon: Wallet, path: "\/m\/receivables", navGate: "\/accounting\?tab=ar" \}/);
});

test("read-only: no view sends a write", () => {
  for (const f of readdirSync(dir)) {
    const s = read(dir + f);
    assert.doesNotMatch(s, /method:\s*"(POST|PUT|PATCH|DELETE)"/, f);
    assert.doesNotMatch(s, /mutateJson|refreshList/, f);
  }
});

test("Receipts: customer receipts need payments:read; Cancelled = lifecycle not ACTIVE (a bounced receipt stays in its kind)", () => {
  const s = read(dir + "ReceiptsView.tsx");
  assert.match(s, /const canCust = hasPermission\("payments", "read"\);/);
  assert.match(s, /c === "cancelled" \? r\.state !== "ACTIVE" : r\.kind === c/);
});

test("Notes: each side follows its own read permission", () => {
  const s = read(dir + "NotesView.tsx");
  assert.match(s, /hasPermission\("credit-notes", "read"\)/);
  assert.match(s, /hasPermission\("debit-notes", "read"\)/);
});

test("a sales invoice and a trade customer open the existing detail screens", () => {
  assert.match(read(dir + "ArInvoicesView.tsx"), /\/m\/invoices\//);
  assert.match(read(dir + "DebtorListView.tsx"), /\/m\/customers\//);
});
