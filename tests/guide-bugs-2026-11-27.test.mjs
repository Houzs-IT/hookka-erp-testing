// ---------------------------------------------------------------------------
// guide-bugs-2026-11-27.test.mjs — regression tests for five bugs found while
// writing the AI Connector how-to guides (BUG-2026-11-27-591 … -595). The
// sixth (show_me SVG, -596) is in tests/mcp-help-shots.test.mjs.
// Pure helpers are exercised directly; UI wiring is pinned by source pattern
// (house style).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isInvoiceableDo, INVOICEABLE_DO_STATUS, invoiceFromDoPath } from "../src/lib/invoiceable-do.ts";
import { buildBulkGrnPlan, bulkGrnItems } from "../src/lib/po-bulk-grn.ts";
import { isPoEditable, hasReceivingGrn } from "../src/lib/po-editable.ts";
import { summarizePoGrns } from "../src/lib/po-grn-refs.ts";
import { systemInfoItems, shortCommit } from "../src/lib/settings-system-info.ts";
import { bareInvoicedFlipRefusal } from "../src/api/lib/do-partial-invoice.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- BUG-2026-11-27-591: New Invoice dialog listed LOADED DOs ------------
test("591: only DELIVERED (and not held for paperwork) DOs are invoiceable", () => {
  assert.equal(INVOICEABLE_DO_STATUS, "DELIVERED");
  assert.equal(isInvoiceableDo({ status: "DELIVERED" }), true);
  assert.equal(isInvoiceableDo({ status: "LOADED" }), false);
  assert.equal(isInvoiceableDo({ status: "IN_TRANSIT" }), false);
  assert.equal(isInvoiceableDo({ status: "INVOICED" }), false);
  assert.equal(isInvoiceableDo({ status: "DELIVERED", deliveryIncomplete: true }), false);
  assert.equal(isInvoiceableDo({ status: "DELIVERED", deliveryIncomplete: 1 }), false);
  assert.equal(isInvoiceableDo({ status: "DELIVERED", deliveryIncomplete: 0 }), true);
});

test("591: the dialog and the server share the one rule", () => {
  const page = read("src/pages/invoices/index.tsx");
  assert.match(page, /all\.filter\(isInvoiceableDo\)/);
  assert.doesNotMatch(page, /o\.status === "LOADED"/);
  assert.doesNotMatch(page, /DELIVERED or LOADED/);
  const route = read("src/api/routes/invoices.ts");
  assert.match(route, /doRow\.status !== INVOICEABLE_DO_STATUS/);
});

// ---- BUG-2026-11-27-592: bulk Convert to GRN posted with no confirmation --
test("592: the plan lists each PO's outstanding lines; fully received lines and POs are left out", () => {
  const plan = buildBulkGrnPlan([
    {
      id: "po1", poNo: "PO-1", supplierName: "Foam Co",
      items: [
        { materialCode: "F1", materialName: "Foam", quantity: 10, receivedQty: 4, unit: "PCS" },
        { materialCode: "F2", materialName: "Glue", quantity: 5, receivedQty: 5, unit: "KG" },
        { materialCode: "F3", materialName: "Wood", quantity: 3, receivedQty: 0, unit: "PCS" },
      ],
    },
    { id: "po2", poNo: "PO-2", items: [{ materialName: "Done", quantity: 2, receivedQty: 2 }] },
  ]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].poNo, "PO-1");
  assert.deepEqual(plan[0].lines.map((l) => [l.poItemIndex, l.materialCode, l.receive, l.unit]), [
    [0, "F1", 6, "PCS"],
    [2, "F3", 3, "PCS"],
  ]);
  // What is posted is exactly what was shown.
  assert.deepEqual(bulkGrnItems(plan[0]), [
    { poItemIndex: 0, receivedQty: 6, acceptedQty: 6, rejectedQty: 0, rejectionReason: null },
    { poItemIndex: 2, receivedQty: 3, acceptedQty: 3, rejectedQty: 0, rejectionReason: null },
  ]);
});

test("592: desktop and /m confirm with the plan BEFORE any POST /api/grn", () => {
  for (const f of ["src/pages/procurement/index.tsx", "src/pages/m/screens/ModuleListScreen.tsx"]) {
    const src = read(f);
    const confirmAt = src.indexOf("message: <BulkGrnConfirmBody plan={plan} />");
    assert.ok(confirmAt > 0, `${f}: confirmation body`);
    const postAt = src.indexOf('fetch(`/api/grn`', confirmAt) >= 0 ? src.indexOf('fetch(`/api/grn`', confirmAt) : src.indexOf('fetch("/api/grn"', confirmAt);
    assert.ok(postAt > confirmAt, `${f}: the GRN POST comes after the confirmation`);
    assert.equal(src.slice(0, confirmAt).includes('fetch("/api/grn"') || src.slice(0, confirmAt).includes("fetch(`/api/grn`"), false, `${f}: no GRN POST before the confirmation`);
    assert.match(src, /bulkGrnItems\(planned\)/, `${f}: posts the confirmed plan`);
  }
  const body = read("src/components/procurement/bulk-grn-confirm-body.tsx");
  assert.match(body, /posted to stock now/);
});

// ---- BUG-2026-11-27-593: PO list right-click Edit DRAFT-only ----------------
test("593: CONFIRMED with nothing received is editable; received / posted GRN / terminal is not", () => {
  const items0 = [{ receivedQty: 0 }, { receivedQty: 0 }];
  assert.equal(isPoEditable({ status: "CONFIRMED", items: items0 }, false), true);
  assert.equal(isPoEditable({ status: "DRAFT", items: items0 }, false), true);
  assert.equal(isPoEditable({ status: "SUBMITTED", items: items0 }, false), true);
  assert.equal(isPoEditable({ status: "CONFIRMED", items: [{ receivedQty: 1 }] }, false), false);
  assert.equal(isPoEditable({ status: "CONFIRMED", items: items0 }, true), false);
  for (const st of ["CANCELLED", "RECEIVED", "CLOSED"]) assert.equal(isPoEditable({ status: st, items: items0 }, false), false, st);
  assert.equal(hasReceivingGrn([{ status: "DRAFT" }]), false);
  assert.equal(hasReceivingGrn([{ status: "POSTED" }]), true);
  assert.equal(hasReceivingGrn([{ status: "confirmed" }]), true);
  assert.equal(hasReceivingGrn(undefined), false);
});

test("593: the list's grnRefs carry the GRN status; list and detail call the shared helper", () => {
  const m = summarizePoGrns(["po-1"], [{ id: "g1", grnNumber: "GRN-1", poId: "po-1", receiveDate: "2026-11-01", status: "posted" }], []);
  assert.equal(m.get("po-1").grnRefs[0].status, "POSTED");
  const list = read("src/pages/procurement/index.tsx");
  assert.match(list, /disabled: !isPoEditable\(row, hasReceivingGrn\(row\.grnRefs\)\)/);
  assert.doesNotMatch(list, /label: "Edit",[\s\S]{0,200}disabled: row\.status !== "DRAFT"/);
  const detail = read("src/pages/procurement/detail.tsx");
  assert.match(detail, /const isEditable = isPoEditable\(po, hasPostedGrn\)/);
});

// ---- BUG-2026-11-27-594: /settings System Information sample numbers -----
test("594: System Information shows only real values, a dash when unknown", () => {
  assert.deepEqual(systemInfoItems({ users: [{}, {}, {}], health: { commit: "0123456789abcdef", env: "production" } }), [
    { label: "User accounts", value: "3" },
    { label: "Deployed build", value: "0123456" },
    { label: "Environment", value: "production" },
  ]);
  assert.deepEqual(systemInfoItems({ users: null, health: null }).map((i) => i.value), ["—", "—", "—"]);
  assert.equal(shortCommit("dev"), "dev");
  const page = read("src/pages/settings/index.tsx");
  for (const fake of ['"1,247"', '"14/04/2026, 02:00"', 'value: "5"', "Total Records", "Last Backup"]) {
    assert.ok(!page.includes(fake), `hard-coded sample figure still on the page: ${fake}`);
  }
  assert.match(page, /systemInfoItems\(/);
});

// ---- BUG-2026-11-27-595: DO "Convert to Invoice" only flipped the status --
test("595: the DO page's Convert to Invoice opens the real create path, never PUTs INVOICED", () => {
  assert.equal(invoiceFromDoPath("do 1"), "/invoices?createFromDo=do%201");
  const detail = read("src/pages/delivery/detail.tsx");
  assert.doesNotMatch(detail, /advanceStatus\("INVOICED"\)/);
  assert.match(detail, /navigate\(invoiceFromDoPath\(order\.id\)\)/);
  const inv = read("src/pages/invoices/index.tsx");
  assert.match(inv, /searchParams\.get\("createFromDo"\)/);
  assert.match(inv, /body: \{ deliveryOrderId: selectedDOId \}/);
});

test("595: the server refuses a bare DELIVERED → INVOICED flip unless invoices already bill the whole DO", () => {
  const base = { lines: [], legacyInvoices: [], legacyInvoice: null };
  const unbilled = { ...base, totalQty: 4, invoicedQty: 0, remainingQty: 4, fullyInvoiced: false, liveInvoiceCount: 0 };
  const partly = { ...base, totalQty: 4, invoicedQty: 1, remainingQty: 3, fullyInvoiced: false, liveInvoiceCount: 1 };
  const full = { ...base, totalQty: 4, invoicedQty: 4, remainingQty: 0, fullyInvoiced: true, liveInvoiceCount: 1 };
  assert.match(bareInvoicedFlipRefusal("DO-1", unbilled), /DO-1 has no invoice for 4 of its 4/);
  assert.match(bareInvoicedFlipRefusal("DO-1", partly), /3 of its 4/);
  assert.equal(bareInvoicedFlipRefusal("DO-1", full), null);
  const helpers = read("src/api/routes/delivery-orders/_helpers.ts");
  const at = helpers.indexOf('if (body.status === "INVOICED" && existing.status === "DELIVERED")');
  assert.ok(at > 0, "guard present in applyDeliveryOrderUpdate");
  const guard = helpers.slice(at, at + 500);
  assert.match(guard, /loadDoBillingState\(c\.var\.DB, id\)/);
  assert.match(guard, /bareInvoicedFlipRefusal\(/);
  assert.match(guard, /409/);
});
