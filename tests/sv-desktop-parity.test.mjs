// sv-desktop-parity.test.mjs — Clone payload, company selection and sofa seat size follow the DESKTOP
// (src/pages/sales/detail.tsx handleClone, src/pages/sales/create.tsx). Pure model checks + wiring checks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FALLBACK_SOFA_SEAT_HEIGHTS } from "../src/lib/sofa-seat-heights.ts";
import {
  blankHeader, cloneSeedFromDoc, companyForCustomer, createBody, editBody, formBlockers, headerFromDoc, blankLine,
  sofaSizeOptions, sofaSizePatch, lineBody,
} from "../src/pages/m/screens/orders/sv-form-model.ts";

const read = (p) => readFileSync(p, "utf8");

const SOURCE = {
  companySOId: "SV-2611-004", customerId: "c1", customerName: "Desa Interior", hubId: "h1", hubName: "KL",
  customerPOId: "PO-9", customerSOId: "SO-9", reference: "Original ref", salesOrgCode: "OHANA",
  customerDeliveryDate: "2026-11-20T00:00:00Z", hookkaExpectedDD: "2026-11-18", notes: "Handle with care", companySODate: "2026-11-01",
  items: [{
    id: "i1", productId: "p1", productCode: "BF-1", productName: "Harbour", itemCategory: "BEDFRAME", sizeCode: "Q", sizeLabel: "Queen", fabricCode: "F1",
    quantity: 2, basePriceSen: 120000, gapInches: 4, divanHeightInches: 8, divanPriceSen: 5000, legHeightInches: 6, legPriceSen: 3000,
    specialOrder: "HB Fully Cover", specialOrderPriceSen: 2500, notes: "n", discountSen: 9000, totalHeightPriceSen: 700,
    customSpecials: [{ description: "x", surchargeSen: 100 }], repairScope: JSON.stringify({ preset: "UPHOLSTERY_ONLY", depts: ["UPHOLSTERY"] }),
  }],
};

test("Clone matches desktop handleClone: PO/SO ids, hub and company are blank; reference is 'Clone of <no>'", () => {
  const { header, lines } = cloneSeedFromDoc(SOURCE, "2026-11-10");
  assert.equal(header.customerId, "c1");
  assert.equal(header.customerPOId, "");
  assert.equal(header.customerSOId, "");
  assert.equal(header.hubId, "");
  assert.equal(header.salesOrgCode, "HOOKKA");
  assert.equal(header.reference, "Clone of SV-2611-004");
  assert.equal(header.companySODate, "2026-11-10");
  assert.equal(header.customerDeliveryDate, "2026-11-20");
  assert.equal(header.hookkaExpectedDD, "2026-11-18");
  assert.equal(header.notes, "Handle with care");
  assert.equal(lines.length, 1);
});

test("Clone line carries only the desktop's fields; discount, custom specials, scope and total-height are reset", () => {
  const l = cloneSeedFromDoc(SOURCE, "2026-11-10").lines[0];
  assert.equal(l.id, "");
  assert.equal(l.quantity, 2);
  assert.equal(l.basePriceSen, 120000);
  assert.equal(l.divanPriceSen, 5000);
  assert.equal(l.legPriceSen, 3000);
  assert.equal(l.specialOrder, "HB Fully Cover");
  assert.equal(l.specialOrderPriceSen, 2500);
  assert.equal(l.gapInches, 4);
  assert.equal(l.discountSen, 0);
  assert.equal(l.totalHeightPriceSen, 0);
  assert.deepEqual(l.customSpecials, []);
  assert.equal(l.scope.preset, "FULL");
});

test("Company: create sends salesOrgCode (default HOOKKA); edit never sends it; headerFromDoc reads it", () => {
  const h = { ...blankHeader("2026-11-10"), customerId: "c1" };
  assert.equal(createBody(h, []).salesOrgCode, "HOOKKA");
  assert.equal(createBody({ ...h, salesOrgCode: "OHANA" }, []).salesOrgCode, "OHANA");
  assert.equal("salesOrgCode" in editBody({ ...h, salesOrgCode: "OHANA" }, [], { draft: true }), false);
  assert.equal(headerFromDoc(SOURCE).salesOrgCode, "OHANA");
  assert.equal(headerFromDoc({}).salesOrgCode, "HOOKKA");
});

test("Company follows the customer's default only when it is an ACTIVE org (desktop Phase 4 rule)", () => {
  assert.equal(companyForCustomer("ohana", ["HOOKKA", "OHANA"], "HOOKKA"), "OHANA");
  assert.equal(companyForCustomer("GONE", ["HOOKKA", "OHANA"], "OHANA"), "OHANA");
  assert.equal(companyForCustomer("", ["HOOKKA"], "HOOKKA"), "HOOKKA");
  assert.equal(companyForCustomer(undefined, [], "HOOKKA"), "HOOKKA");
});

test("Sofa seat size: options from variants-config.sofaSizes, fallback to the desktop list", () => {
  assert.deepEqual(sofaSizeOptions(["30", '28"', "", "28"]), ["28", "30"]);
  assert.deepEqual(sofaSizeOptions(undefined), FALLBACK_SOFA_SEAT_HEIGHTS);
  assert.deepEqual(sofaSizeOptions([]), FALLBACK_SOFA_SEAT_HEIGHTS);
});

test("Sofa seat size mapping = desktop selectSeatHeight: sizeLabel is the value, sizeCode drops quotes", () => {
  assert.deepEqual(sofaSizePatch('28"'), { sizeLabel: '28"', sizeCode: "28" });
  assert.deepEqual(sofaSizePatch("30"), { sizeLabel: "30", sizeCode: "30" });
  assert.deepEqual(sofaSizePatch(""), { sizeLabel: "", sizeCode: "" });
  const sofa = { ...blankLine(), itemCategory: "SOFA", productId: "p", productCode: "5530-2A", fabricCode: "F", ...sofaSizePatch("28") };
  assert.equal(lineBody(sofa).seatHeight, "28");
  assert.equal(lineBody(sofa).sizeLabel, "28");
});

test("A sofa line with no seat size blocks Save & confirm (desktop 'select a seat size')", () => {
  const sofa = { ...blankLine(), itemCategory: "SOFA", productId: "p", productCode: "5530-2A", fabricCode: "F" };
  assert.ok(formBlockers({ customerId: "c1" }, [sofa]).some((m) => /seat size/i.test(m)));
  assert.ok(!formBlockers({ customerId: "c1" }, [{ ...sofa, ...sofaSizePatch("28") }]).some((m) => /seat size/i.test(m)));
  const bf = { ...blankLine(), itemCategory: "BEDFRAME", productId: "p", productCode: "BF", fabricCode: "F", sizeLabel: "" };
  assert.ok(!formBlockers({ customerId: "c1" }, [bf]).some((m) => /seat size/i.test(m)), "bedframes are not asked for a seat size");
});

test("wiring: form uses the clone helper, /api/organisations, and a create-only Company select; item editor has Seat size", () => {
  const form = read("src/pages/m/screens/orders/SvOrderForm.tsx");
  assert.match(form, /cloneSeedFromDoc\(doc, todayIso\(\)\)/);
  assert.match(form, /"\/api\/organisations"/);
  assert.match(form, /!isEdit \? \(/);
  assert.match(form, /companyForCustomer\(/);
  const item = read("src/pages/m/screens/orders/sv-form-item.tsx");
  assert.match(item, /aria-label="Seat size"/);
  assert.match(item, /sofaSizePatch\(/);
});
