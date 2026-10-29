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
  learnFromConfirm,
  diffReverts,
  loadCorrections,
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

test("diffCorrections: an inserted/deleted line yields nothing (no index mis-pairing)", () => {
  const raw = { items: [{ productCode: "A1" }, { productCode: "B2" }] };
  const corrected = { items: [{ productCode: "NEW" }, { productCode: "A1-X" }, { productCode: "B2" }] };
  assert.deepEqual(diffCorrections("po", raw, corrected), []);
});

// Stub DB: scan_field_corrections kept in memory; customers owned by org o1.
function corrDb() {
  const rows = [];
  const stmt = (sql, b = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (/INSERT INTO scan_field_corrections/i.test(sql)) {
        const [, org, kind, scope, field, norm, , corrected, , , sample] = b;
        const hit = rows.find((r) => r.org === org && r.kind === kind && r.scope === scope && r.field === field && r.norm === norm);
        // mirrors the SQL: the same sample id never adds a second hit
        if (hit) { hit.corrected = corrected; if (hit.sample !== sample) hit.hits++; hit.sample = sample; }
        else rows.push({ org, kind, scope, field, norm, corrected, hits: 1, sample });
      }
      if (/UPDATE scan_field_corrections SET hits = 0/i.test(sql)) {
        const [org, kind, scope, field, norm] = b;
        for (const r of rows) if (r.org === org && r.kind === kind && r.scope === scope && r.field === field && r.norm === norm && r.hits > 0) { r.hits = 0; r.corrected = "(raw)"; }
      }
      return {};
    },
    first: async () => (/FROM customers/i.test(sql) && b[0] === "c1" && b[1] === "o1" ? { id: "c1" } : null),
    all: async () => {
      const [kind, scope, org] = b;
      const min = /hits >= 2/.test(sql) ? 2 : 0;
      return { results: rows.filter((r) => r.kind === kind && r.scope === scope && r.org === org && r.hits >= min)
        .map((r) => ({ field: r.field, rawNorm: r.norm, correctedValue: r.corrected })) };
    },
  });
  return { rows, prepare: (sql) => stmt(sql) };
}

test("learnFromConfirm + loadCorrections: replays only after the pair was confirmed twice", async () => {
  const db = corrDb();
  const o = { orgId: "o1", kind: "po", scopeId: "c1", raw: JSON.stringify(RAW_PO), corrected: CORRECTED_PO };
  assert.equal(await learnFromConfirm(db, { ...o, sampleId: "s1" }), 2);
  assert.equal((await loadCorrections(db, o)).size, 0, "one confirm is not enough");
  await learnFromConfirm(db, { ...o, sampleId: "s2" });
  const map = await loadCorrections(db, o);
  assert.equal(map.get(correctionMapKey("productCode", "SL 13.5 (E)")), "SL-13.5-E");
  assert.equal((await loadCorrections(db, { ...o, orgId: "o2" })).size, 0, "other org sees nothing");
});

test("learnFromConfirm: scope that is not this org's customer learns nothing", async () => {
  const db = corrDb();
  const n = await learnFromConfirm(db, { orgId: "o1", kind: "po", scopeId: "c-foreign", raw: RAW_PO, corrected: CORRECTED_PO });
  assert.equal(n, 0);
  assert.equal(db.rows.length, 0);
});

const K2Q = { raw: { items: [{ productCode: "1003-(K)" }] }, corrected: { items: [{ productCode: "1003-(Q)" }] } };
const orgPo = { orgId: "o1", kind: "po", scopeId: "c1" };

test("diffCorrections: two lines with the same misread are one decision", () => {
  const raw = { items: [{ productCode: "A1" }, { productCode: "A1" }] };
  const corrected = { items: [{ productCode: "B1" }, { productCode: "B1" }] };
  assert.equal(diffCorrections("po", raw, corrected).length, 1);
});

test("learnFromConfirm: same-misread lines or a retried confirm of one sample never reach hits>=2", async () => {
  const db = corrDb();
  const raw = { items: [{ productCode: "A1" }, { productCode: "A1" }] };
  const corrected = { items: [{ productCode: "B1" }, { productCode: "B1" }] };
  await learnFromConfirm(db, { ...orgPo, raw, corrected, sampleId: "s1" });
  await learnFromConfirm(db, { ...orgPo, raw, corrected, sampleId: "s1" }); // rejected create + retry
  assert.equal((await loadCorrections(db, orgPo)).size, 0);
  await learnFromConfirm(db, { ...orgPo, raw, corrected, sampleId: "s2" });
  assert.equal((await loadCorrections(db, orgPo)).size, 1, "a second sample is a second decision");
});

test("diffReverts: raw kept as read is a revert, unless corrected elsewhere in the doc", () => {
  assert.deepEqual(diffReverts("po", K2Q.raw, K2Q.raw).map((x) => x.rawValue), ["1003-(K)"]);
  assert.deepEqual(diffReverts("po", K2Q.raw, K2Q.corrected), []);
  const raw = { items: [{ productCode: "A1" }, { productCode: "A1" }] };
  assert.deepEqual(diffReverts("po", raw, { items: [{ productCode: "B1" }, { productCode: "A1" }] }), []);
});

test("learnFromConfirm: typing the raw value back unlearns a replayed pair", async () => {
  const db = corrDb();
  await learnFromConfirm(db, { ...orgPo, ...K2Q, sampleId: "s1" });
  await learnFromConfirm(db, { ...orgPo, ...K2Q, sampleId: "s2" });
  const k = correctionMapKey("productCode", "1003-(K)");
  assert.equal((await loadCorrections(db, orgPo)).get(k), "1003-(Q)", "learned after two decisions");
  // replayed screen showed (Q); operator files (K) back, equal to the stored raw OCR read
  await learnFromConfirm(db, { ...orgPo, raw: K2Q.raw, corrected: K2Q.raw, sampleId: "s3" });
  assert.equal((await loadCorrections(db, orgPo)).size, 0, "pair retired, replay is a no-op");
});
