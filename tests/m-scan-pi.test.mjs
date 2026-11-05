// m-scan-pi.test.mjs — the pure logic of "scan a supplier invoice → DRAFT Purchase Invoice" on mobile
// (src/pages/m/lib/scan-pi.ts), which is the desktop CreatePIWizard taken out of its 6,000-line component.
// Fixture data only: this proves the matching / money / request body, not that real OCR reads a real
// invoice, and not that the real API accepts it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  docsOfRow, pickSupplierFromName, makeBindingResolver, buildPiCard, changeSupplier, pickMaterial, relinkToPos, applyPoPriceFill, materialOptions,
  lineTaxesSen, cardTotals, piBlockers, piDraftBody, correctedExtraction, isFutureInvoiceDate, matchTierHint, poOrderedFor, blankLine,
} from "../src/pages/m/lib/scan-pi.ts";
import { aliasKey } from "../src/lib/party-alias-client.ts";

const SUP = [
  { id: "s1", name: "ADD WOOD INDUSTRIES SDN BHD", code: "400-A002", purchaseOrgCode: "HOOKKA" },
  { id: "s2", name: "Foamtech Industries", code: "400-F001", purchaseOrgCode: "HOUZS" },
  { id: "s3", name: "Kain Mewah Textile Sdn Bhd", code: "400-K003" },
];
const MAT = [
  { itemCode: "PLY-9-48-AB", description: "9MM 4' X 8' PLYWOOD AB" },
  { itemCode: "PLY-18-48-AB", description: "18MM 4' X 8' PLYWOOD AB" },
  { itemCode: "FOAM-32-2", description: "HD Foam 32kg 2in sheet" },
  { itemCode: "NICCA-06-FOG", description: "Nicca fog thread" },
];
const BIND = [
  { supplierId: "s1", materialCode: "PLY-9-48-AB", supplierSku: "SL 27", supplierDescription: "9MM 4' X 8' PLYWOOD AB" },
  { supplierId: "s1", materialCode: "PLY-18-48-AB", supplierSku: "OST-SL 31", supplierDescription: "18MM 4X8 PLYWOOD AB" },
  { supplierId: "s2", materialCode: "FOAM-32-2", supplierSku: "HDF-32-2", supplierDescription: "HD FOAM 32KG 2IN" },
  { supplierId: "s2", materialCode: "NICCA-06-FOG", supplierSku: "NICCA-06-FOG", supplierDescription: "NICCA FOG" },
];
const PO = [
  { id: "po-1", poNo: "PO-2607-003", supplierId: "s1", status: "CONFIRMED", items: [{ id: "i1", materialCode: "PLY-9-48-AB", materialName: "9MM PLY", quantity: 10, receivedQty: 0, unitPriceSen: 4550 }] },
  { id: "po-2", poNo: "PO-2607-020", supplierId: "s1", status: "CONFIRMED", items: [{ id: "i2", materialCode: "PLY-18-48-AB", materialName: "18MM PLY", quantity: 5, receivedQty: 0, unitPriceSen: 8800 }] },
];
const ctx = (over = {}) => ({ suppliers: SUP, materials: MAT, bindings: BIND, purchaseOrders: PO, orgs: [{ code: "HOOKKA", name: "Hookka" }, { code: "HOUZS", name: "Houzs" }], aliases: {}, ...over });

// ---- documents ---------------------------------------------------------------------------------------
test("docsOfRow keeps each document's own index (for /consume), skips empty ones, and accepts a legacy single doc", () => {
  const docs = docsOfRow({ docs: [{ lines: [] }, { docNo: "A", lines: [{ description: "x" }] }, { docNo: "B", lines: [{ description: "y" }] }] });
  assert.deepEqual(docs.map((d) => [d.doc.docNo, d.docIdx]), [["A", 1], ["B", 2]]);
  assert.deepEqual(docsOfRow({ docNo: "L", lines: [{ description: "z" }] }).map((d) => d.doc.docNo), ["L"]);
  assert.deepEqual(docsOfRow(null), []);
  assert.deepEqual(docsOfRow({ docs: [] }), []);
});

// ---- the supplier ------------------------------------------------------------------------------------------
test("supplier: exact, then punctuation-insensitive, then a taught alias outranks every heuristic", () => {
  assert.equal(pickSupplierFromName("Foamtech Industries", SUP)?.id, "s2");
  assert.equal(pickSupplierFromName("ADD WOOD INDUSTRIES SDN. BHD.", SUP)?.id, "s1");
  assert.equal(pickSupplierFromName("400-F001", SUP)?.id, "s2", "by supplier code");
  assert.equal(pickSupplierFromName("Totally Unrelated Co", SUP), null, "no coin-flip");
  assert.equal(pickSupplierFromName("Zzz Trading", SUP, { [aliasKey("Zzz Trading")]: "s3" })?.id, "s3");
  assert.equal(pickSupplierFromName("", SUP), null);
});

// ---- bindings: the two-way link ------------------------------------------------------------------------------
test("binding resolution: their code, our code in their column, their wording, zero-padding, vendor prefix", () => {
  const r = makeBindingResolver(BIND);
  assert.equal(r.anyWay("s1", "SL.27", "")?.materialCode, "PLY-9-48-AB", "their SKU with OCR drift");
  assert.equal(r.anyWay("s1", "PLY-18-48-AB", "")?.materialCode, "PLY-18-48-AB", "OUR code in their column");
  assert.equal(r.anyWay("s1", "", "9MM 4' X 8' PLYWOOD AB")?.materialCode, "PLY-9-48-AB", "their wording");
  assert.equal(r.anyWay("s2", "NICCA-6-FOG", "")?.materialCode, "NICCA-06-FOG", "same code, different zero-padding");
  assert.equal(r.anyWay("s1", "SL 31", "")?.materialCode, "PLY-18-48-AB", "binding carries a vendor prefix (OST-)");
  assert.equal(r.anyWay("s1", "7", ""), null, "a stray digit identifies nothing");
  assert.equal(r.anyWay("", "SL 27", ""), null, "no supplier, no binding");
  assert.equal(r.anyWay("s3", "SL 27", ""), null, "another supplier's code is not this supplier's");
});

// ---- the card ----------------------------------------------------------------------------------------------------
const DOC = {
  supplierName: "ADD WOOD INDUSTRIES SDN. BHD.", docType: "INVOICE", docNo: "INV-55120", deliveryOrderNo: "DO-3381", docDate: "2026-11-02", currency: "MYR",
  customerPoRef: "2607-003", subtotal: 800, tax: 48, total: 848, discount: 20,
  lines: [
    { supplierCode: "SL 27", description: "9MM 4' X 8' PLYWOOD AB", qty: 10, uom: "pcs", unitPrice: 45.5, amount: 455, tax: 0 },
    { supplierCode: "2", description: "Scatter foam", qty: 4, uom: "sheet", unitPrice: null, amount: null, density: "NLY22GH", thickness: "25MM" },
  ],
};

test("a scanned invoice becomes a card: supplier, company, numbers by document type, date, discount, lines as typeable strings", () => {
  const c = buildPiCard(DOC, ctx());
  assert.equal(c.supplierId, "s1");
  assert.equal(c.purchaseOrgCode, "HOOKKA");
  assert.equal(c.supplierInvoiceNo, "INV-55120");
  assert.equal(c.supplierDoNo, "DO-3381", "an explicit D/O reference fills the DO field on an invoice");
  assert.equal(c.invoiceDate, "2026-11-02");
  assert.equal(c.discountRm, "20");
  assert.equal(c.lines.length, 2);
  assert.deepEqual([c.lines[0].qty, c.lines[0].unitPriceRm, c.lines[0].uom], ["10", "45.5", "pcs"]);
  assert.equal(c.docTotalRm, 848);
});

test("document-type routing: a delivery note's number is the DO number, not the invoice number", () => {
  const c = buildPiCard({ ...DOC, docType: "DELIVERY_NOTE", docNo: "DN-9", deliveryOrderNo: null }, ctx());
  assert.equal(c.supplierDoNo, "DN-9");
  assert.equal(c.supplierInvoiceNo, "");
  assert.equal(buildPiCard({ ...DOC, docDate: "garbage" }, ctx(), { today: "2026-11-04" }).invoiceDate, "2026-11-04", "an unreadable date falls back to today, flagged by the future-date rule if wrong");
});

test("line matching: a binding fills BOTH codes; the line-number 'code' is ignored; foam spec rides on the description", () => {
  const c = buildPiCard(DOC, ctx());
  const [a, b] = c.lines;
  assert.equal(a.materialCode, "PLY-9-48-AB");
  assert.equal(a.supplierSku, "SL 27");
  assert.equal(a.autoMatched, false, "a saved binding is established, not a guess");
  assert.equal(b.supplierSku, "", "the running number 2 is not a supplier code");
  assert.match(b.description, /\(NLY22GH 25MM\)/);
  assert.equal(b.qty, "4");
});

test("a line with no binding is matched from the text only when it is clear, and the tier is recorded", () => {
  const c = buildPiCard({ ...DOC, customerPoRef: null, lines: [{ supplierCode: "", description: "18MM 4' X 8' PLYWOOD AB", qty: 2, unitPrice: 88 }] }, ctx({ bindings: [] }));
  assert.equal(c.lines[0].materialCode, "PLY-18-48-AB");
  assert.equal(c.lines[0].autoMatched, true);
  assert.ok(["supplier", "catalog", "po"].includes(c.lines[0].matchTier));
  const unclear = buildPiCard({ ...DOC, customerPoRef: null, lines: [{ supplierCode: "", description: "PLYWOOD", qty: 1, unitPrice: 1 }] }, ctx({ bindings: [] }));
  assert.equal(unclear.lines[0].materialCode, "", "a near-tie is left for the operator, not guessed");
});

test("the PO the supplier printed links; each line is allocated to its owner; a missing price comes from that order", () => {
  const c = buildPiCard({ ...DOC, customerPoRef: "2607-003/2607-020", lines: [
    { supplierCode: "SL 27", description: "9MM PLY", qty: 10, unitPrice: null },
    { supplierCode: "OST-SL 31", description: "18MM PLY", qty: 5, unitPrice: 90 },
  ] }, ctx());
  assert.deepEqual(c.purchaseOrderIds.sort(), ["po-1", "po-2"]);
  assert.deepEqual(c.multiPoRefs, ["2607-003", "2607-020"]);
  assert.deepEqual(c.lines.map((l) => l.poId), ["po-1", "po-2"]);
  assert.equal(c.lines[0].unitPriceRm, "45.5", "priced from its own order's line (4550 sen)");
  assert.equal(c.lines[1].unitPriceRm, "90", "a price on the document is never overwritten");
  const unnamed = buildPiCard({ ...DOC, customerPoRef: "9999-001" }, ctx());
  assert.deepEqual(unnamed.unmatchedPoRefs, ["9999-001"]);
  assert.deepEqual(unnamed.purchaseOrderIds, []);
});

test("re-linking the orders re-allocates the lines (the old link must not outlive the change)", () => {
  let c = buildPiCard(DOC, ctx());
  assert.equal(c.lines[0].poId, "po-1");
  c = relinkToPos(c, [], ctx());
  assert.equal(c.lines[0].poId, null);
  c = relinkToPos(c, ["po-1", "po-2"], ctx());
  assert.equal(c.lines[0].poId, "po-1");
});

test("changing the supplier re-resolves lines against that supplier's bindings; picking a material fills both codes", () => {
  const base = buildPiCard({ ...DOC, supplierName: "" , customerPoRef: null, lines: [{ supplierCode: "HDF-32-2", description: "foam", qty: 1, unitPrice: 5 }] }, ctx({ bindings: BIND }), { defaultSupplierId: "s1" });
  assert.equal(base.supplierId, "s1");
  assert.equal(base.lines[0].materialCode, "", "s1 has no such code");
  const moved = changeSupplier(base, "s2", ctx());
  assert.equal(moved.purchaseOrgCode, "HOUZS");
  assert.equal(moved.lines[0].materialCode, "FOAM-32-2");
  const picked = pickMaterial(base, "l0", "PLY-9-48-AB", ctx());
  assert.equal(picked.lines[0].materialCode, "PLY-9-48-AB");
  assert.equal(picked.lines[0].supplierSku, "SL 27", "the supplier's own code comes from the binding");
  assert.equal(picked.lines[0].autoMatched, false);
  const opts = materialOptions("s1", ctx());
  assert.equal(opts.length, MAT.length, "nothing is hidden: the rest of the catalogue stays reachable");
  assert.ok(opts.find((o) => o.itemCode === "PLY-9-48-AB").known);
  assert.equal(opts.find((o) => o.itemCode === "FOAM-32-2").known, false);
});

// ---- money ----------------------------------------------------------------------------------------------------------
const money = (lines, over = {}) => ({ ...buildPiCard(DOC, ctx()), lines: lines.map((l, i) => ({ ...blankLine(`l${i}`), ...l })), discountRm: "", docTaxRm: null, ...over });

test("the invoice discount is spread over the lines and sums exactly", () => {
  const c = money([{ qty: "10", unitPriceRm: "45.5" }, { qty: "4", unitPriceRm: "10" }], { discountRm: "20" });
  const t = cardTotals(c);
  assert.equal(t.subtotalSen, 45500 + 4000);
  assert.equal(t.discountSen, 2000);
  assert.equal(t.totalSen, 49500 - 2000);
});

test("tax: the footer tax is spread pro-rata and the last line absorbs rounding, so it sums to the footer", () => {
  const c = money([{ qty: "1", unitPriceRm: "33.33" }, { qty: "1", unitPriceRm: "33.33" }, { qty: "1", unitPriceRm: "33.34" }], { docTaxRm: 6 });
  const taxes = lineTaxesSen(c);
  assert.equal(taxes.reduce((a, b) => a + b, 0), 600);
  assert.equal(taxes.length, 3);
});

test("tax: if the operator typed any per-line SST those figures are used verbatim and the footer is ignored", () => {
  const c = money([{ qty: "1", unitPriceRm: "100", taxRm: "6" }, { qty: "1", unitPriceRm: "100" }], { docTaxRm: 99 });
  assert.deepEqual(lineTaxesSen(c), [600, 0]);
});

test("no footer tax and no per-line tax: every line is untaxed", () => {
  assert.deepEqual(lineTaxesSen(money([{ qty: "2", unitPriceRm: "5" }])), [0]);
});

// ---- gates -----------------------------------------------------------------------------------------------------------
test("create is blocked by the same rules as the desktop wizard: supplier, a line, STRICT PICK, a future date", () => {
  const ok = buildPiCard(DOC, ctx());
  ok.lines[1] = { ...ok.lines[1], ...{ materialCode: "FOAM-32-2" } };
  assert.deepEqual(piBlockers(ok, ctx(), Date.parse("2026-11-04T00:00:00Z")), []);
  assert.ok(piBlockers({ ...ok, supplierId: "" }, ctx()).some((m) => /supplier/i.test(m)));
  assert.ok(piBlockers({ ...ok, lines: [] }, ctx()).some((m) => /at least one line/i.test(m)));
  const unbound = { ...ok, lines: [...ok.lines, { ...blankLine("x"), materialName: "mystery" }] };
  assert.ok(piBlockers(unbound, ctx()).some((m) => /not matched to a catalogue item/.test(m)));
  assert.ok(piBlockers({ ...ok, invoiceDate: "2099-01-01" }, ctx()).some((m) => /in the future/.test(m)));
  assert.equal(isFutureInvoiceDate("2026-11-05", Date.parse("2026-11-04T12:00:00Z")), false, "inside the 36-hour tolerance");
  assert.equal(isFutureInvoiceDate("2026-11-07", Date.parse("2026-11-04T12:00:00Z")), true);
});

test("hints say how far to trust a match", () => {
  assert.match(matchTierHint("po"), /linked PO/);
  assert.match(matchTierHint("supplier"), /delivered before/);
  assert.match(matchTierHint("catalog"), /text alone/);
  assert.match(matchTierHint(null, "code"), /supplier's code/);
  const c = buildPiCard(DOC, ctx());
  assert.deepEqual(poOrderedFor(c.lines[0], PO), { poNo: "PO-2607-003", ordered: 10 });
  assert.equal(poOrderedFor({ materialCode: "", poId: null }, PO), null);
});

// ---- the request ------------------------------------------------------------------------------------------------------
test("the body is a DRAFT PI: never confirmed, blank lines dropped, rates keep sub-cent digits, the source file id rides along", () => {
  const c = buildPiCard(DOC, ctx());
  c.lines[1] = { ...c.lines[1], materialCode: "FOAM-32-2", unitPriceRm: "0.055", qty: "100" };
  c.lines.push(blankLine("blank"));
  const b = piDraftBody(c, ctx(), "INV-55120.jpg", "file-77");
  assert.equal(b.status, "DRAFT");
  assert.equal(b.supplierId, "s1");
  assert.equal(b.supplierName, "ADD WOOD INDUSTRIES SDN BHD");
  assert.equal(b.supplierInvoiceNo, "INV-55120");
  assert.equal(b.supplierDoNo, "DO-3381");
  assert.equal(b.purchaseOrgCode, "HOOKKA");
  assert.equal(b.remarks, "Scanned: INV-55120.jpg");
  assert.equal(b.sourceDocumentFileId, "file-77");
  assert.equal(b.purchaseOrderId, "po-1");
  assert.equal(b.items.length, 2, "the blank line is not sent");
  assert.equal(b.items[1].unitPriceSen, 5.5, "RM 0.055 is 5.5 sen, not 6");
  assert.equal(b.items[0].poId, "po-1");
  assert.equal(b.items[0].lineType, "STOCKED");
  assert.equal(b.items[0].grnItemId, null);
  assert.doesNotMatch(JSON.stringify(b), /CONFIRMED/);
  assert.equal("sourceDocumentFileId" in piDraftBody(c, ctx(), "x.jpg", null), false);
});

test("a catalogue-tier guess may fill the field but may not teach a binding (unverifiedMatch); a binding or PO match may", () => {
  const c = buildPiCard({ ...DOC, customerPoRef: null, lines: [{ supplierCode: "", description: "HD Foam 32kg 2in sheet", qty: 1, unitPrice: 5 }] }, ctx({ bindings: [], purchaseOrders: [] }));
  const b = piDraftBody(c, ctx({ bindings: [], purchaseOrders: [] }), "x.jpg", null);
  assert.equal(b.items[0].materialCode, "FOAM-32-2");
  assert.equal(b.items[0].unverifiedMatch, c.lines[0].matchTier === "catalog");
  const bound = buildPiCard(DOC, ctx());
  assert.equal(piDraftBody(bound, ctx(), "x.jpg", null).items[0].unverifiedMatch, false);
});

test("the accuracy report carries the FINAL values in the extraction's own shape", () => {
  const c = buildPiCard(DOC, ctx());
  c.supplierInvoiceNo = "INV-55121";
  c.lines[0] = { ...c.lines[0], qty: "12" };
  const out = correctedExtraction(c, DOC);
  assert.equal(out.docNo, "INV-55121");
  assert.equal(out.lines[0].qty, 12);
  assert.equal(out.lines[0].supplierCode, "SL 27");
  assert.equal(out.discount, 20);
  assert.equal(out.supplierName, DOC.supplierName, "the printed name stays as read");
});

test("applyPoPriceFill never overwrites a price that is on the document", () => {
  const lines = [{ ...blankLine("a"), materialCode: "PLY-9-48-AB", unitPriceRm: "50" }, { ...blankLine("b"), materialCode: "PLY-9-48-AB" }];
  const out = applyPoPriceFill(lines, PO[0]);
  assert.deepEqual(out.map((l) => l.unitPriceRm), ["50", "45.5"]);
  assert.equal(applyPoPriceFill(lines, null), lines);
});

// ---- the sheet wiring (source-level: no network, no OCR) -----------------------------------------------------------
import { readFileSync as _rf } from "node:fs";
const src = (p) => _rf(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

test("the PI tile is live and opens the PI sheet behind purchase-invoices:create + the scan route's permission", () => {
  const s = src("screens/dashboard/ScanToCreate.tsx");
  assert.match(s, /hasPermission\("purchase-invoices", "create"\) && canScan, live: true/);
  assert.match(s, /<ScanPiSheet/);
});

test("the PI sheet uploads the original BEFORE the POST, creates only DRAFTs, never confirms, and shows success only for a real id + piNo", () => {
  const s = src("screens/procurement/ScanPiSheet.tsx");
  const create = s.slice(s.indexOf("const createInvoice"), s.indexOf("// ---- resume"));
  assert.ok(create.indexOf("uploadSourceDoc") < create.indexOf('"/api/purchase-invoices"'), "original saved before the invoice");
  assert.match(create, /Idempotency-Key/);
  assert.match(create, /!data\?\.id \|\| !data\.piNo/);
  assert.ok(create.indexOf("!res.ok") < create.indexOf('setStep("done")'));
  assert.doesNotMatch(s, /status: "CONFIRMED"|purchase-invoices[^`"]*\/confirm/, "a scan never confirms the invoice (the /samples/:id/confirm call is the OCR accuracy report)");
  assert.match(s, /Create without the scanned document/, "failed original upload is an explicit choice");
});

test("a retry after the invoice exists runs only the follow-ups, never the create", () => {
  const s = src("screens/procurement/ScanPiSheet.tsx");
  const fin = s.slice(s.indexOf("const finishFollowUps"), s.indexOf("const openFinish"));
  assert.doesNotMatch(fin, /purchase-invoices"/);
  assert.match(fin, /runFollowUps/);
});

test("editing a saved PI keeps line notes (a PUT replaces every line)", async () => {
  const { piEditLines, piEditBody } = await import("../src/pages/m/lib/procurement-mobile.ts");
  const lines = piEditLines({ items: [{ materialCode: "A", materialName: "A", qty: 2, unitPriceSen: 100, notes: "colour: grey" }] });
  const body = piEditBody({ invoiceDate: "2026-01-01", dueDate: "", remarks: "Scanned: x.pdf", supplierInvoiceNo: "I1", supplierDoNo: "" }, lines);
  assert.equal(body.items[0].notes, "colour: grey");
  assert.equal(body.remarks, "Scanned: x.pdf");
});

test("the PI detail page links the stored source document inline", () => {
  const s = src("screens/procurement/PiDetail.tsx");
  assert.match(s, /label: "Source document"/);
  assert.ok(s.includes("/api/files/${encodeURIComponent(d.id)}/download?inline=1"));
});
