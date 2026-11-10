// ---------------------------------------------------------------------------
// import-schemas.ts — the column schemas of the BatchImportDialog importers.
//
// Moved out of the pages (O6) so the round-trip test can prove each table
// imports its own export (tests/table-import-round-trip.test.mjs). ORDER
// determines the template / export column order. The `code` / `itemCode`
// column is the match key — existing rows with the same key get updated in
// place, new keys get created. Prices are in ringgit (sen / 100) to match the
// "(RM)" headers; the pages convert.
// ---------------------------------------------------------------------------
import type { ImportColumn } from "./table-import";

/** Products page — Batch Import / Export SKUs (POST /api/products/bulk-import). */
export const PRODUCT_IMPORT_COLUMNS: ImportColumn[] = [
  { key: "id", label: "ID", hidden: true },
  { key: "code", label: "Product Code", aliases: ["Code", "SKU", "SKU Code"], required: true, example: "2050(A)-(K)" },
  { key: "name", label: "Product Name", aliases: ["Name"], required: true, example: "ROMA BEDFRAME (6FT)" },
  { key: "category", label: "Category", required: true, enum: ["BEDFRAME", "SOFA", "ACCESSORY"], example: "BEDFRAME" },
  { key: "description", label: "Description", example: "" },
  { key: "baseModel", label: "Base Model", example: "2050(A)" },
  { key: "sizeCode", label: "Size Code", example: "K", help: "K / Q / S / SS / SK / SP" },
  { key: "sizeLabel", label: "Size Label", example: "6FT" },
  { key: "fabricUsage", label: "Fabric Usage (m)", aliases: ["Fabric Usage"], type: "number", example: 8 },
  { key: "unitM3", label: "Unit m³", type: "number", example: 0 },
  { key: "status", label: "Status", enum: ["ACTIVE", "INACTIVE"], example: "ACTIVE" },
  { key: "costPriceSen", label: "Cost Price (RM)", aliases: ["Cost Price", "Cost"], type: "money", example: 1500 },
  { key: "basePriceSen", label: "Base Price (RM)", aliases: ["Base Price", "Price"], type: "money", example: 2500 },
];

/** Inventory → Finished Products batch import (POST /api/products/bulk-import). */
export const FG_IMPORT_COLUMNS: ImportColumn[] = [
  { key: "id", label: "ID", hidden: true },
  { key: "code", label: "Product Code", aliases: ["Code", "SKU", "SKU Code"], required: true, example: "2050(A)-(K)", help: "Unique product code" },
  { key: "name", label: "Product Name", aliases: ["Name"], required: true, example: "ROMA BEDFRAME (6FT)" },
  { key: "category", label: "Category", required: true, enum: ["BEDFRAME", "SOFA", "ACCESSORY"], example: "BEDFRAME" },
  { key: "baseModel", label: "Base Model", example: "2050(A)", help: "Optional family name grouping" },
  { key: "sizeCode", label: "Size Code", example: "K", help: "K / Q / S / SS / SK / SP" },
  { key: "sizeLabel", label: "Size Label", example: "6FT" },
  { key: "basePriceSen", label: "Base Price (RM)", aliases: ["Base Price", "Price"], type: "money", example: 2500, help: "In ringgit, converted to sen internally" },
  { key: "costPriceSen", label: "Cost Price (RM)", aliases: ["Cost Price", "Cost"], type: "money", example: 1500 },
  // Metres of fabric, not money - stays a plain number column on purpose.
  { key: "fabricUsage", label: "Fabric Usage (m)", aliases: ["Fabric Usage"], type: "number", example: 8 },
];

/** Inventory → Raw Materials batch import (POST /api/raw-materials/bulk-import). */
export const RM_IMPORT_COLUMNS: ImportColumn[] = [
  { key: "id", label: "ID", hidden: true },
  { key: "itemCode", label: "Item Code", aliases: ["Code", "Material Code", "Internal Code"], required: true, example: "PC151-01", help: "Unique item code" },
  { key: "description", label: "Description", required: true, example: "Fabric PC151-01 Grey" },
  { key: "baseUOM", label: "Base UOM", aliases: ["UOM", "Unit"], required: true, example: "MTR", help: "One of the units in RM Settings → Units." },
  { key: "itemGroup", label: "Item Group", aliases: ["Group", "Stock Group"], required: true, example: "FABRIC", help: "FABRIC / PLYWOOD / FOAM etc." },
  { key: "balanceQty", label: "Balance Qty", aliases: ["Balance", "Qty"], type: "number", example: 0 },
  { key: "isActive", label: "Active", aliases: ["Is Active"], type: "boolean", example: "TRUE" },
  { key: "notes", label: "Notes", help: "Blank keeps the stored note. Type [CLEAR] to empty it." },
  { key: "mainSupplierCode", label: "Main Supplier Code", help: "Blank keeps the stored code. Type [CLEAR] to empty it." },
];
