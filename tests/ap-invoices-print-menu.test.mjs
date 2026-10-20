// ---------------------------------------------------------------------------
// AP Invoices: tick-box print / export and the row menu Print / Edit / Copy /
// Void (owner 2026-10-20 「这个需要」, from the design list). An AP bill prints
// as its voucher; a purchase invoice prints as its own PDF through the SAME
// loader Procurement's Purchase Invoices list uses, so a PI never prints
// differently from one place to another. A purchase invoice is edited or
// cancelled on its own page. Made-up data only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const ap = ui.slice(ui.indexOf("function ApInvoicesTab("), ui.indexOf("function DocDetailModal("));
const { loadPiForPrint, piWithSupplier } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/pi-print-load.ts")).href);

test("the PI loader: the full invoice with its supplier's block, under the buying company; a failed load is null", async () => {
  const { pi, orgCode } = piWithSupplier(
    { id: "pi-1", piNo: "PI-0001", supplierId: "sup-1", items: [{ description: "Foam" }] },
    [{ id: "sup-0" }, { id: "sup-1", address: "2 Test Lane", contactPerson: "Mr Test", phone: "03-0000", email: "a@b.test", purchaseOrgCode: "OHANA" }],
  );
  assert.equal(pi.piNo, "PI-0001");
  assert.deepEqual(pi.items, [{ description: "Foam" }], "the lines come from the full invoice");
  assert.deepEqual([pi.supplierAddress, pi.supplierContact, pi.supplierPhone, pi.supplierEmail], ["2 Test Lane", "Mr Test", "03-0000", "a@b.test"]);
  assert.equal(orgCode, "OHANA");
  assert.equal(piWithSupplier({ supplierId: "nobody" }, []).orgCode, "HOOKKA", "no supplier → Hookka's letterhead");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ success: false }), { status: 404 }); };
  try {
    assert.equal(await loadPiForPrint("pi-missing", [], []), null, "never a half document");
    assert.deepEqual(calls, ["/api/purchase-invoices/pi-missing"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Procurement's list and AP Invoices print a PI through the one loader", () => {
  const pi = read("src/pages/procurement/pi.tsx");
  assert.match(pi, /import \{ loadPiForPrint as loadPiPrint \} from "@\/lib\/pi-print-load";/);
  assert.match(pi, /\(id: string\) => loadPiPrint\(id, suppliers, orgsResp\?\.organisations\),/);
  assert.match(ui, /import \{ loadPiForPrint, type PiPrintSupplier \} from "@\/lib\/pi-print-load";/);
  assert.match(ap, /await loadPiForPrint\(r\.id, sup\?\.data \?\? \[\], orgs\?\.organisations\)/);
  // One PI → its PDF; several → one combined PDF; a bill → its voucher.
  assert.match(ap, /if \(ok\.length === 1\) generatePurchaseInvoicePdf\(ok\[0\]\.pi as unknown as PiPdf, ok\[0\]\.letterhead\);/);
  assert.match(ap, /else await generateCombinedPurchaseInvoicePdf\(/);
  assert.match(ap, /if \(apBills\.length\) printVouchers\(apBills\.map\(\(b\) => buildOtherPartyBillVoucher\(b, accounts\)\)\);/);
  // Nothing is dropped quietly.
  assert.match(ap, /toast\.error\(`Not printed — \$\{unloaded\.length\} could not be loaded/);
});

test("tick rows: print them or take them to Excel; a click on a row still opens nothing, the box ticks", () => {
  assert.match(ap, /selectable\n\s+checkboxSelectOnly\n\s+onSelectionChange=\{setSelectedApRows\}/);
  assert.match(ap, /<BatchActionsBar\n\s+count=\{selectedApRows\.length\}\n\s+onPrint=\{\(\) => void printApRows\(selectedApRows\)\}/);
  assert.match(ap, /\["Kind", "No\.", "Supplier", "Supplier ref", "Date", "Due", "Description", "Total \(RM\)", "Paid \(RM\)", "Outstanding \(RM\)", "Status"\]/);
});

test("the row menu: Open and Print for every row; a bill's Edit / Copy / Void here; Pay while open", () => {
  const menu = ap.slice(ap.indexOf("const apInvRowMenu = "), ap.indexOf("const liveSum = "));
  assert.match(menu, /\{ label: "Print", action: \(\) => void printApRows\(\[r\]\) \}/);
  assert.match(menu, /\.\.\.\(!voided \? \[\{ label: "Edit", action: \(\) => setBillPopup\(\{ mode: "edit", bill: b \}\) \}\] : \[\]\),/);
  assert.match(menu, /\{ label: "Copy", action: \(\) => setBillPopup\(\{ mode: "copy", bill: b \}\) \},/);
  assert.match(menu, /\? \{ label: "Unvoid", action: \(\) => void billLifecycle\(b, "unvoid"\) \}\n\s+: \{ label: "Void", danger: true, action: \(\) => void billLifecycle\(b, "void"\) \},/);
  // A purchase invoice has no bill here: no Edit / Copy / Void in this list (its page does that).
  assert.match(menu, /const billOf = |const b = billOf\(r\);/);
  assert.match(ap, /const billOf = \(r: ApInvRow\) => \(r\.kind === "AP" \? bills\.find\(\(b\) => b\.billNo === r\.no\) : undefined\);/);
  assert.match(menu, /r\.status === "OPEN" && r\.partyId \? \[\{ label: "Pay", action: \(\) => navigate\(payHref\(r\)\) \}\] : \[\],/);
});
