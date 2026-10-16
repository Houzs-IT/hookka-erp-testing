// ---------------------------------------------------------------------------
// doc-import-grn — the GRN adapter for the shared importer (HK-0002).
//
//   * export → import with no edits is an EMPTY diff (built by the real builder)
//   * edit: a typed Qty becomes the line's accepted qty; every other stored
//     line goes back to PUT /api/grn/:id untouched, in id order
//   * a blank cell keeps the stored value
//   * create: Ref Doc No. = the PO, rows name PO lines by Item Code
//   * one bad row → nothing from the file is applied
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { planDocImport, currentFromListing, planHasWork } from '../src/lib/doc-import/core.ts';
import { buildGrnDetailListingAoa } from '../src/lib/doc-detail-listings.ts';
import { runDocImport } from '../src/api/lib/doc-import.ts';
import {
  GRN_IMPORT_SPEC,
  grnImportAdapter,
  grnUpdateBody,
  grnCreateBody,
  validateGrnPlan,
} from '../src/api/lib/doc-import-grn.ts';

// Raw items as GET /api/grn/:id returns them — sorted by poItemIndex, so id
// order differs from display order on purpose.
const ITEMS = [
  { id: 12, poItemIndex: 0, materialCode: 'RM-A', materialName: 'Foam', supplierSKU: '', orderedQty: 10, receivedQty: 10, acceptedQty: 9, rejectedQty: 1, rejectionReason: 'torn', unitPrice: 1234.5 },
  { id: 11, poItemIndex: 1, materialCode: 'RM-B', materialName: 'Fabric', supplierSKU: '', orderedQty: 5, receivedQty: 5, acceptedQty: 5, rejectedQty: 0, rejectionReason: null, unitPrice: 800 },
];
const NOTE = {
  id: 'grn-1', grnNumber: 'GRN-2610-001', receiveDate: '2026-10-01', poNumber: 'PO-2610-007',
  supplierId: 's1', supplierName: 'Acme', status: 'POSTED', items: ITEMS,
};
const exported = () => buildGrnDetailListingAoa([NOTE], new Map([['s1', 'SUP-1']]));
const current = () =>
  currentFromListing(exported(), GRN_IMPORT_SPEC, new Map([[NOTE.grnNumber, NOTE.id]]),
    new Map([[NOTE.grnNumber, { status: 'POSTED', items: ITEMS }]]));
const col = (aoa, name) => aoa[0].indexOf(name);

test('round trip: an unedited GRN export imports back with no changes', () => {
  const plan = planDocImport(exported(), current(), GRN_IMPORT_SPEC);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(validateGrnPlan(plan), []);
  assert.equal(planHasWork(plan), false);
});

test('edit: a typed Qty is the accepted qty; other lines go back untouched, in id order', () => {
  const aoa = exported();
  const q = col(aoa, 'Qty');
  const row = aoa.findIndex((r) => r[col(aoa, 'Line ID')] === 12);
  aoa[row][q] = 7;
  const plan = planDocImport(aoa, current(), GRN_IMPORT_SPEC);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(validateGrnPlan(plan), []);
  const body = grnUpdateBody(plan.docs[0]);
  assert.deepEqual(body.items.map((i) => i.id), [11, 12], 'committed edits match by position on id ASC');
  assert.deepEqual(body.items[0], ITEMS[1], 'unchanged line is the stored line, byte for byte');
  assert.equal(body.items[1].acceptedQty, 7);
  assert.equal(body.items[1].receivedQty, 8, 'received = accepted + rejected');
  assert.equal(body.items[1].unitPrice, 1234.5, 'sub-sen price kept from the stored row, not the rounded export');
});

test('a blank cell keeps the stored value', () => {
  const aoa = exported();
  for (const r of aoa.slice(1)) {
    r[col(aoa, 'Qty')] = '';
    r[col(aoa, 'Description')] = '';
  }
  const plan = planDocImport(aoa, current(), GRN_IMPORT_SPEC);
  assert.deepEqual(plan.errors, []);
  assert.equal(planHasWork(plan), false);
  assert.equal(plan.docs[0].lines[0].merged.qty, 9);
});

test('edit: a row without a Line ID on an existing GRN is refused', () => {
  const aoa = exported();
  aoa.push([...aoa[1]]);
  aoa[3][col(aoa, 'Line ID')] = '';
  const plan = planDocImport(aoa, current(), GRN_IMPORT_SPEC);
  assert.match(validateGrnPlan(plan)[0].message, /ADD a line/);
});

test('create: Ref Doc No. names the PO, rows name PO lines by Item Code', () => {
  const aoa = [
    exported()[0],
  ];
  const blank = aoa[0].map(() => '');
  const put = (vals) => { const r = [...blank]; for (const [k, v] of Object.entries(vals)) r[col(aoa, k)] = v; aoa.push(r); };
  put({ 'Doc Type': 'GRN', 'Ref Doc No.': 'PO-9', 'Doc Date': '2026-10-15', 'Item Code': 'RM-B', Qty: 4, 'Rejected Qty': 1, 'Rejection Reason': 'wet' });
  put({ 'Doc Type': 'GRN', 'Ref Doc No.': 'PO-9', 'Item Code': 'RM-A', Qty: 0 });
  const plan = planDocImport(aoa, new Map(), GRN_IMPORT_SPEC);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(validateGrnPlan(plan), []);
  const body = grnCreateBody(plan.docs[0], 'po-9', [
    { id: 'pi-1', materialCode: 'RM-A' },
    { id: 'pi-2', material_code: 'RM-B' },
  ]);
  assert.equal(body.poId, 'po-9');
  assert.equal(body.receiveDate, '2026-10-15');
  assert.deepEqual(body.items, [
    { poId: 'po-9', poItemId: 'pi-2', poItemIndex: 1, receivedQty: 5, acceptedQty: 4, rejectedQty: 1, rejectionReason: 'wet' },
    { poId: 'po-9', poItemId: 'pi-1', poItemIndex: 0, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, rejectionReason: null },
  ]);
  assert.throws(() => grnCreateBody(plan.docs[0], 'po-9', [{ id: 'x', materialCode: 'RM-A' }]), /no line with Item Code RM-B/);
});

test('create: a typed number, a missing PO, a blank Qty and a repeated code are refused', () => {
  const H = exported()[0];
  const row = (vals) => H.map((h) => vals[h] ?? '');
  const plan = planDocImport([
    H,
    row({ 'Doc No.': 'GRN-9999-001', 'Ref Doc No.': 'PO-1', 'Item Code': 'A', Qty: 1 }),
    row({ 'Doc No.': 'NEW-1', 'Item Code': 'A' }),
    row({ 'Doc No.': 'NEW-1', 'Item Code': 'A', Qty: 1 }),
  ], new Map(), GRN_IMPORT_SPEC);
  const msgs = validateGrnPlan(plan).map((e) => e.message).join('\n');
  assert.match(msgs, /assigned on save/);
  assert.match(msgs, /needs Ref Doc No/);
  assert.match(msgs, /Qty is blank/);
  assert.match(msgs, /listed twice/);
});

test('all-or-nothing: one bad row and no GRN in the file is written', async () => {
  const NOTE2 = { ...NOTE, id: 'grn-2', grnNumber: 'GRN-2610-002', items: [{ ...ITEMS[1], id: 21 }] };
  const listing = buildGrnDetailListingAoa([NOTE, NOTE2], new Map());
  const updates = [];
  const adapter = {
    ...grnImportAdapter,
    async load(_ctx, docNos) {
      return currentFromListing(listing, GRN_IMPORT_SPEC,
        new Map([[NOTE.grnNumber, NOTE.id], [NOTE2.grnNumber, NOTE2.id]].filter(([n]) => docNos.includes(n))));
    },
    async update(_ctx, doc) { updates.push(doc.docNo); },
  };
  const aoa = listing.map((r) => [...r]);
  const q = col(aoa, 'Qty');
  aoa[1][q] = 3; // a good edit on GRN-2610-001
  aoa[3][col(aoa, 'Line ID')] = 'NOPE'; // GRN-2610-002: a Line ID it does not hold
  aoa[3][q] = 1;

  const db = { transaction: async (fn) => fn({}) };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('DB', db); await next(); });
  app.post('/', async (c) => c.json(await runDocImport(c, adapter, aoa, { execute: true, checkPermission: async () => null })));
  const r = await (await app.request('/', { method: 'POST' })).json();
  assert.equal(r.success, false);
  assert.equal(r.rolledBack, true);
  assert.match(r.errors[0].message, /NOPE is not a line/);
  assert.deepEqual(updates, [], 'the good GRN was not written either');
});
