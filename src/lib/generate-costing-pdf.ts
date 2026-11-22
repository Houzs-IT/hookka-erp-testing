// ---------------------------------------------------------------------------
// Product costing PDFs (owner 2026-11-22, plan D10) — three reports from the
// same costing data the page shows:
//
//   full    Full Costing Report      WIP processes + labour, raw materials +
//                                    prices, totals, fabric tiers, margins
//   spec    Production Spec Sheet    WIP processes + minutes, raw materials +
//                                    qty — NO money (safe to hand to the floor)
//   labour  Labour Cost Report       WIP processes + minutes + labour, by dept
//
// The WIP tree prints with the same hierarchy as the page: one header row per
// WIP, indented by level and tinted like the UI, with its process and material
// rows under it. One autoTable per report, so long BOMs paginate cleanly and
// the column header repeats on every page.
// ---------------------------------------------------------------------------
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { drawDocFooter, drawLetterhead, drawSectionLabel, fmtDate, PDF, tableTheme } from "./pdf-utils";
import { deliverJsPdf, pdfFileName, type PdfOutputMode } from "./pdf-preview";
import { docPageLabel } from "./pdf-page-label";
import type { CostingResult, CostMaterial } from "./product-costing";
import { marginOn } from "./product-costing";
import { wipLabel } from "./wip-label";

export type CostingReportKind = "full" | "spec" | "labour";

export type CostingPdfInput = {
  product: { code: string; name: string; category: string; sizeLabel?: string; baseModel?: string; sizeCode?: string; defaultVariants?: Record<string, string> | null };
  bom: { version: string | null; status: string | null } | null;
  costing: CostingResult;
  prices: { label: string; sen: number | null }[];
  customers: { name: string; sen: number | null }[];
  standard?: { totalSen: number; setAt: string; setBy: string | null } | null;
};

const TITLES: Record<CostingReportKind, string> = {
  full: "FULL COSTING REPORT",
  spec: "PRODUCTION SPEC SHEET",
  labour: "LABOUR COST REPORT",
};

const LEVEL_FILL: [number, number, number][] = [
  [243, 244, 246], [227, 238, 244], [241, 230, 242], [251, 232, 216], [233, 241, 226], [253, 246, 216],
];
const rm = (sen: number | null | undefined) =>
  sen == null ? "—" : `RM ${(Math.round(sen) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The per-minute labour rate keeps 4 decimals (RM 0.1567), like the page. */
const rate = (sen: number) => `RM ${(sen / 100).toFixed(4)}`;
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(q < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, ""));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function materialNote(m: CostMaterial): string {
  if (m.status === "fabric-tier") return "from order · fabric tier";
  if (m.status === "from-order") return "from order · price unknown";
  if (m.status === "no-code") return "not a raw material code";
  if (m.status === "no-price") return "NO SUPPLIER PRICE";
  return m.supplierName ? `${m.supplierName}${m.isMainSupplier ? " (main)" : ""}` : "";
}

/** The table body: per WIP a tinted, indented header row, then its lines. */
export function costingRows(input: CostingPdfInput, kind: CostingReportKind): RowInput[] {
  const rows: RowInput[] = [];
  const cols = kind === "spec" ? 4 : 5;
  for (const n of input.costing.nodes) {
    const indent = Math.max(0, n.level - 1) * 4;
    const label = n.level === 1 ? "Product level" : `L${n.level}  ${wipLabel(n.label, input.product) || "—"}`;
    const meta = n.level === 1 ? "" : `${n.wipType ? `${n.wipType} · ` : ""}× ${n.pcs} PCS`;
    const money = kind === "spec" ? "" : kind === "labour" ? `Labour ${rm(n.labourSen)}` : `WIP cost ${rm(n.labourSen + n.materialSen)}`;
    rows.push([
      {
        content: `${label}${meta ? `    ${meta}` : ""}${money ? `    ·    ${money}` : ""}`,
        colSpan: cols,
        styles: { fontStyle: "bold", fillColor: LEVEL_FILL[Math.min(n.level - 1, LEVEL_FILL.length - 1)], cellPadding: { top: 2, bottom: 2, left: 2 + indent, right: 2 } },
      },
    ]);
    const pad = { top: 1.6, bottom: 1.6, left: 4 + indent, right: 2 };
    for (const p of n.processes) {
      const name = `${p.dept}${p.category ? `  ${p.category}` : ""}`;
      if (kind === "spec") rows.push([{ content: name, styles: { cellPadding: pad } }, `${qty(p.minutesPerPc)} min / pc`, `× ${p.pcs}`, `${qty(p.minutes)} min`]);
      else rows.push([{ content: name, styles: { cellPadding: pad } }, `${qty(p.minutesPerPc)} min / pc`, `× ${p.pcs}`, `${qty(p.minutes)} min`, rm(p.labourSen)]);
    }
    if (kind === "labour") continue;
    for (const m of n.materials) {
      const name = `${m.code || m.name}${m.code && m.name && m.name !== m.code ? ` — ${m.name}` : ""}`;
      const unit = m.unit || "";
      const perPc = `${qty(m.qtyPerPc)} ${unit} / pc`.replace(/\s+\//, " /");
      const q = `${qty(m.qty)} ${unit}`.trim() + (m.wastePct > 0 ? ` (incl. ${m.wastePct}% waste)` : "");
      const fromOrder = m.status === "fabric-tier" || m.status === "from-order";
      if (kind === "spec") {
        rows.push([
          { content: fromOrder && !/from order/i.test(name) ? `${name} (from order)` : name, styles: { cellPadding: pad, fontStyle: "bold" } },
          perPc,
          `× ${n.pcs}`,
          q,
        ]);
      } else {
        const note = materialNote(m);
        rows.push([
          { content: `${name}${note ? `\n${note}` : ""}`, styles: { cellPadding: pad, textColor: m.amountSen == null && m.status !== "fabric-tier" ? [185, 28, 28] : PDF.ink } },
          perPc,
          q,
          m.priceSen == null ? "No price" : `${rm(m.priceSen)} / ${m.priceUnit || m.unit || "unit"}`,
          m.amountSen == null ? "—" : rm(m.amountSen),
        ]);
      }
    }
  }
  return rows;
}

export function buildCostingPdf(input: CostingPdfInput, kind: CostingReportKind): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const m = PDF.margin;
  const c = input.costing;
  let y = drawLetterhead(doc, {
    docTitle: TITLES[kind],
    docNo: input.product.code,
    docDate: fmtDate(new Date().toISOString()),
    company: "HOOKKA",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF.ink);
  doc.text(input.product.name || input.product.code, m, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF.muted);
  const bomTxt = input.bom ? `BOM ${input.bom.version ?? ""} · ${input.bom.status === "ACTIVE" ? "Active" : input.bom.status ?? ""}` : "No BOM";
  doc.text(`${input.product.code} · ${input.product.category} · ${bomTxt} · ${qty(c.minutes)} min`, m, y);
  y += 6;

  // Summary block (not on the spec sheet — it carries no money).
  if (kind !== "spec") {
    y = drawSectionLabel(doc, "Summary", y);
    const lines: [string, string][] =
      kind === "labour"
        ? [
            ["Total minutes", `${qty(c.minutes)} min`],
            ["Labour rate", `${rate(c.labourRatePerMinSen)} / min  (RM 2,200 / 26 days / 9 h)`],
            ["Labour cost", rm(c.labourSen)],
          ]
        : [
            ["Labour", `${rm(c.labourSen)}   (${qty(c.minutes)} min × ${rate(c.labourRatePerMinSen)}/min)`],
            ["Raw materials", `${rm(c.materialSen)}${c.tier ? `   (fabric at ${c.tier})` : ""}${c.missingLines ? `   · ${c.missingLines} line(s) without a price — not counted` : ""}`],
            ["Total cost", rm(c.totalSen)],
            ...(input.standard ? ([["Standard cost", `${rm(input.standard.totalSen)}   (set ${input.standard.setAt.slice(0, 10)}${input.standard.setBy ? ` by ${input.standard.setBy}` : ""})`]] as [string, string][]) : []),
          ];
    doc.setFontSize(8.5);
    for (const [k, v] of lines) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...PDF.muted);
      doc.text(k, m, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...PDF.ink);
      doc.text(v, m + 34, y);
      y += 4.6;
    }
    y += 2;
  }

  // WIP table.
  y = drawSectionLabel(doc, kind === "spec" ? "WIP processes and raw materials" : kind === "labour" ? "Labour by WIP" : "Cost by WIP", y);
  const head =
    kind === "spec"
      ? [["Process / raw material", "Minutes / qty per piece", "Pieces", "Per finished good"]]
      : kind === "labour"
        ? [["Process", "Per piece", "Pieces", "Minutes", "Labour"]]
        : [["Process / raw material", "Per piece", "Pieces / qty", "Minutes / unit price", "Labour / amount"]];
  const theme = tableTheme();
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m, bottom: 20 },
    head,
    body: costingRows(input, kind),
    ...theme,
    alternateRowStyles: {},
    columnStyles:
      kind === "spec"
        ? { 0: { cellWidth: 92 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } }
        : { 0: { cellWidth: 80 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    showHead: "everyPage",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

  const ensure = (h: number) => {
    if (y + h > doc.internal.pageSize.getHeight() - 22) {
      doc.addPage();
      y = 20;
    }
  };

  // By department (full + labour).
  if (kind !== "spec" && c.byDept.length > 0) {
    ensure(20);
    y = drawSectionLabel(doc, "By department", y);
    autoTable(doc, {
      startY: y,
      margin: { left: m, right: m, bottom: 20 },
      head: [["Department", "Minutes", "Labour"]],
      body: c.byDept.map((d) => [d.dept, `${qty(d.minutes)} min`, rm(d.labourSen)]),
      foot: [["Total", `${qty(c.minutes)} min`, rm(c.labourSen)]],
      ...theme,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
  }

  // Fabric tiers + prices & margins (full only).
  if (kind === "full") {
    if (c.tiers.length > 0) {
      ensure(24);
      y = drawSectionLabel(doc, "Fabric from order — cost by fabric tier (each at its top price per metre)", y);
      autoTable(doc, {
        startY: y,
        margin: { left: m, right: m, bottom: 20 },
        head: [["Tier", "Fabric price", "Raw materials", "Total cost"]],
        body: c.tiers.map((t) => [t.level === c.tier ? `${t.level} (shown above)` : t.level, `up to ${rm(t.maxSen)} / m`, rm(t.materialSen), rm(t.totalSen)]),
        ...theme,
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
    }
    const priceRows = [
      ...input.prices.filter((p) => p.sen && p.sen > 0).map((p) => ({ name: p.label, sen: p.sen as number })),
      ...input.customers.filter((p) => p.sen && p.sen > 0).map((p) => ({ name: p.name, sen: p.sen as number })),
    ];
    if (priceRows.length > 0) {
      ensure(24);
      y = drawSectionLabel(doc, "Prices and margin on total cost", y);
      autoTable(doc, {
        startY: y,
        margin: { left: m, right: m, bottom: 20 },
        head: [["Price", "Selling price", "Margin", "Margin %"]],
        body: priceRows.map((p) => {
          const mg = marginOn(p.sen, c.totalSen);
          return [p.name, rm(p.sen), rm(mg.marginSen), pct(mg.pct)];
        }),
        ...theme,
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      });
    }
  }

  // Footer + page labels on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    drawDocFooter(doc, "HOOKKA");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...PDF.faint);
    doc.text(docPageLabel(i, pages), pageW - m, 8, { align: "right" });
  }
  return doc;
}

export function generateCostingPdf(input: CostingPdfInput, kind: CostingReportKind, mode: PdfOutputMode = "view"): void {
  const name = { full: "Full-Costing", spec: "Production-Spec", labour: "Labour-Cost" }[kind];
  deliverJsPdf(buildCostingPdf(input, kind), pdfFileName(`${name}-${input.product.code}`), mode);
}
