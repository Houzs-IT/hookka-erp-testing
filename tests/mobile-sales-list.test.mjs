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
//     rail + pill keyed off SO_STATUS_COLOR, Cancelled dimmed; tablet keeps
//     SoCard; MobileCard is not edited.
//
// Owner 2026-10-26: Sales Orders v3 card + white summary card. Pins the v3
// typography, the Expected DD countdown (real field, literal wording), the
// reference chips, and that NO progress/stage bar is derived.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const { soTotalQty, soRefLine, soRefChips, soCountdown, soShortDate, soStage, SO_STAGES, activeFilterChips } = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/so-card.ts")).href
);
// EOL-agnostic: a Windows checkout (core.autocrlf) has CRLF on disk, and the
// source-shape assertions below match "\n".
const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const screen = read("screens/SalesScreen.tsx");
const phoneCard = screen.slice(screen.indexOf("function PhoneSoCard"), screen.indexOf("function TilePill"));

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
  // Same Scan treatment as Invoices: hairline divider + 36x44 plain button, ScanLine 18/1.75 in M.ink.
  assert.ok(search.includes('var(--m-inv-line)'));
  assert.ok(search.includes('width: 36,'));
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
  assert.ok(bar.includes('aria-label={active ? `Sort and filter orders, ${fCount} filters active` : "Sort and filter orders"}'));
  assert.match(screen, /<PhoneListBar[\s\S]*?onFilter=\{\(\) => setFilterOpen\(true\)\}/);
  const search = screen.slice(screen.indexOf("function PhoneSearchRow"), screen.indexOf("function PhoneChips"));
  assert.doesNotMatch(search, /Filter orders/);
  // One filter sheet at every width (the shared FilterSheet is no longer used by Sales).
  assert.equal(screen.match(/<SalesFilterSheet/g).length, 1);
  assert.doesNotMatch(screen, /<FilterSheet/);
});

// Sales Orders v3 refinement (owner 2026-10-27): header, search + Scan PO, status
// chips, summary card, sort/filter bar, cards.
test("phone: page order is search, chips, summary, sort/filter bar, cards", () => {
  const at = (s) => screen.indexOf(s, screen.indexOf("<MobileHeader"));
  assert.ok(at("<PhoneSearchRow") > 0);
  assert.ok(at("<PhoneSearchRow") < at("<PhoneChips"));
  assert.ok(at("<PhoneChips") < at("<PhoneSummary"));
  assert.ok(at("<PhoneSummary") < at("<PhoneListBar"));
  assert.ok(at("<PhoneListBar") < at("{cards}") || at("<PhoneListBar") < at("<Msg"));
});

test("summary: no 'By status' control; revenue still excludes Cancelled", () => {
  assert.match(screen, /if \(str\(r, "status"\) === "CANCELLED"\) continue;/);
  assert.ok(!screen.includes("By status"));
  assert.ok(!screen.includes("summaryOpen"));
});

test("Scan PO uses the v3 ScanLine icon and the same sheet", () => {
  const search = screen.slice(screen.indexOf("function PhoneSearchRow"), screen.indexOf("function PhoneChips"));
  assert.ok(search.includes("<ScanLine size={18} strokeWidth={1.75} />"));
  assert.ok(!screen.includes("FileSearch"));
  assert.ok(search.includes('aria-label="Scan customer PO"'));
});

test("status chips carry a status-colour dot (not on All); counts unchanged", () => {
  const chips = screen.slice(screen.indexOf("function PhoneChips"), screen.indexOf("function PhoneSummary"));
  assert.ok(chips.includes('c.key !== "all"'));
  assert.ok(chips.includes("resolveStatus(c.key, STATUS_MAPS.so)"));
  assert.ok(chips.includes("CHIP_COUNT"));
  assert.ok(chips.includes("CHIP_ROW_CLASS"));
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

// Sales Orders v4 (owner 2026-10-27): the card is the Invoices card through ListCardShell.
test("v4 phone card: shared shell, status colours, both refs, dimmed Cancelled, no Qty/icon tile", () => {
  assert.match(screen, /<PhoneSoCard/);
  assert.ok(phoneCard.includes("<ListCardShell"));
  assert.ok(phoneCard.includes('resolveStatus(statusKey, STATUS_MAPS.so)'));
  assert.ok(phoneCard.includes('rail={status.style.hex}'));
  assert.ok(phoneCard.includes('<TilePill tint={tint}'));
  assert.ok(phoneCard.includes('soRefChips(r)'));
  assert.ok(phoneCard.includes('soCountdown(expected, statusKey, today)'));
  assert.ok(phoneCard.includes('soStage(statusKey)'));
  assert.ok(phoneCard.includes('"totalSen"'));
  assert.ok(phoneCard.includes('opacity: cancelled ? 0.55 : 1'));
  // SO number 14px raisin (shell default is 12/taupe, the Invoices look).
  assert.match(phoneCard, /fontSize: 14, color: M\.raisin/);
  // Removed vs v3: icon tile, divider + date tag row, Qty.
  assert.ok(!phoneCard.includes("soTotalQty"));
  assert.doesNotMatch(phoneCard, /Qty/);
  assert.ok(!phoneCard.includes("STATUS_ICON"));
  assert.ok(!phoneCard.includes("MobileCard"));
  assert.ok(phoneCard.includes('label: "AMOUNT"'));
  assert.ok(phoneCard.includes("EXPECTED DD"));
  assert.ok(!screen.includes("A89F8D"));
});

test("v4 card: stage bar is lifecycle position, hidden outside the seven stages; no late wording", () => {
  assert.ok(phoneCard.includes("stage ? ("));
  assert.match(phoneCard, /Stage \{stage\.n\} of \{stage\.total\}/);
  assert.ok(!phoneCard.includes("past"));
  assert.ok(!phoneCard.includes("CalendarX"));
  assert.doesNotMatch(phoneCard, /\blate\b/i);
  // The date always shows; a missing date is a dash.
  assert.ok(phoneCard.includes('soShortDate(expected) || "—"'));
  assert.ok(phoneCard.includes("cd.text ?"));
});

test("soStage: the seven lifecycle stages in server order; everything else is null", () => {
  assert.deepEqual(soStage("DRAFT"), { n: 1, total: 7 });
  assert.deepEqual(soStage("IN_PRODUCTION"), { n: 2, total: 7 });
  assert.deepEqual(soStage("READY_TO_SHIP"), { n: 3, total: 7 });
  assert.deepEqual(soStage("SHIPPED"), { n: 4, total: 7 });
  assert.deepEqual(soStage("DELIVERED"), { n: 5, total: 7 });
  assert.deepEqual(soStage("invoiced"), { n: 6, total: 7 });
  assert.deepEqual(soStage("CLOSED"), { n: 7, total: 7 });
  for (const st of ["CONFIRMED", "ON_HOLD", "CANCELLED", "WHATEVER", ""]) assert.equal(soStage(st), null, st);
  assert.deepEqual(SO_STAGES, ["DRAFT", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"]);
});

test("stage order matches the server's lifecycle (VALID_TRANSITIONS)", () => {
  const helpers = readFileSync(new URL("../src/api/routes/sales-orders/_helpers.ts", import.meta.url), "utf8");
  const block = helpers.slice(helpers.indexOf("export const VALID_TRANSITIONS"));
  const next = (st) => (block.match(new RegExp(`${st}: \\[([^\\]]*)\\]`)) || [])[1] || "";
  assert.ok(next("DRAFT").includes("IN_PRODUCTION"));
  assert.ok(next("IN_PRODUCTION").includes("READY_TO_SHIP"));
  assert.ok(next("READY_TO_SHIP").includes("SHIPPED"));
  assert.ok(next("SHIPPED").includes("DELIVERED"));
});

test("ListCardShell is presentational and the Invoices card renders through it", () => {
  const shell = read("components/ListCardShell.tsx");
  assert.ok(!shell.includes("useCachedJson") && !shell.includes("fetch("));
  assert.ok(shell.includes('background: "var(--m-inv-gold-box)"'));
  const parts = read("screens/invoices/parts.tsx");
  assert.ok(parts.includes("<ListCardShell"));
  // Invoices keeps the shell's default 12/700 taupe code (no override).
  const card = parts.slice(parts.indexOf("export function InvoiceCard"), parts.indexOf("export function InvPill"));
  assert.ok(!card.includes("codeStyle"));
});

test("v3 summary is a white card, money never ellipsised", () => {
  const sum = screen.slice(screen.indexOf("function PhoneSummary"), screen.indexOf('/** Round gradient'));
  assert.ok(sum.includes('backgroundColor: M.card'));
  assert.ok(!sum.includes('linear-gradient'));
  assert.ok(!sum.includes('rgba(255,255,255'));
  assert.match(sum, /flex: "none",\s*fontSize: 27/);
  const fig = sum.slice(sum.indexOf('fontSize: 27'), sum.indexOf('fontSize: 27') + 400);
  assert.ok(!fig.includes('textOverflow'));
  assert.ok(fig.includes('whiteSpace: "nowrap"'));
});

// ── v3 countdown + reference chips (real fields only) ──────────────────────

test("reference chips: PO then Cust SO, empty parts omitted", () => {
  assert.deepEqual(soRefChips({ customerPOId: "PO-1", customerSOId: "S-1" }), [
    { k: "PO", v: "PO-1" },
    { k: "Cust SO", v: "S-1" },
  ]);
  assert.deepEqual(soRefChips({ customerSOId: "S-2" }), [{ k: "Cust SO", v: "S-2" }]);
  assert.deepEqual(soRefChips({}), []);
});

// Countdown (owner 2026-10-27, display only): Expected DD 0–7 days away, and only
// for Confirmed / In Production / Ready to Ship. Never "late", never red.
const T = "2026-10-15";

test("countdown: Due today / In 1 day / In N days for 0–7 days ahead, amber", () => {
  assert.deepEqual(soCountdown("2026-10-15", "IN_PRODUCTION", T), { text: "Due today", tone: "soon", days: 0 });
  assert.deepEqual(soCountdown("2026-10-16", "CONFIRMED", T), { text: "In 1 day", tone: "soon", days: 1 });
  assert.deepEqual(soCountdown("2026-10-19", "READY_TO_SHIP", T), { text: "In 4 days", tone: "soon", days: 4 });
  assert.deepEqual(soCountdown("2026-10-22", "CONFIRMED", T), { text: "In 7 days", tone: "soon", days: 7 });
});

test("countdown: nothing beyond 7 days and nothing for a past Expected DD", () => {
  assert.deepEqual(soCountdown("2026-10-23", "CONFIRMED", T), { text: "", tone: "normal", days: 8 });
  assert.deepEqual(soCountdown("2026-12-31", "CONFIRMED", T), { text: "", tone: "normal", days: 77 });
  assert.deepEqual(soCountdown("2026-10-14", "CONFIRMED", T), { text: "", tone: "normal", days: -1 });
  assert.deepEqual(soCountdown("2025-01-01", "IN_PRODUCTION", T), { text: "", tone: "normal", days: -652 });
});

test("countdown: only Confirmed, In Production, Ready to Ship; every other status is silent", () => {
  for (const st of ["DRAFT", "ON_HOLD", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED", "CANCELLED", "WHATEVER", ""]) {
    assert.equal(soCountdown("2026-10-17", st, T).text, "", st);
    assert.equal(soCountdown("2026-10-17", st, T).tone, "normal", st);
  }
  assert.equal(soCountdown("2026-10-17", "confirmed", T).text, "In 2 days");
});

test("countdown: no date or bad date shows nothing", () => {
  assert.deepEqual(soCountdown("", "CONFIRMED", T), { text: "", tone: "normal", days: null });
  assert.deepEqual(soCountdown("nope", "CONFIRMED", T), { text: "", tone: "normal", days: null });
});

test("countdown maths is date-only (month/year boundaries, DST-safe)", () => {
  assert.equal(soCountdown("2026-11-01", "CONFIRMED", "2026-10-31").text, "In 1 day");
  assert.equal(soCountdown("2027-01-01", "CONFIRMED", "2026-12-31").text, "In 1 day");
  assert.equal(soCountdown("2026-03-30", "CONFIRMED", "2026-03-28").text, "In 2 days");
  assert.equal(soCountdown("2026-11-02", "CONFIRMED", "2026-10-25").text, "");
});

test("short date: '28 Oct', blank on bad input", () => {
  assert.equal(soShortDate("2026-10-28"), "28 Oct");
  assert.equal(soShortDate("2026-01-05"), "5 Jan");
  assert.equal(soShortDate(""), "");
  assert.equal(soShortDate("nope"), "");
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
