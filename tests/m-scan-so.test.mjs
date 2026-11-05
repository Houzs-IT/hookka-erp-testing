// m-scan-so.test.mjs — the mobile "Scan customer PO → draft Sales Order" flow: the OCR → review →
// POST /api/sales-orders mapping (pure logic) plus guards on how the screens wire it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rmToSen, senToRm, normCategory, reviewItemFromRaw, draftFromPo, itemFlags, draftFlags, blockers, cleanSpecialOrder, droppedSpecials,
  soItemsBody, buildSoBody, correctedJsonFor, idempotencyKeyFor, fileProblem, posOfRow,
} from "../src/pages/m/lib/scan-so.ts";
import { aliasKey } from "../src/lib/party-alias-client.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

const CATALOG = {
  customers: [
    { id: "c1", code: "DI", name: "Desa Interior Sdn Bhd", hubs: [{ id: "h1", shortName: "Shah Alam", state: "Selangor" }, { id: "h2", shortName: "Johor Bahru", state: "Johor" }] },
    { id: "c2", code: "MH", name: "Mewah Home Living", hubs: [] },
  ],
  bedframes: ["HB-5001-Q", "HB-5003-S"],
  sofas: ["ASPEN-3S"],
  accessories: ["CUSH-45"],
  fabrics: ["LINEN-SAND"],
  bedframeSpecials: ["Headrest Firm"],
  sofaSpecials: ["Extra Cushion"],
};

// What POST /api/scan-po/extract and the scan queue really return (scan-po.ts ExtractedPO).
const RAW_PO = {
  customerPO: "DI-8840", customerName: "Desa Interior Sdn Bhd", customerCode: null, customerId: null, customerState: null,
  deliveryHub: "Shah Alam", deliveryHubId: null, yourRefNo: "REF-7", customerSO: "S-12", deliveryDate: "2026-11-20", isUrgent: false, pageNumbers: [1],
  items: [
    { category: "BEDFRAME", productCode: "HB-5001-Q", description: "Harbour", quantity: 4, sizeLabel: "5FT", fabricCode: "LINEN-SAND", divanHeightInches: 8, legHeightInches: 4, gapInches: 2, noLeg: false, specialOrder: "Headrest Firm, Nylon Fabric", specialNotes: null, unitPrice: 1890, transferredSO: null },
    { category: "SOFA", productCode: "ASPEN-3S", description: "Aspen", quantity: 2, sizeLabel: '28"', fabricCode: null, divanHeightInches: null, legHeightInches: null, gapInches: null, noLeg: true, specialOrder: null, specialNotes: "charcoal", unitPrice: 3300, transferredSO: "SO-0009" },
    { category: "ACCESSORY", productCode: "CUSH-45", description: "Cushion", quantity: 12, sizeLabel: null, fabricCode: null, divanHeightInches: null, legHeightInches: null, gapInches: null, noLeg: false, specialOrder: null, specialNotes: null, unitPrice: null, transferredSO: null },
  ],
};

// ---- price: RM on the document → integer sen --------------------------------
test("rmToSen converts RM to integer sen and treats blanks / junk / negatives as 0", () => {
  assert.equal(rmToSen(1890), 189000);
  assert.equal(rmToSen("1,890.50"), 189050);
  assert.equal(rmToSen(19.99), 1999, "float drift must not lose a sen");
  assert.equal(rmToSen("45"), 4500);
  for (const v of ["", null, undefined, "abc", -5, 0]) assert.equal(rmToSen(v), 0);
  assert.equal(senToRm(189000), "1890.00");
});

test("the server's `unitPrice` (RM) reaches the API as basePriceSen (sen); a missing price is 0, not NaN", () => {
  const items = soItemsBody(RAW_PO.items.map(reviewItemFromRaw), CATALOG);
  assert.deepEqual(items.map((i) => i.basePriceSen), [189000, 330000, 0]);
});

// ---- category: server `category` → API `itemCategory` --------------------------
test("the server's `category` becomes itemCategory — a scanned sofa stays a sofa", () => {
  const items = soItemsBody(RAW_PO.items.map(reviewItemFromRaw), CATALOG);
  assert.deepEqual(items.map((i) => i.itemCategory), ["BEDFRAME", "SOFA", "ACCESSORY"]);
  assert.equal(normCategory("sofa"), "SOFA");
  assert.equal(normCategory("Chair"), "", "unknown stays unset so the operator must pick, not default to BEDFRAME");
  assert.equal(normCategory(undefined), "");
});

test("sofa seat height goes on sizeLabel AND seatHeight; a bedframe size is left to the product master", () => {
  const [bed, sofa] = soItemsBody(RAW_PO.items.map(reviewItemFromRaw), CATALOG);
  assert.equal(sofa.sizeLabel, "28");
  assert.equal(sofa.seatHeight, "28");
  assert.equal(bed.sizeLabel, "", "the OCR's '5FT' is reference text, never the stored size");
  assert.equal(bed.seatHeight, "");
  assert.equal(bed.productName, "", "product name is resolved by the server");
});

test("variant numbers, noLeg, transferredSO and notes are carried; specials outside the catalog are dropped and reported", () => {
  const items = RAW_PO.items.map(reviewItemFromRaw);
  const [bed, sofa] = soItemsBody(items, CATALOG);
  assert.equal(bed.divanHeightInches, 8);
  assert.equal(bed.legHeightInches, 4);
  assert.equal(bed.gapInches, 2);
  assert.equal(sofa.legHeightInches, null, "noLeg sends null, not 0");
  assert.equal(sofa.transferredFromSO, "SO-0009");
  assert.equal(sofa.notes, "charcoal");
  assert.equal(bed.specialOrder, "Headrest Firm");
  assert.deepEqual(droppedSpecials(items[0], CATALOG), ["Nylon Fabric"]);
  assert.equal(cleanSpecialOrder(items[0], { bedframeSpecials: [], sofaSpecials: [] }), "Headrest Firm, Nylon Fabric", "no catalog list loaded → keep the raw text");
  assert.deepEqual(bed.lineNo, 1);
  assert.equal(bed.lineSuffix, "-01");
});

// ---- customer / hub resolution -------------------------------------------------
test("customer and hub resolve from the catalog (name match, then the hub printed on the PO)", () => {
  const d = draftFromPo(RAW_PO, CATALOG, {});
  assert.equal(d.customerId, "c1");
  assert.equal(d.hubId, "h1");
  assert.equal(d.deliveryDate, "2026-11-20");
  assert.equal(d.reference, "REF-7");
  assert.equal(d.customerSO, "S-12");
  const byHub = draftFromPo({ ...RAW_PO, customerName: "DESA INTERIOR" }, CATALOG, {});
  assert.equal(byHub.customerId, "c1", "legal-suffix differences must still match");
});

test("a taught alias outranks the heuristics, and an unknown customer stays unresolved", () => {
  const taught = draftFromPo({ ...RAW_PO, customerName: "Zzz Trading", deliveryHub: null }, CATALOG, { [aliasKey("Zzz Trading")]: "c2" });
  assert.equal(taught.customerId, "c2");
  const none = draftFromPo({ ...RAW_PO, customerName: "Totally Unknown Pte", deliveryHub: null }, CATALOG, {});
  assert.equal(none.customerId, "");
  assert.ok(blockers(none).some((b) => /customer/i.test(b)), "no silent guess: the operator must choose");
});

test("an unreadable delivery date is left empty rather than invented", () => {
  assert.equal(draftFromPo({ ...RAW_PO, deliveryDate: "next week" }, CATALOG, {}).deliveryDate, "");
  assert.equal(draftFromPo({ ...RAW_PO, deliveryDate: null }, CATALOG, {}).deliveryDate, "");
  assert.equal(draftFromPo({ ...RAW_PO, deliveryDate: "2026-11-20T00:00:00Z" }, CATALOG, {}).deliveryDate, "2026-11-20");
});

// ---- the request body ------------------------------------------------------------
test("the body is a DRAFT SO from a scan: no confirm, hub and customer set, original sent as a file not an image blob", () => {
  const d = draftFromPo(RAW_PO, CATALOG, {});
  const b = buildSoBody(d, CATALOG, RAW_PO, "2026-11-03");
  assert.equal(b.status, "DRAFT");
  assert.equal(b.isServiceOrder, false);
  assert.equal(b.source, "PO_SCAN_CLAUDE");
  assert.equal(b.customerId, "c1");
  assert.equal(b.customerName, "Desa Interior Sdn Bhd");
  assert.equal(b.deliveryHubId, "h1");
  assert.equal(b.customerState, "Selangor", "state comes from the chosen hub");
  assert.equal(b.customerPOId, "DI-8840");
  assert.equal(b.reference, "REF-7");
  assert.equal(b.customerSOId, "S-12");
  assert.equal(b.customerDeliveryDate, "2026-11-20");
  assert.equal(b.companySODate, "2026-11-03");
  assert.equal(b.customerPOImageB64, null);
  assert.equal(b.items.length, 3);
  assert.doesNotMatch(JSON.stringify(b), /CONFIRMED/);
});

test("operator edits win: changed customer, hub, qty, price and code all reach the body", () => {
  const d = draftFromPo(RAW_PO, CATALOG, {});
  d.customerId = "c2"; d.hubId = ""; d.customerPO = " DI-8841 ";
  d.items[0].qty = "6"; d.items[0].priceRm = "2,000"; d.items[0].productCode = " HB-5003-S ";
  const b = buildSoBody(d, CATALOG, RAW_PO, "2026-11-03");
  assert.equal(b.customerId, "c2");
  assert.equal(b.deliveryHubId, null);
  assert.equal(b.customerPOId, "DI-8841");
  assert.equal(b.items[0].quantity, 6);
  assert.equal(b.items[0].basePriceSen, 200000);
  assert.equal(b.items[0].productCode, "HB-5003-S");
});

// ---- review flags -----------------------------------------------------------------
test("flags: not-found fields are counted, price-less / off-catalog lines are 'check', and create is blocked only by real gaps", () => {
  const d = draftFromPo({ ...RAW_PO, customerPO: "", deliveryDate: null }, CATALOG, {});
  const f = draftFlags(d, CATALOG);
  assert.ok(f.missing.has("customerPO") && f.missing.has("deliveryDate"));
  assert.equal(f.missing.has("customerId"), false);
  assert.equal(f.checkCount >= 2, true, "the price-less accessory and the dropped special are worth a look");
  // (The shared fixture mixes a bedframe and a sofa, which the server rejects; use a valid order here.)
  const valid = { ...d, items: d.items.filter((i) => i.category !== "SOFA") };
  assert.deepEqual(blockers(valid), [], "a missing PO number or date does not stop a DRAFT");
  assert.ok(blockers(d).some((m) => /Sofa and Bedframe cannot be on the same Sales Order/.test(m)), "the mixed-category rule is told before the request");
  const bad = { ...d, items: [{ ...d.items[0], productCode: "", qty: "0" }] };
  assert.equal(blockers(bad).length, 2);
  assert.equal(blockers({ ...d, items: [] }).length, 1);
  const flags = itemFlags({ ...d.items[0], productCode: "NOPE-1" }, CATALOG);
  assert.ok(flags.some((x) => x.field === "productCode" && x.kind === "check"));
});

test("a customer with hubs but none chosen raises a hub 'check' (the server then picks by state / default)", () => {
  const d = draftFromPo({ ...RAW_PO, deliveryHub: null }, CATALOG, {});
  assert.equal(d.customerId, "c1");
  assert.equal(draftFlags(d, CATALOG).hubCheck, true);
  assert.equal(draftFlags({ ...d, customerId: "c2" }, CATALOG).hubCheck, false, "a customer with no hubs has nothing to pick");
});

// ---- accuracy report ----------------------------------------------------------------
test("the OCR-accuracy report carries the FINAL imported values, prices back in RM", () => {
  const d = draftFromPo(RAW_PO, CATALOG, {});
  d.customerPO = "DI-8841"; d.items[0].qty = "5"; d.items[0].priceRm = "1950";
  const c = correctedJsonFor(RAW_PO, d, CATALOG);
  assert.equal(c.customerPO, "DI-8841");
  assert.equal(c.items[0].quantity, 5);
  assert.equal(c.items[0].unitPrice, 1950);
  assert.equal(c.items[0].category, "BEDFRAME");
  assert.equal(c.customerName, RAW_PO.customerName, "untouched extraction fields stay as read");
});

// ---- idempotency -----------------------------------------------------------------------
test("a retry of the same body re-uses its Idempotency-Key; an edited body gets a fresh one", () => {
  const store = { body: null, key: null };
  let n = 0;
  const make = () => `k${++n}`;
  const a = { x: 1 };
  assert.equal(idempotencyKeyFor(store, a, make), "k1");
  assert.equal(idempotencyKeyFor(store, { x: 1 }, make), "k1", "network blip → retry → same key, no duplicate SO");
  assert.equal(idempotencyKeyFor(store, { x: 2 }, make), "k2");
});

// ---- files + queue rows ------------------------------------------------------------------
test("fileProblem follows the scan-po contract (PDF / JPEG / PNG / WebP, up to 32 MB)", () => {
  assert.equal(fileProblem({ name: "po.pdf", type: "application/pdf", size: 1000 }), null);
  assert.equal(fileProblem({ name: "IMG_1.JPG", type: "", size: 1000 }), null);
  assert.equal(fileProblem({ name: "p.webp", type: "image/webp", size: 1000 }), null);
  assert.match(fileProblem({ name: "p.heic", type: "image/heic", size: 1000 }), /JPEG/);
  assert.match(fileProblem({ name: "p.pdf", type: "application/pdf", size: 33 * 1024 * 1024 }), /32 MB/);
  assert.match(fileProblem({ name: "p.pdf", type: "application/pdf", size: 0 }), /empty/);
});

test("posOfRow keeps each PO's own index for /consume and skips empty ones after numbering", () => {
  const rows = posOfRow({ pos: [{ items: [] }, { customerPO: "A", items: [{}] }, { customerPO: "B", items: [{}] }] });
  assert.deepEqual(rows.map((r) => [r.po.customerPO, r.docIdx]), [["A", 1], ["B", 2]]);
  assert.deepEqual(posOfRow(null), []);
  assert.deepEqual(posOfRow({ docs: [] }), []);
});

// ---- wiring guards -------------------------------------------------------------------------
test("the sheet uses the existing queue, original-document and learning helpers — not the sync /extract route", () => {
  const src = read("screens/dashboard/ScanSoSheet.tsx");
  assert.match(src, /\/api\/scan-queue\/upload/);
  assert.match(src, /createScanQueueDriver/);
  assert.match(src, /\/api\/scan-queue\/batch\//);
  assert.match(src, /\/api\/scan-po\/catalog/);
  assert.match(src, /persistSoOriginal/);
  assert.match(src, /postScanQueueConsume/);
  assert.match(src, /teachPartyAlias/);
  assert.match(src, /\/api\/scan-po\/samples\/\$\{[^}]+\}\/confirm/);
  assert.match(src, /"Idempotency-Key"/);
  assert.match(src, /idempotencyKeyFor/);
  assert.match(src, /"\/api\/sales-orders"/);
  assert.doesNotMatch(src, /\/api\/scan-po\/extract/);
  assert.doesNotMatch(src, /\/confirm`?, "POST"\)|status: "CONFIRMED"|\/api\/sales-orders\/[^"`]*\/confirm/, "a scan never confirms the order");
});

test("success is shown only after the API says the order exists, and it links to the saved SO", () => {
  const src = read("screens/dashboard/ScanSoSheet.tsx");
  const create = src.slice(src.indexOf("const createOrder"), src.indexOf("const createOrder") + 3500);
  assert.match(create, /if \(!res\.ok\)/);
  assert.ok(create.indexOf("if (!res.ok)") < create.indexOf('setStep("done")'), "the failure branch returns before the success step is set");
  assert.match(src, /navigate\(`\/m\/sales\/\$\{encodeURIComponent\(result\.id\)\}`\)/);
  assert.match(src, /step === "done" && result/, "the success card needs a real result from the API");
});

test("Home shows the four tiles; Sales Order, Purchase Invoice and Goods Receipt open flows, Payment Voucher is labelled Coming soon", () => {
  const sec = read("screens/dashboard/ScanToCreate.tsx");
  for (const t of ["Sales Order", "Purchase Invoice", "Goods Receipt", "Payment Voucher"]) assert.match(sec, new RegExp(t));
  for (const s of ["Scan customer PO", "Scan supplier invoice", "Scan supplier document", "Scan bill / receipt"]) assert.match(sec, new RegExp(s));
  assert.match(sec, /Coming soon/);
  assert.match(sec, /hasPermission\("sales-orders", "create"\)/);
  assert.match(sec, /hasPermission\("purchase-orders", "create"\)/, "the scan route itself needs purchase-orders:create");
  assert.match(sec, /aria-disabled/);
  const home = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(home, /<ScanToCreate/);
  assert.doesNotMatch(home, /Quick actions|newDeliveryOrderSpec|newPurchaseOrderSpec|New SO/, "the old chips are replaced");
  assert.doesNotMatch(sec, /setTimeout|simulat/i, "no simulated create flow");
});
