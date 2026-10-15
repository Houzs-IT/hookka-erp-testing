// HK-0002 — an empty cell in a raw-material batch import must never clear a
// stored value. Sheet columns are only code/description/UOM/group/qty/active, so
// minStock, maxStock, notes, itemType, uomCount, stockControl, mainSupplierCode
// are ABSENT from every sheet and used to be reset to 0/null/1 on every update.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeRmBulkUpdate } from '../src/api/lib/rm-bulk-import.ts';

const prior = {
  description: 'Fabric PC151-01 Grey', itemGroup: 'FABRIC', status: 'ACTIVE',
  minStock: 20, maxStock: 200, notes: 'keep', uomCount: 2, itemType: 'ROLL',
  stockControl: 0, mainSupplierCode: 'SUP-9',
};

test('a row carrying only the code keeps every stored field', () => {
  assert.deepEqual(mergeRmBulkUpdate(prior, { itemCode: 'PC151-01' }), prior);
});

test('blank strings / null count as blank, like absent', () => {
  const m = mergeRmBulkUpdate(prior, { description: '  ', itemGroup: '', status: '', notes: null, itemType: '', mainSupplierCode: '' });
  assert.deepEqual(m, prior);
});

test('a typed value still wins', () => {
  const m = mergeRmBulkUpdate(prior, { description: 'New', itemGroup: 'FOAM', isActive: false, minStock: 0, notes: 'n2' });
  assert.equal(m.description, 'New');
  assert.equal(m.itemGroup, 'FOAM');
  assert.equal(m.status, 'INACTIVE');
  assert.equal(m.minStock, 0, 'an explicit 0 is a value, not a blank');
  assert.equal(m.notes, 'n2');
  assert.equal(m.maxStock, 200);
});

test('route wires the merge on UPDATE and reads the stored columns', () => {
  const src = readFileSync('src/api/routes/raw-materials.ts', 'utf8');
  assert.match(src, /mergeRmBulkUpdate\(/);
  assert.match(src, /SELECT id, itemCode, itemGroup, baseUOM, balanceQty, description, status, minStock, maxStock, notes, uomCount, itemType, stockControl, mainSupplierCode FROM raw_materials/);
});

test('exports write a never-priced SKU as a blank cell, not 0 (round-trip safe)', () => {
  for (const p of ['src/pages/inventory/index.tsx', 'src/pages/products/index.tsx']) {
    const src = readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /basePriceSen: \(p\.basePriceSen \?\? 0\) \/ 100/, p);
    assert.match(src, /p\.basePriceSen == null \? "" :/, p);
  }
});
