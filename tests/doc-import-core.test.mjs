// ---------------------------------------------------------------------------
// doc-import-core — the shared importer's planner (HK-0002), plus the SI rules.
//
// The properties that decide whether an import is safe:
//   * a BLANK cell keeps the stored value; a typed value wins — INCLUDING 0
//   * rows group by Doc No.: existing = edit, blank / NEW- / unknown = create
//   * an unknown or duplicated Line ID is an error, never a skip
//   * export → import with no edits is an EMPTY diff, for every listing
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planDocImport,
  currentFromListing,
  planHasWork,
  withFields,
  COMMON_FIELDS,
} from '../src/lib/doc-import/core.ts';
import { INVOICE_IMPORT_SPEC, invoiceEditPlan, validateInvoicePlan } from '../src/lib/doc-import/invoice.ts';
import { buildInvoiceDetailListingAoa } from '../src/lib/invoice-detail-listing.ts';
import {
  buildPoDetailListingAoa,
  buildGrnDetailListingAoa,
  buildDoDetailListingAoa,
  buildPiDetailListingAoa,
} from '../src/lib/doc-detail-listings.ts';
import { buildSoDetailListingAoa } from '../src/lib/so-detail-listing.ts';

const SPEC = { docTypes: ['SO'], fields: withFields(['qty', 'unitPrice', 'discount', 'description']) };
const H = ['Doc Type', 'Doc No.', 'Line ID', 'Item Code', 'Description', 'Qty', 'Unit Price', 'Discount'];
const stored = () =>
  new Map([
    ['SO-1', {
      id: 'so-1', docNo: 'SO-1', header: { docType: 'SO', docNo: 'SO-1' },
      lines: [
        { lineId: 'L1', values: { lineId: 'L1', itemCode: 'A', description: 'Bed', qty: 2, unitPrice: 50000, discount: 1000 } },
        { lineId: 'L2', values: { lineId: 'L2', itemCode: 'B', description: 'Sofa', qty: 1, unitPrice: 90000, discount: 0 } },
      ],
    }],
  ]);

test('blank keeps the stored value', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', 'L1', 'A', '', '', '', '']], stored(), SPEC);
  assert.deepEqual(plan.errors, []);
  const line = plan.docs[0].lines[0];
  assert.equal(line.action, 'update');
  assert.deepEqual(line.changes, [], 'every editable cell blank → nothing changes');
  assert.equal(line.merged.unitPrice, 50000);
  assert.equal(line.merged.discount, 1000);
  assert.equal(planHasWork(plan), false);
});

test('a typed 0 wins (it is not blank)', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', 'L1', 'A', '', '', 0, '0']], stored(), SPEC);
  const line = plan.docs[0].lines[0];
  assert.equal(line.merged.unitPrice, 0);
  assert.equal(line.merged.discount, 0);
  assert.deepEqual(line.changes.map((c) => [c.key, c.from, c.to]), [['unitPrice', 50000, 0], ['discount', 1000, 0]]);
});

test('money is read as ringgit → sen; "RM 1,234.50" parses', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', 'L2', 'B', '', '', 'RM 1,234.50', '']], stored(), SPEC);
  assert.equal(plan.docs[0].lines[0].merged.unitPrice, 123450);
});

test('create vs edit grouping by Doc No.', () => {
  const plan = planDocImport(
    [
      H,
      ['SO', 'SO-1', 'L1', 'A', '', 3, '', ''], // existing → edit
      ['SO', '', '', 'X', '', 1, 10, ''], // blank → ONE new doc
      ['SO', '', '', 'Y', '', 1, 10, ''],
      ['SO', 'NEW-1', '', 'X', '', 1, 10, ''], // NEW-1 → its own new doc
      ['SO', 'new-1', '', 'Y', '', 1, 10, ''], // same key, case-insensitive
      ['SO', 'NEW-2', '', 'Z', '', 1, 10, ''],
      ['SO', 'SO-999', '', 'Z', '', 1, 10, ''], // unknown number → create asking for it
    ],
    stored(),
    SPEC,
  );
  assert.deepEqual(plan.errors, []);
  const by = Object.fromEntries(plan.docs.map((d) => [d.key, d]));
  assert.equal(by['SO-1'].action, 'update');
  assert.equal(by[''].action, 'create');
  assert.equal(by[''].docNo, null, 'server assigns the number');
  assert.equal(by[''].lines.length, 2);
  assert.equal(by['NEW-1'].lines.length, 2);
  assert.equal(by['NEW-1'].docNo, null);
  assert.equal(by['NEW-2'].action, 'create');
  assert.equal(by['SO-999'].action, 'create');
  assert.equal(by['SO-999'].docNo, 'SO-999');
});

test('blank Line ID on an existing doc = a new line', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', '', 'C', 'Pillow', 4, 20, '']], stored(), SPEC);
  assert.equal(plan.docs[0].lines[0].action, 'create');
  assert.equal(plan.docs[0].lines[0].typed.qty, 4);
});

test('an unknown Line ID is an error, not a skip', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', 'L9', 'A', '', 1, '', '']], stored(), SPEC);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].message, /L9 is not a line of SO-1/);
  assert.equal(plan.errors[0].row, 2);
});

test('a Line ID twice in the file is refused on every copy', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', 'L1', 'A', '', 1, '', ''], ['SO', 'SO-1', 'L1', 'A', '', 2, '', '']], stored(), SPEC);
  assert.equal(plan.errors.length, 2);
});

test('a Line ID on a NEW doc is an error', () => {
  const plan = planDocImport([H, ['SO', 'NEW-1', 'L1', 'A', '', 1, 1, '']], stored(), SPEC);
  assert.match(plan.errors[0].message, /new document/);
});

test('read-only cells that differ are ignored with a warning', () => {
  const plan = planDocImport([H, ['SO', 'SO-1', 'L1', 'ZZZ', '', '', '', '']], stored(), SPEC);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0].message, /Item Code .* read-only/);
});

test('bad numbers, negatives and a wrong Doc Type are errors', () => {
  const plan = planDocImport(
    [H, ['SO', 'SO-1', 'L1', 'A', '', 'abc', '', ''], ['SO', 'SO-1', 'L2', 'B', '', -1, '', ''], ['PO', 'SO-1', 'L2', 'B', '', 1, '', '']],
    stored(),
    SPEC,
  );
  assert.equal(plan.errors.length, 3);
});

test('a header value contradicted inside one doc is an error', () => {
  const spec = { docTypes: ['SO'], fields: COMMON_FIELDS };
  const plan = planDocImport([['Doc No.', 'Ref Doc No.', 'Item Code'], ['', 'DO-1', 'A'], ['', 'DO-2', 'B']], new Map(), spec);
  assert.match(plan.errors[0].message, /Ref Doc No\./);
});

test('columns are found by name; a repeated name reads the first, warns on the rest', () => {
  const plan = planDocImport([['Discount', 'Line ID', 'Doc No.', 'Discount'], [5, 'L1', 'SO-1', 9]], stored(), SPEC);
  assert.equal(plan.docs[0].lines[0].merged.discount, 500);
  assert.equal(plan.warnings.length, 1);
});

test('no Doc No. column → refused outright', () => {
  const plan = planDocImport([['Line ID', 'Qty'], ['L1', 1]], stored(), SPEC);
  assert.equal(plan.docs.length, 0);
  assert.match(plan.errors[0].message, /Doc No\./);
});

// ---- export → import round trip: no diff, for EVERY listing ----------------
const allEditable = (type) => ({
  docTypes: [type],
  fields: withFields(COMMON_FIELDS.map((f) => f.key)),
});
const roundTrip = (type, aoa) => {
  const spec = allEditable(type);
  const ids = new Map(aoa.slice(1).map((r) => [String(r[1]), `id-${r[1]}`]));
  const current = currentFromListing(aoa, spec, ids);
  const plan = planDocImport(aoa, current, spec);
  assert.deepEqual(plan.errors, [], `${type}: no errors`);
  assert.equal(planHasWork(plan), false, `${type}: an unedited export imports as NO change`);
  assert.ok(plan.docs.every((d) => d.action === 'update'));
};

test('round trip: SO, PO, GRN, DO, PI, DI/SI exports import back with no diff', () => {
  roundTrip('SO', buildSoDetailListingAoa([
    { companySOId: 'SO-1', companySODate: '2026-10-01', customerId: 'c1', customerName: 'Acme', items: [
      { id: 'soi-1', productCode: 'BF-1', productName: 'Bed', quantity: 2, unitPriceSen: 45050, itemCategory: 'BEDFRAME' },
      { id: 'soi-2', productCode: 'AC-1', productName: 'Pillow', quantity: 1, unitPriceSen: 0, itemCategory: 'ACCESSORY' },
    ] },
  ], { debtorCodeByCustomerId: new Map([['c1', '300-A001']]) }));
  roundTrip('PO', buildPoDetailListingAoa([
    { poNo: 'PO-1', orderDate: '2026-10-01', supplierId: 's1', supplierName: 'Foam', items: [
      { id: 'poi-1', materialCode: 'F-1', materialName: 'Foam', unit: 'SHEET', quantity: 3, unitPriceSen: 1234, totalSen: 3702 },
    ] },
  ], new Map([['s1', '400-F001']])));
  roundTrip('GRN', buildGrnDetailListingAoa([
    { grnNumber: 'GRN-1', receiveDate: '2026-10-02', poNumber: 'PO-1', supplierName: 'Foam', items: [
      { id: 'gi-1', materialCode: 'F-1', materialName: 'Foam', acceptedQty: 3, unitPrice: 1234 },
    ] },
  ]));
  roundTrip('DO', buildDoDetailListingAoa([
    { doNo: 'DO-1', dispatchDate: '2026-10-03', customerName: 'Acme', items: [
      { id: 'doi-1', salesOrderNo: 'SO-1', productCode: 'BF-1', productName: 'Bed', quantity: 2 },
    ] },
  ]));
  roundTrip('PI', buildPiDetailListingAoa([
    { piNo: 'PI-1', invoiceDate: '2026-10-04', poRef: 'PO-1', supplierName: 'Foam', items: [
      { id: 'pii-1', materialCode: 'F-1', materialName: 'Foam', qty: 3, unitPriceSen: 1234, discountSen: 100, lineTotalSen: 3602 },
    ] },
  ]));
  roundTrip('DI', buildInvoiceDetailListingAoa([
    { invoiceNo: 'INV-1', invoiceDate: '2026-10-05', deliveryOrderId: 'do-1', doNo: 'DO-1', customerName: 'Acme', items: [
      { id: 'invi-1', productCode: 'BF-1', productName: 'Bed', quantity: 2, unitPriceSen: 76500, basePriceSen: 71000, divanPriceSen: 5500, itemCategory: 'BEDFRAME', discountSen: 0 },
    ] },
  ]));
});

// ---- SI / DI rules ---------------------------------------------------------
const invAoa = (items, over = {}) =>
  buildInvoiceDetailListingAoa([{ invoiceNo: 'INV-1', invoiceDate: '2026-10-05', deliveryOrderId: 'do-1', doNo: 'DO-1', customerName: 'Acme', status: 'SENT', items, ...over }]);
const bed = { id: 'invi-1', productCode: 'BF-1', quantity: 2, unitPriceSen: 76500, basePriceSen: 71000, divanPriceSen: 5500, itemCategory: 'BEDFRAME', discountSen: 0 };
const invCurrent = (aoa, meta = { status: 'SENT', paidSen: 0 }) =>
  currentFromListing(aoa, INVOICE_IMPORT_SPEC, new Map([['INV-1', 'inv-1']]), new Map([['INV-1', meta]]));
const col = (aoa, name) => aoa[0].indexOf(name);

test('SI edit: a typed Divan of 0 and a blank Base → priceEdits keep base, zero divan', () => {
  const aoa = invAoa([bed]);
  const cur = invCurrent(aoa);
  const edited = aoa.map((r) => [...r]);
  edited[1][col(aoa, 'Base')] = ''; // blank = keep 710.00
  edited[1][col(aoa, 'Divan')] = 0; // typed 0 wins
  const plan = planDocImport(edited, cur, INVOICE_IMPORT_SPEC);
  assert.deepEqual(validateInvoicePlan(plan), []);
  const { edits } = invoiceEditPlan(plan.docs[0]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].id, 'invi-1');
  assert.equal(edits[0].baseSen, 71000);
  assert.equal(edits[0].divanSen, 0);
  assert.equal(edits[0].allowZero, true);
});

test('SI edit: a stale Unit Price baseline is refused', () => {
  const aoa = invAoa([bed]);
  const cur = invCurrent(invAoa([{ ...bed, unitPriceSen: 80000, basePriceSen: 74500 }]));
  const edited = aoa.map((r) => [...r]);
  edited[1][col(aoa, 'Divan')] = 60;
  const errs = validateInvoicePlan(planDocImport(edited, cur, INVOICE_IMPORT_SPEC));
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /someone changed it/);
});

test('SI edit: a paid invoice is refused; adding a line to an invoice is refused', () => {
  const aoa = invAoa([bed]);
  const edited = aoa.map((r) => [...r]);
  edited[1][col(aoa, 'Divan')] = 60;
  const paid = validateInvoicePlan(planDocImport(edited, invCurrent(aoa, { status: 'SENT', paidSen: 100 }), INVOICE_IMPORT_SPEC));
  assert.match(paid[0].message, /payment/);
  const add = aoa.map((r) => [...r]);
  add.push(add[1].map((v, i) => (i === col(aoa, 'Line ID') ? '' : v)));
  const added = validateInvoicePlan(planDocImport(add, invCurrent(aoa), INVOICE_IMPORT_SPEC));
  assert.ok(added.some((e) => /ADD a line/.test(e.message)));
});

test('create: an SI (no DO) is refused; a DI needs Qty and a unique Item Code', () => {
  const head = ['Doc Type', 'Doc No.', 'Ref Doc No.', 'Item Code', 'Qty'];
  const si = validateInvoicePlan(planDocImport([head, ['SI', 'NEW-1', '', 'BF-1', 1]], new Map(), INVOICE_IMPORT_SPEC));
  assert.match(si[0].message, /SI without a DO/);
  const di = validateInvoicePlan(planDocImport([head, ['DI', 'NEW-1', 'DO-1', 'BF-1', ''], ['DI', 'NEW-1', 'DO-1', 'BF-1', 1]], new Map(), INVOICE_IMPORT_SPEC));
  assert.ok(di.some((e) => /Qty is blank/.test(e.message)));
  assert.ok(di.some((e) => /listed twice/.test(e.message)));
  const ok = validateInvoicePlan(planDocImport([head, ['DI', '', 'DO-1', 'BF-1', 1]], new Map(), INVOICE_IMPORT_SPEC));
  assert.deepEqual(ok, []);
});
