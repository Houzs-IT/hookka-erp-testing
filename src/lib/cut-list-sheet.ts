// HK-0036 cut list → rows for the Excel download and the print view (one
// source, so the two never disagree). Shapes mirror /api/cnc-cut-list.
// Column set is a best guess until Violet corrects it from a sample sheet.

export type CutListPayload = {
  batch: { id: string; exportedAt: string; cardCount: number; changeCount: number };
  groups: {
    key: string;
    category: string;
    fabricCode: string;
    model: string;
    rows: {
      jobCardId: string;
      fabricCode: string;
      productCode: string;
      sizeLabel: string;
      wipLabel: string;
      qty: number;
      poNo: string;
      dueDate: string;
      layout?: { templateId: string; name: string; metres: number | null } | null;
    }[];
  }[];
  changed: {
    jobCardId: string;
    poNo: string;
    productCode: string;
    fabricCode: string;
    sizeLabel: string;
    wipLabel: string;
    exportedAt: string;
    note: string;
  }[];
  markers: { id: string; groupKey: string; fileName: string; metres: number | null; sizeBytes: number; uploadedAt: string }[];
};

export const CUT_LIST_HEADER = [
  "Group", "Colour code", "Model", "Size", "Part", "Qty", "PO no", "Due date", "Layout (.plt)", "Metres",
];

export const cutGroupLabel = (g: { category: string; model: string; fabricCode: string }) =>
  [g.category, g.model, g.fabricCode || "(no fabric)"].filter(Boolean).join(" · ");

export type CutSheetRowKind = "section" | undefined;

/** Header + rows, plus which body rows are section (group / changed) headers. */
export function cutListSheet(p: CutListPayload): { aoa: (string | number)[][]; kinds: CutSheetRowKind[] } {
  const aoa: (string | number)[][] = [CUT_LIST_HEADER];
  const kinds: CutSheetRowKind[] = [];
  const push = (row: (string | number)[], kind?: CutSheetRowKind) => {
    aoa.push(row);
    kinds.push(kind);
  };
  if (p.changed.length) {
    push([`CHANGED SINCE EXPORT, check before cutting (${p.changed.length})`, "", "", "", "", "", "", "", "", ""], "section");
    for (const c of p.changed) {
      push([
        "Changed", c.fabricCode, c.productCode, c.sizeLabel, c.wipLabel, "", c.poNo,
        `exported ${c.exportedAt.slice(0, 10)}`, c.note, "",
      ]);
    }
  }
  for (const g of p.groups) {
    const markers = p.markers.filter((m) => m.groupKey === g.key);
    const known = markers.filter((m) => m.metres != null);
    push(
      [
        `${cutGroupLabel(g)} (${g.rows.length})`, "", "", "", "", "", "", "",
        markers.map((m) => m.fileName).join(", "),
        known.length ? known.reduce((s, m) => s + (m.metres ?? 0), 0) : "",
      ],
      "section",
    );
    for (const r of g.rows) {
      push([
        "", r.fabricCode, r.productCode, r.sizeLabel, r.wipLabel, r.qty, r.poNo, r.dueDate,
        r.layout ? r.layout.name : g.category === "SOFA" ? "(no layout)" : "",
        r.layout?.metres ?? "",
      ]);
    }
  }
  return { aoa, kinds };
}
