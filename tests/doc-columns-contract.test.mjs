// ---------------------------------------------------------------------------
// doc-columns-contract — every document Detail Listing LEADS with the same
// column block, in the same order, with the same names (HK-0002). That block is
// what the shared importer reads, so a listing that drifts from it is a listing
// that can no longer be imported back.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';

import { commonHeaders } from '../src/lib/doc-columns.ts';
import { COMMON_FIELDS } from '../src/lib/doc-import/core.ts';
import { SO_DETAIL_HEADERS, buildSoDetailListingAoa } from '../src/lib/so-detail-listing.ts';
import { INVOICE_DETAIL_HEADERS, buildInvoiceDetailListingAoa } from '../src/lib/invoice-detail-listing.ts';
import {
  PO_DETAIL_HEADERS, GRN_DETAIL_HEADERS, DO_DETAIL_HEADERS, PI_DETAIL_HEADERS,
  buildPoDetailListingAoa, buildGrnDetailListingAoa, buildDoDetailListingAoa, buildPiDetailListingAoa,
} from '../src/lib/doc-detail-listings.ts';

const LISTINGS = [
  ['SO', SO_DETAIL_HEADERS, false, () => buildSoDetailListingAoa([{ companySOId: 'X', items: [] }])],
  ['PO', PO_DETAIL_HEADERS, false, () => buildPoDetailListingAoa([{ poNo: 'X' }])],
  ['GRN', GRN_DETAIL_HEADERS, true, () => buildGrnDetailListingAoa([{ grnNumber: 'X' }])],
  ['DO', DO_DETAIL_HEADERS, true, () => buildDoDetailListingAoa([{ doNo: 'X' }])],
  ['PI', PI_DETAIL_HEADERS, true, () => buildPiDetailListingAoa([{ piNo: 'X' }])],
  ['SI', INVOICE_DETAIL_HEADERS, true, () => buildInvoiceDetailListingAoa([{ invoiceNo: 'X', items: [] }])],
  // DI = the same invoices listing, for an invoice raised from a DO.
  ['DI', INVOICE_DETAIL_HEADERS, true, () => buildInvoiceDetailListingAoa([{ invoiceNo: 'X', deliveryOrderId: 'do-1', items: [] }])],
];

test('the shared block is exactly the contract', () => {
  assert.deepEqual(commonHeaders(true), [
    'Doc Type', 'Doc No.', 'Doc Date', 'Party Code', 'Party Name', 'Ref Doc No.',
    'Line ID', 'Item Code', 'Description', 'Qty', 'UOM', 'Unit Price', 'Discount', 'Line Total',
  ]);
  assert.deepEqual(commonHeaders(false), commonHeaders(true).filter((h) => h !== 'Ref Doc No.'));
});

test('the importer reads the same names the exports write', () => {
  assert.deepEqual(COMMON_FIELDS.map((f) => f.header), commonHeaders(true));
});

for (const [type, headers, withRef, build] of LISTINGS) {
  test(`${type} listing leads with the shared block`, () => {
    const block = commonHeaders(withRef);
    assert.deepEqual(headers.slice(0, block.length), block);
    const aoa = build();
    assert.deepEqual(aoa[0], [...headers]);
    for (const row of aoa.slice(1)) assert.equal(row.length, headers.length, 'every row as wide as the header');
    assert.match(String(aoa[1][0]), type === 'SI' ? /^SI$/ : new RegExp(`^${type}$`), 'Doc Type cell');
    assert.equal(aoa[1][1], 'X', 'Doc No. cell');
  });
}

test('DI vs SI: the Doc Type says whether the invoice came from a DO', () => {
  const aoa = buildInvoiceDetailListingAoa([
    { invoiceNo: 'A', deliveryOrderId: 'do-1', items: [] },
    { invoiceNo: 'B', deliveryOrderId: '', items: [] },
  ]);
  assert.equal(aoa[1][0], 'DI');
  assert.equal(aoa[2][0], 'SI');
});
