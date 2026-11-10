// O6 (cross-system review 2026-11-10, sister Houzs#4618 / #4527 / #4605 /
// #4614): ONE shared CSV / Excel import parser with header aliases.
//
//   1. Round trip — every table that exports through the shared schema imports
//      its own export back to the same values, as .xlsx AND as .csv.
//   2. Pin — for sample files that import today, the shared parser produces
//      EXACTLY what the old inline BatchImportDialog code produced (the old
//      code is kept below as the oracle), so moving it changed nothing an
//      import writes.
//   3. Aliases — a column's own label always beats an alias.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

import {
  aoaToRecords,
  buildExportAoa,
  buildHeaderMap,
  findHeaderIndex,
  normalizeHeader,
  parseImportRows,
} from "../src/lib/table-import.ts";
import { FG_IMPORT_COLUMNS, PRODUCT_IMPORT_COLUMNS, RM_IMPORT_COLUMNS } from "../src/lib/import-schemas.ts";
import { parseMoneyInput } from "../src/lib/parse-money.ts";
import { isCleanImportShape, isRmCountShape, parseRmCountRows } from "../src/lib/stock-take-import.ts";

// The way BatchImportDialog reads an uploaded file.
function readBack(aoa, bookType) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const out = XLSX.write(wb, { bookType, type: bookType === "csv" ? "string" : "buffer" });
  const back = XLSX.read(out, { type: bookType === "csv" ? "string" : "buffer" });
  return XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { raw: false, defval: "" });
}

// ── the OLD inline BatchImportDialog parse (origin/main before O6) — oracle ──
function oldParse(rawRows, columns) {
  const headerToKey = new Map();
  for (const col of columns) {
    headerToKey.set(col.label.toLowerCase(), col.key);
    headerToKey.set(`${col.label} *`.toLowerCase(), col.key);
  }
  return rawRows.map((row, i) => {
    const values = {};
    const errors = [];
    const remapped = {};
    for (const [header, v] of Object.entries(row)) {
      const k = headerToKey.get(header.trim().toLowerCase());
      if (k) remapped[k] = v;
    }
    for (const col of columns) {
      const raw = remapped[col.key];
      const str = raw === null || raw === undefined ? "" : String(raw).trim();
      if (col.required && !str) { errors.push(`${col.label} is required`); values[col.key] = ""; continue; }
      if (!str) { values[col.key] = undefined; continue; }
      if (col.enum && col.enum.length > 0) {
        const match = col.enum.find((e) => e.toLowerCase() === str.toLowerCase());
        if (!match) { errors.push(`${col.label} must be one of: ${col.enum.join(", ")} (got "${str}")`); values[col.key] = str; continue; }
        values[col.key] = match; continue;
      }
      if (col.type === "money") {
        const rm = parseMoneyInput(str);
        if (rm === null) { errors.push(`${col.label} must be an amount (got "${str}")`); values[col.key] = 0; } else values[col.key] = rm;
        continue;
      }
      if (col.type === "number") {
        const n = Number(str.replace(/,/g, ""));
        if (Number.isNaN(n)) { errors.push(`${col.label} must be a number (got "${str}")`); values[col.key] = 0; } else values[col.key] = n;
        continue;
      }
      if (col.type === "boolean") {
        const truthy = ["true", "yes", "y", "1", "active"].includes(str.toLowerCase());
        const falsy = ["false", "no", "n", "0", "inactive"].includes(str.toLowerCase());
        if (!truthy && !falsy) { errors.push(`${col.label} must be true/false (got "${str}")`); values[col.key] = false; } else values[col.key] = truthy;
        continue;
      }
      values[col.key] = str;
    }
    return { idx: i + 2, values, errors };
  });
}

const SCHEMAS = [
  ["products", PRODUCT_IMPORT_COLUMNS],
  ["finished products", FG_IMPORT_COLUMNS],
  ["raw materials", RM_IMPORT_COLUMNS],
];

const RECORDS = {
  products: [
    { id: "prod-1", code: "2050(A)-(K)", name: "ROMA BEDFRAME (6FT)", category: "BEDFRAME", description: "Grey, \"premium\", 6ft", baseModel: "2050(A)", sizeCode: "K", sizeLabel: "6FT", fabricUsage: 8.5, unitM3: 1.25, status: "ACTIVE", costPriceSen: 1500, basePriceSen: 12000.5 },
    { id: "prod-2", code: "SOFA-1", name: "SOFA, 3 seat", category: "SOFA", status: "INACTIVE", basePriceSen: 0 },
  ],
  "finished products": [
    { id: "p-9", code: "BC06", name: "BC06 BED", category: "ACCESSORY", baseModel: "BC06", sizeCode: "Q", sizeLabel: "5FT", basePriceSen: 899, costPriceSen: 450.25, fabricUsage: 3 },
  ],
  "raw materials": [
    { id: "rm-1", itemCode: "PC151-01", description: "Fabric PC151-01 Grey", baseUOM: "MTR", itemGroup: "FABRIC", balanceQty: 12.5, isActive: true, notes: "line 1, with comma", mainSupplierCode: "SUP-01" },
    { id: "rm-2", itemCode: "PLY-9", description: "Plywood 9mm", baseUOM: "PCS", itemGroup: "PLYWOOD", balanceQty: 0, isActive: false },
  ],
};

for (const [name, columns] of SCHEMAS) {
  for (const bookType of ["xlsx", "csv"]) {
    test(`round trip: ${name} imports its own ${bookType} export to the same values`, () => {
      const records = RECORDS[name];
      const parsed = parseImportRows(readBack(buildExportAoa(columns, records), bookType), columns);
      assert.equal(parsed.length, records.length);
      parsed.forEach((p, i) => {
        assert.deepEqual(p.errors, [], `row ${p.idx}: ${p.errors.join("; ")}`);
        for (const col of columns) {
          const want = records[i][col.key];
          const got = p.values[col.key];
          if (want === undefined || want === null || want === "") {
            assert.equal(got, undefined, `${col.key} blank must come back absent`);
          } else {
            assert.equal(got, want, `${name} row ${i + 1} ${col.key}`);
          }
        }
      });
    });
  }
}

test("round trip: stock take's own export is read back as the clean shape", () => {
  // StockTakeTab exports [["Material Group", "Closing Stock (RM)"], …].
  const back = readBack([["Material Group", "Closing Stock (RM)"], ["FABRIC", 1200.5]], "xlsx");
  assert.ok(isCleanImportShape(Object.keys(back[0])));
});

test("round trip: the raw-material export is a priced-count file for stock take", () => {
  const aoa = buildExportAoa(RM_IMPORT_COLUMNS, RECORDS["raw materials"]);
  assert.ok(isRmCountShape(aoa[0]), "Item Code * / Item Group * / Balance Qty headers must be recognised");
  const rows = parseRmCountRows(aoa);
  assert.deepEqual(rows.map((r) => [r.code, r.qty]), [["PC151-01", 12.5]]);
});

// ── 2. pin: sample files that import today parse exactly as before ──────────
const SAMPLE_FILES = {
  products: [
    ["ID", "Product Code *", "Product Name *", "Category *", "Description", "Base Model", "Size Code", "Size Label", "Fabric Usage (m)", "Unit m³", "Status", "Cost Price (RM)", "Base Price (RM)", "Unrelated"],
    ["", "2050(A)-(K)", "ROMA", "bedframe", "", "2050(A)", "K", "6FT", "8", "", "active", "1,500", "RM 12,000.50", "ignored"],
    ["prod-2", "X1", "", "TABLE", "d", "", "", "", "abc", "0", "", "(12.00)", "free"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ],
  "finished products": [
    ["product code", "PRODUCT NAME", " Category ", "Base Price (RM) *", "Cost Price (RM)", "Fabric Usage (m)"],
    ["BC06", "BC06 BED", "Accessory", "899", "", "3.5"],
  ],
  "raw materials": [
    ["Item Code *", "Description *", "Base UOM *", "Item Group *", "Balance Qty", "Active", "Notes", "Main Supplier Code"],
    ["PC151-01", "Fabric", "MTR", "FABRIC", "1,234.5", "yes", "[CLEAR]", ""],
    ["PLY-9", "Ply", "PCS", "PLYWOOD", "", "inactive", "", "SUP"],
    ["BAD", "Bad", "PCS", "FOAM", "x", "maybe", "", ""],
  ],
};

for (const [name, columns] of SCHEMAS) {
  for (const bookType of ["xlsx", "csv"]) {
    test(`pin: a ${name} ${bookType} file that imports today parses exactly as before`, () => {
      const raw = readBack(SAMPLE_FILES[name], bookType);
      assert.deepEqual(parseImportRows(raw, columns), oldParse(raw, columns));
    });
  }
}

test("pin: concrete values for the products sample (money via parse-money, enum case, blanks absent)", () => {
  const [first, second] = parseImportRows(readBack(SAMPLE_FILES.products, "xlsx"), PRODUCT_IMPORT_COLUMNS);
  assert.equal(first.values.code, "2050(A)-(K)");
  assert.equal(first.values.category, "BEDFRAME");
  assert.equal(first.values.status, "ACTIVE");
  assert.equal(first.values.costPriceSen, 1500);
  assert.equal(first.values.basePriceSen, 12000.5);
  assert.equal(first.values.fabricUsage, 8);
  assert.equal(first.values.unitM3, undefined);
  assert.equal(first.values.description, undefined);
  assert.deepEqual(first.errors, []);
  assert.ok(second.errors.includes("Product Name is required"));
  assert.ok(second.errors.some((e) => /Category must be one of/.test(e)));
  assert.ok(second.errors.some((e) => /Fabric Usage \(m\) must be a number/.test(e)));
  assert.ok(second.errors.some((e) => /Base Price \(RM\) must be an amount/.test(e)));
});

// ── 3. aliases ───────────────────────────────────────────────────────────────
test("aliases: a file with other common headers maps to the same fields", () => {
  const raw = readBack(
    [
      ["Code", "Description", "UOM", "Group", "Qty", "Is Active"],
      ["PC151-01", "Fabric", "MTR", "FABRIC", "4", "TRUE"],
    ],
    "csv",
  );
  const [row] = parseImportRows(raw, RM_IMPORT_COLUMNS);
  assert.deepEqual(row.errors, []);
  assert.equal(row.values.itemCode, "PC151-01");
  assert.equal(row.values.baseUOM, "MTR");
  assert.equal(row.values.itemGroup, "FABRIC");
  assert.equal(row.values.balanceQty, 4);
  assert.equal(row.values.isActive, true);
});

test("aliases: a column's own label always beats an alias, whatever the order", () => {
  const cols = [{ key: "code", label: "Product Code", aliases: ["Code"] }];
  const map = buildHeaderMap(["Code", "Product Code"], cols);
  assert.deepEqual([...map.entries()], [[1, "code"]]);
  // An alias never steals a header another field's label claimed.
  const two = [
    { key: "name", label: "Name" },
    { key: "productName", label: "Product Name", aliases: ["Name"] },
  ];
  assert.deepEqual([...buildHeaderMap(["Name"], two).entries()], [[0, "name"]]);
});

test("normalizeHeader / findHeaderIndex: case, spaces, `_` and the star do not matter; names tried in order", () => {
  assert.equal(normalizeHeader("  Item_Code  * "), "item code");
  assert.equal(normalizeHeader("BOM  Avg\u00a0Minutes"), "bom avg minutes");
  assert.equal(normalizeHeader(null), "");
  const head = ["WIP", "department", "BOM Time", "bom avg minutes *"];
  assert.equal(findHeaderIndex(head, "BOM Avg Minutes", "BOM Minutes", "Minutes"), 3);
  assert.equal(findHeaderIndex(head, "Department"), 1);
  assert.equal(findHeaderIndex(head, "Nope"), -1);
  assert.deepEqual(aoaToRecords([["A", "", "B"], [1, 2, 3]]), [{ A: 1, B: 3 }]);
});

test("the converted importers use the shared parser", () => {
  const dialog = readFileSync("src/components/ui/batch-import-dialog.tsx", "utf8");
  assert.match(dialog, /parseImportRows\(rawRows, columns\)/);
  assert.match(dialog, /buildExportAoa\(columns, rows\)/);
  assert.doesNotMatch(dialog, /headerToKey/, "the inline header map must be gone");
  const wip = readFileSync("src/pages/production/wip-times.tsx", "utf8");
  assert.match(wip, /findHeaderIndex\(headerRow, \.\.\.names\)/);
  const st = readFileSync("src/lib/stock-take-import.ts", "utf8");
  assert.match(st, /const headerName = \(v: unknown\) => normalizeHeader\(v\);/);
});
