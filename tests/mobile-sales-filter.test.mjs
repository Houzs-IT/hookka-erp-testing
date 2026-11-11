// ---------------------------------------------------------------------------
// mobile-sales-filter.test.mjs — phone /m/sales "Filter orders" sheet and the
// summary card layout (owner 2026-10-15, Claude Design `Sales Orders.dc.html`).
//
// Pins:
//   • Expected DD presets from a local today: week = Mon–Sun, month, next 30
//     days (incl. today), before today; preset detection round-trips;
//   • Amount presets are sen and do NOT overlap at RM 10k / RM 50k; custom
//     RM input → integer sen (BUG-2026-10-15-289 is why the shared sheet is
//     not reused);
//   • Draft → filters → Draft round-trips, including More filters columns;
//   • the main chip and the sheet's Status never disagree (splitStatus);
//   • "Show N orders" counts with the real applyFilters over the real rows;
//   • the phone sheet is Filter only (no Sort | Filter switch); the list keeps
//     its sort state + applySort; phone uses SalesFilterSheet, tablet keeps
//     the shared FilterSheet, and
//     the shared FilterSheet is not edited;
//   • summary card: prototype 1.4fr | 1px | .9fr, KPI line height 1.1, money
//     never ellipsised (stacks instead), fixed right-aligned count column.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const P = await import(pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/so-filter-presets.ts")).href);
const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const screen = read("screens/SalesScreen.tsx");
const sheet = read("screens/SalesFilterSheet.tsx");

// The real Sales columns' keys / types (src/pages/m/config/modules.ts).
const COLS = [
  { key: "companySO", label: "Company SO", type: "text" },
  { key: "customerSO", label: "Customer SO", type: "text" },
  { key: "customerPO", label: "Customer PO", type: "text" },
  { key: "customer", label: "Customer", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "reference", label: "Reference", type: "text" },
  { key: "orderDate", label: "Order Date", type: "date" },
  { key: "expectedDD", label: "Expected DD", type: "date" },
  { key: "qty", label: "Qty", type: "number" },
  { key: "items", label: "Items", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
  { key: "status", label: "Status", type: "enum", options: ["DRAFT", "CONFIRMED", "ON_HOLD"] },
];
const TODAY = "2026-10-15"; // a Thursday

// ── Dates ──────────────────────────────────────────────────────────────────

test("localToday uses the device's local date, not UTC", () => {
  // 00:30 local on 15 Oct is still 14 Oct in UTC for any zone ahead of UTC.
  assert.equal(P.localToday(new Date(2026, 9, 15, 0, 30)), "2026-10-15");
});

test("This week is Monday–Sunday", () => {
  assert.deepEqual(P.expPresetRange("week", TODAY), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(P.expPresetRange("week", "2026-10-18"), { from: "2026-10-12", to: "2026-10-18" }); // Sunday
  assert.deepEqual(P.expPresetRange("week", "2026-10-19"), { from: "2026-10-19", to: "2026-10-25" }); // Monday
});

test("This month, Next 30 days and Before today", () => {
  assert.deepEqual(P.expPresetRange("month", TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(P.expPresetRange("month", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(P.expPresetRange("next30", TODAY), { from: "2026-10-15", to: "2026-11-13" });
  assert.deepEqual(P.expPresetRange("past", TODAY), { from: "", to: "2026-10-14" });
});

test("a stored date filter is recognised as its preset only while the dates still match", () => {
  const d = P.seedDraft({}, "all", COLS, TODAY);
  d.exp.preset = "week";
  const f = P.buildFilters(d, COLS, TODAY);
  assert.deepEqual(f.expectedDD, { type: "date", from: "2026-10-12", to: "2026-10-18" });
  assert.equal(P.detectExpPreset(f.expectedDD, TODAY), "week");
  assert.equal(P.detectExpPreset(f.expectedDD, "2026-10-20"), "custom");
});

// ── Amounts ────────────────────────────────────────────────────────────────

test("amount presets are sen and do not overlap at RM 10k / RM 50k", () => {
  const keep = (p, sen) => {
    const f = P.amtPresetFilter(p);
    if (f.op === "lt") return sen < f.a;
    if (f.op === "gt") return sen > f.a;
    return sen >= f.a && sen <= f.b;
  };
  for (const sen of [999_999, 1_000_000, 1_000_001, 4_999_999, 5_000_000, 5_000_001]) {
    const hits = ["lt10", "10to50", "gt50"].filter((p) => keep(p, sen));
    assert.equal(hits.length, 1, `RM ${sen / 100} matched ${hits}`);
  }
  assert.ok(keep("10to50", 1_000_000) && keep("10to50", 5_000_000));
});

test("custom RM input becomes integer sen", () => {
  assert.equal(P.rmToSen("10000"), 1_000_000);
  assert.equal(P.rmToSen("1,234.56"), 123_456);
  assert.equal(P.rmToSen("RM 0.1"), 10);
  assert.equal(P.rmToSen("0.105"), 11);
  assert.equal(P.rmToSen(""), null);
  assert.equal(P.rmToSen("abc"), null);
  const d = P.seedDraft({}, "all", COLS, TODAY);
  d.amt = { preset: "custom", min: "10000", max: "" };
  assert.deepEqual(P.buildFilters(d, COLS, TODAY).amount, { type: "number", op: "gte", a: 1_000_000, b: null });
});

test("a custom amount reopens in RM, a preset reopens as the preset", () => {
  const custom = P.seedDraft({ amount: { type: "number", op: "between", a: 250_000, b: 1_234_500 } }, "all", COLS, TODAY);
  assert.deepEqual(custom.amt, { preset: "custom", min: "2500", max: "12345" });
  const preset = P.seedDraft({ amount: P.amtPresetFilter("gt50") }, "all", COLS, TODAY);
  assert.equal(preset.amt.preset, "gt50");
});

// ── Draft round trip / More filters ────────────────────────────────────────

test("every existing column is still filterable and round-trips", () => {
  const filters = {
    companySO: { type: "text", contains: "SO-26" },
    state: { type: "text", contains: "Johor" },
    orderDate: { type: "date", from: "2026-09-01", to: "2026-09-30" },
    qty: { type: "number", op: "between", a: 5, b: 20 },
    items: { type: "number", op: "lte", a: 3, b: null },
    status: { type: "enum", selected: ["DRAFT", "ON_HOLD"] },
  };
  const d = P.seedDraft(filters, "all", COLS, TODAY);
  assert.equal(P.moreCount(d), 5); // companySO, state, orderDate, qty, items
  assert.deepEqual(P.buildFilters(d, COLS, TODAY), filters);
});

test("min / max map onto the existing number filter, inclusive", () => {
  assert.deepEqual(P.rangeFilter(5, null), { type: "number", op: "gte", a: 5, b: null });
  assert.deepEqual(P.rangeFilter(null, 9), { type: "number", op: "lte", a: 9, b: null });
  assert.deepEqual(P.rangeFilter(5, 9), { type: "number", op: "between", a: 5, b: 9 });
  assert.equal(P.rangeFilter(null, null), null);
});

test("Reset empties every section", () => {
  assert.deepEqual(P.buildFilters(P.seedDraft({}, "all", COLS, TODAY), COLS, TODAY), {});
});

// ── Main chip vs sheet Status ──────────────────────────────────────────────

const CHIP_KEYS = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "DELIVERED", "CANCELLED"];

test("the open chip shows as the selected status in the sheet", () => {
  assert.deepEqual(P.seedDraft({}, "CONFIRMED", COLS, TODAY).status, ["CONFIRMED"]);
  assert.deepEqual(P.seedDraft({}, "all", COLS, TODAY).status, []);
});

test("one status with a chip becomes the chip; several keep the filter with chip All", () => {
  const amt = P.amtPresetFilter("lt10");
  const one = P.splitStatus({ status: { type: "enum", selected: ["DRAFT"] }, amount: amt }, CHIP_KEYS);
  assert.deepEqual(one, { chip: "DRAFT", filters: { amount: amt } });
  const many = P.splitStatus({ status: { type: "enum", selected: ["DRAFT", "ON_HOLD"] } }, CHIP_KEYS);
  assert.equal(many.chip, "all");
  assert.deepEqual(many.filters.status.selected, ["DRAFT", "ON_HOLD"]);
  const noChip = P.splitStatus({ status: { type: "enum", selected: ["ON_HOLD"] } }, CHIP_KEYS);
  assert.equal(noChip.chip, "all");
  assert.deepEqual(P.splitStatus({}, CHIP_KEYS), { chip: "all", filters: {} });
});

test("picking a main chip drops a sheet Status filter at every width", () => {
  assert.match(screen, /const pickChip = \(k: string\) => \{\s*setChip\(k\);\s*removeFilter\("status"\);/);
  assert.match(screen, /<PhoneChips chip=\{chip\} setChip=\{pickChip\}/);
});

// ── Sheet wiring ───────────────────────────────────────────────────────────

test("Show N orders is the real applyFilters count over the real rows", () => {
  assert.match(sheet, /applyFilters\(rows, columns, built as Record<string, ActiveFilter>, search\)\.length/);
  assert.match(sheet, /n === 1 \? "Show 1 order" : `Show \$\{n\} orders`/);
  assert.match(screen, /rows=\{allRows\}\s*search=\{dq\}/);
});

test("one SalesFilterSheet at every width; the shared FilterSheet itself is unchanged", () => {
  assert.equal(screen.match(/<SalesFilterSheet/g).length, 1);
  assert.doesNotMatch(screen, /<FilterSheet/);
  const shared = read("components/FilterSheet.tsx");
  assert.match(shared, /<Sheet open=\{open\} onClose=\{onClose\} title="Filter & sort">/);
});

test("Sort & filter sheet: no Sort | Filter switch; the Sort section at every width (owner 2026-10-27); list sorting untouched", () => {
  assert.ok(sheet.includes('title="Filter orders"')); // the approved design title
  assert.doesNotMatch(sheet, /SegmentedSwitch|onSort|TOP_SORTS|SortList/);
  // The list bar button opens this sheet at every width, so the screen always opts in.
  assert.match(screen, /\n\s*withSort\s*\n/);
  assert.ok(!screen.includes("withSort={tablet}"));
  assert.match(sheet, /withSort = false,/);
  assert.ok(sheet.includes("{withSort ? <SortBy columns={columns} sort={draftSort} onChange={setDraftSort} /> : null}"));
  // The list still sorts exactly as before: same state, default and applySort.
  assert.ok(screen.includes("const [sort, setSort] = useState<Sort>(source.defaultSort ?? null);"));
  assert.ok(screen.includes("return applySort(filtered, source.columns, sort);"));
});

// ── Summary card layout ────────────────────────────────────────────────────

// Sales Orders v3 (owner 2026-10-26): white summary card, one 27/700 revenue
// figure (the two-column KPI layout and its stacking logic are gone).
test("summary card: v3 revenue figure 27/700, money never ellipsised", () => {
  assert.ok(!screen.includes("KPI_COLS"));
  assert.ok(!screen.includes("function HeroFigure"));
  const sum = screen.slice(screen.indexOf("function PhoneSummary"), screen.indexOf("/** Round gradient"));
  assert.match(sum, /flex: "none",\s*fontSize: 27,\s*lineHeight: 1\.1,\s*fontWeight: 700,\s*letterSpacing: "-0\.6px"/);
  const fig = sum.slice(sum.indexOf("fontSize: 27"), sum.indexOf("fontSize: 27") + 400);
  assert.ok(!fig.includes("textOverflow"));
});

