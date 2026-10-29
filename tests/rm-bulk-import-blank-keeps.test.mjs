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

test('whitespace-only notes keep; [CLEAR] empties nullable text; garbage stockControl keeps', () => {
  const m = mergeRmBulkUpdate(prior, { notes: '   ', stockControl: 'banana' });
  assert.equal(m.notes, 'keep');
  assert.equal(m.stockControl, 0, 'garbage is not an assertion');
  const c = mergeRmBulkUpdate(prior, { notes: '[clear]', mainSupplierCode: ' [CLEAR] ', itemType: '[CLEAR]', description: '[CLEAR]' });
  assert.equal(c.notes, null);
  assert.equal(c.mainSupplierCode, null);
  assert.equal(c.itemType, null);
  assert.equal(c.description, '[CLEAR]', 'NOT NULL text fields are not clearable');
  assert.equal(mergeRmBulkUpdate(prior, { stockControl: 'true' }).stockControl, 1);
  assert.equal(mergeRmBulkUpdate(prior, { stockControl: false }).stockControl, 0);
});

// --- behavioural: the route itself, two tenants --------------------------------
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Hono } from 'hono';
try { register('tsx/esm', pathToFileURL('./')); } catch {}
register('./tests/_alias-loader.mjs', pathToFileURL('./'));
const { default: rmApp } = await import(pathToFileURL(resolve(process.cwd(), 'src/api/routes/raw-materials.ts')).href);

const ROWS = [
  { id: 'rm-a', orgId: 'hookka', itemCode: 'PC151-01', itemGroup: 'FABRIC', baseUOM: 'MTR', balanceQty: 5, description: 'Mine', status: 'ACTIVE', minStock: 20, maxStock: 200, notes: 'keep', uomCount: 2, itemType: 'ROLL', stockControl: 0, mainSupplierCode: 'SUP-9' },
  { id: 'rm-b', orgId: 'acme', itemCode: 'PC151-01', itemGroup: 'FABRIC', baseUOM: 'MTR', balanceQty: 7, description: 'Theirs', status: 'ACTIVE', minStock: 1, maxStock: 2, notes: 'secret', uomCount: 1, itemType: null, stockControl: 1, mainSupplierCode: null },
];
function makeDb() {
  const writes = [];
  function prepare(sql) {
    const o = { sql, bound: [],
      bind(...a) { o.bound = a; return o; },
      async all() {
        if (/FROM raw_materials/i.test(sql)) {
          const scoped = /WHERE orgId = \?/i.test(sql);
          return { results: scoped ? ROWS.filter((r) => r.orgId === o.bound[0]) : ROWS };
        }
        return { results: [] };
      },
      async first() { return null; },
      async run() { return { success: true }; },
    };
    return o;
  }
  return { db: { prepare, batch: async (st) => { writes.push(...st); return []; } }, writes };
}
async function post(orgId, rows) {
  const { db, writes } = makeDb();
  const parent = new Hono();
  parent.use('*', async (c, next) => { c.set('DB', db); c.set('orgId', orgId); c.set('userRole', 'ADMIN'); c.set('userId', 'u1'); await next(); });
  parent.route('/', rmApp);
  const res = await parent.request('/bulk-import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) }, {});
  return { res, body: await res.json(), writes };
}

test('route: an update only ever sees and writes its own org (cross-org)', async () => {
  const { body, writes } = await post('hookka', [{ itemCode: 'PC151-01', baseUOM: 'MTR' }]);
  assert.equal(body.success, true, JSON.stringify(body));
  const upd = writes.find((w) => /UPDATE raw_materials/i.test(w.sql));
  assert.ok(upd, 'row matched in own org');
  assert.equal(upd.bound.at(-2), 'rm-a');
  assert.equal(upd.bound.at(-1), 'hookka');
  assert.ok(upd.bound.includes('keep'), 'own stored notes kept');
  assert.ok(!upd.bound.includes('secret'), 'other org notes never read');
});

test('route: the other org does not match hookka rows (creates under its own org)', async () => {
  const { writes } = await post('globex', [{ itemCode: 'PC151-01', baseUOM: 'MTR', description: 'x', itemGroup: 'FABRIC' }]);
  assert.ok(!writes.some((w) => /UPDATE raw_materials/i.test(w.sql)), 'must not update another tenant row');
  const ins = writes.find((w) => /INSERT INTO raw_materials/i.test(w.sql));
  assert.ok(ins, 'new row inserted');
  assert.equal(ins.bound.at(-1), 'globex');
});

test('exports write a never-priced SKU as a blank cell, not 0 (round-trip safe)', () => {
  for (const p of ['src/pages/inventory/index.tsx', 'src/pages/products/index.tsx']) {
    const src = readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /basePriceSen: \(p\.basePriceSen \?\? 0\) \/ 100/, p);
    assert.match(src, /p\.basePriceSen == null \? "" :/, p);
    assert.doesNotMatch(src, /costPriceSen: \(p\.costPriceSen \?\? 0\) \/ 100/, p);
  }
});

test('blank Active cell is absent, not false (dialog), so it neither inactivates nor changes status', () => {
  const dlg = readFileSync(new URL('../src/components/ui/batch-import-dialog.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dlg, /col\.type === "boolean" \? false : undefined/);
  // Update: absent isActive keeps stored status.
  assert.equal(mergeRmBulkUpdate({ ...prior, status: 'ACTIVE' }, { itemCode: 'X', isActive: undefined }).status, 'ACTIVE');
});

test('same code twice in one sheet: each update is stored back so the next row merges against it', () => {
  const src = readFileSync(new URL('../src/api/routes/raw-materials.ts', import.meta.url), 'utf8');
  assert.match(src, /idToStored\.set\(existingId, merged!\)/);
});
