// The Sales Order status actions and the Paid / Balance maths. The money maths still matches the legacy
// tablet screen exactly. The ACTIONS were rebuilt on 2026-11-03 to follow the desktop page (status rules,
// permissions, requests, wording, error handling) because desktop functionality must also be on mobile;
// the old "same as the legacy tablet" pins for them were replaced on purpose. The handlers run for real
// with a stubbed fetch (fixture data, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./_ssr-sales.mjs"; // registers the alias + test stubs, defines __BUILD_ID__
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const imp = (p) => import(pathToFileURL(resolvePath(process.cwd(), p)).href);
const { soFinancials, hasBalanceDue } = await imp("src/pages/m/lib/so-financials.ts");
const { soActionPlan, SO_ACTION_LABEL } = await imp("src/pages/m/lib/so-actions.ts");
const { useSalesOrderActions, statusMessage } = await imp("src/pages/m/lib/use-so-actions.ts");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const LEGACY = read("src/pages/m/screens/SalesDetailScreen.tsx");
const HOOK = read("src/pages/m/lib/use-so-actions.ts");

// ---- Paid / Balance ----------------------------------------------------------

test("Paid is the sum of linked payments (amount or amountSen), Balance is Total minus Paid", () => {
  const f = soFinancials(680000, [{ amount: 300000 }, { amountSen: 100000 }, { amount: 0 }]);
  assert.deepEqual(f, { total: 680000, paid: 400000, balance: 280000 });
  assert.equal(hasBalanceDue(f), true);
});

test("no payments: Paid 0, Balance = Total", () => {
  assert.deepEqual(soFinancials(123456, []), { total: 123456, paid: 0, balance: 123456 });
});

test("settled and over-paid orders: no balance due", () => {
  assert.equal(hasBalanceDue(soFinancials(500000, [{ amount: 500000 }])), false);
  const over = soFinancials(500000, [{ amount: 600000 }]);
  assert.equal(over.balance, -100000);
  assert.equal(hasBalanceDue(over), false);
});

test("amounts stay integer sen: bad or missing values count as 0, never NaN", () => {
  const f = soFinancials(1000, [{ amount: "abc" }, {}, { amount: null }, { amount: "250" }]);
  assert.equal(f.paid, 250);
  assert.ok(Number.isInteger(f.paid) && Number.isInteger(f.balance));
});

test("the legacy tablet screen computes the same thing", () => {
  assert.match(LEGACY, /const paid = payments\.reduce\(\(s, p\) => s \+ num\(p, "amount", "amountSen"\), 0\);/);
  assert.match(LEGACY, /const balance = total - paid;/);
});

// ---- the status matrix: the DESKTOP rules (src/pages/sales/detail.tsx) ------------------
// Owner / Mr Lim, 2026-11-03: what desktop can do, mobile can do. These replace the old tablet matrix
// (which offered Cancel on every status and Issue DO on CONFIRMED).

test("status matrix with no context: exactly desktop's actions per status", () => {
  assert.deepEqual(soActionPlan("DRAFT").rows, [["confirm"], ["edit-draft", "cancel"], ["delete-draft"]]);
  assert.deepEqual(soActionPlan("CONFIRMED").rows, [["edit", "hold"], ["cancel"]]);
  assert.deepEqual(soActionPlan("IN_PRODUCTION").rows, [["edit", "hold"], ["cancel"]]);
  assert.deepEqual(soActionPlan("READY_TO_SHIP").rows, [["issue-do"]]);
  assert.deepEqual(soActionPlan("ON_HOLD").rows, [["resume"]]);
  assert.deepEqual(soActionPlan("CANCELLED").rows, [["undo-cancel"]]);
  assert.match(soActionPlan("CANCELLED").note, /This order was cancelled\./);
  assert.deepEqual(soActionPlan("DELIVERED").rows, [["generate-invoice"], ["service-case"]]);
  for (const st of ["SHIPPED", "INVOICED", "CLOSED"]) {
    assert.deepEqual(soActionPlan(st).rows, [["service-case"]], st);
    assert.match(soActionPlan(st).note, /No further status actions/);
  }
  for (const st of ["SOMETHING_NEW", ""]) assert.deepEqual(soActionPlan(st), { rows: [] }, st || "(empty)");
});

test("an order cannot be cancelled once it is past production, or put on hold before it is confirmed (desktop canCancel / canHold)", () => {
  const cancellable = ["DRAFT", "CONFIRMED", "IN_PRODUCTION"];
  const holdable = ["CONFIRMED", "IN_PRODUCTION"];
  for (const st of ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD", "CANCELLED", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"]) {
    const kinds = soActionPlan(st).rows.flat();
    assert.equal(kinds.includes("cancel"), cancellable.includes(st), `cancel @ ${st}`);
    assert.equal(kinds.includes("hold"), holdable.includes(st), `hold @ ${st}`);
  }
});

test("permissions hide what the server would refuse: confirm / update / delivery create", () => {
  const none = { can: { confirm: false, update: false, issueDo: false } };
  assert.deepEqual(soActionPlan("DRAFT", { can: { confirm: false } }).rows, [["edit-draft", "cancel"], ["delete-draft"]]);
  assert.match(soActionPlan("DRAFT", { can: { confirm: false } }).note, /Confirm permission/);
  assert.deepEqual(soActionPlan("DRAFT", { can: { update: false } }).rows, [["confirm"], ["delete-draft"]], "confirm needs only sales-orders:confirm; delete needs only sales-orders:delete");
  assert.deepEqual(soActionPlan("CONFIRMED", { can: { update: false } }).rows, []);
  assert.match(soActionPlan("CONFIRMED", none).note, /do not have permission/);
  assert.deepEqual(soActionPlan("ON_HOLD", { can: { update: false } }).rows, []);
  assert.deepEqual(soActionPlan("CANCELLED", { can: { update: false } }).rows, []);
  assert.deepEqual(soActionPlan("READY_TO_SHIP", { can: { issueDo: false } }).rows, []);
  assert.deepEqual(soActionPlan("READY_TO_SHIP", { can: { update: false, issueDo: true } }).rows, [["issue-do"]]);
});

test("edit lock rules: eligibility for in-production orders, the cascade lock, the admin override", () => {
  const locked = { eligibility: { editable: false, reason: "production_window" } };
  assert.deepEqual(soActionPlan("IN_PRODUCTION", locked).rows, [["hold", "cancel"]], "no Edit while the window is shut");
  assert.match(soActionPlan("IN_PRODUCTION", locked).note, /Editing is locked/);
  assert.deepEqual(soActionPlan("IN_PRODUCTION", { ...locked, isAdmin: true }).rows, [["override-edit", "hold"], ["cancel"]]);
  assert.deepEqual(soActionPlan("CONFIRMED", { eligibility: { editable: false, reason: "production_window" }, isAdmin: false }).rows.flat().includes("edit"), true, "CONFIRMED stays editable (desktop: only IN_PRODUCTION asks the server)");
  assert.equal(soActionPlan("DRAFT", { locked: true }).rows.flat().includes("edit-draft"), false, "a completed downstream PO locks edits");
  assert.match(soActionPlan("DRAFT", { locked: false, eligibility: null }).rows.flat().join(), /edit-draft/);
  const done = soActionPlan("IN_PRODUCTION", { eligibility: { editable: false, reason: "dept_completed", completedDept: "Sewing", completedAt: "2026-10-30T08:00:00Z" } });
  assert.match(done.disabled.cancel, /Cannot cancel — Sewing completed on 2026-10-30/);
  assert.ok(done.rows.flat().includes("cancel"), "shown but disabled, with the reason");
});

test("button labels", () => {
  assert.deepEqual(SO_ACTION_LABEL, {
    "edit-draft": "Edit Draft",
    edit: "Edit",
    "override-edit": "Override Edit Lock",
    confirm: "Confirm Order",
    hold: "Put On Hold",
    resume: "Resume Order",
    cancel: "Cancel Order",
    "undo-cancel": "Undo Cancel",
    "issue-do": "Issue Delivery Order",
    "generate-invoice": "Generate Invoice",
    "service-case": "Open Service Case",
    "delete-draft": "Delete Draft",
  });
});

// ---- the handlers: the desktop requests, bodies, texts and error handling ------------------

function harness(doc, reply = {}) {
  const notes = [];
  const calls = [];
  const asked = [];
  const infos = [];
  let delivery = 0;
  let invoices = 0;
  let deleted = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body, headers: init?.headers });
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body ?? { success: true }, text: async () => "" };
  };
  let hook;
  function C() {
    hook = useSalesOrderActions({
      url: "/api/sales-orders/so-0001",
      id: "so-0001",
      doc,
      notify: (text, tone) => notes.push([text, tone]),
      ask: async (spec) => (asked.push(spec), reply.decline ? false : true),
      info: (spec) => infos.push(spec),
      goDelivery: () => { delivery += 1; },
      goInvoices: () => { invoices += 1; },
      afterDelete: () => { deleted += 1; },
    });
    return null;
  }
  renderToStaticMarkup(h(C));
  return { hook, notes, calls, asked, infos, deliveries: () => delivery, invoiceVisits: () => invoices, deletions: () => deleted };
}

test("Confirm asks first (desktop wording), then POSTs /confirm with an Idempotency-Key and changedBy", async () => {
  const r = harness({ companySO: "SO-1" }, { body: { success: true, message: "Order confirmed — 3 production orders created" } });
  await r.hook.onConfirm();
  assert.equal(r.asked.length, 1);
  assert.equal(r.asked[0].title, "Confirm Sales Order");
  assert.equal(r.asked[0].confirmLabel, "Confirm & Create POs");
  assert.match(r.asked[0].lines[0].text, /create Production Orders for all line items and change the status to CONFIRMED/);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "/api/sales-orders/so-0001/confirm");
  assert.equal(r.calls[0].method, "POST");
  assert.match(r.calls[0].headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
  assert.equal(typeof JSON.parse(r.calls[0].body).changedBy, "string");
  assert.deepEqual(r.notes, [["Order confirmed — 3 production orders created", "success"]]);
});

test("declining the Confirm sheet sends nothing; a scan-created draft is never confirmed by anything but this tap", async () => {
  const r = harness({}, { decline: true });
  await r.hook.onConfirm();
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.notes, []);
});

test("Confirm 422 lists the products with no BOM and does not claim success (the order stays DRAFT)", async () => {
  const r = harness({}, { status: 422, body: { success: false, error: "BOM incomplete", details: { incompleteProducts: [{ productCode: "HB-1", productName: "Harbour" }, { productCode: "AS-2", productName: "Aspen" }] } } });
  await r.hook.onConfirm();
  assert.equal(r.infos.length, 1);
  assert.deepEqual(r.infos[0].items, ["HB-1: Harbour", "AS-2: Aspen"]);
  assert.match(r.infos[0].intro, /no WIP components in their BOM/);
  assert.deepEqual(r.notes, []);
});

test("a failed Confirm reports the server's message", async () => {
  const r = harness({}, { status: 500, body: { error: "Server said no" } });
  await r.hook.onConfirm();
  assert.deepEqual(r.notes, [["Server said no", "error"]]);
});

test("Cancel asks (desktop wording); accepting PUTs CANCELLED with changedBy; the cascade is summarised", async () => {
  const r = harness({ companySO: "SO-9" }, { body: { success: true, cascade: { affectedPoCount: 2, affectedJcCount: 5 } } });
  await r.hook.onCancel();
  assert.equal(r.asked[0].title, "Cancel Order");
  assert.match(r.asked[0].lines[0].text, /Are you sure you want to cancel this order\? This action cannot be easily undone\./);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, "PUT");
  assert.equal(r.calls[0].url, "/api/sales-orders/so-0001");
  const body = JSON.parse(r.calls[0].body);
  assert.equal(body.status, "CANCELLED");
  assert.equal(typeof body.changedBy, "string");
  assert.deepEqual(r.notes, [["Status → CANCELLED. 2 production orders + 5 job cards updated.", "success"]]);
  const quiet = harness({}, { decline: true });
  await quiet.hook.onCancel();
  assert.equal(quiet.calls.length, 0, "declined: no request");
});

test("Cancel blocked by completed work (409 + blockingItems) shows the list instead of a bare error", async () => {
  const r = harness({}, { status: 409, body: { success: false, error: "blocked", blockingItems: [{ poNo: "PO-1", departmentName: "Sewing", completedDate: "2026-10-30T00:00:00Z" }] } });
  await r.hook.onCancel();
  assert.deepEqual(r.infos[0].items, ["PO-1 · Sewing · 2026-10-30"]);
  assert.deepEqual(r.notes, []);
});

test("Undo cancel returns to the saved prior status, or IN_PRODUCTION for old rows", async () => {
  let r = harness({ preCancelStatus: "CONFIRMED" });
  await r.hook.onUndoCancel();
  assert.equal(JSON.parse(r.calls[0].body).status, "CONFIRMED");
  assert.match(r.asked[0].lines[0].text, /The order returns to CONFIRMED\./);
  r = harness({});
  await r.hook.onUndoCancel();
  assert.equal(JSON.parse(r.calls[0].body).status, "IN_PRODUCTION");
  assert.deepEqual(r.notes, [["Status updated to IN_PRODUCTION.", "success"]]);
});

test("Resume returns to the saved pre-hold status, or CONFIRMED", async () => {
  let r = harness({ preHoldStatus: "IN_PRODUCTION" });
  await r.hook.onResume();
  assert.equal(JSON.parse(r.calls[0].body).status, "IN_PRODUCTION");
  r = harness({});
  await r.hook.onResume();
  assert.equal(JSON.parse(r.calls[0].body).status, "CONFIRMED");
});

test("Put On Hold needs a reason: blank sends nothing, a reason is trimmed and sent as holdReason", async () => {
  let r = harness({});
  assert.equal(await r.hook.submitHold("   "), false);
  assert.equal(r.calls.length, 0);
  r = harness({});
  assert.equal(await r.hook.submitHold("  waiting for fabric  "), true);
  assert.deepEqual({ ...JSON.parse(r.calls[0].body), changedBy: "x" }, { status: "ON_HOLD", holdReason: "waiting for fabric", changedBy: "x" });
});

test("Override edit lock: under 5 characters is refused locally; a reason buys a token and opens the editor", async () => {
  let r = harness({});
  assert.match(await r.hook.submitOverride("abc"), /at least 5 characters/);
  assert.equal(r.calls.length, 0);
  r = harness({}, { body: { success: true, overrideToken: "tok-1" } });
  assert.equal(await r.hook.submitOverride("customer changed the fabric"), null);
  assert.equal(r.calls[0].url, "/api/sales-orders/so-0001/override-edit-lock");
  assert.deepEqual(JSON.parse(r.calls[0].body), { reason: "customer changed the fabric" });
});

test("Issue DO opens the Delivery module (desktop 'Create Delivery' navigates to /delivery); it makes no request", () => {
  const r = harness({});
  r.hook.openIssueDo();
  assert.equal(r.deliveries(), 1);
  assert.equal(r.calls.length, 0);
});

test("statusMessage matches desktop: a plain line, or what the cascade touched", () => {
  assert.equal(statusMessage("CONFIRMED", null), "Status updated to CONFIRMED.");
  assert.equal(statusMessage("ON_HOLD", { affectedPoCount: 1, affectedJcCount: 0 }), "Status → ON_HOLD. 1 production order updated.");
  assert.equal(statusMessage("CANCELLED", { affectedPoCount: 0, affectedJcCount: 1 }), "Status → CANCELLED. 1 job card updated.");
});

test("the hook never confirms on its own: the only /confirm call is behind the Confirm sheet", () => {
  const confirmCalls = [...HOOK.matchAll(/\/confirm`/g)].length;
  assert.equal(confirmCalls, 1);
  const body = HOOK.slice(HOOK.indexOf("const confirmOrder"), HOOK.indexOf("const changeStatus"));
  assert.ok(body.indexOf("await ask(") < body.indexOf("/confirm`"), "ask first, request second");
});

// ---- the remaining desktop actions (2026-11-04): Delete Draft, Generate Invoice, Open Service Case, and the customer / hub locks ----
const { soEditLocks } = await imp("src/pages/m/lib/so-actions.ts");

test("Delete Draft: only a DRAFT, and only with sales-orders:delete (the server also refuses any other status)", () => {
  for (const st of ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD", "CANCELLED", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"]) {
    assert.ok(!soActionPlan(st).rows.flat().includes("delete-draft"), st);
  }
  assert.ok(soActionPlan("DRAFT").rows.flat().includes("delete-draft"));
  assert.ok(!soActionPlan("DRAFT", { can: { del: false } }).rows.flat().includes("delete-draft"));
});

test("Generate Invoice: DELIVERED only (desktop opens the Invoices page), needs invoices:create; Open Service Case: shipped or later, needs service-cases:create", () => {
  for (const st of ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD", "CANCELLED", "SHIPPED", "INVOICED", "CLOSED"]) {
    assert.ok(!soActionPlan(st).rows.flat().includes("generate-invoice"), st);
  }
  assert.deepEqual(soActionPlan("DELIVERED", { can: { invoice: false } }).rows, [["service-case"]]);
  for (const st of ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD", "CANCELLED"]) {
    assert.ok(!soActionPlan(st).rows.flat().includes("service-case"), st);
  }
  for (const st of ["SHIPPED", "DELIVERED", "INVOICED", "CLOSED"]) {
    assert.ok(soActionPlan(st).rows.flat().includes("service-case"), st);
    assert.ok(!soActionPlan(st, { can: { serviceCase: false } }).rows.flat().includes("service-case"), st + " without permission");
  }
  assert.deepEqual(soActionPlan("DELIVERED", { can: { invoice: false, serviceCase: false } }).rows, []);
});

test("customer / hub pencils: both close once a DO is loaded or beyond; the customer also once an invoice is issued (DRAFT / CANCELLED do not count)", () => {
  assert.deepEqual(soEditLocks([], []), { customer: "", hub: "" });
  assert.deepEqual(soEditLocks([{ doNo: "DO-1", status: "DRAFT" }, { doNo: "DO-2", status: "CANCELLED" }], [{ invoiceNo: "INV-1", status: "DRAFT" }, { invoiceNo: "INV-2", status: "CANCELLED" }]), { customer: "", hub: "" });
  for (const st of ["LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"]) {
    const l = soEditLocks([{ doNo: "DO-9", status: st }], []);
    assert.equal(l.hub, `Hub locked: DO DO-9 already ${st}.`);
    assert.equal(l.customer, `Customer locked: DO DO-9 already ${st}.`);
  }
  const inv = soEditLocks([], [{ invoiceNo: "INV-7", status: "UNPAID" }]);
  assert.equal(inv.hub, "", "an issued invoice does not lock the hub");
  assert.equal(inv.customer, "Customer locked: invoice INV-7 already UNPAID.");
});

test("Delete Draft: confirms, sends DELETE for this order, then leaves the page; a refusal says why and leaves the page alone", async () => {
  const ok = harness({ id: "so-0001", companySOId: "SO-2611-001", status: "DRAFT" });
  await ok.hook.onDelete();
  assert.equal(ok.asked[0].title, "Delete order?");
  assert.equal(ok.asked[0].confirmLabel, "Delete");
  assert.deepEqual(ok.calls.map((c) => [c.method, c.url]), [["DELETE", "/api/sales-orders/so-0001"]]);
  assert.equal(ok.deletions(), 1);

  const declined = harness({ id: "so-0001", status: "DRAFT" }, { decline: true });
  await declined.hook.onDelete();
  assert.equal(declined.calls.length, 0, "no request without the confirmation");
  assert.equal(declined.deletions(), 0);

  const refused = harness({ id: "so-0001", status: "DRAFT" }, { status: 409, body: { success: false, error: "SO-1 is CONFIRMED — only DRAFT orders can be deleted. Cancel it instead to keep the record." } });
  await refused.hook.onDelete();
  assert.equal(refused.deletions(), 0, "a failed delete does not leave the page");
  assert.deepEqual(refused.notes[0], ["Failed to delete order: SO-1 is CONFIRMED — only DRAFT orders can be deleted. Cancel it instead to keep the record.", "error"]);
});

test("Generate Invoice only opens the Invoices module (desktop's button navigates; there is no request)", () => {
  const t = harness({ id: "so-0001", status: "DELIVERED" });
  t.hook.openGenerateInvoice();
  assert.equal(t.invoiceVisits(), 1);
  assert.equal(t.calls.length, 0);
});

test("the customer / hub / service-case sheets use the desktop requests and bodies", () => {
  const src = readFileSync(new URL("../src/pages/m/screens/so/so-change-sheets.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /"\/api\/service-cases", "POST", \{\n\s+sourceType: "SO",\n\s+sourceId: orderId,/);
  assert.match(src, /rootCauseNotes: null,/);
  assert.match(src, /\/customer`, "PATCH", \{ customerId, hubId: hubId \|\| undefined, reason: reason\.trim\(\) \|\| undefined \}/);
  assert.match(src, /\/hub`, "PATCH", \{ hubId, reason: reason\.trim\(\) \|\| undefined \}/);
  assert.match(src, /customerStage \?\? "CONFIRMED"\) !== "POTENTIAL"/, "a prospect cannot be picked, as on desktop");
  assert.match(src, /Pick a delivery hub for the new customer\./);
  const detail = readFileSync(new URL("../src/pages/m/screens/SalesOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /navigate\(`\/m\/servicecases\/\$\{encodeURIComponent\(caseId\)\}`\)/, "the real route slug is servicecases");
  assert.match(detail, /const canChangeParty = hasPermission\("sales-orders", "update"\);/);
  assert.match(detail, /disabled=\{!!locks\.customer\}/);
  assert.match(detail, /disabled=\{!!locks\.hub\}/);
  assert.match(detail, /del: hasPermission\("sales-orders", "delete"\)/);
  assert.match(detail, /invoice: hasPermission\("invoices", "create"\)/);
  assert.match(detail, /serviceCase: hasPermission\("service-cases", "create"\)/);
});
