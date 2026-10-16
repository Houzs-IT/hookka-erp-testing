// ---------------------------------------------------------------------------
// doc-import/core — the shared document importer's PLANNER (HK-0002).
//
// Pure. Takes the sheet (array of arrays, header row first, in the column
// contract of src/lib/doc-columns.ts), the documents the file names as they
// stand in the database, and a spec of which columns mean what. Returns one
// plan per document — create or update, the per-line diff — plus errors and
// warnings. The preview and the apply run this SAME function, so what the
// operator is shown is what gets written.
//
// Rules (owner YH 2026-10-16, and the lessons of BUG-2026-08-20-158):
//   * Rows are grouped by Doc No.
//       blank        → ONE new document (all blank rows together)
//       NEW-xxx      → one new document per distinct NEW- key
//       unknown no.  → a new document asking for that number
//       existing no. → EDIT that document
//   * EDIT matches lines on Line ID. Blank Line ID = a new line. A Line ID the
//     document does not hold is an ERROR, never a skip. A Line ID that appears
//     twice in the file is an error on every copy (no first-one-wins).
//   * A BLANK cell keeps the stored value. A typed value wins — including 0.
//   * Lines are never deleted by an import.
//   * Columns are found by NAME (case-insensitive), never by position. The
//     first column with a name wins (the shared block leads every listing);
//     later duplicates are ignored with a warning.
// ---------------------------------------------------------------------------

export type FieldKind = "text" | "money" | "qty" | "date";

export type FieldSpec = {
  /** The key adapters read: `values[key]`. */
  key: string;
  /** The sheet header (doc-columns.ts spelling). */
  header: string;
  aliases?: string[];
  kind: FieldKind;
  level: "header" | "line";
  /** May an EDIT change it? Non-editable fields typed with a different value
   *  are ignored with a warning. On CREATE every typed field is passed on. */
  editable?: boolean;
};

/** money = sen (integer), qty = number, text/date = trimmed string. */
export type Value = string | number;
export type Values = Record<string, Value>;

export type CurrentLine = { lineId: string; values: Values };
export type CurrentDoc = {
  id: string;
  docNo: string;
  header: Values;
  lines: CurrentLine[];
  /** Adapter-private state (status, paid amount...) for validate(). */
  meta?: Record<string, unknown>;
};

export type ImportSpec = {
  /** Accepted Doc Type cells (blank is accepted too). */
  docTypes: string[];
  fields: FieldSpec[];
};

export type Change = { key: string; header: string; kind: FieldKind; from: Value | null; to: Value };

export type LinePlan = {
  /** 1-based sheet row (the header is row 1). */
  row: number;
  action: "create" | "update";
  lineId: string | null;
  /** Every typed (non-blank) cell on the row. */
  typed: Values;
  /** EDIT only: stored values with the typed EDITABLE cells merged over. */
  merged: Values;
  /** EDIT only: editable fields whose typed value differs from the stored one. */
  changes: Change[];
};

export type DocPlan = {
  /** Group key: the Doc No., or "" / "NEW-…" for a create. */
  key: string;
  action: "create" | "update";
  /** The number the file asks for — null when the server must assign one. */
  docNo: string | null;
  current?: CurrentDoc;
  rows: number[];
  header: Values;
  headerChanges: Change[];
  lines: LinePlan[];
};

export type Issue = { row: number; docNo?: string; message: string };

export type ImportPlan = { docs: DocPlan[]; errors: Issue[]; warnings: Issue[] };

/** The shared block (doc-columns.ts). Adapters spread it and set `editable`. */
export const COMMON_FIELDS: FieldSpec[] = [
  { key: "docType", header: "Doc Type", kind: "text", level: "header" },
  { key: "docNo", header: "Doc No.", aliases: ["Doc. No."], kind: "text", level: "header" },
  { key: "docDate", header: "Doc Date", kind: "date", level: "header" },
  { key: "partyCode", header: "Party Code", aliases: ["Debtor Code"], kind: "text", level: "header" },
  { key: "partyName", header: "Party Name", aliases: ["Debtor Name"], kind: "text", level: "header" },
  { key: "refDocNo", header: "Ref Doc No.", kind: "text", level: "header" },
  { key: "lineId", header: "Line ID", kind: "text", level: "line" },
  { key: "itemCode", header: "Item Code", kind: "text", level: "line" },
  { key: "description", header: "Description", kind: "text", level: "line" },
  { key: "qty", header: "Qty", kind: "qty", level: "line" },
  { key: "uom", header: "UOM", kind: "text", level: "line" },
  { key: "unitPrice", header: "Unit Price", kind: "money", level: "line" },
  { key: "discount", header: "Discount", kind: "money", level: "line" },
  { key: "lineTotal", header: "Line Total", kind: "money", level: "line" },
];

/** `common` with `editable` switched on for the listed keys, plus `extra`. */
export function withFields(editable: string[], extra: FieldSpec[] = []): FieldSpec[] {
  const on = new Set(editable);
  return [
    ...COMMON_FIELDS.map((f) => (on.has(f.key) ? { ...f, editable: true } : f)),
    ...extra.map((f) => (on.has(f.key) ? { ...f, editable: true } : f)),
  ];
}

/** null / undefined / "" / whitespace are BLANK. 0 and "0" are a real zero. */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  return String(v).trim() === "";
}

/** Parse one non-blank cell. Returns an error string on a bad value. */
export function parseCell(v: unknown, kind: FieldKind): Value | { error: string } {
  if (kind === "text") return String(v).trim();
  if (kind === "date") {
    // Excel serial date (raw:true sheets) → YYYY-MM-DD.
    if (typeof v === "number") {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return { error: `"${s}" is not a date (YYYY-MM-DD).` };
    return s.slice(0, 10);
  }
  let n: number;
  if (typeof v === "number") n = v;
  else {
    const cleaned = String(v).replace(/[,\s]/g, "").replace(/^RM/i, "");
    if (!/^-?\d*\.?\d+$/.test(cleaned)) return { error: `"${String(v)}" is not a number.` };
    n = Number(cleaned);
  }
  if (n < 0) return { error: `${String(v)} is negative.` };
  return kind === "money" ? Math.round(n * 100) : n;
}

const norm = (s: string) => s.trim().toLowerCase();
const show = (v: Value | null | undefined, kind: FieldKind) =>
  v === null || v === undefined ? "blank" : kind === "money" ? (Number(v) / 100).toFixed(2) : String(v);

type Parsed = { row: number; values: Values };

/** Read the sheet into typed rows by column NAME. Shared by the planner and by
 *  currentFromListing, so stored and typed values are parsed identically. */
export function readSheet(aoa: unknown[][], spec: ImportSpec) {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const rows: Parsed[] = [];
  const headerRow = (aoa[0] ?? []).map((h) => String(h ?? ""));

  const col = new Map<string, number>(); // field key → column index
  const byName = new Map<string, FieldSpec>();
  for (const f of spec.fields) byName.set(norm(f.header), f);
  for (const f of spec.fields) for (const a of f.aliases ?? []) if (!byName.has(norm(a))) byName.set(norm(a), f);
  headerRow.forEach((h, i) => {
    const f = byName.get(norm(h));
    if (!f) return;
    const had = col.get(f.key);
    if (had === undefined) col.set(f.key, i);
    // A canonical name beats an alias seen earlier.
    else if (norm(h) === norm(f.header) && norm(headerRow[had]) !== norm(f.header)) col.set(f.key, i);
    else warnings.push({ row: 1, message: `Column "${h}" (column ${i + 1}) repeats "${f.header}" — only the first is read.` });
  });
  if (!col.has("docNo")) {
    errors.push({ row: 1, message: 'The sheet has no "Doc No." column. Export a fresh Detail Listing and edit that.' });
    return { rows, errors, warnings };
  }
  const fieldOf = new Map(spec.fields.map((f) => [f.key, f]));
  const okTypes = new Set(spec.docTypes.map((t) => t.toUpperCase()));
  for (let r = 1; r < aoa.length; r++) {
    const cells = aoa[r] ?? [];
    if (cells.every(isBlank)) continue;
    const rowNo = r + 1;
    const values: Values = {};
    let bad = false;
    for (const [key, idx] of col) {
      const raw = cells[idx];
      if (isBlank(raw)) continue;
      const f = fieldOf.get(key)!;
      const p = parseCell(raw, f.kind);
      if (typeof p === "object") {
        errors.push({ row: rowNo, message: `${f.header}: ${p.error}` });
        bad = true;
      } else values[key] = p;
    }
    if (bad) continue;
    const dt = String(values.docType ?? "").toUpperCase();
    if (dt && !okTypes.has(dt)) {
      errors.push({ row: rowNo, message: `Doc Type "${values.docType}" cannot be imported here (expects ${spec.docTypes.join(" / ")}).` });
      continue;
    }
    rows.push({ row: rowNo, values });
  }
  return { rows, errors, warnings };
}

/**
 * The stored documents, in the importer's terms, built by running the
 * document's OWN export builder over the database rows and reading that sheet
 * back. Stored and typed values then go through the same formatter and the
 * same parser, so an unedited export → import is an empty diff by
 * construction, not by keeping two mappings in step.
 */
export function currentFromListing(
  aoa: unknown[][],
  spec: ImportSpec,
  idByDocNo: Map<string, string>,
  metaByDocNo: Map<string, Record<string, unknown>> = new Map(),
): Map<string, CurrentDoc> {
  const out = new Map<string, CurrentDoc>();
  const headerKeys = spec.fields.filter((f) => f.level === "header").map((f) => f.key);
  for (const p of readSheet(aoa, spec).rows) {
    const docNo = String(p.values.docNo ?? "");
    const id = idByDocNo.get(docNo);
    if (!id) continue;
    let doc = out.get(docNo);
    if (!doc) {
      const header: Values = {};
      for (const k of headerKeys) if (p.values[k] !== undefined) header[k] = p.values[k];
      doc = { id, docNo, header, lines: [], meta: metaByDocNo.get(docNo) };
      out.set(docNo, doc);
    }
    const lineId = String(p.values.lineId ?? "");
    if (lineId) doc.lines.push({ lineId, values: p.values });
  }
  return out;
}

export function planDocImport(
  aoa: unknown[][],
  current: Map<string, CurrentDoc>,
  spec: ImportSpec,
): ImportPlan {
  const { rows: parsed, errors, warnings } = readSheet(aoa, spec);
  const docs: DocPlan[] = [];
  const groups = new Map<string, Parsed[]>();
  for (const p of parsed) {
    const docNo = String(p.values.docNo ?? "");
    const key = /^new-/i.test(docNo) ? docNo.toUpperCase() : docNo;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  // Duplicate Line IDs anywhere in the file are refused on every copy.
  const idRows = new Map<string, number[]>();
  for (const rows of groups.values())
    for (const p of rows) {
      const id = String(p.values.lineId ?? "");
      if (id) idRows.set(id, [...(idRows.get(id) ?? []), p.row]);
    }

  const headerFields = spec.fields.filter((f) => f.level === "header");
  const lineFields = spec.fields.filter((f) => f.level === "line");

  for (const [key, rows] of groups) {
    const cur = key && !/^NEW-/.test(key) ? current.get(key) : undefined;
    const action: "create" | "update" = cur ? "update" : "create";
    const docNo = key && !/^NEW-/.test(key) ? key : null;
    const label = docNo ?? (key || "(new)");
    const err = (row: number, message: string) => errors.push({ row, docNo: label, message });
    const warn = (row: number, message: string) => warnings.push({ row, docNo: label, message });

    // Header values: the first typed value wins; a contradiction is an error.
    const header: Values = {};
    if (docNo) header.docNo = docNo;
    for (const f of headerFields) {
      if (f.key === "docNo") continue; // already the group key (NEW- is case-insensitive)
      for (const p of rows) {
        const v = p.values[f.key];
        if (v === undefined) continue;
        if (header[f.key] === undefined) header[f.key] = v;
        else if (header[f.key] !== v)
          err(p.row, `${f.header} is "${show(v, f.kind)}" here but "${show(header[f.key], f.kind)}" on an earlier row of the same document.`);
      }
    }
    const headerChanges: Change[] = [];
    if (cur) {
      for (const f of headerFields) {
        if (f.key === "docNo" || f.key === "docType" || header[f.key] === undefined) continue;
        const from = cur.header[f.key] ?? null;
        if (from === header[f.key]) continue;
        if (f.editable) headerChanges.push({ key: f.key, header: f.header, kind: f.kind, from, to: header[f.key] });
        else warn(rows[0].row, `${f.header} "${show(header[f.key], f.kind)}" differs from the stored "${show(from, f.kind)}" — read-only here, ignored.`);
      }
    }

    const lines: LinePlan[] = [];
    const curLines = new Map((cur?.lines ?? []).map((l) => [l.lineId, l]));
    for (const p of rows) {
      const lineId = String(p.values.lineId ?? "");
      if (!lineId && p.values.itemCode === undefined) continue; // header-only row
      if (lineId && (idRows.get(lineId)?.length ?? 0) > 1) {
        err(p.row, `Line ID ${lineId} appears on rows ${idRows.get(lineId)!.join(", ")} — every copy is refused.`);
        continue;
      }
      const typed: Values = {};
      for (const f of lineFields) if (p.values[f.key] !== undefined && f.key !== "lineId") typed[f.key] = p.values[f.key];
      if (action === "create") {
        if (lineId) {
          err(p.row, `Line ID ${lineId} on a new document — a new line has no id yet. Clear the Line ID (or use the existing Doc No. to edit).`);
          continue;
        }
        lines.push({ row: p.row, action: "create", lineId: null, typed, merged: typed, changes: [] });
        continue;
      }
      if (!lineId) {
        lines.push({ row: p.row, action: "create", lineId: null, typed, merged: typed, changes: [] });
        continue;
      }
      const stored = curLines.get(lineId);
      if (!stored) {
        err(p.row, `Line ID ${lineId} is not a line of ${label}. It may have been removed, or belong to another document.`);
        continue;
      }
      const merged: Values = { ...stored.values };
      const changes: Change[] = [];
      for (const f of lineFields) {
        if (f.key === "lineId") continue;
        const v = typed[f.key];
        if (v === undefined) continue; // BLANK keeps the stored value
        const from = stored.values[f.key] ?? null;
        if (from === v) continue;
        if (f.editable) {
          merged[f.key] = v;
          changes.push({ key: f.key, header: f.header, kind: f.kind, from, to: v });
        } else {
          warn(p.row, `${f.header} "${show(v, f.kind)}" differs from the stored "${show(from, f.kind)}" — read-only here, ignored.`);
        }
      }
      lines.push({ row: p.row, action: "update", lineId, typed, merged, changes });
    }

    docs.push({ key, action, docNo, current: cur, rows: rows.map((p) => p.row), header, headerChanges, lines });
  }

  return { docs, errors, warnings };
}

/** Did the plan ask for any write at all? */
export function planHasWork(plan: ImportPlan): boolean {
  return plan.docs.some(
    (d) => d.action === "create" || d.headerChanges.length > 0 || d.lines.some((l) => l.action === "create" || l.changes.length > 0),
  );
}
