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
import autoTable from "jspdf-autotable";
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

export type CostingBlock = {
  level: number;
  title: string;
  meta: string;
  money: string;
  head: string[] | null;
  procRows: string[][];
  matHead: string[] | null;
  matRows: { cells: string[]; red: boolean }[];
  foot: string;
};

/** One box per WIP (PDF v3, owner-approved design ⑤): processes and raw
 *  materials are two SEPARATE tables with their own headings, so a material
 *  never sits in a "minutes" column. Spec = no money; labour = processes. */
export function costingBlocks(input: CostingPdfInput, kind: CostingReportKind): CostingBlock[] {
  return input.costing.nodes.map((n) => {
    const title = n.level === 1 ? "Product level" : wipLabel(n.label, input.product) || "—";
    const meta = n.level === 1 ? "" : `${n.wipType ? `${n.wipType} · ` : ""}× ${n.pcs} PCS`;
    const money = kind === "spec" ? "" : kind === "labour" ? rm(n.labourSen) : rm(n.labourSen + n.materialSen);
    const procRows = n.processes.map((p) => {
      const name = `${p.dept}${p.category ? `  ${p.category}` : ""}`;
      return kind === "spec"
        ? [name, qty(p.minutesPerPc), String(p.pcs), qty(p.minutes)]
        : [name, qty(p.minutesPerPc), String(p.pcs), qty(p.minutes), rm(p.labourSen)];
    });
    const head = n.processes.length
      ? kind === "spec"
        ? ["Process", "Min / pc", "× PCS", "Minutes"]
        : ["Process", "Min / pc", "× PCS", "Minutes", "Labour"]
      : null;
    const mats = kind === "labour" ? [] : n.materials;
    const matRows = mats.map((m) => {
      const fromOrder = m.status === "fabric-tier" || m.status === "from-order";
      const label = `${m.code || m.name}${m.code && m.name && m.name !== m.code ? ` — ${m.name}` : ""}`;
      const name = fromOrder && !/from order/i.test(label) ? `${label} (from order)` : label;
      const note = kind === "spec" ? "" : materialNote(m);
      const per = `${qty(m.qty)}${m.wastePct > 0 ? ` (${m.wastePct}% waste)` : ""}`;
      const cells =
        kind === "spec"
          ? [name, qty(m.qtyPerPc), m.unit || "", per]
          : [`${name}${note ? `  · ${note}` : ""}`, qty(m.qtyPerPc), m.unit || "", per, m.priceSen == null ? "No price" : rm(m.priceSen), m.amountSen == null ? "—" : rm(m.amountSen)];
      return { cells, red: kind !== "spec" && m.amountSen == null && m.status !== "fabric-tier" };
    });
    const matHead = mats.length
      ? kind === "spec"
        ? ["Raw material", "Qty / pc", "UOM", "Per product"]
        : ["Raw material", "Qty / pc", "UOM", "Per product", "Unit price", "Amount"]
      : null;
    const foot =
      kind === "full"
        ? `Labour ${rm(n.labourSen)}    Materials ${rm(n.materialSen)}    WIP cost ${rm(n.labourSen + n.materialSen)}`
        : kind === "labour"
          ? `Labour ${rm(n.labourSen)}`
          : "";
    return { level: n.level, title, meta, money, head, procRows, matHead, matRows, foot };
  });
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

  const pageH = doc.internal.pageSize.getHeight();
  const bottom = pageH - 20;

  // Summary tiles (not on the spec sheet — it carries no money).
  if (kind !== "spec") {
    const tiles: [string, string, string][] =
      kind === "labour"
        ? [
            ["TOTAL MINUTES", `${qty(c.minutes)} min`, ""],
            ["LABOUR RATE", `${rate(c.labourRatePerMinSen)} / min`, "RM 2,200 / 26 days / 9 h"],
            ["LABOUR COST", rm(c.labourSen), ""],
          ]
        : [
            ["LABOUR", rm(c.labourSen), `${qty(c.minutes)} min × ${rate(c.labourRatePerMinSen)}`],
            ["RAW MATERIALS", rm(c.materialSen), `${c.tier ? `fabric ${c.tier}` : ""}${c.missingLines ? `${c.tier ? " · " : ""}${c.missingLines} no price` : ""}`],
            ["TOTAL COST", rm(c.totalSen), input.standard ? `standard ${rm(input.standard.totalSen)}` : "labour + materials"],
            ...((): [string, string, string][] => {
              const p2 = input.prices.find((x) => x.label === "Price 2")?.sen;
              if (!p2) return [];
              const mg = marginOn(p2, c.totalSen);
              return [["MARGIN AT PRICE 2", `${rm(mg.marginSen)} · ${pct(mg.pct)}`, rm(p2)]];
            })(),
          ];
    const gap = 3;
    const w = (pageW - m * 2 - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([k, v, sub], i) => {
      const x = m + i * (w + gap);
      doc.setDrawColor(...PDF.rule);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, w, 15, 1.5, 1.5, "S");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...PDF.muted);
      doc.text(k, x + 3, y + 4.2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...(k.startsWith("MARGIN") ? (v.startsWith("RM -") ? ([185, 28, 28] as [number, number, number]) : ([21, 128, 61] as [number, number, number])) : PDF.ink));
      doc.text(v, x + 3, y + 9.4);
      if (sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...(sub.includes("no price") ? ([185, 28, 28] as [number, number, number]) : PDF.muted));
        doc.text(sub, x + 3, y + 13.2);
      }
    });
    y += 20;
  }

  // WIP boxes with connector lines (PDF v3).
  y = drawSectionLabel(doc, kind === "spec" ? "WIP processes and raw materials" : kind === "labour" ? "Labour by WIP" : "Cost by WIP", y);
  const theme = tableTheme();
  const INDENT = 6;
  const lineColor: [number, number, number] = [185, 173, 147];
  // y of the last header drawn at each level on the current page — the
  // connector of a child runs up to its parent's header.
  let anchors: Record<number, number> = {};
  let page = doc.getNumberOfPages();
  const blocks = costingBlocks(input, kind);
  for (const blk of blocks) {
    const x0 = m + Math.max(0, blk.level - 2) * INDENT;
    const width = pageW - m - x0;
    const est = 7 + (blk.head ? 5 + blk.procRows.length * 5 : 0) + (blk.matHead ? 5 + blk.matRows.length * 5.6 : 0) + (blk.foot ? 5 : 0) + 3;
    if (y + Math.min(est, bottom - 30) > bottom) {
      doc.addPage();
      y = 18;
    }
    if (doc.getNumberOfPages() !== page) {
      page = doc.getNumberOfPages();
      anchors = {};
    }
    // connector: vertical from the parent's header down to this header, then right.
    if (blk.level > 2) {
      const cx = x0 - INDENT + 2.2;
      const fromY = anchors[blk.level - 1] ?? 14;
      doc.setDrawColor(...lineColor);
      doc.setLineWidth(0.35);
      doc.line(cx, fromY, cx, y + 3.5);
      doc.line(cx, y + 3.5, x0, y + 3.5);
    }
    // header bar
    const fill = LEVEL_FILL[Math.min(blk.level - 1, LEVEL_FILL.length - 1)];
    doc.setFillColor(...fill);
    doc.setDrawColor(...PDF.rule);
    doc.setLineWidth(0.25);
    doc.rect(x0, y, width, 7, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF.ink);
    const badge = blk.level === 1 ? "" : `L${blk.level}  `;
    doc.text(`${badge}${blk.title}`, x0 + 2.5, y + 4.7, { maxWidth: width - 50 });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF.muted);
    const right = `${blk.meta}${blk.money ? `    ${blk.money}` : ""}`;
    doc.text(right, x0 + width - 2.5, y + 4.7, { align: "right" });
    y += 7;
    const tableOpts = {
      margin: { left: x0, right: m, bottom: 20 },
      tableWidth: width,
      ...theme,
      styles: { ...theme.styles, fontSize: 7.4, cellPadding: 1.6 },
      headStyles: { fillColor: [250, 248, 244] as [number, number, number], textColor: PDF.muted, fontStyle: "bold" as const, fontSize: 6.8, lineColor: PDF.rule, lineWidth: 0.2 },
      alternateRowStyles: {},
    };
    if (blk.head) {
      autoTable(doc, {
        ...tableOpts,
        startY: y,
        head: [blk.head.map((h, i) => ({ content: h, styles: i === 0 ? {} : { halign: "right" as const } }))],
        body: blk.procRows,
        columnStyles: { 0: { cellWidth: width * 0.42 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable?.finalY ?? y;
    }
    if (blk.matHead) {
      autoTable(doc, {
        ...tableOpts,
        startY: y,
        head: [blk.matHead.map((h, i) => ({ content: h, styles: i === 0 || h === "UOM" ? {} : { halign: "right" as const } }))],
        body: blk.matRows.map((r) => r.cells.map((cell, ci) => ({ content: cell, styles: r.red && ci >= 4 ? { textColor: [185, 28, 28], fontStyle: "bold" } : ci === 0 ? { fontStyle: "bold" } : {} }))),
        columnStyles:
          kind === "spec"
            ? { 0: { cellWidth: width * 0.5 }, 1: { halign: "right" }, 3: { halign: "right" } }
            : { 0: { cellWidth: width * 0.4 }, 1: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable?.finalY ?? y;
    }
    if (!blk.head && !blk.matHead) {
      doc.setFontSize(7.4);
      doc.setTextColor(...PDF.faint);
      doc.rect(x0, y, width, 5, "S");
      doc.text("No processes or raw materials", x0 + 2.5, y + 3.4);
      y += 5;
    }
    if (blk.foot) {
      doc.setFillColor(250, 248, 244);
      doc.setDrawColor(...PDF.rule);
      doc.rect(x0, y, width, 5, "FD");
      doc.setFontSize(7.2);
      doc.setTextColor(...PDF.muted);
      doc.text(blk.foot, x0 + width - 2.5, y + 3.4, { align: "right" });
      y += 5;
    }
    if (doc.getNumberOfPages() !== page) {
      page = doc.getNumberOfPages();
      anchors = {};
    }
    // A child's connector starts BELOW its parent's box, so the line never
    // runs through the parent's own tables; deeper anchors are reset.
    anchors[blk.level] = y;
    for (const k of Object.keys(anchors)) if (Number(k) > blk.level) delete anchors[Number(k)];
    y += 3;
  }
  y += 3;

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
