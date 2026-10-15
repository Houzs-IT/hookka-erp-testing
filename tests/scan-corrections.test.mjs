// ---------------------------------------------------------------------------
// HK-0005: the scan learning loop must see the MISTAKE, not only the corrected
// answer. `diffCorrections` turns (raw extraction, operator-confirmed) into
// field-level pairs; `applyCorrections` replays them on the next scan of the
// same layout. Pure functions - the DB wrappers are exercised by the source
// guards in scan-originals.test.mjs.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  correctionKey,
  diffCorrections,
  applyCorrections,
  correctionMapKey,
} from "../src/api/lib/scan-corrections.ts";

const RAW_PO = {
  pos: [
    {
      customerPO: "PO-1",
      items: [
        { productCode: "SL 13.5 (E)", sizeCode: "Q", fabricCode: "PC151-O1", quantity: 2 },
        { productCode: "5530-1A", sizeCode: "K", fabricCode: "", quantity: 1 },
      ],
    },
  ],
};
const CORRECTED_PO = {
  customerPO: "PO-1",
  items: [
    { productCode: "SL-13.5-E", sizeCode: "Q", fabricCode: "PC151-01", quantity: 3 },
    { productCode: "5530-1A", sizeCode: "K", fabricCode: "PC151-01", quantity: 1 },
  ],
};

test("diffCorrections (po): logs the wrong value and the right one, per field", () => {
  const d = diffCorrections("po", RAW_PO, CORRECTED_PO);
  assert.deepEqual(
    d.map((x) => [x.field, x.rawValue, x.correctedValue]),
    [
      ["productCode", "SL 13.5 (E)", "SL-13.5-E"],
      ["fabricCode", "PC151-O1", "PC151-01"],
    ],
  );
});

test("diffCorrections: blank raw and numeric fields are not alias-able", () => {
  const d = diffCorrections("po", RAW_PO, CORRECTED_PO);
  assert.equal(d.some((x) => x.field === "quantity"), false, "qty is not a lookup");
  assert.equal(d.some((x) => x.rawValue === ""), false, "blank raw has no key to match on");
});

test("diffCorrections: case/whitespace-only edits are not corrections", () => {
  const d = diffCorrections(
    "po",
    { items: [{ productCode: " sl-1 " }] },
    { items: [{ productCode: "SL-1" }] },
  );
  assert.deepEqual(d, []);
});

test("diffCorrections (supplier): picks the raw doc by docNo, reads lines[]", () => {
  const raw = {
    docs: [
      { docNo: "A1", lines: [{ supplierCode: "X1", description: "FABRIC" }] },
      { docNo: "B2", lines: [{ supplierCode: "Y9", description: "FOAM 12MM" }] },
    ],
  };
  const corrected = { docNo: "B2", lines: [{ supplierCode: "Y9", description: "FOAM 12MM HR" }] };
  const d = diffCorrections("supplier", raw, corrected);
  assert.deepEqual(
    d.map((x) => [x.field, x.rawValue, x.correctedValue]),
    [["description", "FOAM 12MM", "FOAM 12MM HR"]],
  );
});

test("applyCorrections: replays a learned pair on the next scan, returns the count", () => {
  const map = new Map([
    [correctionMapKey("productCode", "SL 13.5 (E)"), "SL-13.5-E"],
  ]);
  const next = {
    items: [
      { productCode: "sl 13.5  (e)", quantity: 1 },
      { productCode: "OTHER", quantity: 1 },
    ],
  };
  const n = applyCorrections("po", next, map);
  assert.equal(n, 1);
  assert.equal(next.items[0].productCode, "SL-13.5-E");
  assert.equal(next.items[1].productCode, "OTHER");
});

test("applyCorrections: only touches the alias-able string fields", () => {
  const map = new Map([[correctionMapKey("quantity", "2"), "9"]]);
  const doc = { items: [{ quantity: 2 }] };
  assert.equal(applyCorrections("po", doc, map), 0);
  assert.equal(doc.items[0].quantity, 2);
});

test("correctionKey folds case and runs of whitespace", () => {
  assert.equal(correctionKey("  a   b\tc "), "A B C");
  assert.equal(correctionKey(null), "");
});
