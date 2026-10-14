// ---------------------------------------------------------------------------
// mobile-sales-list.test.mjs — phone /m/sales list (owner 2026-10-14, Claude
// Design prototype `Sales Orders.dc.html`; typography stays the repo's).
//
// Pins:
//   • Total Qty = Σ items[].quantity, never the line count; "no items array"
//     is null (the card shows "—"), not 0;
//   • the reference line shows BOTH Customer PO and Cust SO, empty parts
//     omitted;
//   • the screen: phone-only search row (Scan PO tile inside the field, one
//     ScanPOSheet), New SO moved from the header to the sort row on phones,
//     summary card with the Cancelled-excluded revenue rule, phone card with
//     rail + borderless pill keyed off SO_STATUS_COLOR, Cancelled dimmed,
//     repo typography (Amount 13/600); tablet keeps SoCard; MobileCard is
//     not edited.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const { soTotalQty, soRefLine } = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/so-card.ts")).href
);
const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const screen = read("screens/SalesScreen.tsx");
const phoneCard = screen.slice(screen.indexOf("function PhoneSoCard"), screen.indexOf("function TilePill"));
const metric = screen.slice(screen.indexOf("function Metric"), screen.indexOf("function SoCard"));

// ── Total quantity ─────────────────────────────────────────────────────────

test("total qty sums item quantities, not the line count", () => {
  const row = { items: [{ quantity: 5 }, { quantity: 12 }, { quantity: 1 }] };
  assert.equal(soTotalQty(row), 18);
  assert.notEqual(soTotalQty(row), row.items.length);
});

test("total qty: numeric strings count, junk is skipped, empty list is 0", () => {
  assert.equal(soTotalQty({ items: [{ quantity: "4" }, { quantity: null }, { quantity: "x" }, null] }), 4);
  assert.equal(soTotalQty({ items: [] }), 0);
});

test("total qty is null when the row carries no items array", () => {
  assert.equal(soTotalQty({}), null);
  assert.equal(soTotalQty({ items: undefined }), null);
});

// ── Reference line ─────────────────────────────────────────────────────────

test("reference line shows PO and Cust SO; customerPOId first", () => {
  assert.equal(soRefLine({ customerPOId: "PO-1", customerPO: "x", customerSOId: "S-1" }), "PO PO-1 · Cust SO S-1");
  assert.equal(soRefLine({ customerPOId: "", customerPO: "PO-2" }), "PO PO-2");
  assert.equal(soRefLine({ customer_po_id: "PO-3", customer_so: "S-3" }), "PO PO-3 · Cust SO S-3");
});

test("reference line omits empty parts; empty when both are blank", () => {
  assert.equal(soRefLine({ customerPOId: " ", customerSOId: "CS-9" }), "Cust SO CS-9");
  assert.equal(soRefLine({}), "");
});

// ── Screen wiring ──────────────────────────────────────────────────────────

test("phone: Scan PO tile inside the search field; one ScanPOSheet", () => {
  const search = screen.slice(screen.indexOf("function PhoneSearchRow"), screen.indexOf("function PhoneChips"));
  assert.match(search, /aria-label="Scan customer PO"/);
  assert.match(search, /M_ACCENT\.gold\.bg/);
  assert.match(search, /aria-label="Clear search"/);
  assert.equal(screen.match(/<ScanPOSheet/g).length, 1);
  assert.match(screen, /setCreateSpec\(newSalesOrderSpec\(prefill\)\)/);
});

test("phone: New SO leaves the header and sits on the sort row", () => {
  assert.match(screen, /trailing=\{\s*phone \? undefined :/);
  const sortRow = screen.slice(screen.indexOf("function PhoneSortRow"), screen.indexOf("function PhoneSoCard"));
  assert.match(sortRow, /aria-label="New Sales Order"/);
  assert.match(sortRow, /New SO/);
  assert.match(screen, /onSort=\{\(\) => setFilterOpen\(true\)\}/);
});

test("summary revenue still excludes Cancelled", () => {
  assert.match(screen, /if \(str\(r, "status"\) === "CANCELLED"\) continue;/);
  assert.match(screen, /b\.key === "CANCELLED" \? "excluded"/);
});

test("phone card: status colours, both refs, dimmed Cancelled, repo typography", () => {
  assert.match(screen, /<PhoneSoCard/);
  assert.match(phoneCard, /resolveStatus\(str\(r, "status"\), STATUS_MAPS\.so\)/);
  assert.match(phoneCard, /backgroundColor: status\.style\.hex/);
  assert.match(phoneCard, /<TilePill style=\{status\.style\}/);
  assert.match(phoneCard, /soRefLine\(r\)/);
  assert.match(phoneCard, /soTotalQty\(r\)/);
  assert.match(phoneCard, /"totalSen"/);
  assert.match(phoneCard, /opacity: cancelled \? 0\.55 : 1/);
  assert.match(phoneCard, /border: "none"/);
  assert.doesNotMatch(phoneCard, /WebkitLineClamp/);
  assert.doesNotMatch(phoneCard, /companySODate|ORDER DATE/);
  // Amount + meta values keep the repo's 13/600, not the prototype's 14/700.
  assert.match(metric, /fontSize: 13,\s*fontWeight: 600,/);
  assert.doesNotMatch(metric, /fontSize: 14/);
});

test("tablet keeps SoCard and the separate Scan button", () => {
  assert.match(screen, /<SoCard/);
  assert.match(screen, /placeholder="Search SO · customer · PO · reference"/);
});

test("MobileCard is not edited", () => {
  const card = read("components/MobileCard.tsx");
  assert.match(card, /border: `1px solid \$\{M\.border\}`/);
});
