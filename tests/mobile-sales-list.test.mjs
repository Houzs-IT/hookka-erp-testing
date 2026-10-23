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
//     ScanPOSheet), round "+" in the phone header (2026-10-15; the sort row is
//     gone), summary card on top with the Cancelled-excluded revenue rule,
//     Filter on the "N ORDERS" bar, removable filter chips, phone card with
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

const { soTotalQty, soRefLine, activeFilterChips } = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/so-card.ts")).href
);
// EOL-agnostic: a Windows checkout (core.autocrlf) has CRLF on disk, and the
// source-shape assertions below match "\n".
const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const screen = read("screens/SalesScreen.tsx");
const phoneCard = screen.slice(screen.indexOf("function PhoneSoCard"), screen.indexOf("function TilePill"));
const metric = screen.slice(screen.indexOf("function Metric"), screen.indexOf("/** The prototype empty state"));

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

// Owner 2026-10-15 (live prototype): "+" back in the phone header, Sort row gone,
// Filter on the "N ORDERS" bar, summary on top.
test("phone: round + in the header opens the same FormSheet; no sort row", () => {
  assert.match(screen, /trailing=\{<PhoneNewButton onClick=\{openCreate\} \/>\}/);
  const btn = screen.slice(screen.indexOf("function PhoneNewButton"), screen.indexOf("function PhoneListBar"));
  assert.match(btn, /aria-label="New Sales Order"/);
  assert.match(screen, /const openCreate = \(\) => setCreateSpec\(newSalesOrderSpec\(\)\);/);
  assert.doesNotMatch(screen, /PhoneSortRow/);
});

test("phone: Filter lives on the list bar and opens the filter sheet", () => {
  const bar = screen.slice(screen.indexOf("function PhoneListBar"), screen.indexOf("function PhoneActiveFilters"));
  assert.match(bar, /aria-label=\{active \? `Filter orders, \$\{fCount\} active` : "Filter orders"\}/);
  assert.match(screen, /<PhoneListBar[\s\S]*?onFilter=\{\(\) => setFilterOpen\(true\)\}/);
  const search = screen.slice(screen.indexOf("function PhoneSearchRow"), screen.indexOf("function PhoneChips"));
  assert.doesNotMatch(search, /Filter orders/);
  // One filter sheet at every width (the shared FilterSheet is no longer used by Sales).
  assert.equal(screen.match(/<SalesFilterSheet/g).length, 1);
  assert.doesNotMatch(screen, /<FilterSheet/);
});

test("phone: summary sits above search", () => {
  assert.ok(screen.indexOf("<PhoneSummary") < screen.indexOf("<PhoneSearchRow"));
});

test("summary revenue still excludes Cancelled", () => {
  assert.match(screen, /if \(str\(r, "status"\) === "CANCELLED"\) continue;/);
  assert.match(screen, /b\.key === "CANCELLED" \? "excluded"/);
});

// ── Active filter chips ────────────────────────────────────────────────────

const COLS = [
  { key: "customer", label: "Customer" },
  { key: "expectedDD", label: "Expected DD" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
];

// Amount filters are sen; the chip formats them as RM (2026-10-15).
const OPTS = { today: "2026-10-15", money: (sen) => "RM " + (sen / 100).toFixed(2) };

test("filter chips: one per active filter, in column order; Amount shown in RM", () => {
  const chips = activeFilterChips(
    {
      status: { type: "enum", selected: ["IN_PRODUCTION"] },
      customer: { type: "text", contains: " Mewah " },
      amount: { type: "number", op: "gte", a: 5000, b: null },
      expectedDD: { type: "date", from: "2026-10-01", to: null },
    },
    COLS,
    OPTS,
  );
  assert.deepEqual(chips.map((c) => c.label), [
    "Customer: Mewah",
    "Expected DD from 2026-10-01",
    "Amount ≥ RM 50.00",
    "Status: In Production",
  ]);
});

test("filter chips skip inactive filters, matching activeFilterCount", () => {
  const chips = activeFilterChips(
    {
      customer: { type: "text", contains: "  " },
      amount: { type: "number", op: "eq", a: null, b: null },
      expectedDD: { type: "date", from: null, to: null },
      status: { type: "enum", selected: ["DRAFT", "CONFIRMED"] },
    },
    COLS,
    OPTS,
  );
  assert.deepEqual(chips, [{ key: "status", label: "Status: 2 selected" }]);
});

test("removing a chip deletes only that key from the filters state", () => {
  assert.match(screen, /const next = \{ \.\.\.f \};\s*delete next\[key\];/);
  assert.match(screen, /onClear=\{\(\) => setFilters\(\{\}\)\}/);
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

test("wider screens use the SAME phone design: no separate tablet card, search or filter sheet", () => {
  assert.doesNotMatch(screen, /<SoCard|function SoCard/);
  assert.doesNotMatch(screen, /placeholder="Search SO · customer · PO · reference"/);
  assert.match(screen, /const cards = rows\.map\(\(r\) => \(\s*<PhoneSoCard/);
});

test("wider screens arrange the cards in columns, one column in a phone or the split list pane", () => {
  assert.match(screen, /const columns = tablet && !inPane;/);
  assert.match(screen, /const inPane = layout\.canSplitDetail && !!openId;/);
  assert.match(screen, /<ResponsiveGrid gap=\{11\} style=\{\{ padding: "8px 18px 120px" \}\}>/);
  // Phone / pane: the original column, untouched.
  assert.match(screen, /<div style=\{\{ display: "flex", flexDirection: "column", gap: 11, padding: "8px 18px 120px" \}\}>\{cards\}<\/div>/);
});

test("MobileCard is not edited", () => {
  const card = read("components/MobileCard.tsx");
  assert.match(card, /border: `1px solid \$\{M\.border\}`/);
});
