// The Sales Order detail is ONE adaptive screen. These tests server-render it with
// FIXTURE data (shape of GET /api/sales-orders/:id) at phone and tablet widths and
// check what each shows: the phone stays read-only; wider screens add the Payments
// block (Total / Paid / Balance), the status actions, and a two-column arrangement
// where two phone-width columns fit. They prove markup and wiring for these order
// shapes, not that real orders render well and not how it looks on a device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderScreen, soFixture } from "./_ssr-sales.mjs";

const ENTRY = ["src/pages/m/screens/SalesDetailScreen.tsx", "SalesDetailScreen"];
const render = (opts) => renderScreen(...ENTRY, opts);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const TWO_COLS = "grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)";

const WIDE_ONLY = ["Payments", "Paid", "Balance", "Confirm Order", "Cancel Order", "Undo Cancel", "Issue Delivery Order", "Edit Draft", "No payments recorded"];

// ---- phone: unchanged and read-only --------------------------------------------

test("phone (390, 600, 719): read-only, no Payments / Paid / Balance / action bar", async () => {
  for (const width of [390, 600, 719]) {
    for (const status of ["DRAFT", "CONFIRMED", "CANCELLED", "IN_PRODUCTION"]) {
      const html = await render({ width, fixture: soFixture({ status }) });
      const t = text(html);
      for (const word of WIDE_ONLY) assert.ok(!t.includes(word), `${width} ${status} must not show "${word}"`);
      assert.ok(!html.includes("data-responsive-action-dock"), `${width} ${status}: no action dock`);
      assert.ok(!html.includes(TWO_COLS), `${width} ${status}: one column`);
    }
  }
});

// ---- tablet: the same blocks plus the tablet-only money and actions --------------

const BLOCKS = ["Order total", "Production", "Delivery", "Order items", "Related documents", "Additional information", "History"];

test("tablet widths keep every phone block", async () => {
  for (const width of [768, 820, 1024, 1180]) {
    const t = text(await render({ width }));
    for (const b of BLOCKS) assert.ok(t.includes(b), `${width}: ${b}`);
    assert.ok(t.includes("Sample Customer Sdn Bhd"));
    // Notes now live inside Additional information (collapsed by default), as in Sales Order Detail v4.
    assert.ok(t.includes("Aria Sofa 3-seater"), "items");
  }
});

test("tablet shows Total / Paid / Balance computed from the linked payments, in sen", async () => {
  // total 760000 sen; payments 300000 + 100000 -> paid 400000, balance 360000
  const t = text(await render({ width: 768 }));
  assert.match(t, /Payments\s+2/);
  assert.match(t, /Total\s+RM\s?7,600\.00/);
  assert.match(t, /Paid\s+RM\s?4,000\.00/);
  assert.match(t, /Balance\s+RM\s?3,600\.00/);
  assert.ok(t.includes("Bank Transfer") && t.includes("Cash"), "each payment is listed");
  assert.match(t, /RM\s?3,000\.00/); // the 300000 sen payment
});

test("a settled order shows a zero balance; no payments says so", async () => {
  const settled = text(await render({ width: 768, fixture: soFixture({ payments: [{ id: "p", amount: 760000, paymentMethod: "Bank Transfer" }] }) }));
  assert.match(settled, /Balance\s+RM\s?0\.00/);
  const none = text(await render({ width: 768, fixture: soFixture({ payments: [] }) }));
  assert.match(none, /Paid\s+RM\s?0\.00/);
  assert.match(none, /Balance\s+RM\s?7,600\.00/);
  assert.ok(none.includes("No payments recorded"));
});

test("the balance is coloured as due only while money is owed", async () => {
  const owed = await render({ width: 768 });
  const settled = await render({ width: 768, fixture: soFixture({ payments: [{ id: "p", amount: 760000 }] }) });
  const balanceColour = (html) => /Balance<\/div><div style="[^"]*color:(var\([^)]+\))/.exec(html)?.[1];
  assert.equal(balanceColour(owed), "var(--m-text-status-danger)");
  assert.equal(balanceColour(settled), "var(--m-text-status-success)");
});

// ---- status actions on wider screens ---------------------------------------------

const ALL_LABELS = ["Edit Draft", "Confirm Order", "Undo Cancel", "Issue Delivery Order", "Edit", "Cancel Order", "Back"];
const buttons = (html) => [...html.matchAll(/<button[^>]*>(?:<span[^>]*>)?([^<]+)(?:<\/span>)?<\/button>/g)].map((m) => m[1]);

const expected = {
  DRAFT: ["Edit Draft", "Confirm Order"],
  CONFIRMED: ["Issue Delivery Order", "Edit", "Cancel Order"],
  CANCELLED: ["Undo Cancel"],
  IN_PRODUCTION: ["Back", "Cancel Order"],
  READY_TO_SHIP: ["Back", "Cancel Order"],
  DELIVERED: ["Back", "Cancel Order"],
  ON_HOLD: ["Back", "Cancel Order"],
};

test("each status offers exactly the tablet's actions", async () => {
  for (const width of [768, 1024, 1180]) {
    for (const [status, want] of Object.entries(expected)) {
      const html = await render({ width, fixture: soFixture({ status }) });
      const got = buttons(html).filter((b) => ALL_LABELS.includes(b));
      assert.deepEqual(got, want, `${width} ${status}`);
    }
  }
});

test("a cancelled order says so above its Undo Cancel", async () => {
  const t = text(await render({ width: 768, fixture: soFixture({ status: "CANCELLED" }) }));
  assert.ok(t.includes("This order was cancelled."));
});

test("the action bar sits in the right dock: the pane in the split view, the content otherwise", async () => {
  assert.match(await render({ width: 768 }), /data-responsive-action-dock="content"/); // no split at 768
  assert.match(await render({ width: 1024 }), /data-responsive-action-dock="detail"/); // split possible
  assert.match(await render({ width: 1180 }), /data-responsive-action-dock="detail"/);
});

// ---- one column or two, by the width of the box it is in ------------------------------

test("two columns only where two phone-width columns fit (760px container)", async () => {
  const at = (width, paneWidth) => render({ width, pane: paneWidth ? { kind: "detail", width: paneWidth } : undefined });
  // Split-view detail panes: 505 / 641 at 1024 / 1180 -> one column.
  assert.ok(!(await at(1024, 505)).includes(TWO_COLS), "1024 pane 505");
  assert.ok(!(await at(1180, 641)).includes(TWO_COLS), "1180 pane 641");
  assert.ok(!(await at(1180, 759)).includes(TWO_COLS), "just under");
  assert.ok((await at(1180, 760)).includes(TWO_COLS), "at 760");
  assert.ok((await at(1366, 827)).includes(TWO_COLS), "1366 pane 827");
  // No pane: the content width decides (portrait 768 = 696, landscape 1366 = 1168).
  assert.ok(!(await at(768)).includes(TWO_COLS), "768 content 696");
  assert.ok((await at(1366)).includes(TWO_COLS), "1366 content 1168");
});

test("two columns hold the same blocks as one column, nothing dropped or doubled", async () => {
  const one = text(await render({ width: 768 }));
  const two = text(await render({ width: 1366 }));
  for (const b of [...BLOCKS, "Payments", "Sample Customer Sdn Bhd"]) {
    assert.equal(one.split(b).length, two.split(b).length, `"${b}" appears equally often`);
  }
});

// ---- wiring ----------------------------------------------------------------------------

test("wider screens add the tablet-only Customer PO Date row; the phone list of rows is untouched", () => {
  const code = readFileSync(new URL("../src/pages/m/screens/SalesOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(code, /\.\.\.\(wide \? \[\["Customer PO Date", fmtDate\(str\(doc, "customerPODate"\)\)\]/);
  // The three phone rows are unchanged.
  assert.match(code, /\["Customer SO", str\(doc, "customerSOId", "customerSO"\)\]/);
  assert.match(code, /\["Reference", str\(doc, "reference"\)\]/);
  assert.match(code, /\["Order Date", fmtDate\(str\(doc, "companySODate"\)\)\]/);
});

test("Paid / Balance are only read on wider screens", () => {
  const code = readFileSync(new URL("../src/pages/m/screens/SalesOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(code, /const payments = wide \? rows\(env\.linkedPayments\) : \[\];/);
});
