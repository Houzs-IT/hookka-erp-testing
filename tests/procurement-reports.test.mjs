// Procurement › Reports (cross-system review pass 2, H2-5 supplier delay score,
// H2-6 outstanding PO lines ageing). Pure rules exercised directly; the route,
// page and menu wiring pinned by source pattern (house style for UI).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  lateBucket,
  windowStart,
  coverPoLines,
  outstandingLines,
  bucketSummary,
  delayScore,
  supplierScores,
  LATE_BUCKETS,
} from "../src/lib/procurement-reports.ts";
import { poIdsDeliveredInFull } from "../src/api/lib/po-delivered.ts";

const read = (p) => readFileSync(p, "utf8");
const TODAY = "2026-11-10";

const line = (o) => ({
  poId: "po1", poNo: "PO-2611-001", poStatus: "CONFIRMED", supplierId: "s1", supplierName: "Alpha",
  lineId: "l1", lineNo: 1, materialCode: "RM-1", materialName: "Foam", category: "FOAM", supplierSku: "",
  unit: "PCS", orderDate: "2026-10-01", expectedDate: "2026-11-01", receivedDate: null,
  quantity: 10, receivedQty: 0, unitPriceSen: 1250, ...o,
});

// ── Layers ────────────────────────────────────────────────────────────────
test("days-late layers: Over 30 / 15–30 / 8–14 / 4–7 / 1–3 / not yet due / no date", () => {
  assert.equal(lateBucket(31), "over30");
  assert.equal(lateBucket(30), "d15to30");
  assert.equal(lateBucket(15), "d15to30");
  assert.equal(lateBucket(14), "d8to14");
  assert.equal(lateBucket(8), "d8to14");
  assert.equal(lateBucket(7), "d4to7");
  assert.equal(lateBucket(4), "d4to7");
  assert.equal(lateBucket(3), "d1to3");
  assert.equal(lateBucket(1), "d1to3");
  assert.equal(lateBucket(0), "notDue");
  assert.equal(lateBucket(-5), "notDue");
  assert.equal(lateBucket(null), "none");
  assert.deepEqual(LATE_BUCKETS.map((b) => b.key), ["over30", "d15to30", "d8to14", "d4to7", "d1to3", "notDue", "none"]);
});

test("the 90-day window ends today and starts 89 days earlier (Malaysian day passed in)", () => {
  assert.equal(windowStart("2026-11-01"), "2026-08-04"); // same as Houzs #5091's cron test
  assert.equal(windowStart(TODAY), "2026-08-13");
});

// ── Coverage = max(received, invoiced), HK-0114 buckets ───────────────────
test("a line billed without a GRN is covered by its invoice; agrees with the PO Overdue widget", () => {
  const lines = [
    line({ lineId: "a", lineNo: 1, materialCode: "RM-1", quantity: 10 }),
    line({ lineId: "b", lineNo: 2, materialCode: "RM-2", quantity: 5, receivedQty: 5 }),
    line({ poId: "po2", lineId: "c", lineNo: 1, materialCode: "RM-1", quantity: 8 }),
  ];
  const invoiced = [
    { poId: "po1", poItemId: null, materialCode: "RM-1", materialName: null, qty: 10, lastDate: "2026-10-30" },
    { poId: "po2", poItemId: "c", materialCode: null, materialName: null, qty: 3, lastDate: "2026-11-02" },
  ];
  const cov = coverPoLines(lines, invoiced);
  assert.equal(cov.get("a").covered, 10);
  assert.equal(cov.get("a").invoicedDate, "2026-10-30");
  assert.equal(cov.get("b").covered, 5);
  assert.equal(cov.get("b").invoicedDate, null);
  assert.equal(cov.get("c").covered, 3);

  // Every PO the widget calls delivered-in-full has no outstanding line here, and vice versa.
  const delivered = poIdsDeliveredInFull(
    lines.map((l) => ({ id: l.lineId, purchaseOrderId: l.poId, materialCode: l.materialCode, materialName: l.materialName, quantity: l.quantity, receivedQty: l.receivedQty })),
    invoiced.map(({ lastDate, ...r }) => r),
  );
  const out = outstandingLines(lines, cov, TODAY, { withAmounts: true });
  const posWithOutstanding = new Set(out.map((r) => r.poId));
  for (const po of ["po1", "po2"]) assert.equal(delivered.has(po), !posWithOutstanding.has(po), po);
});

test("one bucket's invoiced quantity goes to its lines in line order", () => {
  const lines = [
    line({ lineId: "x2", lineNo: 2, materialCode: "RM-9", quantity: 4 }),
    line({ lineId: "x1", lineNo: 1, materialCode: "RM-9", quantity: 6 }),
  ];
  const cov = coverPoLines(lines, [{ poId: "po1", poItemId: null, materialCode: "RM-9", materialName: null, qty: 7 }]);
  assert.equal(cov.get("x1").covered, 6);
  assert.equal(cov.get("x2").covered, 1);
});

// ── Outstanding lines ─────────────────────────────────────────────────────
test("outstanding lines: open POs only, ordered − covered > 0, value in integer sen, worst first", () => {
  const lines = [
    line({ lineId: "late", expectedDate: "2026-10-01", quantity: 3, unitPriceSen: 1234.5678 }),
    line({ lineId: "soon", expectedDate: "2026-11-20", quantity: 2 }),
    line({ lineId: "nodate", expectedDate: null, quantity: 1 }),
    line({ lineId: "done", quantity: 5, receivedQty: 5 }),
    line({ lineId: "draft", poStatus: "DRAFT", quantity: 5 }),
    line({ lineId: "closed", poStatus: "CLOSED", quantity: 5 }),
    line({ lineId: "recvd", poStatus: "RECEIVED", quantity: 5 }),
  ];
  const out = outstandingLines(lines, coverPoLines(lines, []), TODAY, { withAmounts: true });
  assert.deepEqual(out.map((r) => r.key), ["late", "soon", "nodate"]);
  assert.equal(out[0].daysLate, 40);
  assert.equal(out[0].bucket, "over30");
  assert.equal(out[0].outstandingSen, Math.round(3 * 1234.5678));
  assert.ok(Number.isInteger(out[0].outstandingSen));
  assert.equal(out[1].bucket, "notDue");
  assert.equal(out[2].bucket, "none");
  const hidden = outstandingLines(lines, coverPoLines(lines, []), TODAY, { withAmounts: false });
  assert.ok(hidden.every((r) => r.outstandingSen === null));
  const sum = bucketSummary(out);
  assert.equal(sum.find((b) => b.key === "over30").lines, 1);
  assert.equal(sum.find((b) => b.key === "d1to3").lines, 0);
});

// ── Score ─────────────────────────────────────────────────────────────────
test("score weights: on time 40 · how late 20 · overdue share 30 · quality 10; missing parts re-weighted", () => {
  assert.equal(delayScore({ onTimeRate: 1, avgDaysLate: 0, overdueShare: 0, qualityPer100: 0 }), 100);
  assert.equal(delayScore({ onTimeRate: 0, avgDaysLate: 10, overdueShare: 1, qualityPer100: 20 }), 0);
  // 0.5×40 + 0.5×20 + 0.5×30 + 0.5×10 = 50
  assert.equal(delayScore({ onTimeRate: 0.5, avgDaysLate: 5, overdueShare: 0.5, qualityPer100: 10 }), 50);
  // Quality left out → (1×40 + 1×20 + 0×30) / 90 = 66.7
  assert.equal(delayScore({ onTimeRate: 1, avgDaysLate: 0, overdueShare: 1, qualityPer100: null }), 67);
  assert.equal(delayScore({ onTimeRate: null, avgDaysLate: null, overdueShare: null, qualityPer100: null }), null);
  // Past the zero points it floors at 0, never negative.
  assert.equal(delayScore({ onTimeRate: null, avgDaysLate: 25, overdueShare: null, qualityPer100: null }), 0);
});

test("supplier scores: on time by GRN or invoice date, overdue RM × days, quality deduped, worst first", () => {
  const lines = [
    // Alpha: two received lines in the window — one on time (GRN), one 4 days late (invoice) — and one overdue.
    line({ lineId: "a1", expectedDate: "2026-10-10", quantity: 2, receivedQty: 2, poStatus: "RECEIVED" }),
    line({ poId: "pa2", lineId: "a2", expectedDate: "2026-10-10", quantity: 1, poStatus: "CLOSED" }),
    line({ poId: "pa3", lineId: "a3", expectedDate: "2026-11-05", quantity: 2, unitPriceSen: 10000 }),
    // Beta: on time, nothing outstanding.
    line({ poId: "pb1", lineId: "b1", supplierId: "s2", supplierName: "Beta", expectedDate: "2026-10-20", quantity: 1, receivedQty: 1, poStatus: "RECEIVED", receivedDate: "2026-10-19" }),
    // Outside the window: ignored for on-time.
    line({ poId: "pa9", lineId: "a9", expectedDate: "2026-01-01", quantity: 1, receivedQty: 1, poStatus: "RECEIVED", receivedDate: "2026-03-01" }),
  ];
  const invoiced = [{ poId: "pa2", poItemId: null, materialCode: "RM-1", materialName: null, qty: 1, lastDate: "2026-10-14" }];
  const quality = [
    { supplierId: "s1", date: "2026-10-12", caseKey: "grn:77" },
    { supplierId: "s1", date: "2026-10-15", caseKey: "grn:77" }, // a return of the same rejected GRN line
    { supplierId: "s1", date: "2026-01-01", caseKey: "ret:5" }, // outside the window
  ];
  const rows = supplierScores({
    lines,
    coverage: coverPoLines(lines, invoiced),
    grnDateByLine: new Map([["a1", "2026-10-09"]]),
    quality,
    today: TODAY,
    withAmounts: true,
  });
  assert.deepEqual(rows.map((r) => r.supplierName), ["Alpha", "Beta"]);
  const a = rows[0];
  assert.equal(a.linesReceived, 2);
  assert.equal(a.onTimePct, 50);
  assert.equal(a.avgDaysLate, 4);
  assert.equal(a.overdueLines, 1);
  assert.equal(a.overdueSen, 20000);
  assert.equal(a.overdueRmDays, 1000); // RM 200 × 5 days
  assert.equal(a.overdueSharePct, 100);
  assert.equal(a.qualityCases, 1);
  assert.equal(a.qualityPer100, 50);
  assert.equal(a.fewReceipts, true);
  // 0.5×40 + 0.6×20 + 0×30 + 0×10 = 32
  assert.equal(a.score, 32);
  assert.equal(rows[1].score, 100);

  const noQuality = supplierScores({ lines, coverage: coverPoLines(lines, invoiced), grnDateByLine: new Map([["a1", "2026-10-09"]]), quality: null, today: TODAY, withAmounts: false });
  assert.equal(noQuality[0].qualityCases, null);
  assert.equal(noQuality[0].overdueSen, null);
  assert.equal(noQuality[0].overdueRmDays, null);
  // Without quality: (0.5×40 + 0.6×20 + 0×30) / 90 = 35.6
  assert.equal(noQuality[0].score, 36);
});

// ── Wiring ────────────────────────────────────────────────────────────────
test("route: read-only, gated like the PO list, mounted", () => {
  const src = read("src/api/routes/procurement-reports.ts");
  assert.equal((src.match(/requirePermission\(c, "purchase-orders", "read"\)/g) || []).length, 2);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|ALTER)\s/);
  assert.match(src, /app\.get\("\/outstanding-lines"/);
  assert.match(src, /app\.get\("\/supplier-delay"/);
  assert.match(src, /todayYmdMY\(\)/);
  const worker = read("src/api/worker.ts");
  assert.match(worker, /app\.route\("\/api\/procurement-reports", procurementReports\)/);
});

test("route SQL reads only columns that exist in the prod schema snapshot", () => {
  const schema = JSON.parse(read("tests/db-schema.json"));
  const src = read("src/api/routes/procurement-reports.ts");
  const alias = { p: "purchase_orders", poi: "purchase_order_items", pii: "purchase_invoice_items", pi: "purchase_invoices", gi: "grn_items", g: "grns", pri: "purchase_return_items", pr: "purchase_returns" };
  const bad = [];
  for (const m of src.matchAll(/\b(p|poi|pii|pi|gi|g|pri|pr)\.([a-z_]+)\b/g)) {
    const t = alias[m[1]];
    if (!schema[t].includes(m[2])) bad.push(`${t}.${m[2]}`);
  }
  assert.deepEqual(bad, []);
});

test("page: one gridId DataGrid per report, export, click opens late lines, route before :id, menu entry", () => {
  const page = read("src/pages/procurement/reports.tsx");
  assert.match(page, /gridId="procurement-supplier-delay"/);
  assert.match(page, /gridId="procurement-outstanding-po-lines"/);
  assert.match(page, /exportName="Outstanding PO Lines"/);
  assert.match(page, /tab=lines&supplier=\$\{encodeURIComponent\(r\.supplierId\)\}&layer=late/);
  assert.match(page, /groupBy=\{group === "none" \? undefined : group\}/);
  assert.match(page, /error=\{listLoadError\(resp, error\)\}/);
  const routes = read("src/dashboard-routes.tsx");
  assert.ok(routes.indexOf("path: '/procurement/reports'") > 0);
  assert.ok(routes.indexOf("path: '/procurement/reports'") < routes.indexOf("path: '/procurement/:id'"));
  const sidebar = read("src/components/layout/sidebar.tsx");
  assert.match(sidebar, /name: "Procurement Reports", href: "\/procurement\/reports"/);
  assert.match(sidebar, /!pathname\.startsWith\("\/procurement\/reports"\)/);
});
