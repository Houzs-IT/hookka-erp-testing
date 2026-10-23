// The Sales Order status actions and the Paid / Balance maths, moved out of the
// legacy tablet screen into shared code. Nothing about them may change: the same
// status matrix, the same API requests, the same confirmation texts, the same
// integer-sen arithmetic. These tests pin that against the legacy source and by
// running the real hook handlers with a stubbed fetch (fixture data, no network).
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
const { useSalesOrderActions } = await imp("src/pages/m/lib/use-so-actions.ts");

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

// ---- the status matrix -----------------------------------------------------------

test("status matrix: what each status offers", () => {
  assert.deepEqual(soActionPlan("DRAFT"), { rows: [["edit-draft", "confirm"]] });
  assert.deepEqual(soActionPlan("CONFIRMED"), { rows: [["issue-do"], ["edit", "cancel"]] });
  assert.deepEqual(soActionPlan("CANCELLED"), { note: "This order was cancelled.", rows: [["undo-cancel"]] });
  // Every other status: Back + Cancel Order, exactly like the legacy fallback branch.
  for (const st of ["IN_PRODUCTION", "READY_TO_SHIP", "DELIVERED", "ON_HOLD", "SOMETHING_NEW", ""]) {
    assert.deepEqual(soActionPlan(st), { rows: [["back", "cancel"]] }, st || "(empty)");
  }
});

test("button labels are the legacy ones", () => {
  assert.deepEqual(SO_ACTION_LABEL, {
    "edit-draft": "Edit Draft",
    confirm: "Confirm Order",
    "undo-cancel": "Undo Cancel",
    "issue-do": "Issue Delivery Order",
    edit: "Edit",
    cancel: "Cancel Order",
    back: "Back",
  });
});

test("the matrix matches the legacy action bar, branch by branch", () => {
  const bar = LEGACY.slice(LEGACY.indexOf("Status-dependent action bar"));
  const branch = (from, to) => bar.slice(bar.indexOf(from), to ? bar.indexOf(to) : undefined);
  const draft = branch('status === "DRAFT"', 'status === "CANCELLED"');
  const cancelled = branch('status === "CANCELLED"', 'status === "CONFIRMED"');
  const confirmed = branch('status === "CONFIRMED"', "<FormSheet");
  assert.ok(draft.indexOf("Edit Draft") < draft.indexOf("Confirm Order"));
  assert.match(cancelled, /This order was cancelled\./);
  assert.ok(cancelled.includes("Undo Cancel"));
  assert.ok(confirmed.indexOf("Issue Delivery Order") < confirmed.indexOf(">Edit<"));
  assert.ok(confirmed.indexOf(">Edit<") < confirmed.indexOf("Cancel Order"));
  assert.match(bar, /Back<\/Btn>\s*<Btn danger flex=\{1\} busy=\{busy\} onClick=\{onCancel\}>Cancel Order/);
});

// ---- the handlers: same requests as the legacy screen ---------------------------

test("the hook keeps every request, body and text of the legacy handlers", () => {
  const same = [
    "mutateJson(`${url}/confirm`, \"POST\")",
    "mutateJson(url, \"PUT\", { status: \"CANCELLED\" })",
    "mutateJson(url, \"PUT\", { status: target })",
    "Cancel ${str(doc ?? {}, \"companySO\") || \"this order\"}? You can undo this from the order page.",
    "Restore this order to ${target}? Cancelled production orders and job cards will be restored too.",
    "const target = str(doc ?? {}, \"preCancelStatus\") || \"IN_PRODUCTION\";",
    "refreshOne(url);",
    "refreshList(\"/api/sales-orders\");",
    "r.error || \"Confirm failed\"",
    "r.error || \"Cancel failed\"",
    "r.error || \"Undo failed\"",
    "\"Order confirmed\"",
    "\"Order cancelled\"",
    "\"Cancel undone\"",
  ];
  for (const snippet of same) {
    assert.ok(LEGACY.includes(snippet), `legacy has: ${snippet}`);
    assert.ok(HOOK.includes(snippet), `hook has: ${snippet}`);
  }
});

function harness(doc) {
  const notes = [];
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body });
    return { ok: globalThis.__fail ? false : true, status: globalThis.__fail ? 500 : 200, json: async () => (globalThis.__fail ? { error: "Server said no" } : { success: true }), text: async () => "{}" };
  };
  let hook;
  function C() {
    hook = useSalesOrderActions({ url: "/api/sales-orders/so-0001", id: "so-0001", doc, notify: (text, tone) => notes.push([text, tone]) });
    return null;
  }
  renderToStaticMarkup(h(C));
  return { hook, notes, calls };
}

test("Confirm: POST /confirm, then a success message", async () => {
  globalThis.__fail = false;
  const { hook, notes, calls } = harness({ companySO: "SO-1" });
  await hook.onConfirm();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/sales-orders/so-0001/confirm");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(notes, [["Order confirmed", "success"]]);
});

test("Cancel asks first; declining sends nothing, accepting PUTs CANCELLED", async () => {
  globalThis.__fail = false;
  const asked = [];
  globalThis.window = { confirm: (t) => (asked.push(t), false) };
  let r = harness({ companySO: "SO-9" });
  await r.hook.onCancel();
  assert.equal(r.calls.length, 0, "declined: no request");
  assert.deepEqual(asked, ["Cancel SO-9? You can undo this from the order page."]);

  globalThis.window = { confirm: () => true };
  r = harness({ companySO: "SO-9" });
  await r.hook.onCancel();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, "PUT");
  assert.equal(r.calls[0].url, "/api/sales-orders/so-0001");
  assert.deepEqual(JSON.parse(r.calls[0].body), { status: "CANCELLED" });
  assert.deepEqual(r.notes, [["Order cancelled", "success"]]);
});

test("Undo cancel restores the saved prior status, or IN_PRODUCTION for old rows", async () => {
  globalThis.__fail = false;
  const asked = [];
  globalThis.window = { confirm: (t) => (asked.push(t), true) };
  let r = harness({ preCancelStatus: "CONFIRMED" });
  await r.hook.onUndoCancel();
  assert.deepEqual(JSON.parse(r.calls[0].body), { status: "CONFIRMED" });
  assert.match(asked[0], /^Restore this order to CONFIRMED\?/);
  r = harness({});
  await r.hook.onUndoCancel();
  assert.deepEqual(JSON.parse(r.calls[0].body), { status: "IN_PRODUCTION" });
  assert.deepEqual(r.notes, [["Cancel undone", "success"]]);
});

test("a failed request reports the server's message and does not claim success", async () => {
  globalThis.__fail = true;
  globalThis.window = { confirm: () => true };
  const r = harness({ companySO: "SO-1" });
  await r.hook.onConfirm();
  assert.deepEqual(r.notes, [["Server said no", "error"]]);
  globalThis.__fail = false;
});
