// ---------------------------------------------------------------------------
// Procurement › Reports (cross-system review pass 2, H2-5 / H2-6). Read-only.
//
//   ?tab=delay  Supplier delay score — 0–100 per supplier on the last 90 days,
//               worst first; a click opens that supplier's late lines.
//   ?tab=lines  Outstanding PO lines — every line still to come, layered by
//               days late against the PO's expected date, grouped by supplier
//               or category, exported through the shared grid.
//
// Data: GET /api/procurement-reports/{supplier-delay,outstanding-lines}
// (purchase-orders:read). Rules: src/lib/procurement-reports.ts.
// ---------------------------------------------------------------------------
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { KpiCards } from "@/components/finance/report-shell";
import { SegmentedChips } from "@/components/finance/segmented-chips";
import { useCachedJson } from "@/lib/cached-fetch";
import { listLoadError } from "@/lib/list-load-error";
import { useUrlState } from "@/lib/use-url-state";
import { formatCurrency } from "@/lib/utils";
import {
  FEW_RECEIPTS,
  LATE_BUCKETS,
  SCORE_WEIGHTS,
  lateBucketLabel,
  type LateBucketKey,
  type OutstandingLine,
  type SupplierScoreRow,
} from "@/lib/procurement-reports";

type Tab = "delay" | "lines";
type Layer = "all" | "late" | LateBucketKey;
type Group = "none" | "supplierName" | "category";

type LinesResp = { success?: boolean; error?: string; data?: OutstandingLine[]; today?: string };
type DelayResp = { success?: boolean; error?: string; data?: SupplierScoreRow[]; today?: string; from?: string; qualityIncluded?: boolean };

const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-MY") : n.toLocaleString("en-MY", { maximumFractionDigits: 3 }));
const dash = <span className="text-[#C4BDB3]">—</span>;

/** Red under 60, amber under 80, green otherwise (Houzs #5089). */
function scoreTone(score: number | null): string {
  if (score == null) return "bg-[#F3F4F6] text-[#6B7280]";
  if (score < 60) return "bg-[#F9E1DC] text-[#9A3A2D]";
  if (score < 80) return "bg-[#FBF0D9] text-[#7A5B12]";
  return "bg-[#E7F0E3] text-[#27500A]";
}

const BUCKET_TONE: Record<LateBucketKey, string> = {
  over30: "bg-[#F9E1DC] text-[#9A3A2D]",
  d15to30: "bg-[#FBE7DA] text-[#9A4A1D]",
  d8to14: "bg-[#FBF0D9] text-[#7A5B12]",
  d4to7: "bg-[#FDF6E3] text-[#7A6512]",
  d1to3: "bg-[#F4F1E8] text-[#6B5C32]",
  notDue: "bg-[#E7F0E3] text-[#27500A]",
  none: "bg-[#F3F4F6] text-[#6B7280]",
};

export default function ProcurementReportsPage() {
  const [tab, setTab] = useUrlState<string>("tab", "delay");
  const active: Tab = tab === "lines" ? "lines" : "delay";
  return (
    <div className="space-y-4" data-procurement-reports>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#1F1D1B]">Procurement Reports</h1>
          <p className="text-xs text-[#6B7280]">Which suppliers deliver late, and every PO line still to come. Read-only.</p>
        </div>
        <SegmentedChips<Tab>
          options={[
            { key: "delay", label: "Supplier delay score" },
            { key: "lines", label: "Outstanding PO lines" },
          ]}
          value={active}
          onChange={(k) => setTab(k)}
        />
      </div>
      {active === "delay" ? <SupplierDelayTab /> : <OutstandingLinesTab />}
    </div>
  );
}

// ── H2-5 Supplier delay score ───────────────────────────────────────────────

function SupplierDelayTab() {
  const navigate = useNavigate();
  const { data: resp, loading, error, refresh } = useCachedJson<DelayResp>("/api/procurement-reports/supplier-delay", 300);
  const rows = useMemo(() => (resp?.success ? resp.data ?? [] : []), [resp]);
  const qualityIncluded = resp?.qualityIncluded !== false;

  // A click opens the Outstanding PO lines tab on this supplier's late lines.
  const openLate = (r: SupplierScoreRow) =>
    navigate(`/procurement/reports?tab=lines&supplier=${encodeURIComponent(r.supplierId)}&layer=late`);

  const columns = useMemo<Column<SupplierScoreRow>[]>(() => [
    {
      key: "score", label: "Score", width: "90px", align: "center", type: "number",
      sortAccessor: (r) => r.score ?? 101,
      exportValue: (r) => r.score,
      render: (_v, r) => (
        <span
          className={`inline-flex min-w-[42px] justify-center rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ${scoreTone(r.score)} ${r.fewReceipts ? "opacity-50" : ""}`}
          title={r.fewReceipts ? `Fewer than ${FEW_RECEIPTS} lines received in 90 days — read with care` : undefined}
        >
          {r.score ?? "—"}
        </span>
      ),
    },
    {
      key: "supplierName", label: "Supplier", width: "240px", noFilter: true,
      render: (_v, r, _i, hl) => <span className="text-[#3E6570] underline-offset-2 hover:underline">{hl(r.supplierName)}</span>,
    },
    { key: "onTimePct", label: "On time %", width: "100px", align: "right", type: "number", render: (_v, r) => (r.onTimePct == null ? dash : `${r.onTimePct}%`) },
    { key: "avgDaysLate", label: "Avg days late", width: "110px", align: "right", type: "number", render: (_v, r) => (r.avgDaysLate == null ? dash : r.avgDaysLate) },
    { key: "overdueLines", label: "Overdue lines", width: "110px", align: "right", type: "number", total: "sum" },
    { key: "overdueSen", label: "Overdue now", width: "130px", align: "right", type: "currency", total: "sum", render: (_v, r) => (r.overdueSen == null ? dash : r.overdueSen ? formatCurrency(r.overdueSen) : dash) },
    { key: "overdueSharePct", label: "Overdue share", width: "115px", align: "right", type: "number", render: (_v, r) => (r.overdueSharePct == null ? dash : `${r.overdueSharePct}%`) },
    {
      key: "overdueRmDays", label: "Overdue RM × days", width: "140px", align: "right", type: "number", total: "sum",
      render: (_v, r) => (r.overdueRmDays == null ? dash : r.overdueRmDays ? <span className="tabular-nums">{r.overdueRmDays.toLocaleString("en-MY")}</span> : dash),
    },
    ...(qualityIncluded
      ? [
          { key: "qualityCases", label: "Quality cases", width: "110px", align: "right" as const, type: "number" as const, total: "sum" as const },
          { key: "qualityPer100", label: "Cases / 100 lines", width: "130px", align: "right" as const, type: "number" as const, render: (_v: unknown, r: SupplierScoreRow) => (r.qualityPer100 == null ? dash : r.qualityPer100) },
        ]
      : []),
    { key: "linesReceived", label: "Lines received", width: "115px", align: "right", type: "number", total: "sum" },
    { key: "outstandingLines", label: "Lines outstanding", width: "130px", align: "right", type: "number", total: "sum", defaultHidden: true },
  ], [qualityIncluded]);

  const scored = rows.filter((r) => r.score != null);
  const red = scored.filter((r) => (r.score ?? 100) < 60).length;
  const overdueSen = rows.reduce((t, r) => t + (r.overdueSen ?? 0), 0);
  const rmDays = rows.reduce((t, r) => t + (r.overdueRmDays ?? 0), 0);
  const weights = qualityIncluded
    ? `on time ${SCORE_WEIGHTS.onTime}% · how late ${SCORE_WEIGHTS.lateness}% · overdue share ${SCORE_WEIGHTS.overdueShare}% · quality cases ${SCORE_WEIGHTS.quality}%`
    : `on time ${SCORE_WEIGHTS.onTime}% · how late ${SCORE_WEIGHTS.lateness}% · overdue share ${SCORE_WEIGHTS.overdueShare}% (quality could not be read and is left out)`;

  return (
    <div className="space-y-4" data-report="supplier-delay">
      <KpiCards
        items={[
          { label: "Suppliers scored", value: loading && !resp ? "—" : String(scored.length), note: resp?.from ? `${resp.from} to ${resp.today}` : "last 90 days" },
          { label: "Under 60", value: loading && !resp ? "—" : String(red), tone: red ? "err" : "ok", note: "red: deliver late most" },
          { label: "Overdue now", value: loading && !resp ? "—" : formatCurrency(overdueSen), tone: overdueSen ? "warn" : "ink", note: "outstanding value past its due date" },
          { label: "Overdue RM × days", value: loading && !resp ? "—" : rmDays.toLocaleString("en-MY"), note: "value late × days late" },
        ]}
      />
      <Card>
        <CardContent className="p-0">
          <DataGrid
            columns={columns}
            data={rows}
            keyField="supplierId"
            gridId="procurement-supplier-delay"
            loading={loading && !resp}
            error={listLoadError(resp, error)}
            onRetry={refresh}
            onRowClick={openLate}
            rowClassName={(r) => (r.fewReceipts ? "text-[#9CA3AF]" : "")}
            emptyMessage="No supplier has PO lines due in the last 90 days or still outstanding."
            exportName="Supplier Delay Score"
            exportSheetLabel="Supplier delay"
            stickyHeader
            maxHeight="calc(100vh - 340px)"
          />
        </CardContent>
      </Card>
      <p className="text-[12px] leading-relaxed text-[#9CA3AF]" data-score-notes>
        Score 0–100, worst first: {weights}. A part with no data is left out and the rest re-weighted. "How late" reaches 0 at
        an average of 10 days late; quality reaches 0 at 20 cases per 100 lines received. Received lines are those of POs due
        in the last 90 days; a line counts as received when a GRN or a confirmed purchase invoice covers it, on the GRN date
        or — billed without a GRN — the invoice date, which can be later than the real delivery. Quality cases are GRN lines
        with a rejected quantity and purchase-return lines (service cases name no supplier, so they are not counted). Greyed:
        fewer than {FEW_RECEIPTS} lines received. Click a supplier to open its late lines.
      </p>
    </div>
  );
}

// ── H2-6 Outstanding PO lines ───────────────────────────────────────────────

function OutstandingLinesTab() {
  const navigate = useNavigate();
  const { data: resp, loading, error, refresh } = useCachedJson<LinesResp>("/api/procurement-reports/outstanding-lines", 120);
  const all = useMemo(() => (resp?.success ? resp.data ?? [] : []), [resp]);
  const [layerRaw, setLayer] = useUrlState<string>("layer", "all");
  const [supplier, setSupplier] = useUrlState<string>("supplier", "");
  const [groupRaw, setGroup] = useUrlState<string>("group", "none");
  const layer = (["all", "late", ...LATE_BUCKETS.map((b) => b.key)] as string[]).includes(layerRaw) ? (layerRaw as Layer) : "all";
  const group: Group = groupRaw === "supplierName" || groupRaw === "category" ? groupRaw : "none";

  const forSupplier = useMemo(() => (supplier ? all.filter((r) => r.supplierId === supplier) : all), [all, supplier]);
  const shown = useMemo(
    () =>
      forSupplier.filter((r) =>
        layer === "all" ? true : layer === "late" ? (r.daysLate ?? 0) > 0 : r.bucket === layer,
      ),
    [forSupplier, layer],
  );
  const supplierName = supplier ? forSupplier[0]?.supplierName ?? all.find((r) => r.supplierId === supplier)?.supplierName ?? "this supplier" : "";

  const columns = useMemo<Column<OutstandingLine>[]>(() => [
    {
      key: "bucket", label: "Layer", width: "140px",
      sortAccessor: (r) => r.daysLate ?? -1,
      filterAccessor: (r) => lateBucketLabel(r.bucket),
      exportValue: (r) => lateBucketLabel(r.bucket),
      render: (_v, r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${BUCKET_TONE[r.bucket]}`}>{lateBucketLabel(r.bucket)}</span>,
    },
    { key: "daysLate", label: "Days late", width: "90px", align: "right", type: "number", render: (_v, r) => (r.daysLate == null ? dash : r.daysLate > 0 ? <span className="font-semibold tabular-nums text-[#9A3A2D]">{r.daysLate}</span> : "0") },
    { key: "poNo", label: "PO No.", width: "130px", type: "docno", noFilter: true },
    { key: "supplierName", label: "Supplier", width: "200px" },
    { key: "category", label: "Category", width: "130px" },
    { key: "materialCode", label: "Item Code", width: "150px", noFilter: true, render: (_v, r, _i, hl) => <span className="font-mono text-xs">{hl(r.materialCode || "—")}</span> },
    { key: "materialName", label: "Description", width: "240px", noFilter: true },
    { key: "supplierSku", label: "Supplier SKU", width: "130px", noFilter: true, defaultHidden: true },
    { key: "orderDate", label: "PO Date", width: "105px", type: "date", defaultHidden: true },
    { key: "expectedDate", label: "Expected", width: "105px", type: "date" },
    { key: "ordered", label: "Ordered", width: "90px", align: "right", type: "number", render: (_v, r) => fmtNum(r.ordered) },
    { key: "covered", label: "Received / billed", width: "120px", align: "right", type: "number", render: (_v, r) => fmtNum(r.covered) },
    { key: "outstanding", label: "Outstanding", width: "100px", align: "right", type: "number", total: "sum", render: (_v, r) => <span className="font-semibold tabular-nums">{fmtNum(r.outstanding)}</span> },
    { key: "unit", label: "UOM", width: "70px" },
    { key: "outstandingSen", label: "Outstanding RM", width: "130px", align: "right", type: "currency", total: "sum", render: (_v, r) => (r.outstandingSen == null ? dash : formatCurrency(r.outstandingSen)) },
  ], []);

  const count = (k: Layer) =>
    forSupplier.filter((r) => (k === "all" ? true : k === "late" ? (r.daysLate ?? 0) > 0 : r.bucket === k)).length;
  const lateRows = forSupplier.filter((r) => (r.daysLate ?? 0) > 0);
  const lateSen = lateRows.reduce((t, r) => t + (r.outstandingSen ?? 0), 0);
  const allSen = forSupplier.reduce((t, r) => t + (r.outstandingSen ?? 0), 0);
  const wait = loading && !resp;

  return (
    <div className="space-y-4" data-report="outstanding-lines">
      <KpiCards
        items={[
          { label: "Lines outstanding", value: wait ? "—" : String(forSupplier.length), note: wait ? "" : formatCurrency(allSen) },
          { label: "Overdue lines", value: wait ? "—" : String(lateRows.length), tone: lateRows.length ? "err" : "ok", note: wait ? "" : formatCurrency(lateSen) },
          { label: "Over 30 days late", value: wait ? "—" : String(count("over30")), tone: count("over30") ? "err" : "ink", note: "worst layer" },
          { label: "Not yet due", value: wait ? "—" : String(count("notDue")), note: resp?.today ? `as of ${resp.today}` : "" },
        ]}
      />
      {supplier && (
        <div className="flex items-center gap-2 text-[13px] text-[#374151]" data-supplier-filter>
          <span>
            Showing <b>{supplierName}</b> only.
          </span>
          <button type="button" className="text-[#3E6570] underline" onClick={() => setSupplier("")}>
            Show every supplier
          </button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <DataGrid
            columns={columns}
            data={shown}
            keyField="key"
            gridId="procurement-outstanding-po-lines"
            loading={wait}
            error={listLoadError(resp, error)}
            onRetry={refresh}
            groupBy={group === "none" ? undefined : group}
            onDoubleClick={(r) => navigate(`/procurement/${encodeURIComponent(r.poId)}`)}
            contextMenuItems={() => [{ label: "Open PO", action: (r: OutstandingLine) => navigate(`/procurement/${encodeURIComponent(r.poId)}`) }]}
            emptyMessage={layer === "all" ? "No PO line is waiting for goods." : "No line in this layer."}
            exportName="Outstanding PO Lines"
            exportSheetLabel="Outstanding PO lines"
            stickyHeader
            virtualize
            maxHeight="calc(100vh - 360px)"
            toolbarStart={
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedChips<Layer>
                  options={[
                    { key: "all", label: "All", count: count("all") },
                    { key: "late", label: "Overdue", count: count("late") },
                    ...LATE_BUCKETS.filter((b) => count(b.key) > 0).map((b) => ({ key: b.key as Layer, label: b.label.replace(" days late", "d late"), count: count(b.key) })),
                  ]}
                  value={layer}
                  onChange={(k) => setLayer(k)}
                />
                <SegmentedChips<Group>
                  options={[
                    { key: "none", label: "No grouping" },
                    { key: "supplierName", label: "By supplier" },
                    { key: "category", label: "By category" },
                  ]}
                  value={group}
                  onChange={(k) => setGroup(k)}
                />
              </div>
            }
          />
        </CardContent>
      </Card>
      <p className="text-[12px] leading-relaxed text-[#9CA3AF]" data-lines-notes>
        Every line of a submitted / confirmed / partly received PO with quantity still to come. A line is covered by what a
        GRN received or a confirmed purchase invoice billed, whichever is more (most POs are billed without a GRN). Days late
        count from the PO's expected date — Hookka keeps one expected date per PO, not per line. Double-click a line to open
        its PO.
      </p>
    </div>
  );
}
