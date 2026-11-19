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

// HK-0158 follow-up: 15 invoices a page, one invoice's lines never split.
import { pageByGroup } from '../src/lib/page-by-group.ts';

test('pageByGroup pages by invoice and never splits one', () => {
  // 32 invoices, 2 lines each, interleaved order kept.
  const rows = Array.from({ length: 64 }, (_, i) => ({ id: i, inv: `I${Math.floor(i / 2)}` }));
  const p1 = pageByGroup(rows, (r) => r.inv, 15, 1);
  assert.equal(p1.pageCount, 3);
  assert.equal(p1.rows.length, 30);
  assert.deepEqual([p1.firstGroup, p1.lastGroup, p1.groupCount], [1, 15, 32]);
  const p3 = pageByGroup(rows, (r) => r.inv, 15, 3);
  assert.deepEqual(p3.rows.map((r) => r.inv), ['I30', 'I30', 'I31', 'I31']);
  // A page past the end clamps to the last page; empty input is one empty page.
  assert.equal(pageByGroup(rows, (r) => r.inv, 15, 9).page, 3);
  assert.deepEqual(pageByGroup([], (r) => r.inv, 15, 1), {
    rows: [], page: 1, pageCount: 1, groupCount: 0, firstGroup: 0, lastGroup: 0,
  });
});

test('price summary page uses the shared grid with invoice paging and a Payment filter', () => {
  const page = readFileSync(new URL('../src/pages/invoices/price-summary.tsx', import.meta.url), 'utf8');
  assert.match(page, /pageBy=\{\(l\) => l\.invoiceId\}/);
  assert.match(page, /pageSize=\{15\}/);
  assert.match(page, /key: "payment"/);
  const api = readFileSync(new URL('../src/api/routes/invoices.ts', import.meta.url), 'utf8');
  assert.match(api, /payment: status === "PAID" \? "Paid" : paid > 0 \? "Part paid" : "Unpaid"/);
});
