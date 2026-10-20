// ---------------------------------------------------------------------------
// doc-detail-dblclick.test.mjs — owner 2026-09-22 「其他的类似 payment voucher,
// receipt 这些都要双击点开」: every finance document list opens its record on
// double-click; single click keeps doing what it did (select / expand).
// One modal shell (DocDetailModal) for vouchers, receipts, transfers.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const block = (from, to) => { const a = ui.indexOf(from); assert.notEqual(a, -1, from); const b = ui.indexOf(to, a + 1); return ui.slice(a, b === -1 ? undefined : b); };

test("one shell for every document popup", () => {
  assert.match(ui, /function DocDetailModal\(\{ title, badges, onClose, children, actions, wide \}/);
  assert.match(ui, /function DetailField\(\{ label, children, span \}/);
  assert.ok((ui.match(/<DocDetailModal/g) ?? []).length >= 3, "PV, receipts and fund transfer all use the shell");
});

test("Payment Vouchers: double-click opens the popup; single click does nothing (owner 2026-10-01)", () => {
  const pv = block("function PaymentsTab(", "// =============== TAB: OFFICIAL RECEIPT");
  // Right-click (2026-10-02) opens the row's menu; double-click still opens the
  // popup. The list is a DataGrid since finance v2: checkboxSelectOnly keeps a
  // single click from doing anything.
  assert.match(pv, /onDoubleClick=\{\(r\) => \(r\.pv \? setDetailPvId\(r\.pv\.id\) : setDetailPayKey\(r\.key\)\)\}/);
  assert.match(pv, /contextMenuItems=\{\(r\) => rowMenuItems\(r\.pv \? pvRowMenu\(r\.pv\) : payRowMenu\(r\)\)\}/);
  assert.match(pv, /\n\s+checkboxSelectOnly\n/);
  assert.doesNotMatch(pv, /setExpandedPv|expandedPv/, "no inline expand any more");
  assert.match(pv, /const r = \(rows \?\? \[\]\)\.find\(\(x\) => x\.id === detailPvId\);/, "resolved from rows so it refreshes after actions");
  // The popup carries the ladder trail, the lines / bills and the attachments block.
  assert.match(pv, /Ladder trail — who did what, when\./);
  assert.match(pv, /<PvAttachmentsBlock pv=\{r\} onChanged=\{load\} \/>/);
  assert.match(pv, /sourceId=\{r\.pvKind === "AP" \? r\.pvNo : r\.id\}\s*\n\s*\/>\s*\n\s*<\/DocDetailModal>/, "ledger entry + bank state close the popup");
  // Actions inside mirror the row: same handlers, same gates.
  for (const rung of ['"prepare"', '"withdraw"', '"reject"', '"check"', '"approve"']) assert.match(pv, new RegExp(`onClick=\\{\\(\\) => void handleLadder\\(r, ${rung}\\)\\}>`));
  assert.match(pv, /onClick=\{\(\) => \{ close\(\); void handleLifecycle\(r\.id, r\.pvNo, "void"\); \}\}/);
});

test("Receipts hub: double-click opens the popup, which shows the receipt's detail table", () => {
  const hub = block("function ReceiptsHubTab(", "// =============== TAB: FUND TRANSFER");
  // A DataGrid since finance v2; the click-to-expand row went (owner 2026-10-16
  // 「继续做」 on the recommendation) — double-click shows the same table.
  assert.match(hub, /onDoubleClick=\{\(r\) => setDetailKey\(r\.key\)\}/);
  assert.match(hub, /const detailTable = \(r: ReceiptHubRow\) => \(/);
  assert.equal((hub.match(/\{detailTable\(r\)\}/g) ?? []).length, 1, "the popup renders detailTable");
  assert.match(hub, /const r = rows\.find\(\(x\) => x\.key === detailKey\);/);
});

test("Fund Transfer, Other Party Bills / Payments, AP Invoices open on double-click too", () => {
  const ft = block("function FundTransferTab(", "// =============== TAB: STOCK SUMMARY");
  assert.match(ft, /onDoubleClick=\{\(r\) => setDetailFt\(r\.no\)\}/);
  assert.match(ft, /title=\{`Fund Transfer \$\{r\.no\}`\}/);
  const bills = block("function OtherPartyBillsManager(", "function OtherPartyPaymentForm(");
  // A DataGrid since 2026-10-17: double-click opens the bill's popup (the
  // card that used to unfold under the row).
  assert.match(bills, /onDoubleClick=\{\(b\) => setDetailBillId\(b\.id\)\}/);
  assert.match(bills, /<OtherPartyBillCard b=\{b\} accounts=\{accounts\} onChanged=\{load\} \/>/);
  const pays = block("function OtherPartyPaymentsManager(", "// =============== TAB: GENERAL LEDGER");
  assert.match(pays, /onDoubleClick=\{\(g\) => setDetail\(g\)\}/);
  const ap = block("function ApInvoicesTab(", "function DocDetailModal(");
  // Owner 2026-09-29: a PI opens its own detail page, not the list.
  assert.match(ap, /const openApInv = \(r: ApInvRow\) => \{ if \(r\.kind === "PI"\) navigate\(`\/procurement\/pi\/\$\{r\.id\}`\); else setDetailBillNo\(r\.no\); \};/);
  assert.match(ap, /onDoubleClick=\{openApInv\}/);
  // The checkbox cell never lets a double-click on it open the record.
  // Fund Transfer is a DataGrid since 2026-10-17: its tick column is the
  // grid's own (checkboxSelectOnly — a tick never opens the record).
  assert.match(ft, /selectable\n\s*checkboxSelectOnly/);
  assert.match(bills, /selectable\n\s*checkboxSelectOnly/);
});
