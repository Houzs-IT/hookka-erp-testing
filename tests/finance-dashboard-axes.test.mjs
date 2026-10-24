// ---------------------------------------------------------------------------
// finance-dashboard-axes.test.mjs — BUG-2026-10-24-391 (found while writing the
// dashboard's UI spec, owner 2026-10-24 「可以，修」): on the Financial
// Dashboard the Financial Ratios axis read 0 at every tick (the money format
// divided 39.05 % by 100), a seven-digit axis label lost its first digit
// (recharts' fixed 60 px), and the Balance Sheet drew an empty tab track.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const { yAxisWidthFor, ratioTick } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/finance-chart-look.ts")).href);

// The page's money format: sen in, whole ringgit out.
const rm = (sen) => (sen / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 });

test("the axis is as wide as its widest label; a six-digit axis keeps its 60", () => {
  assert.equal(yAxisWidthFor([60_000_000, 45_000_000], rm), 60, "600,000 fits the old width");
  const seven = yAxisWidthFor([137_800_000, 133_400_000], rm);
  assert.ok(seven >= 70, `1,400,000 needs room for nine characters (got ${seven})`);
  // The axis rounds its top up: 850,000 draws a 1,000,000 tick.
  assert.ok(yAxisWidthFor([85_000_000], rm) >= 70);
  // A negative label carries its minus.
  assert.ok(yAxisWidthFor([-120_000_000, 10_000_000], rm) > yAxisWidthFor([10_000_000], rm));
  // Blanks and non-numbers are skipped.
  assert.equal(yAxisWidthFor([null, undefined, Number.NaN], rm), 60);
});

test("a ratio axis reads its own value, never the money format", () => {
  assert.equal(ratioTick(39.05, true), "39.05%");
  assert.equal(ratioTick(40, true), "40%");
  assert.equal(ratioTick(1.5, false), "1.5");
  assert.equal(ratioTick(0.333, false), "0.33");
  assert.equal(rm(39.05), "0", "what the axis used to print");
});

test("the page: every left axis sized, Ratios formatted as ratios, no empty tab track", () => {
  const src = readFileSync("src/pages/finance-dashboard.tsx", "utf8").replace(/\r\n/g, "\n");
  const left = (src.match(/<YAxis [^\n]*\/>/g) ?? []).filter((a) => !/orientation="right"/.test(a));
  assert.equal(left.length, 3, "three left axes (salary cards, chart cards, cost structure)");
  for (const a of left) assert.match(a, /width=\{/, a);
  assert.match(src, /<YAxis \{\.\.\.yAxisProps\} width=\{leftWidth\} tickFormatter=\{fmtY\} \/>/);
  assert.match(src, /const fmtY = yFormat \?\? \(\(v: number\) => rm\(v\)\);/, "money unless a card says otherwise");
  assert.match(src, /yFormat=\{\(v\) => ratioTick\(v, \/Pct\$\/\.test\(ratioTab\)\)\}/);
  assert.match(src, /\{tabs\.length > 0 && \(\n\s*<SegmentedSwitch tone="pill" label=\{title\} options=\{tabs\} value=\{active\} onChange=\{onTab\} \/>\n\s*\)\}/);
});
