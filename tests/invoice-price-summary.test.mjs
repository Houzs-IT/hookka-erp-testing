// HK-0158 — Invoice Price Summary: a new unit price becomes the same priceEdits
// entry the invoice's own editor sends, keeping the add-ons and moving Base.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { monthRange, unitPriceEdit, editsByInvoice } from '../src/lib/invoice-price-summary.ts';

const line = (o = {}) => ({
  id: 'L1',
  invoiceId: 'I1',
  unitPriceSen: 42000,
  discountSen: 0,
  basePriceSen: 0,
  divanPriceSen: 0,
  legPriceSen: 0,
  specialOrderPriceSen: 0,
  totalHeightPriceSen: 0,
  ...o,
});

test('monthRange covers the whole month, leap Feb included', () => {
  assert.deepEqual(monthRange('2026-11'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

test('reconciling build-up: add-ons kept, Base absorbs the change', () => {
  const l = line({ basePriceSen: 37000, divanPriceSen: 3000, legPriceSen: 2000, discountSen: 500 });
  const r = unitPriceEdit(l, 47000);
  assert.deepEqual(r.edit, {
    id: 'L1', baseSen: 42000, divanSen: 3000, legSen: 2000, specialSen: 0, totalHeightSen: 0,
    discountSen: 500, allowZero: false,
  });
});

test('non-reconciling build-up is not trusted: whole charge goes to Base', () => {
  const l = line({ basePriceSen: 100, divanPriceSen: 3000 }); // sums to 3100, charge 42000
  const r = unitPriceEdit(l, 47000);
  assert.equal(r.edit.baseSen, 47000);
  assert.equal(r.edit.divanSen, 0);
});

test('price below the add-ons is refused, not clamped', () => {
  const l = line({ basePriceSen: 37000, divanPriceSen: 5000 });
  assert.ok('error' in unitPriceEdit(l, 4000));
});

test('a typed zero is a deliberate free line', () => {
  assert.equal(unitPriceEdit(line(), 0).edit.allowZero, true);
});

test('editsByInvoice skips untouched and unchanged lines, groups the rest', () => {
  const lines = [
    line({ id: 'A', invoiceId: 'I1' }),
    line({ id: 'B', invoiceId: 'I1' }),
    line({ id: 'C', invoiceId: 'I2' }),
    line({ id: 'D', invoiceId: 'I2', basePriceSen: 30000, divanPriceSen: 12000 }),
  ];
  const { groups, errors } = editsByInvoice(lines, { A: 45000, B: 42000, D: 100 });
  assert.deepEqual([...groups.keys()], ['I1']);
  assert.deepEqual(groups.get('I1').map((e) => e.id), ['A']);
  assert.deepEqual(errors.map((e) => e.id), ['D']);
});

test('line-summary route is registered before /:id and gated by invoices:read', () => {
  const src = readFileSync(new URL('../src/api/routes/invoices.ts', import.meta.url), 'utf8');
  const summary = src.indexOf('app.get("/line-summary"');
  assert.ok(summary > 0 && summary < src.indexOf('app.get("/:id"'));
  assert.match(src.slice(summary, summary + 300), /requirePermission\(c, "invoices", "read"\)/);
});
