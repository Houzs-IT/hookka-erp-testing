// ---------------------------------------------------------------------------
// Procurement › Reports — pure rules for the two read-only reports
// (cross-system review pass 2, H2-5 / H2-6; Houzs #5076 / #5089 / #5091).
//
//   * Outstanding PO lines — every line of an open PO with something still to
//     come, layered by how late it is against the PO's expected date.
//   * Supplier delay score — one 0–100 number per supplier on the last 90 days.
//
// Shared by the API route (src/api/routes/procurement-reports.ts) and tested
// directly (tests/procurement-reports.test.mjs). Nothing here writes; nothing
// here changes how a PO, stock or a bill is computed.
//
// WHAT "STILL TO COME" MEANS IN HOOKKA. The office bills most POs straight from
// the PO without a GRN, so `received_qty` stays 0 on goods that arrived long
// ago (HK-0114, src/api/lib/po-delivered.ts). A line is therefore covered by
// max(received, invoiced) — the same rule the PO list's Overdue widget uses. A
// bill is matched to a PO by material code, then PO line, then (code-less legacy
// lines) material name, into one bucket per PO; when a bucket is covered every
// line in it is covered (so this list agrees with the widget), otherwise the
// bucket's invoiced quantity is handed to its lines in line order.
//
// THE DUE DATE. Hookka stores one expected date per PO (`purchase_orders.
// expected_date`); PO lines carry none. Every line of a PO is due that day.
// ---------------------------------------------------------------------------

export const OPEN_PO_STATUSES = ["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"] as const;
export const SCORE_WINDOW_DAYS = 90;

/** Days-late layers, worst first. `none` = the PO has no expected date. */
export const LATE_BUCKETS = [
  { key: "over30", label: "Over 30 days late" },
  { key: "d15to30", label: "15–30 days late" },
  { key: "d8to14", label: "8–14 days late" },
  { key: "d4to7", label: "4–7 days late" },
  { key: "d1to3", label: "1–3 days late" },
  { key: "notDue", label: "Not yet due" },
  { key: "none", label: "No expected date" },
] as const;
export type LateBucketKey = (typeof LATE_BUCKETS)[number]["key"];

export function lateBucket(daysLate: number | null): LateBucketKey {
  if (daysLate == null) return "none";
  if (daysLate > 30) return "over30";
  if (daysLate >= 15) return "d15to30";
  if (daysLate >= 8) return "d8to14";
  if (daysLate >= 4) return "d4to7";
  if (daysLate >= 1) return "d1to3";
  return "notDue";
}

export function lateBucketLabel(key: LateBucketKey): string {
  return LATE_BUCKETS.find((b) => b.key === key)?.label ?? key;
}

/** YYYY-MM-DD from a TEXT date column (or a Date), else null. */
export function ymd(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** `today` minus (n − 1) days — the first day of an n-day window ending today. */
export function windowStart(today: string, days = SCORE_WINDOW_DAYS): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Days late on `today` for a line due `expected`: null without a date, ≤ 0 when not yet due. */
export function daysLateOn(expected: string | null, today: string): number | null {
  return expected ? daysBetween(expected, today) : null;
}

// ── Coverage (received OR invoiced) ─────────────────────────────────────────

export interface PoLineInput {
  poId: string;
  lineId: string;
  lineNo: number;
  materialCode: string | null;
  materialName: string | null;
  quantity: number;
  receivedQty: number;
}

export interface PoInvoicedInput {
  poId: string;
  poItemId: string | null;
  materialCode: string | null;
  materialName: string | null;
  qty: number;
  /** Latest bill date of this group (YYYY-MM-DD), when known. */
  lastDate?: string | null;
}

export interface LineCoverage {
  covered: number;
  /** Quantity of the line covered by bills (not by GRNs). */
  invoicedPart: number;
  /** Latest bill date of the line's bucket, when bills contributed. */
  invoicedDate: string | null;
}

const nameKey = (n: string | null | undefined) => String(n ?? "").trim().toUpperCase();

/**
 * Per-line covered quantity, keyed by lineId. Same buckets as
 * `poIdsDeliveredInFull` (src/api/lib/po-delivered.ts).
 */
export function coverPoLines(lines: PoLineInput[], invoiced: PoInvoicedInput[]): Map<string, LineCoverage> {
  type Bucket = { lines: PoLineInput[]; ordered: number; received: number; invoiced: number; lastDate: string | null };
  type Po = { buckets: Map<string, Bucket>; byItemId: Map<string, string>; byCode: Map<string, string>; byName: Map<string, string> };
  const perPo = new Map<string, Po>();
  for (const l of lines) {
    let po = perPo.get(l.poId);
    if (!po) {
      po = { buckets: new Map(), byItemId: new Map(), byCode: new Map(), byName: new Map() };
      perPo.set(l.poId, po);
    }
    const code = l.materialCode ? String(l.materialCode) : "";
    const name = code ? "" : nameKey(l.materialName);
    const key = code ? `code:${code}` : name ? `name:${name}` : `item:${l.lineId}`;
    po.byItemId.set(String(l.lineId), key);
    if (code) po.byCode.set(code, key);
    if (name) po.byName.set(name, key);
    const b = po.buckets.get(key) ?? { lines: [], ordered: 0, received: 0, invoiced: 0, lastDate: null };
    b.lines.push(l);
    b.ordered += Number(l.quantity) || 0;
    b.received += Number(l.receivedQty) || 0;
    po.buckets.set(key, b);
  }
  for (const row of invoiced) {
    const po = perPo.get(row.poId);
    if (!po) continue;
    const key =
      (row.materialCode ? po.byCode.get(String(row.materialCode)) : undefined) ??
      (row.poItemId ? po.byItemId.get(String(row.poItemId)) : undefined) ??
      (!row.materialCode && row.materialName ? po.byName.get(nameKey(row.materialName)) : undefined);
    if (!key) continue;
    const b = po.buckets.get(key)!;
    b.invoiced += Number(row.qty) || 0;
    const d = ymd(row.lastDate);
    if (d && (!b.lastDate || d > b.lastDate)) b.lastDate = d;
  }
  const out = new Map<string, LineCoverage>();
  for (const po of perPo.values()) {
    for (const b of po.buckets.values()) {
      const bucketDone = Math.max(b.received, b.invoiced) >= b.ordered;
      let invLeft = b.invoiced;
      const ordered = [...b.lines].sort((x, y) => (x.lineNo || 0) - (y.lineNo || 0));
      for (const l of ordered) {
        const qty = Number(l.quantity) || 0;
        const recv = Number(l.receivedQty) || 0;
        const inv = Math.max(0, Math.min(qty, invLeft));
        invLeft -= inv;
        const covered = bucketDone ? qty : Math.min(qty, Math.max(recv, inv));
        const invoicedPart = recv >= qty ? 0 : Math.max(0, covered - recv);
        out.set(String(l.lineId), { covered, invoicedPart, invoicedDate: invoicedPart > 0 ? b.lastDate : null });
      }
    }
  }
  return out;
}

// ── Outstanding PO lines ────────────────────────────────────────────────────

export interface ReportLineInput extends PoLineInput {
  poNo: string;
  poStatus: string;
  supplierId: string | null;
  supplierName: string | null;
  category: string | null;
  supplierSku: string | null;
  unit: string | null;
  orderDate: string | null;
  expectedDate: string | null;
  receivedDate: string | null;
  /** Rate in sen (may carry 4 decimals of sen). */
  unitPriceSen: number;
}

export interface OutstandingLine {
  key: string;
  poId: string;
  poNo: string;
  lineNo: number;
  supplierId: string | null;
  supplierName: string;
  category: string;
  materialCode: string;
  materialName: string;
  supplierSku: string;
  unit: string;
  orderDate: string | null;
  expectedDate: string | null;
  ordered: number;
  covered: number;
  outstanding: number;
  daysLate: number | null;
  bucket: LateBucketKey;
  /** Outstanding × unit price, integer sen. Null when amounts are withheld. */
  outstandingSen: number | null;
}

/** Qty arithmetic on 3-decimal quantities without float dust. */
const q3 = (n: number) => Math.round(n * 1000) / 1000;

export function outstandingLines(
  lines: ReportLineInput[],
  coverage: Map<string, LineCoverage>,
  today: string,
  opts: { withAmounts: boolean },
): OutstandingLine[] {
  const open = new Set<string>(OPEN_PO_STATUSES);
  const out: OutstandingLine[] = [];
  for (const l of lines) {
    if (!open.has(String(l.poStatus))) continue;
    const ordered = Number(l.quantity) || 0;
    const covered = coverage.get(String(l.lineId))?.covered ?? (Number(l.receivedQty) || 0);
    const outstanding = q3(ordered - covered);
    if (!(outstanding > 0)) continue;
    const expected = ymd(l.expectedDate);
    const daysLate = daysLateOn(expected, today);
    out.push({
      key: String(l.lineId),
      poId: l.poId,
      poNo: l.poNo,
      lineNo: Number(l.lineNo) || 0,
      supplierId: l.supplierId,
      supplierName: l.supplierName || "—",
      category: l.category || "Uncategorised",
      materialCode: l.materialCode || "",
      materialName: l.materialName || "",
      supplierSku: l.supplierSku || "",
      unit: l.unit || "",
      orderDate: ymd(l.orderDate),
      expectedDate: expected,
      ordered,
      covered,
      outstanding,
      daysLate: daysLate != null && daysLate > 0 ? daysLate : daysLate == null ? null : 0,
      bucket: lateBucket(daysLate),
      outstandingSen: opts.withAmounts ? Math.round(outstanding * (Number(l.unitPriceSen) || 0)) : null,
    });
  }
  return out.sort(
    (a, b) => (b.daysLate ?? -1) - (a.daysLate ?? -1) || a.poNo.localeCompare(b.poNo) || a.lineNo - b.lineNo,
  );
}

/** Count + value per layer, in LATE_BUCKETS order (empty layers kept, count 0). */
export function bucketSummary(rows: OutstandingLine[]) {
  return LATE_BUCKETS.map((b) => {
    const inB = rows.filter((r) => r.bucket === b.key);
    return {
      key: b.key,
      label: b.label,
      lines: inB.length,
      sen: inB.some((r) => r.outstandingSen != null) ? inB.reduce((t, r) => t + (r.outstandingSen ?? 0), 0) : null,
    };
  });
}

// ── Supplier delay score ────────────────────────────────────────────────────

/** Weights (Houzs #5089): a part with no data is left out and the rest re-weighted. */
export const SCORE_WEIGHTS = { onTime: 40, lateness: 20, overdueShare: 30, quality: 10 } as const;
/** Average days late at which the lateness part reaches 0. */
export const LATENESS_ZERO_DAYS = 10;
/** Quality cases per 100 received lines at which the quality part reaches 0. */
export const QUALITY_ZERO_PER_100 = 20;
/** Fewer received lines than this → the score is shown greyed ("few receipts"). */
export const FEW_RECEIPTS = 10;

export interface ScoreParts {
  /** 0–1 share of received lines that arrived on or before the due date. */
  onTimeRate: number | null;
  /** Average days late over the lines that arrived late. */
  avgDaysLate: number | null;
  /** 0–1 share of the still-to-come value (or qty) that is already overdue. */
  overdueShare: number | null;
  /** Quality cases per 100 received lines. */
  qualityPer100: number | null;
}

/** Weighted 0–100 score; null when no part has data. */
export function delayScore(p: ScoreParts): number | null {
  const parts: Array<[number, number]> = [];
  if (p.onTimeRate != null) parts.push([SCORE_WEIGHTS.onTime, clamp01(p.onTimeRate)]);
  if (p.avgDaysLate != null) parts.push([SCORE_WEIGHTS.lateness, clamp01(1 - p.avgDaysLate / LATENESS_ZERO_DAYS)]);
  if (p.overdueShare != null) parts.push([SCORE_WEIGHTS.overdueShare, clamp01(1 - p.overdueShare)]);
  if (p.qualityPer100 != null) parts.push([SCORE_WEIGHTS.quality, clamp01(1 - p.qualityPer100 / QUALITY_ZERO_PER_100)]);
  const w = parts.reduce((t, [wt]) => t + wt, 0);
  if (w === 0) return null;
  return Math.round((parts.reduce((t, [wt, v]) => t + wt * v, 0) / w) * 100);
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export interface QualityCaseInput {
  supplierId: string | null;
  /** YYYY-MM-DD the case was raised (GRN receive date / return date). */
  date: string | null;
  /** Dedupe key: a return of a rejected GRN line is the same case. */
  caseKey: string;
}

export interface SupplierScoreRow {
  supplierId: string;
  supplierName: string;
  score: number | null;
  fewReceipts: boolean;
  linesReceived: number;
  linesOnTime: number;
  onTimePct: number | null;
  avgDaysLate: number | null;
  overdueLines: number;
  outstandingLines: number;
  overdueSharePct: number | null;
  overdueSen: number | null;
  overdueRmDays: number | null;
  qualityCases: number | null;
  qualityPer100: number | null;
}

/**
 * One row per supplier. `lines` = PO lines (any status but DRAFT / CANCELLED);
 * received lines count when their PO is due inside the window; the overdue
 * parts read what is outstanding today; quality cases inside the window.
 * `quality === null` means no quality source → that weight is left out.
 */
export function supplierScores(args: {
  lines: ReportLineInput[];
  coverage: Map<string, LineCoverage>;
  /** Latest GRN receive date per PO line id. */
  grnDateByLine: Map<string, string>;
  quality: QualityCaseInput[] | null;
  today: string;
  withAmounts: boolean;
}): SupplierScoreRow[] {
  const { lines, coverage, grnDateByLine, quality, today, withAmounts } = args;
  const from = windowStart(today);
  type Acc = {
    name: string;
    received: number;
    onTime: number;
    lateDays: number;
    lateCount: number;
    outstandingVal: number;
    overdueVal: number;
    outstandingQty: number;
    overdueQty: number;
    outstandingLines: number;
    overdueLines: number;
    rmDaysSen: number;
  };
  const acc = new Map<string, Acc>();
  const get = (id: string, name: string | null) => {
    let a = acc.get(id);
    if (!a) {
      a = { name: name || "—", received: 0, onTime: 0, lateDays: 0, lateCount: 0, outstandingVal: 0, overdueVal: 0, outstandingQty: 0, overdueQty: 0, outstandingLines: 0, overdueLines: 0, rmDaysSen: 0 };
      acc.set(id, a);
    }
    if (a.name === "—" && name) a.name = name;
    return a;
  };

  for (const r of outstandingLines(lines, coverage, today, { withAmounts: true })) {
    if (!r.supplierId) continue;
    const a = get(r.supplierId, r.supplierName);
    a.outstandingLines += 1;
    a.outstandingQty += r.outstanding;
    a.outstandingVal += r.outstandingSen ?? 0;
    if ((r.daysLate ?? 0) > 0) {
      a.overdueLines += 1;
      a.overdueQty += r.outstanding;
      a.overdueVal += r.outstandingSen ?? 0;
      a.rmDaysSen += (r.outstandingSen ?? 0) * (r.daysLate ?? 0);
    }
  }

  for (const l of lines) {
    if (!l.supplierId) continue;
    const expected = ymd(l.expectedDate);
    if (!expected || expected < from || expected > today) continue;
    const qty = Number(l.quantity) || 0;
    const cov = coverage.get(String(l.lineId));
    if (!cov || cov.covered < qty || qty <= 0) continue;
    const grnCovered = (Number(l.receivedQty) || 0) >= qty;
    const arrived = (grnCovered ? grnDateByLine.get(String(l.lineId)) : cov.invoicedDate) ?? ymd(l.receivedDate);
    if (!arrived) continue;
    const a = get(l.supplierId, l.supplierName);
    a.received += 1;
    const late = daysBetween(expected, arrived);
    if (late <= 0) a.onTime += 1;
    else {
      a.lateCount += 1;
      a.lateDays += late;
    }
  }

  const cases = new Map<string, Set<string>>();
  if (quality) {
    for (const qc of quality) {
      const d = ymd(qc.date);
      if (!qc.supplierId || !d || d < from || d > today) continue;
      const s = cases.get(qc.supplierId) ?? new Set<string>();
      s.add(qc.caseKey);
      cases.set(qc.supplierId, s);
    }
    // A supplier with cases but no PO lines still shows up.
    for (const id of cases.keys()) get(id, null);
  }

  const rows: SupplierScoreRow[] = [];
  for (const [supplierId, a] of acc) {
    const onTimeRate = a.received > 0 ? a.onTime / a.received : null;
    const avgDaysLate = a.received > 0 ? (a.lateCount > 0 ? a.lateDays / a.lateCount : 0) : null;
    const share =
      a.outstandingVal > 0 ? a.overdueVal / a.outstandingVal : a.outstandingQty > 0 ? a.overdueQty / a.outstandingQty : null;
    const nCases = quality ? cases.get(supplierId)?.size ?? 0 : null;
    const qualityPer100 = nCases != null && a.received > 0 ? (nCases / a.received) * 100 : null;
    if (a.received === 0 && a.outstandingLines === 0 && !nCases) continue;
    rows.push({
      supplierId,
      supplierName: a.name,
      score: delayScore({ onTimeRate, avgDaysLate, overdueShare: share, qualityPer100 }),
      fewReceipts: a.received < FEW_RECEIPTS,
      linesReceived: a.received,
      linesOnTime: a.onTime,
      onTimePct: onTimeRate == null ? null : Math.round(onTimeRate * 1000) / 10,
      avgDaysLate: avgDaysLate == null ? null : Math.round(avgDaysLate * 10) / 10,
      overdueLines: a.overdueLines,
      outstandingLines: a.outstandingLines,
      overdueSharePct: share == null ? null : Math.round(share * 1000) / 10,
      overdueSen: withAmounts ? a.overdueVal : null,
      // RM × days: sen·days / 100 → RM·days, rounded to whole RM·days.
      overdueRmDays: withAmounts ? Math.round(a.rmDaysSen / 100) : null,
      qualityCases: nCases,
      qualityPer100: qualityPer100 == null ? null : Math.round(qualityPer100 * 10) / 10,
    });
  }
  // Worst first: lowest score, then most overdue RM × days; unscored last.
  return rows.sort(
    (x, y) =>
      (x.score ?? 101) - (y.score ?? 101) ||
      (y.overdueRmDays ?? 0) - (x.overdueRmDays ?? 0) ||
      y.overdueLines - x.overdueLines ||
      x.supplierName.localeCompare(y.supplierName),
  );
}
