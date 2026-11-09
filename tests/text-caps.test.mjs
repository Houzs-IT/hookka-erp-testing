// ---------------------------------------------------------------------------
// text-caps.test.mjs — server-side length caps on free-text fields.
//
// Hardening batch (owner-approved 2026-11-08). src/api/lib/text-caps.ts
// refuses an over-long name / note / remark / address with a 400 that names
// the field. This pins:
//   * the helper's behaviour (limits, item lines, plain English message);
//   * that base64 / image / JSON-blob fields are NEVER in a cap set;
//   * that the ten create/update handlers it was written for still call it
//     (sales orders, purchase orders, purchase invoices, customers, suppliers).
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as caps from '../src/api/lib/text-caps.ts';

const { textCapError, fieldLabel, NAME_MAX, NOTE_MAX } = caps;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a value at the limit passes; one character over is refused with the field named', () => {
  assert.equal(textCapError({ notes: 'x'.repeat(NOTE_MAX) }, caps.SO_HEADER_CAPS), null);
  const msg = textCapError({ notes: 'x'.repeat(NOTE_MAX + 1) }, caps.SO_HEADER_CAPS);
  assert.match(msg, /^Notes is too long \(5,001 characters\)\. The maximum is 5,000\.$/);
});

test('names are capped at 200', () => {
  assert.equal(textCapError({ name: 'A'.repeat(NAME_MAX) }, caps.CUSTOMER_CAPS), null);
  assert.match(textCapError({ name: 'A'.repeat(NAME_MAX + 1) }, caps.CUSTOMER_CAPS), /^Name is too long/);
  assert.match(
    textCapError({ contactPerson: 'A'.repeat(NAME_MAX + 1) }, caps.SUPPLIER_CAPS),
    /^Contact person is too long/,
  );
});

test('line items are checked and the message names the line', () => {
  const body = { notes: 'ok', items: [{ notes: 'fine' }, { notes: 'y'.repeat(NOTE_MAX + 1) }] };
  assert.match(textCapError(body, caps.SO_HEADER_CAPS, caps.SO_ITEM_CAPS), /^Line 2: Notes is too long/);
  // Without item caps, items are not inspected.
  assert.equal(textCapError(body, caps.SO_HEADER_CAPS), null);
});

test('non-strings, missing fields and odd bodies are ignored', () => {
  assert.equal(textCapError(null, caps.SO_HEADER_CAPS), null);
  assert.equal(textCapError('nope', caps.SO_HEADER_CAPS), null);
  assert.equal(textCapError({ notes: null, reference: 12345 }, caps.SO_HEADER_CAPS), null);
  assert.equal(textCapError({ items: 'not-an-array' }, {}, caps.SO_ITEM_CAPS), null);
  assert.equal(textCapError({ items: [null, 3, 'x'] }, {}, caps.SO_ITEM_CAPS), null);
});

test('fieldLabel turns keys into plain English', () => {
  assert.equal(fieldLabel('contactName'), 'Contact name');
  assert.equal(fieldLabel('hold_reason'), 'Hold reason');
  assert.equal(fieldLabel('addressLine1'), 'Address line1');
});

test('base64 / image / file / JSON-blob fields are never capped', () => {
  const sets = Object.entries(caps).filter(([k, v]) => k.endsWith('_CAPS') && v && typeof v === 'object');
  assert.ok(sets.length >= 8, 'expected the per-document cap sets');
  const forbidden = /b64|base64|image|photo|file|attachment|blob|json|customSpecials|materials|deliveryHubs/i;
  for (const [setName, set] of sets) {
    for (const key of Object.keys(set)) {
      assert.doesNotMatch(key, forbidden, `${setName}.${key} must not be length-capped`);
    }
  }
  // The SO image travels in the same body — a huge one must pass the cap check.
  assert.equal(
    textCapError({ customerPOImageB64: 'A'.repeat(500_000) }, caps.SO_HEADER_CAPS, caps.SO_ITEM_CAPS),
    null,
  );
});

test('the ten create/update handlers call textCapError right after parsing the body', () => {
  const wiring = [
    ['sales-orders.ts', 'SO_HEADER_CAPS, SO_ITEM_CAPS', 2],
    ['purchase-orders.ts', 'PO_HEADER_CAPS, PO_ITEM_CAPS', 2],
    ['purchase-invoices.ts', 'PI_HEADER_CAPS, PI_ITEM_CAPS', 2],
    ['customers.ts', 'CUSTOMER_CAPS', 2],
    ['suppliers.ts', 'SUPPLIER_CAPS', 2],
  ];
  for (const [file, args, expected] of wiring) {
    const src = readFileSync(join(ROOT, 'src', 'api', 'routes', file), 'utf8');
    const calls = src.split(`textCapError(body, ${args})`).length - 1;
    assert.equal(calls, expected, `${file}: expected ${expected} textCapError calls, found ${calls}`);
    assert.match(src, /if \(tooLong\) return c\.json\(\{ success: false, error: tooLong \}, 400\);/);
  }
});
