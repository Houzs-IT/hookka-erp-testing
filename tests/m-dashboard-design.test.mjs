// ---------------------------------------------------------------------------
// m-dashboard-design.test.mjs — the Finance Dashboard on the phone as the
// owner's phone design draws it ("Hookka Finance Mobile"; owner 2026-10-20
// 「手机版的和我之前设计的也有不一样」 and 「做」 for the swipe back): the last
// four months that happened, a month chosen for every card by a tap, the
// Income Statement's mini chart (teal bars, the chosen one full; the forecast
// a smooth red dashed line with hollow dots), the pill against the forecast,
// the salary and cost cards' share bar, month list and tiles, the cash card's
// sections; a swipe from the left edge backs out, in the iPhone home-screen
// app only. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  MOBILE_DASH_LINES, FIN_DASH_LINES, rmWhole, vsForecast, phoneDashMonths, smoothPath, cfSectionTotals, shareWidths,
  monthName, shortName, SWIPE_EDGE_PX, swipeGoesBack,
  pctPointLabel,
} from "../src/pages/m/screens/finance/m-finance-lib.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dir = "src/pages/m/screens/finance/";
const scr = read(dir + "DashScreen.tsx");
const sec = read(dir + "DashSections.tsx");
const shell = read(dir + "finance-shell.tsx");

test("the phone's lines: the desktop's, without Stock Movement", () => {
  assert.deepEqual(MOBILE_DASH_LINES.map((l) => l.key), FIN_DASH_LINES.map((l) => l.key).filter((k) => k !== "stockMovement"));
  assert.equal(MOBILE_DASH_LINES.length, 9);
});

test("figures in whole ringgit; the pill against the forecast, good or not", () => {
  assert.equal(rmWhole(61240000), "612,400");
  assert.equal(rmWhole(-88760000), "-887,600");
  assert.equal(rmWhole(null), "-");
  assert.deepEqual(vsForecast(61240000, 150000000, false), { text: "-887,600 vs fcst", good: false, forecast: "1,500,000" });
  assert.deepEqual(vsForecast(1000000, 1200000, true), { text: "-2,000 vs fcst", good: true, forecast: "12,000" }, "a cost under plan is good");
  assert.equal(vsForecast(1000000, null, true), null);
});

test("the months: the last four that happened, from July", () => {
  const rows = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((key) => ({ key, actual: { sales: 1 } }))
    .concat([{ key: "2026-11", actual: null }]);
  assert.deepEqual(phoneDashMonths(rows).map((r) => r.key), ["2026-07", "2026-08", "2026-09", "2026-10"]);
});

test("the smooth line, the cash sections, the share bar", () => {
  assert.equal(smoothPath([[0, 10], [25, 0]]), "M0,10 C10,10 15,0 25,0");
  assert.equal(smoothPath([]), "");
  // In the statement's order and in words, whatever order the lines come in; nothing-net sections out.
  assert.deepEqual(cfSectionTotals([
    { section: "CAPEX", value: -50 }, { section: "RAW MATERIALS", value: -300 },
    { section: "REVENUE_COLLECTION", value: 500 }, { section: "REVENUE COLLECTION", value: 100 },
    { section: "OTHER THING", value: 7 }, { section: "TRADE FINANCE", value: 0 },
  ]), [
    { name: "Revenue collection", value: 600 }, { name: "Raw materials", value: -300 },
    { name: "Capex", value: -50 }, { name: "Other thing", value: 7 },
  ]);
  assert.deepEqual(shareWidths([30, null, 70]), [30, 0, 70]);
  assert.deepEqual(shareWidths([0, -5]), [0, 0]);
});

test("one month for every card, chosen by a tap; the latest at first", () => {
  assert.match(scr, /const months = phoneDashMonths\(rows\);/);
  assert.match(scr, /const sel = pick !== null && pick < months\.length \? pick : months\.length - 1;/);
  assert.equal((scr.match(/onSel=\{setPick\}/g) ?? []).length, 4, "the chart, both salary cards and the cost card choose it");
  assert.match(scr, /<CashFlowCard month=\{last\} \/>/);
  assert.match(scr, /<BalanceSheetCard month=\{last\} \/>/);
  assert.match(scr, /<RatiosCard month=\{last\} \/>/);
  assert.match(scr, /is still running — figures are so far\./);
  // Money out reads as an amount, as the design: "Out 363,252".
  assert.match(sec, /Out \$\{rmWhole\(cf\?\.outflow == null \? null : Math\.abs\(cf\.outflow\)\)\}/);
});

test("the design's look: the mini chart, the pill, the list, the share bar, the tiles", () => {
  // Mini chart: teal bars, the chosen one full and the rest at .45; the forecast red, dashed, smooth, hollow dots.
  assert.match(sec, /rx=\{4\} fill=\{CH\.single\}/);
  assert.match(sec, /opacity: me \? 1 : 0\.45, transition: "y \.45s ease, height \.45s ease, opacity \.2s"/);
  assert.match(sec, /<path d=\{smoothPath\(pts\)\} fill="none" stroke=\{CH\.fc\} strokeWidth=\{2\} strokeDasharray=\{FORECAST_DASH\}/);
  assert.match(sec, /<circle key=\{k\} cx=\{cx\} cy=\{cy\} r=\{3\} fill="#FFFFFF" stroke=\{CH\.fc\} strokeWidth=\{2\}/);
  // The pill: green on #E8F3EC when good, red on #FBEAE7 when not; "Forecast …" under it.
  assert.match(sec, /background: vs\.good \? "#E8F3EC" : "#FBEAE7", color: vs\.good \? GREEN : RED/);
  assert.match(sec, /Forecast \{vs\.forecast\}/);
  // The list: the chosen month on #E9F2F1; % of sales red over plan, green within.
  assert.match(sec, /background: r\.selected \? "#E9F2F1" : "transparent"/);
  assert.match(sec, /const vsColour = \(p: number \| null, fp: number \| null\) => \(p === null \|\| fp === null \? MUTED : p > fp \? RED : GREEN\);/);
  // The share bar in the desktop's band colours; the tiles.
  assert.match(sec, /background: CS_COLOURS\[i % CS_COLOURS\.length\], transition: "width \.4s ease"/);
  assert.match(sec, /\{ label: "Headcount", value: head === null \? "-" : String\(head\), col: CH\.teal \}/);
  assert.match(sec, /\{ label: "RM \/ unit", value: rmWhole\(per\(units\)\), col: CH\.green \}/);
  // The card frame.
  assert.match(sec, /background: "#FFFFFF", border: "1px solid #E7E0D4", borderRadius: 16, padding: 14/);
});

test("month names: in words, starred while running", () => {
  assert.equal(monthName({ key: "2026-10", partial: true }), "Oct 2026 *");
  assert.equal(shortName({ key: "2026-09", partial: false }), "Sep", "the design's Sep, not en-GB Sept");
});

test("swipe back: from the left edge, past 30% of the width, in the iPhone home-screen app only", () => {
  assert.equal(SWIPE_EDGE_PX, 28);
  assert.equal(swipeGoesBack(121, 400), true);
  assert.equal(swipeGoesBack(120, 400), false);
  assert.match(shell, /\(navigator as Navigator & \{ standalone\?: boolean \}\)\.standalone === true/);
  assert.match(shell, /if \(!enabled\) return <>\{children\}<\/>;/);
  assert.match(shell, /if \(e\.clientX - box\.left > SWIPE_EDGE_PX\) return;/);
  assert.match(shell, /transition: dragging \? "none" : "transform \.22s cubic-bezier\(\.2,\.8,\.2,1\)"/);
  assert.match(read(dir + "FinanceRoute.tsx"), /return <SwipeBack onBack=\{\(\) => navigate\("\/m\/finance"\)\}>\{render\(\)\}<\/SwipeBack>;/);
});

test("a percentage chart's point carries its figure on the phone (owner 2026-10-20)", () => {
  assert.equal(pctPointLabel(46.84), "46.8%");
  assert.equal(pctPointLabel(0), "0.0%");
  assert.equal(pctPointLabel(-2.5), "(2.5%)");
  assert.equal(pctPointLabel(null), "", "a month without sales has no point, so no label");
  assert.equal(pctPointLabel(Number.NaN), "");
});
