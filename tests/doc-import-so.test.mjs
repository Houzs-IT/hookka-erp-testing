// ---------------------------------------------------------------------------
// doc-import-so — the Sales Order adapter of the shared importer (HK-0002).
// The routes are stood in by a spy ctx.callRoute (the adapter's only write
// path); the DB answers the adapter's own lookups.
//
//   create · edit · blank keeps · all-or-nothing · export → import round trip
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { soImportAdapter, validateSoPlan, SO_IMPORT_SPEC } from '../src/api/lib/doc-import-so.ts';
import { runDocImport } from '../src/api/lib/doc-import.ts';
import { planDocImport, planHasWork } from '../src/lib/doc-import/core.ts';
import { buildSoDetailListingAoa } from '../src/lib/so-detail-listing.ts';

const ORDER = {
  id: 'so-1', companySOId: 'SO-2610-001', companySODate: '2026-10-01', customerId: 'c1', customerName: 'Acme',
  status: 'CONFIRMED',
  items: [
    { id: 'soi-1', lineNo: 1, productId: 'p1', productCode: 'BF-1', productName: 'Bed', itemCategory: 'BEDFRAME', quantity: 2, unitPriceSen: 45050, discountSen: 0, lineTotalSen: 90100, divanPriceSen: 5000, notes: 'keep me' },
    { id: 'soi-2', lineNo: 2, productId: 'p2', productCode: 'AC-1', productName: 'Pillow', itemCategory: 'ACCESSORY', quantity: 1, unitPriceSen: 2000, discountSen: 500, lineTotalSen: 1500 },
  ],
};
const EXPORT = () => buildSoDetailListingAoa([ORDER], { debtorCodeByCustomerId: new Map([['c1', '300-A001']]) });

function fakeCtx() {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async all() {
          if (/FROM sales_orders/.test(sql)) return { results: this.args.includes('SO-2610-001') ? [{ id: 'so-1', companySOId: 'SO-2610-001', customerId: 'c1' }] : [] };
          if (/FROM customers WHERE id IN/.test(sql)) return { results: [{ id: 'c1', code: '300-A001' }] };
          if (/FROM customers WHERE code/.test(sql)) return { results: this.args[0] === '300-A001' ? [{ id: 'c1' }] : [] };
          if (/FROM products/.test(sql)) return { results: [{ id: 'p1', code: 'BF-1', category: 'BEDFRAME' }, { id: 'p3', code: 'BF-3', category: 'BEDFRAME' }].filter((p) => this.args.includes(p.code)) };
          return { results: [] };
        },
      };
    },
  };
  const c = { get: (k) => ({ orgId: 'hookka', userRole: 'SUPER_ADMIN', userId: 'u1' })[k], var: { DB: db } };
  const callRoute = async (_app, method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return { success: true, data: structuredClone(ORDER) };
    if (method === 'POST') return { success: true, data: { id: 'so-new', companySOId: 'SO-2610-002' } };
    return { success: true };
  };
  return { ctx: { c, db, callRoute }, calls };
}

async function planFor(aoa) {
  const { ctx } = fakeCtx();
  const current = await soImportAdapter.load(ctx, ['SO-2610-001']);
  const plan = planDocImport(aoa, current, SO_IMPORT_SPEC);
  plan.errors.push(...validateSoPlan(plan));
  return plan;
}
const col = (aoa, h) => aoa[0].indexOf(h);

test('round trip: an unedited export, loaded through the adapter, is NO change', async () => {
  const plan = await planFor(EXPORT());
  assert.deepEqual(plan.errors, []);
  assert.equal(planHasWork(plan), false);
  assert.deepEqual(plan.docs.map((d) => d.action), ['update']);
});

test('edit: a typed Qty / Discount goes to PUT with every other line and field kept', async () => {
  const aoa = EXPORT();
  aoa[1][col(aoa, 'Qty')] = 3;
  aoa[2][col(aoa, 'Discount')] = 0; // a typed 0 wins
  const plan = await planFor(aoa);
  assert.deepEqual(plan.errors, []);
  const { ctx, calls } = fakeCtx();
  await soImportAdapter.update(ctx, plan.docs[0]);
  const put = calls.find((x) => x.method === 'PUT');
  assert.equal(put.path, '/so-1');
  assert.deepEqual(put.body.items.map((i) => i.id), ['soi-1', 'soi-2'], 'Line IDs kept, nothing dropped');
  assert.equal(put.body.items[0].quantity, 3);
  assert.equal(put.body.items[0].divanPriceSen, 5000, 'stored components sent back untouched');
  assert.equal(put.body.items[0].notes, 'keep me');
  assert.equal(put.body.items[1].discountSen, 0);
});

test('edit: a new row (blank Line ID) is appended with its product', async () => {
  const aoa = EXPORT();
  const row = [...aoa[1]];
  row[col(aoa, 'Line ID')] = '';
  row[col(aoa, 'Item Code')] = 'BF-3';
  row[col(aoa, 'Qty')] = 1;
  aoa.push(row);
  const plan = await planFor(aoa);
  assert.deepEqual(plan.errors, []);
  const { ctx, calls } = fakeCtx();
  await soImportAdapter.update(ctx, plan.docs[0]);
  const items = calls.find((x) => x.method === 'PUT').body.items;
  assert.equal(items.length, 3);
  assert.deepEqual({ ...items[2], basePriceSen: undefined }, { productId: 'p3', productCode: 'BF-3', itemCategory: 'BEDFRAME', quantity: 1, discountSen: 0, basePriceSen: undefined });
});

test('blank keeps: a cleared Qty cell keeps the stored quantity', async () => {
  const aoa = EXPORT();
  aoa[1][col(aoa, 'Qty')] = '';
  aoa[1][col(aoa, 'Discount')] = 10;
  const plan = await planFor(aoa);
  const { ctx, calls } = fakeCtx();
  await soImportAdapter.update(ctx, plan.docs[0]);
  const item = calls.find((x) => x.method === 'PUT').body.items[0];
  assert.equal(item.quantity, 2, 'blank Qty = stored 2');
  assert.equal(item.discountSen, 1000);
});

test('create: blank Doc No. → POST with the customer, date and lines', async () => {
  const H = EXPORT()[0];
  const row = (code, qty) => H.map((h) => ({ 'Doc Type': 'SO', 'Doc Date': '2026-10-09', 'Party Code': '300-A001', 'Item Code': code, Qty: qty })[h] ?? '');
  const plan = planDocImport([H, row('BF-1', 2), row('BF-3', 1)], new Map(), SO_IMPORT_SPEC);
  assert.deepEqual([...plan.errors, ...validateSoPlan(plan)], []);
  const { ctx, calls } = fakeCtx();
  const res = await soImportAdapter.create(ctx, plan.docs[0]);
  assert.deepEqual(res, { id: 'so-new', docNo: 'SO-2610-002' });
  const post = calls.find((x) => x.method === 'POST');
  assert.equal(post.body.customerId, 'c1');
  assert.equal(post.body.companySODate, '2026-10-09');
  assert.deepEqual(post.body.items.map((i) => [i.productId, i.quantity]), [['p1', 2], ['p3', 1]]);
});

test('create refusals: a typed unknown Doc No., no Party Code, no Qty', () => {
  const H = EXPORT()[0];
  const row = (cells) => H.map((h) => cells[h] ?? '');
  const plan = planDocImport([
    H,
    row({ 'Doc No.': 'SO-9999-999', 'Party Code': '300-A001', 'Item Code': 'BF-1', Qty: 1 }),
    row({ 'Doc No.': 'NEW-1', 'Item Code': 'BF-1' }),
  ], new Map(), SO_IMPORT_SPEC);
  const msgs = validateSoPlan(plan).map((e) => e.message).join('\n');
  assert.match(msgs, /assigned by the system/);
  assert.match(msgs, /Party Code is blank/);
  assert.match(msgs, /Qty is blank/);
});

test('all-or-nothing: one bad row refuses the whole file, nothing is written', async () => {
  const committed = [];
  const mk = (log) => ({
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async run() { log.push(sql); return { success: true }; },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
    },
  });
  const db = mk(committed);
  db.transaction = async (fn) => { const pending = []; const r = await fn(mk(pending)); committed.push(...pending); return r; };
  const H = EXPORT()[0];
  const row = (cells) => H.map((h) => cells[h] ?? '');
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('DB', db); c.set('orgId', 'hookka'); c.set('userRole', 'SUPER_ADMIN'); await next(); });
  app.post('/', async (c) => c.json(await runDocImport(c, soImportAdapter, [
    H,
    row({ 'Doc No.': 'NEW-1', 'Party Code': '300-A001', 'Item Code': 'BF-1', Qty: 1 }),
    row({ 'Doc No.': 'NEW-2', 'Party Code': '300-A001', 'Item Code': 'BF-1' }), // no Qty
  ], { execute: true, checkPermission: async () => null })));
  const res = await (await app.request('/', { method: 'POST' })).json();
  assert.equal(res.success, false);
  assert.equal(res.rolledBack, true);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].message, /Qty is blank/);
  assert.deepEqual(committed, []);
});
