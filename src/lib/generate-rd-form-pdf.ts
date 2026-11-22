// ---------------------------------------------------------------------------
// R&D Spec Form PDF (owner 2026-11-22, plan D11; approved design "RD-Form").
//
// A fill-in form for R&D, printed from what the BOM already has:
//   • each WIP numbered (#1, #2 …) in BOM order, tinted + indented by level;
//   • each process shows the current minutes ("now 18") and an empty box for
//     the minutes per piece — left empty when "now" is right;
//   • materials on file print BOLD with qty and unit (UOM); a "correct qty /
//     remark" column takes corrections; N blank lines per WIP for new ones;
//   • an Extra table (write the WIP no.) for anything that does not fit;
//   • Filled by / Checked by / Entered into system by, each with a date.
// Grid lines on every cell (owner: 「没有线之类的吗？」). The filled form comes
// back through the costing editor (key-in now; scan + OCR later — phase 7).
// ---------------------------------------------------------------------------
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { PDF } from "./pdf-utils";
import { deliverJsPdf, pdfFileName, type PdfOutputMode } from "./pdf-preview";
import { docPageLabel } from "./pdf-page-label";
import type { CostNode } from "./product-costing";
import { wipLabel } from "./wip-label";
import { rdFormNo } from "./rd-form-no";
import { todayYmdMY } from "./utils";
export { rdFormNo } from "./rd-form-no";

export type RdFormInput = {
  product: { code: string; name: string; category: string; sizeLabel?: string; baseModel?: string; sizeCode?: string; defaultVariants?: Record<string, string> | null };
  bom: { version: string | null } | null;
  nodes: CostNode[];
  /** Blank material lines per WIP (1–10). */
  blankLines?: number;
  issuedOn?: string; // YYYY-MM-DD
};

const LEVEL_FILL: [number, number, number][] = [
  [243, 244, 246], [227, 238, 244], [241, 230, 242], [251, 232, 216], [233, 241, 226], [253, 246, 216],
];
const GRID: [number, number, number] = [185, 173, 147];
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(q < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, ""));


/** The numbered WIP list as printed (#1 = first WIP in BOM order); the
 *  costing editor shows the same numbers so key-in lines up with paper. */
export function rdFormRows(input: RdFormInput): RowInput[] {
  const blank = Math.max(1, Math.min(10, input.blankLines ?? 2));
  const rows: RowInput[] = [];
  let no = 0;
  for (const n of input.nodes) {
    const indent = Math.max(0, n.level - 1) * 4;
    const fill = LEVEL_FILL[Math.min(n.level - 1, LEVEL_FILL.length - 1)];
    const title = n.level === 1 ? "Product level" : `#${++no}   L${n.level}   ${wipLabel(n.label, input.product) || "—"}`;
    const meta = n.level === 1 ? "" : `${n.wipType ? `${n.wipType} · ` : ""}× ${n.pcs} PCS`;
    rows.push([{ content: `${title}${meta ? `      ${meta}` : ""}`, colSpan: 4, styles: { fontStyle: "bold", fillColor: fill, cellPadding: { top: 1.8, bottom: 1.8, left: 2 + indent, right: 2 } } }]);
    const pad = { top: 1.4, bottom: 1.4, left: 4 + indent, right: 2 };
    for (const p of n.processes) {
      rows.push([
        { content: `${p.dept}${p.category ? `  ${p.category}` : ""}`, styles: { cellPadding: pad } },
        { content: `now ${qty(p.minutesPerPc)}`, styles: { halign: "right", textColor: PDF.muted } },
        "",
        { content: "min / pc", styles: { textColor: PDF.muted } },
      ]);
    }
    rows.push([
      { content: "Raw material code", styles: { cellPadding: pad, fontStyle: "bold", fontSize: 6.8, textColor: PDF.muted, fillColor: [250, 248, 244] } },
      { content: `Qty per ${input.product.category === "SOFA" ? "set" : "product"}`, styles: { fontStyle: "bold", fontSize: 6.8, textColor: PDF.muted, fillColor: [250, 248, 244] } },
      { content: "Unit", styles: { fontStyle: "bold", fontSize: 6.8, textColor: PDF.muted, fillColor: [250, 248, 244] } },
      { content: "Correct qty / remark", styles: { fontStyle: "bold", fontSize: 6.8, textColor: PDF.muted, fillColor: [250, 248, 244] } },
    ]);
    for (const m of n.materials) {
      const name = m.status === "fabric-tier" || m.status === "from-order" ? `${m.name || "From order"} (from order)`.replace("(from order) (from order)", "(from order)") : m.code || m.name;
      rows.push([
        { content: name, styles: { cellPadding: pad, fontStyle: "bold" } },
        // Per product = per piece × pieces, WITHOUT wastage — the figure the
        // BOM author typed, so a correction compares like with like.
        { content: qty(m.qtyPerPc * n.pcs), styles: { fontStyle: "bold", halign: "right" } },
        { content: m.unit || "", styles: { fontStyle: "bold" } },
        "",
      ]);
    }
    for (let i = 0; i < blank; i++) rows.push([{ content: "", styles: { cellPadding: pad, minCellHeight: 6.5 } }, "", "", ""]);
  }
  return rows;
}

export function buildRdFormPdf(input: RdFormInput): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const m = PDF.margin;
  const issued = input.issuedOn ?? todayYmdMY();
  const formNo = rdFormNo(input.product.code, issued);
  const wipCount = input.nodes.filter((n) => n.level > 1).length;
  const bomTxt = input.bom?.version ? `BOM v${input.bom.version}` : "BOM";

  doc.setTextColor(...PDF.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("HOOKKA INDUSTRIES SDN BHD", m, 14);
  doc.setFontSize(15);
  doc.text("R&D Spec Form", m, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF.muted);
  doc.text(`${input.product.code} ${input.product.name} · ${bomTxt} · ${wipCount} WIPs`, m, 26.5);
  doc.setTextColor(...PDF.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Form no. ${formNo}`, pageW - m, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Issued ${issued}`, pageW - m, 19, { align: "right" });
  doc.text("Return by ____________", pageW - m, 24, { align: "right" });
  doc.setDrawColor(...PDF.accent);
  doc.setLineWidth(0.6);
  doc.line(m, 29, pageW - m, 29);

  doc.setFontSize(7.6);
  doc.setTextColor(...PDF.muted);
  const help = doc.splitTextToSize(
    'What the BOM already has is printed ("now 18" = current minutes; bold rows = materials on file). Minutes: write the minutes per piece in the box — leave it empty if "now" is right. Materials on file: write a corrected qty only if it is wrong. New materials: write code, qty and unit on the empty lines. Need more lines? Use the Extra table with the WIP no.',
    pageW - m * 2,
  );
  doc.text(help, m, 33.5);
  const startY = 33.5 + help.length * 3.4 + 2;

  const grid = { lineColor: GRID, lineWidth: 0.2 };
  autoTable(doc, {
    startY,
    margin: { left: m, right: m, top: 16, bottom: 18 },
    body: rdFormRows(input),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.6, cellPadding: 1.4, textColor: PDF.ink, valign: "middle", ...grid },
    columnStyles: { 0: { cellWidth: 86 }, 1: { cellWidth: 28 }, 2: { cellWidth: 24 }, 3: { cellWidth: "auto" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = ((doc as any).lastAutoTable?.finalY ?? startY) + 6;

  const head = (label: string) => {
    if (y + 16 > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF.accent);
    doc.text(label, m, y);
    y += 2;
  };

  head("Extra raw materials — write the WIP no.");
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m, top: 16, bottom: 18 },
    head: [["WIP no.", "Raw material code", "Qty", "Unit", "Remark"]],
    body: Array.from({ length: 10 }, () => ["", "", "", "", ""]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.6, minCellHeight: 6.5, textColor: PDF.ink, ...grid },
    headStyles: { fillColor: [250, 248, 244], textColor: PDF.muted, fontStyle: "bold", ...grid },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 70 }, 2: { cellWidth: 20 }, 3: { cellWidth: 20 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

  head("Sign-off");
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m, top: 16, bottom: 18 },
    body: [
      ["Filled by (R&D)", "", "Date", ""],
      ["Checked by", "", "Date", ""],
      ["Entered into system by", "", "Date", ""],
    ],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, minCellHeight: 9, textColor: PDF.ink, valign: "middle", ...grid },
    columnStyles: { 0: { cellWidth: 40, fontStyle: "bold" }, 2: { cellWidth: 16, fontStyle: "bold" }, 3: { cellWidth: 36 } },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...PDF.faint);
    const fy = doc.internal.pageSize.getHeight() - 9;
    doc.text(`${formNo} · ${input.product.code} · ${bomTxt}`, m, fy);
    doc.text(docPageLabel(i, pages), pageW - m, fy, { align: "right" });
  }
  return doc;
}

export function generateRdFormPdf(input: RdFormInput, mode: PdfOutputMode = "view"): void {
  deliverJsPdf(buildRdFormPdf(input), pdfFileName(`RD-Spec-Form-${input.product.code}`), mode);
}
