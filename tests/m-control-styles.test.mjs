// Segmented switch + filter chips — one approved Claude Design handoff spec
// (owner 2026-10-21) shared by Home, Products, Sales Orders and Delivery via
// src/pages/m/lib/control-styles.ts. Pins the values and that each screen reads
// them, so the four screens cannot drift apart again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cs = read("lib/control-styles.ts");
const vars = read("theme-vars.css");
const sw = read("components/SegmentedSwitch.tsx");
const home = read("screens/Home.tsx");
const products = read("screens/ProductsScreen.tsx");
const sales = read("screens/SalesScreen.tsx");
const delivery = read("screens/delivery/DeliveryScreen.tsx");
const deliveryUi = read("screens/delivery/ui.tsx");

const fn = (src, name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`))?.[0] ?? "";

test("segmented switch values match the handoff", () => {
  assert.match(cs, /SEGMENT_WRAP: CSSProperties = \{ padding: "6px 18px 0" \}/);
  assert.match(cs, /gridTemplateColumns: `repeat\(\$\{n\}, minmax\(0, 1fr\)\)`,\s*gap: 4,\s*height: 46,\s*boxSizing: "border-box",\s*padding: 4,\s*borderRadius: 14,\s*background: "var\(--m-segment-track\)",/);
  assert.match(cs, /borderRadius: 10,\s*border: "none",\s*background: on \? M\.card : "transparent",\s*boxShadow: on \? "var\(--m-shadow-segment-on\)" : "none",\s*color: on \? M\.raisin : M\.ink,/);
  assert.match(cs, /fontSize: 13,\s*fontWeight: on \? 700 : 600,\s*whiteSpace: "nowrap",/);
  assert.match(cs, /justifyContent: "center",\s*gap: 7,/);
  assert.match(cs, /SEGMENT_ICON = \{ size: 15, strokeWidth: 1\.9 \}/);
});

test("filter chip values match the handoff", () => {
  assert.match(cs, /display: "flex",\s*gap: 8,\s*overflowX: "auto",\s*padding: "12px 18px 4px",\s*scrollbarWidth: "none",/);
  assert.match(cs, /height: 34,\s*padding: "0 13px",\s*borderRadius: 999,\s*border: "none",/);
  assert.match(cs, /background: on \? M\.taupe : M\.card,\s*color: on \? "var\(--m-text-on-accent\)" : "var\(--m-chip-text\)",\s*boxShadow: on \? "var\(--m-shadow-chip-on\)" : "var\(--m-shadow-chip\)",/);
  assert.match(cs, /fontSize: 12\.5,\s*fontWeight: on \? 700 : 600,\s*display: "inline-flex",\s*alignItems: "center",\s*gap: 6,/);
  assert.match(cs, /CHIP_COUNT: CSSProperties = \{ opacity: 0\.8, fontVariantNumeric: "tabular-nums" \}/);
  assert.match(cs, /width: 7, height: 7, borderRadius: "50%"/);
});

test("handoff tokens: light hex + dark equivalents; tokens only in the style module", () => {
  assert.match(vars, /--m-segment-track: #F0ECE9;/);
  assert.match(vars, /--m-chip-text: #3A352C;/);
  assert.match(vars, /--m-segment-track: #34302A;/);
  assert.match(vars, /--m-chip-text: #D4C9A8;/);
  assert.match(vars, /--m-shadow-segment-on: 0 1px 2px rgba\(31, 29, 27, 0\.08\), 0 6px 14px -6px rgba\(31, 29, 27, 0\.2\);/);
  assert.match(vars, /--m-shadow-chip: 0 1px 2px rgba\(31, 29, 27, 0\.06\), 0 4px 10px -6px rgba\(31, 29, 27, 0\.16\);/);
  assert.match(vars, /--m-shadow-chip-on: 0 6px 14px -6px rgba\(107, 92, 50, 0\.6\);/);
  assert.doesNotMatch(cs, /#[0-9A-Fa-f]{3,6}\b/);
});

test("Home: prominent switch is opt-in; the default SegmentedSwitch is unchanged", () => {
  assert.match(home, /ariaLabel="Home view" variant="prominent"/);
  assert.match(sw, /variant = "default"/);
  assert.match(sw, /style=\{prominent \? segmentTrack\(options\.length\) : \{/);
  assert.match(sw, /style=\{prominent \? segmentButton\(on\) : \{/);
});

test("Products, Sales Orders and Delivery read the shared styles", () => {
  const view = fn(products, "ViewSwitch");
  assert.match(view, /<div style=\{SEGMENT_WRAP\}>/);
  assert.match(view, /style=\{segmentTrack\(opts\.length\)\}/);
  assert.match(view, /style=\{segmentButton\(on\)\}/);
  assert.match(fn(products, "CategoryChips"), /style=\{CHIP_ROW\}[\s\S]*style=\{chipStyle\(on\)\}/);

  assert.match(fn(sales, "PhoneChips"), /style=\{CHIP_ROW\}[\s\S]*style=\{chipStyle\(on\)\}/);
  // One chip row at every width (the old tablet row with its own 10px spacing is gone, 2026-10-23).
  assert.doesNotMatch(sales, /padding: "10px 18px 4px"/);
  assert.equal((sales.match(/chipStyle\(on\)/g) ?? []).length, 1);
  // Status dots on the Sales chips (owner 2026-10-27, Sales Orders v3); "All" has none.
  assert.match(fn(sales, "PhoneChips"), /c\.key !== "all"[\s\S]*chipDot\(/);

  assert.match(fn(delivery, "Chips"), /style=\{CHIP_ROW\}[\s\S]*chipDot\(sem\(dot\)\)[\s\S]*style=\{chipStyle\(on\)\}|style=\{CHIP_ROW\}[\s\S]*style=\{chipStyle\(on\)\}[\s\S]*chipDot\(sem\(dot\)\)/);
  assert.match(delivery, /<div style=\{SEGMENT_WRAP\}>\s*<SectionSwitch/);
  assert.match(fn(deliveryUi, "SectionSwitch"), /style=\{segmentTrack\(opts\.length\)\}[\s\S]*style=\{segmentButton\(on\)\}/);
});
