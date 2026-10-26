// Sales Order Detail v4 (owner 2026-10-27, Claude Design `Sales Order Detail v4`, visual only).
//
// Pins:
//   • lib/so-pdf.ts: the Bill To lookup (existing GET /api/customers/:id, read-only) and
//     the rule that an incomplete PDF is never produced without an explicit decision;
//   • the screen: v4 header / overview / banner order / plain icons, the ⋯ "More actions"
//     menu with Download PDF (reusing the Invoices menu pieces unchanged), the Hookka
//     Expected DD countdown rule (no "late", never on Customer DD), and that no 7-stage bar
//     was added to the detail.
// Fixture data only: proves markup and wiring, not how it looks on a device and not that a
// PDF downloads on a phone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { renderScreen, soFixture, withFrozenClock, GOLDEN_NOW } from "./_ssr-sales.mjs";

const { lookupBillTo, downloadSoPdf, BILL_TO_MESSAGE, PDF_FAILED } = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/so-pdf.ts")).href
);
const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const detail = read("screens/SalesOrderDetail.tsx");

// ── Bill To lookup ─────────────────────────────────────────────────────────

const okFetch = (data) => async () => ({ ok: true, json: async () => ({ success: true, data }) });

test("bill to: reads the company address from the existing customer endpoint", async () => {
  let url = "";
  const res = await lookupBillTo({ customerId: "cus 1" }, async (u) => {
    url = u;
    return { ok: true, json: async () => ({ success: true, data: { companyAddress: "  1 Jalan Satu, KL " } }) };
  });
  assert.equal(url, "/api/customers/cus%201");
  assert.deepEqual(res, { state: "ready", address: "1 Jalan Satu, KL" });
});

test("bill to: every way of having no address is 'missing', never silently ready", async () => {
  assert.deepEqual(await lookupBillTo({}, okFetch({})), { state: "missing", reason: "no-customer" });
  assert.deepEqual(await lookupBillTo({ customerId: "c" }, okFetch({ companyAddress: "  " })), { state: "missing", reason: "no-address" });
  assert.deepEqual(await lookupBillTo({ customerId: "c" }, async () => ({ ok: false, json: async () => ({}) })), { state: "missing", reason: "lookup-failed" });
  assert.deepEqual(await lookupBillTo({ customerId: "c" }, async () => ({ ok: true, json: async () => ({ success: false }) })), { state: "missing", reason: "lookup-failed" });
  assert.deepEqual(await lookupBillTo({ customerId: "c" }, async () => { throw new Error("offline"); }), { state: "missing", reason: "lookup-failed" });
  for (const r of ["no-customer", "lookup-failed", "no-address"]) assert.ok(BILL_TO_MESSAGE[r].includes("Bill To"));
});

test("download: passes the same order payload and the address to the desktop generator", async () => {
  const calls = [];
  const doc = { id: "so1", companySOId: "SO-2610-0001" };
  const res = await downloadSoPdf(doc, "1 Jalan Satu", async (o, c) => void calls.push([o, c]));
  assert.deepEqual(res, { ok: true });
  assert.equal(calls[0][0], doc);
  assert.deepEqual(calls[0][1], { companyAddress: "1 Jalan Satu" });
  await downloadSoPdf(doc, "", async (o, c) => void calls.push([o, c]));
  assert.equal(calls[1][1], null, "the confirmed address-less PDF passes no customer");
});

test("download: a generator failure becomes a message, never an exception", async () => {
  const res = await downloadSoPdf({}, "x", async () => { throw new Error("pdf-lib"); });
  assert.deepEqual(res, { ok: false, error: PDF_FAILED });
});

test("so-pdf reuses generateSOPdf and adds no endpoint or write", () => {
  const src = read("lib/so-pdf.ts");
  assert.ok(src.includes('import("@/lib/generate-so-pdf")'));
  assert.ok(src.includes("generateSOPdf("));
  assert.ok(src.includes("/api/customers/"));
  assert.doesNotMatch(src, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(src, /fetch\([^)]*sales-orders|`\/api\/sales-orders/);
});

// ── The screen ─────────────────────────────────────────────────────────────

const ENTRY = ["src/pages/m/screens/SalesDetailScreen.tsx", "SalesDetailScreen"];
const render = (opts) => withFrozenClock(GOLDEN_NOW, () => renderScreen(...ENTRY, opts));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("header: ⋯ More actions button (shared HeaderMore); the sheets stay closed until tapped", async () => {
  const html = await render({ width: 390 });
  assert.ok(html.includes('aria-label="More actions"'));
  assert.ok(!text(html).includes("Download PDF"), "the menu is closed on load");
  assert.ok(detail.includes('import { HeaderMore } from "./procurement/parts";'));
  // The design's "Sales order PDF" sheet: one row, "Download SO PDF".
  assert.ok(detail.includes('title="Sales order PDF"'));
  assert.ok(detail.includes('{pdfBusy ? "Preparing PDF…" : "Download SO PDF"}'));
});

test("Download PDF only lives in the ⋯ menu: no PDF card, no View PDF, a warning sheet for a missing address", () => {
  assert.ok(!detail.includes("InvoicePdfCard"));
  assert.ok(!detail.includes("View PDF"));
  assert.ok(detail.includes('title="Bill To address missing"'));
  assert.ok(detail.includes("Download without address"));
  // The lookup comes first; a missing address stops and asks (setBillTo) instead of downloading.
  const run = detail.slice(detail.indexOf("const found = await lookupBillTo(doc);"));
  assert.ok(run.indexOf("setBillTo(found)") < run.indexOf("downloadSoPdf(doc, found.address)"));
});

test("v4 header and overview: plain page header, gold ORDER TOTAL dash, RM 30px, Delivery Hub in the grid", async () => {
  const html = await render({ width: 390 });
  const t = text(html);
  assert.ok(html.includes("font-size:21px"));
  assert.ok(html.includes("font-size:30px"));
  assert.ok(t.includes("Order total") || t.includes("ORDER TOTAL"));
  for (const label of ["Customer DD", "Hookka Expected DD", "Delivery Hub"]) assert.ok(t.includes(label), label);
  assert.ok(html.includes("grid-column:1 / -1"), "the hub spans the full row");
  assert.ok(t.includes("Klang Hub"), "the hub is still hubName");
  assert.ok(!html.includes('aria-label="Order progress"') || html.includes("Order progress"));
});

test("banners (On Hold / Cancelled) sit below the overview card, same conditions", async () => {
  for (const status of ["ON_HOLD", "CANCELLED"]) {
    const html = await render({ width: 390, fixture: soFixture({ status }) });
    const overview = html.indexOf('aria-label="Order overview"');
    const banner = html.indexOf('role="status"');
    assert.ok(overview > 0 && banner > overview, `${status}: banner after the overview`);
  }
  const plain = await render({ width: 390, fixture: soFixture({ status: "CONFIRMED" }) });
  assert.ok(!plain.includes('role="status"'), "no banner for a normal order");
});

test("countdown: Hookka Expected DD only, 0–7 days, Confirmed / In Production / Ready; never late wording", async () => {
  // GOLDEN_NOW is 2026-10-26; the fixture's Expected DD is 2026-11-01 (6 days).
  for (const status of ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP"]) {
    const t = text(await render({ width: 390, fixture: soFixture({ status }) }));
    assert.ok(t.includes("In 6 days"), `${status}: countdown shown`);
  }
  for (const status of ["DRAFT", "ON_HOLD", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED", "CANCELLED"]) {
    const t = text(await render({ width: 390, fixture: soFixture({ status }) }));
    assert.ok(!/In \d+ days?|Due today/.test(t), `${status}: no countdown`);
  }
  const far = text(await render({ width: 390, fixture: soFixture({ status: "CONFIRMED", order: { hookkaExpectedDD: "2026-12-30" } }) }));
  assert.ok(!/In \d+ days?/.test(far), "beyond 7 days: nothing");
  const past = text(await render({ width: 390, fixture: soFixture({ status: "CONFIRMED", order: { hookkaExpectedDD: "2026-10-01" } }) }));
  assert.ok(!/\b(past|late|overdue)\b/i.test(past), "a past Expected DD shows no late wording");
  // Customer DD never carries a countdown.
  const customerOnly = text(await render({ width: 390, fixture: soFixture({ status: "CONFIRMED", order: { hookkaExpectedDD: "", customerDeliveryDate: "2026-10-28" } }) }));
  assert.ok(!/In \d+ days?|Due today/.test(customerOnly), "Customer DD has no countdown");
  assert.ok(!/\blate\b/i.test(detail.slice(detail.indexOf("const expectedCountdown"), detail.indexOf("const overviewBlock"))));
});

// ── The whole screen, element by element against Sales Order Detail v4 ─────────

const count = (s, needle) => s.split(needle).length - 1;

test("Order progress: lifecycle stepper (position from soStage), production tiles and delivery orders", async () => {
  const html = await render({ width: 390, fixture: soFixture({ status: "IN_PRODUCTION" }) });
  const t = text(html);
  assert.ok(t.includes("Order progress") && t.includes("CURRENT STAGE") && t.includes("In Production"));
  assert.ok(t.includes("Stage 2 of 7"));
  assert.equal(count(html, 'aria-label="Sales order lifecycle"'), 1);
  assert.equal(count(html, "— done") + count(html, "— current stage") + count(html, "— upcoming"), 7);
  assert.ok(t.includes("Done: Draft") && t.includes("Next: Ready to Ship"));
  assert.ok(t.includes("View all 7 stages"));
  assert.ok(t.includes("PRODUCTION") && t.includes("DELIVERY"));
  assert.ok(t.includes("0 of 1 Production Orders completed"));
  for (const tile of ["Completed", "In progress", "Pending"]) assert.ok(t.includes(tile), tile);
  assert.ok(t.includes("1 Delivery Order linked"));
  assert.ok(html.includes("Open delivery order"), "the DO row still opens the delivery order");
});

test("Order progress: statuses outside the seven show the design's note, not an invented stage", async () => {
  const hold = text(await render({ width: 390, fixture: soFixture({ status: "ON_HOLD" }) }));
  assert.ok(hold.includes("Current status: On Hold") && hold.includes("special status outside the stage sequence"));
  assert.ok(!hold.includes("CURRENT STAGE"));
  const conf = text(await render({ width: 390, fixture: soFixture({ status: "CONFIRMED" }) }));
  assert.ok(conf.includes("legacy transitional status"));
  const cancelled = text(await render({ width: 390, fixture: soFixture({ status: "CANCELLED" }) }));
  assert.ok(cancelled.includes("No further stages apply"));
});

test("progress uses real data only: the stepper maps through soStage, tiles through the real PO statuses", () => {
  assert.ok(detail.includes('import { soCountdown, soStage } from "../lib/so-card";'));
  assert.ok(detail.includes("const stage = soStage(status);"));
  assert.ok(detail.includes("productionSummary(pos)"));
  assert.doesNotMatch(detail, /FLOW7|"CONFIRMED", "IN_PRODUCTION"\]/);
  // DO links keep working.
  assert.ok(detail.includes("navigate(`/m/delivery/${encodeURIComponent(doId)}`)"));
});

test("Order items: summary, category tile and pill, SKU/spec/price/qty, full-width View all", async () => {
  const html = await render({ width: 390 });
  const t = text(html);
  assert.ok(t.includes("3 lines · 7 qty"), "item count and total quantity");
  for (const pill of ["SOFA", "BEDFRAME"]) assert.ok(t.includes(pill), pill); // the first two lines show; the third is behind View all
  assert.ok(detail.includes("\"ACCESSORY\""));
  assert.ok(t.includes("Aria Sofa 3-seater") && t.includes("SF-ARIA-3") && t.includes("Qty 2"));
  assert.ok(t.includes("View all 3 items"));
  assert.ok(html.includes("var(--m-cat-sofa-bg)") && html.includes("var(--m-cat-bedframe-bg)"), "category tones are the dark-safe tokens");
  const one = text(await render({ width: 390, fixture: soFixture({ items: [] }) }));
  assert.ok(one.includes("0 lines · 0 qty") && one.includes("No line items on this order."));
});

test("Order items: expanded rows carry Base price, surcharges, Unit price, Line total and the override warning (source)", () => {
  const card = detail.slice(detail.indexOf("function ItemCard"), detail.indexOf("function Fact"));
  for (const k of ['"SO line"', '"Category"', '"Size"', '"Fabric"', '"Base price"', '"Unit price"', '"Line total"', "surcharge", "Price override:"]) {
    assert.ok(card.includes(k), k);
  }
  assert.ok(card.includes("basePriceSen"));
});

test("Related documents: the chain Customer PO → Sales Order → Delivery Orders → Sales Invoice, legend, details toggle", async () => {
  const html = await render({ width: 390 });
  const t = text(html);
  assert.ok(t.includes("Related documents"));
  assert.equal(count(html, 'aria-label="Document relationship"'), 1);
  for (const n of ["Customer PO", "Sales Order", "Delivery Order", "Sales Invoice"]) assert.ok(t.includes(n), n);
  assert.ok(t.includes("PO-77") && t.includes("SO-2610-0001") && t.includes("DO-2610-0001") && t.includes("INV-2610-0001"));
  assert.ok(t.includes("This order") && t.includes("Linked") && t.includes("Not created yet"));
  assert.ok(t.includes("Show document details"));
  assert.ok(!t.includes("Production Orders · "), "grouped details are collapsed until opened");
  // No linked documents: the design's pending labels.
  const bare = text(
    await render({ width: 390, fixture: { ...soFixture({ order: { customerPOId: "" } }), linkedDOs: [], linkedInvoices: [] } }),
  );
  assert.ok(bare.includes("Not recorded") && bare.includes("After confirmation") && bare.includes("On delivery") && bare.includes("Not created"));
});

test("Related documents: grouped details and navigation use the real linked documents", () => {
  const src = detail.slice(detail.indexOf("const docNote"), detail.indexOf("// 7 · Additional information"));
  for (const k of ["Production Orders · ", "Delivery Orders · ", "Invoices · ", "None yet.", "Hide document details"]) assert.ok(src.includes(k), k);
  assert.ok(src.includes("navigate(`/m/delivery/${encodeURIComponent(doId)}`)"));
  assert.ok(src.includes('invId.startsWith("inv-")'), "the invoice link keeps its existing guard");
  assert.ok(!src.includes("prototype"));
});

test("Additional information: titled as the design, notes and the original Customer PO live inside it", async () => {
  const t = text(await render({ width: 390 }));
  assert.ok(t.includes("Additional information") && !t.includes("More details"));
  assert.ok(!t.includes("Deliver after 2pm"), "notes are inside the collapsed section, not a separate card");
  assert.ok(!detail.includes("notesBlock"));
  const info = detail.slice(detail.indexOf("const infoRows"), detail.indexOf("// 8 · History"));
  for (const k of ["View original Customer PO", "NOTES", "openCustomerPO", '"Customer SO"', '"Reference"', '"Order Date"']) assert.ok(info.includes(k), k);
  // The PO file is read when this section opens (it used to be Documents).
  assert.ok(detail.includes("infoOpen && docId ? `/api/files?resourceType=SO"));
});

test("History: design tabs (Status timeline / Audit history), audit note and timeline", () => {
  const hist = detail.slice(detail.indexOf("const historyBlock"), detail.indexOf("const paymentsBlock"));
  for (const k of ['"Status timeline"', '"Audit history"', "Recorded audit events only — may not include every historical change.", "No status changes recorded yet", "No audit events recorded yet"]) {
    assert.ok(hist.includes(k), k);
  }
  assert.ok(!hist.includes("SegmentedSwitch"));
  assert.ok(hist.includes("height: 44") && hist.includes("padding: 4"));
  const tl = detail.slice(detail.indexOf("function Timeline"));
  assert.ok(tl.includes("var(--m-inv-line)") && !tl.includes("M_ACCENT"));
});

test("dark mode: the new sections use theme variables, not fixed light fills", () => {
  const body = detail.slice(detail.indexOf("const progressBlock"), detail.indexOf("const paymentsBlock"));
  for (const v of ["var(--m-inv-line)", "var(--m-inv-dot-ring)", "var(--m-inv-note-bg)", "var(--m-inv-info)", "STAGE_DONE", "var(--m-text-on-accent)"]) {
    assert.ok(body.includes(v), v);
  }
  assert.ok(detail.includes("const STAGE_DONE = \"var(--m-inv-success)\""));
  assert.doesNotMatch(body, /background: "#FFFFFF"|background: "#FAF8F4"|#F0ECE9/);
});

test("shared pieces are reused unchanged: the Invoices menu components and shared tokens", () => {
  const parts = readFileSync(new URL("../src/pages/m/screens/procurement/parts.tsx", import.meta.url), "utf8");
  assert.ok(/export function HeaderMore/.test(parts) && /export function MenuRow/.test(parts) && /export function MenuGroup/.test(parts));
  assert.ok(!detail.includes("--m-type-section-heading-size"), "v4 typography is local, not a token override");
});
