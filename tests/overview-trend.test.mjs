// ---------------------------------------------------------------------------
// overview-trend.test.mjs — the Finance Overview (owner 2026-10-14 「overview
// 主要显示…」→「默认三个月」「6 张卡做成 graph 和 table」「ar/ap 放下面…指向…
// 显示 detail」「型号可以合并」→「做，top 5，分成 sofa bedframe」).
//   - months, document sums, model series and the top 5 per category (pure);
//   - "how a figure is made" adds up exactly, in the statement's own terms;
//   - the route: read-only, the P&L page's own month windows, drafts and
//     cancelled documents left out, figures before SST;
//   - the tab: charts (the month table went), aging below with who makes up a
//     bucket, the recent-journal grid gone.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  modelSeries, lastMonths, sumByMonth, topModelsByMonth, overviewPnl, shareOfSales, explainMonth, TOP_MODELS,
} from "../src/lib/overview-trend.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const slice = (src, a, b) => {
  const i = src.indexOf(a);
  assert.ok(i >= 0, `marker ${a}`);
  const j = src.indexOf(b, i + a.length);
  return src.slice(i, j < 0 ? undefined : j);
};

test("a model's variants count as one series", () => {
  assert.equal(modelSeries("1003(A)(HF)(W)"), "1003");
  assert.equal(modelSeries("1003(A)"), "1003");
  assert.equal(modelSeries("2038(A)-(SK)"), "2038");
  assert.equal(modelSeries("10033"), "10033", "a different number is a different model");
  assert.equal(modelSeries("SQUARE PILLOW RDM"), "SQUARE PILLOW RDM");
  assert.equal(modelSeries(null), "");
});

test("the last n months end with the running one, oldest first", () => {
  assert.deepEqual(lastMonths("2026-10", 3), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(lastMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(lastMonths("2026-10", 12)[0], "2025-11");
});

test("documents are counted and summed per month, outside the range ignored", () => {
  const by = sumByMonth([
    { ym: "2026-09", sen: 1000 }, { ym: "2026-09", sen: 2500 }, { ym: "2026-10", sen: 700 }, { ym: "2026-07", sen: 99 },
  ], ["2026-09", "2026-10"]);
  assert.deepEqual(by.get("2026-09"), { count: 2, sen: 3500 });
  assert.deepEqual(by.get("2026-10"), { count: 1, sen: 700 });
  assert.equal(by.has("2026-07"), false);
});

test("top 5 per month, Sofa and Bedframe apart, series merged, service charges left out", () => {
  const orders = [
    { ym: "2026-10", category: "SOFA", model: "1003(A)", qty: 2 },
    { ym: "2026-10", category: "SOFA", model: "1003(A)(HF)(W)", qty: 3 },
    { ym: "2026-10", category: "SOFA", model: "2038(A)-(SK)", qty: 4 },
    { ym: "2026-10", category: "BEDFRAME", model: "5530", qty: 1 },
    { ym: "2026-10", category: "SOFA", model: "SERVICE CHARGE", qty: 9 },
    { ym: "2026-10", category: "ACCESSORY", model: "LONG PILLOW", qty: 9 },
    ...["A", "B", "C", "D", "E", "F"].map((m, i) => ({ ym: "2026-10", category: "BEDFRAME", model: `X${m}`, qty: i + 2 })),
    { ym: "2026-09", category: "SOFA", model: "1003", qty: 0 },
  ];
  const top = topModelsByMonth(orders, ["2026-09", "2026-10"]);
  assert.deepEqual(top.get("2026-10").SOFA, [
    { model: "1003", qty: 5, orders: 2 },
    { model: "2038", qty: 4, orders: 1 },
  ]);
  assert.equal(top.get("2026-10").BEDFRAME.length, TOP_MODELS);
  assert.deepEqual(top.get("2026-10").BEDFRAME.map((m) => m.model), ["XF", "XE", "XD", "XC", "XB"]);
  assert.deepEqual(top.get("2026-09").SOFA, [{ model: "1003", qty: 1, orders: 1 }], "a zero quantity counts as one, as the stock does");
});

const W = {
  netSalesSen: 100000, revLines: [], carriageSen: 0, sstSen: 0, labourLines: [], labourSen: 12000,
  rmGroups: [{ group: "A", description: "A", openingSen: 10000, purchasesSen: 30000, closingSen: 5000 }, { group: "B", description: "B", openingSen: 0, purchasesSen: 5000, closingSen: 0 }],
  rmConsumedSen: 40000, overheadLines: [{ code: "x", name: "x", amountSen: 3000, estSen: 3000 }], overheadSen: 3000,
  wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0, manufacturingSen: 55000, cogsSen: 55000, grossProfitSen: 45000,
  otherIncomeSen: 1000, otherIncomeLines: [], expenseLines: [{ code: "e", name: "e", amountSen: 20000, salary: false, estSen: 500 }],
  expenseSen: 20000, netProfitSen: 26000,
};

test("the Overview's P&L is the statement's own totals", () => {
  const p = overviewPnl(W);
  assert.deepEqual(p.rm, {
    openingSen: 10000, purchasesSen: 35000, closingSen: 5000, usedSen: 40000,
    groups: [{ name: "A", usedSen: 35000 }, { name: "B", usedSen: 5000 }],
  });
  assert.equal(p.estSen, 3500, "overhead and expense estimates");
  assert.equal(p.estOverheadSen, 3000, "the overhead part sits in cost of goods sold");
  assert.equal(shareOfSales(p.grossProfitSen, p.netSalesSen), 45);
  assert.equal(shareOfSales(1, 0), null);
});

test("how a figure is made adds up exactly", () => {
  const m = { ym: "2026-10", running: true, so: { count: 4, sen: 200000 }, inv: { count: 3, sen: 150000 }, pnl: overviewPnl(W), top: { SOFA: [], BEDFRAME: [] } };
  const sum = (lines) => lines.filter((l) => !l.total && l.sen !== undefined).reduce((s, l) => s + l.sen, 0);
  const gp = explainMonth(m, "gp");
  assert.equal(sum(gp.slice(0, 2)), gp.find((l) => l.label === "= Gross profit").sen, "net sales − cost of goods sold");
  const np = explainMonth(m, "np");
  assert.equal(sum(np.slice(0, 3)), np.find((l) => l.label === "= Net profit").sen, "gross profit + other income − expenses");
  assert.ok(np.some((l) => l.label === "incl. estimated costs" && l.sen === 3500));
  assert.ok(gp.some((l) => l.label === "incl. estimated factory overhead" && l.sen === 3000), "gross profit carries only the overhead estimates");
  assert.ok(!gp.some((l) => l.label === "incl. estimated costs"));
  // Raw materials: each material with its amount and share of sales (owner
  // 2026-10-14), adding up to the total; the opening / purchases / closing in its note.
  const rmx = explainMonth(m, "rm");
  const total = rmx.find((l) => l.label === "= Raw materials used");
  assert.deepEqual(rmx.slice(0, 2).map((l) => [l.label, l.sen, l.pct]), [["A", 35000, 35], ["B", 5000, 5]]);
  assert.equal(sum(rmx.slice(0, 2)), total.sen, "the materials add up to the total");
  assert.equal(total.pct, 40);
  assert.match(total.note, /^opening 100\.00 \+ purchases 350\.00 − closing 50\.00$/);
  assert.equal(explainMonth(m, "dl").at(-1).pct, 12);
  assert.equal(explainMonth(m, "orders").at(-1).pct, 75, "invoiced, of the orders");
  assert.deepEqual(explainMonth({ ...m, pnl: null }, "np"), [{ label: "No P&L for this month", note: "before the books opened" }]);
});

test("the route is read-only and reads the P&L page's own month windows", () => {
  const api = read("src/api/routes/accounting.ts");
  const route = slice(api, 'app.get("/overview-trend"', "\n});\n");
  // The figures are computed by computeOverviewTrend; the route keeps the last
  // copy in its own snapshot table (2026-10-19, tests/finance-overview-speed.test.mjs)
  // — that cache is the ONLY thing it writes.
  const r = slice(api, "async function computeOverviewTrend(", "\n}\n");
  assert.match(route, /requirePermission\(c, "accounting", "read"\)/);
  assert.doesNotMatch(r, /INSERT|UPDATE|DELETE|kvSet|\.run\(/, "nothing written");
  assert.doesNotMatch(route.replace(/CREATE TABLE IF NOT EXISTS accounting_overview_snapshot \([\s\S]*?\)`,\n\s*\)\.run\(\);/, ""), /INSERT|UPDATE|DELETE|kvSet|\.run\(/, "the route writes its snapshot table only");
  assert.match(route, /const n = asked === 6 \|\| asked === 12 \? asked : 3;/, "three months unless asked");
  assert.match(r, /FROM sales_orders WHERE status NOT IN \('DRAFT','CANCELLED'\)/);
  assert.match(r, /FROM invoices WHERE status NOT IN \('DRAFT','CANCELLED'\)/);
  assert.match(r, /SELECT companySODate, createdAt, subtotalSen FROM sales_orders/, "an order before SST (it carries none)");
  assert.match(r, /SELECT invoiceDate, createdAt, subtotalSen FROM invoices/, "an invoice's subtotal = before SST");
  assert.match(r, /WHERE completedDate IS NOT NULL AND status <> 'CANCELLED'/);
  assert.match(r, /const hist = selectHistoricalWindow\(historical, openingMonth, ym, "all"\);/);
  assert.match(r, /await computePnlWindow\(db, orgId, ym, ym, "all", matData, dc, override\)/);
  assert.match(r, /pnl: w \? overviewPnl\(w\) : null,/);
});

test("the tab: six charts, aging with who makes up a bucket, no month table", () => {
  const ui = read("src/pages/accounting/overview-tab.tsx");
  const page = read("src/pages/accounting/index.tsx");
  assert.match(page, /<OverviewTab arData=\{arData\} apData=\{apData\} agingLoading=\{agingPending\} \/>/);
  assert.doesNotMatch(page, /Recent Journal Entries/, "the recent-journal grid is gone");
  assert.match(ui, /const \[range, setRange\] = useState<Range>\(3\);/, "three months by default");
  assert.match(ui, /`\/api\/accounting\/overview-trend\?months=\$\{range\}`/);
  for (const t of ["Sales orders vs sales invoices", "Gross profit", "Net profit", "Raw material cost, of sales", "Direct labour, of sales", "Most produced models · top 5"]) {
    assert.ok(ui.includes(t), `chart: ${t}`);
  }
  assert.match(ui, /content=\{chartTip\(byYm, "orders"\)\}/, "the orders chart explains on hover");
  assert.equal((ui.match(/content=\{chartTip\(byYm, metric\)\}/g) ?? []).length, 2, "profit and % charts explain on hover");
  assert.match(ui, /\{profitChart\("gp", "gpPct", gpAxis, gpPctAxis, "gp"\)\}/);
  assert.match(ui, /\{profitChart\("np", "npPct", npAxis, npPctAxis, "np"\)\}/, "net profit: bars (amount) + a line (% of sales)");
  assert.match(ui, /\{pctChart\("rmPct", rmPctAxis, C\.rmLine, "Raw material cost", "rm"\)\}/);
  assert.match(ui, /\{pctChart\("dlPct", dlPctAxis, C\.dlLine, "Direct labour", "dl"\)\}/);
  assert.match(ui, /<LabelList dataKey="so" position="top" formatter=\{compactLabel\}/, "order amounts show without pointing");
  assert.match(ui, /<LabelList dataKey="inv" position="top" formatter=\{compactLabel\}/);
  assert.equal((ui.match(/<CartesianGrid vertical=\{false\} stroke="#EEF1F5" syncWithTicks \/>/g) ?? []).length, 3, "a grid line on every tick");
  assert.match(ui, /rounded-full bg-\[#F0ECE9\] text-\[9px\] font-semibold text-\[#6B7280\]">\{i \+ 1\}<\/span>/, "the rank is not read as part of the model number");
  assert.match(ui, /<TopList title="Sofa" items=\{m\.top\.SOFA\}/);
  assert.match(ui, /<TopList title="Bedframe" items=\{m\.top\.BEDFRAME\}/);
  assert.match(ui, /<HoverDetail key=\{b\.period\} block detail=\{detail\(b\)\}>/, "an aging bucket shows its parties");
  assert.match(ui, /createPortal\(/, "the detail is drawn in a layer of its own");
  assert.match(ui, /domain=\{ordersAxis\.domain\} ticks=\{ordersAxis\.ticks\}/, "round ticks with room for the labels");
  assert.equal((ui.match(/domain=\{axis\.domain\} ticks=\{axis\.ticks\}/g) ?? []).length, 2, "profit and % charts too");
  assert.match(ui, /domain=\{pctAxis\.domain\} ticks=\{pctAxis\.ticks\}/, "the % line on its own axis");
  // The month-by-month table went (owner 2026-10-14 「这个表不需要了吧，我看上面的 card 就行」).
  assert.doesNotMatch(ui, /MonthTable|Month by month/, "the charts carry the months");
});

test("chart axes: round ticks, always through 0, room for the labels", async () => {
  const { niceAxis } = await import("../src/lib/overview-trend.ts");
  // Made-up figures (the repo is public).
  assert.deepEqual(niceAxis([412000.5, 487250.75, 298100.25]), { domain: [0, 600000], ticks: [0, 200000, 400000, 600000] });
  const np = niceAxis([-41000.5, 62500.25, -72800.75]);
  assert.deepEqual(np.domain, [-100000, 100000]);
  assert.ok(np.ticks.includes(0), "a loss chart keeps its zero line");
  assert.ok(np.domain[0] < -72800.75 * 1.3, "room below the deepest loss for its label");
  assert.deepEqual(niceAxis([0, 0]), { domain: [0, 1], ticks: [0, 1] });
});

test("material groups are named the short way", async () => {
  const { materialName } = await import("../src/lib/overview-trend.ts");
  assert.equal(materialName("PURCHASE - B.M FABRIC"), "B.M Fabric");
  assert.equal(materialName("PURCHASES - PLYWOOD"), "Plywood");
  assert.equal(materialName("B.FILLER"), "B.FILLER");
});

test("profit charts: the month's % of sales sits under its name, never on a short bar's amount", () => {
  const ui = read("src/pages/accounting/overview-tab.tsx");
  assert.match(ui, /<XAxis dataKey="label" tick=\{pctTick\(pctKey\)\} height=\{34\} interval=\{0\}/);
  assert.match(ui, /<Line yAxisId="pct" type="monotone" dataKey=\{pctKey\} [^>]*connectNulls \/>/, "the line keeps the trend, without labels");
  assert.match(ui, /<LabelList dataKey=\{key\} position="insideBottom" formatter=\{compactLabel\}/, "the amount by the zero line");
});
