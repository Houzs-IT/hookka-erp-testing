// ---------------------------------------------------------------------------
// doc-import-do — the Delivery Order import adapter (HK-0002 DO).
//
// load / update / create run against a fake ctx (stub db + a callRoute that
// records what would reach the real delivery-orders route), so what is
// checked is exactly what the adapter asks the route for.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { doImportAdapter, DO_IMPORT_SPEC, validateDoPlan } from '../src/api/lib/doc-import-do.ts';
import { runDocImport } from '../src/api/lib/doc-import.ts';
import { currentFromListing, planDocImport, planHasWork } from '../src/lib/doc-import/core.ts';
import { buildDoDetailListingAoa } from '../src/lib/doc-detail-listings.ts';

// GET /api/delivery-orders/:id payload. A consolidated DO: two SOs.
const DO_API = {
  id: 'do-1', doNo: 'DO-1', dispatchedAt: '2026-10-03T08:00:00Z', companySO: '', customerId: 'c1',
  customerName: 'Acme', status: 'DRAFT', deliveryDate: '2026-10-05', remarks: 'Back door',
  items: [
    { id: 'doi-1', salesOrderNo: 'SO-1', poNo: 'PO-1', productCode: 'BF-1', productName: 'Bed', quantity: 1, itemM3: 1.2 },
    { id: 'doi-2', salesOrderNo: 'SO-2', poNo: 'PO-2', productCode: 'BF-2', productName: 'Sofa', quantity: 1, itemM3: 2 },
  ],
};
// What the list page exports (mapDOToRow rows) for the same DO.
const EXPORT = buildDoDetailListingAoa([{
  doNo: 'DO-1', dispatchDate: '2026-10-03T08:00:00Z', companySO: '', customerId: 'c1', customerName: 'Acme',
  status: 'DRAFT', deliveryDate: '2026-10-05', remarks: 'Back door',
  items: DO_API.items.map((i) => ({ ...i })),
}], new Map([['c1', '300-A001']]));
const col = (name) => EXPORT[0].indexOf(name);

function fakeCtx({ rows = {}, onRoute = () => ({ success: true }) } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async all() {
          const key = Object.keys(rows).find((k) => sql.includes(k));
          const r = key ? rows[key] : [];
          return { results: typeof r === 'function' ? r(this.args) : r };
        },
      };
    },
  };
  const c = { var: { orgId: 'org-1', userRole: 'SUPER_ADMIN' }, get(k) { return this.var[k]; } };
  return {
    calls,
    ctx: {
      c, db,
      async callRoute(_app, method, path, body) { calls.push({ method, path, body }); return onRoute(method, path, body); },
    },
  };
}

const loadCtx = () => fakeCtx({
  rows: { 'FROM delivery_orders': [{ id: 'do-1', doNo: 'DO-1', customerId: 'c1' }], 'FROM customers': [{ id: 'c1', code: '300-A001' }] },
  onRoute: () => ({ success: true, data: DO_API }),
});
const current = () => currentFromListing(EXPORT, DO_IMPORT_SPEC, new Map([['DO-1', 'do-1']]));
const plan = (aoa, cur = current()) => {
  const p = planDocImport(aoa, cur, DO_IMPORT_SPEC);
  p.errors.push(...validateDoPlan(p));
  return p;
};
const edit = (fn) => { const aoa = EXPORT.map((r) => [...r]); fn(aoa); return aoa; };

test('round trip: load (through the route + export builder) then an unedited export → no change', async () => {
  const { ctx, calls } = loadCtx();
  const cur = await doImportAdapter.load(ctx, ['DO-1']);
  assert.deepEqual(calls.map((x) => [x.method, x.path]), [['GET', '/do-1']]);
  const p = plan(EXPORT, cur);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.equal(planHasWork(p), false, 'a multi-SO DO (Ref Doc No. per line) is not a contradiction');
});

test('edit: a changed Remarks goes to PUT /:id, nothing else', async () => {
  const aoa = edit((a) => { a[1][col('Remarks')] = 'Front door'; a[2][col('Remarks')] = 'Front door'; });
  const p = plan(aoa);
  assert.deepEqual(p.errors, []);
  const { ctx, calls } = fakeCtx();
  await doImportAdapter.update(ctx, p.docs[0]);
  assert.deepEqual(calls, [{ method: 'PUT', path: '/do-1', body: { remarks: 'Front door' } }]);
});

test('a blank cell keeps the stored value', async () => {
  const aoa = edit((a) => {
    for (const r of a.slice(1)) { r[col('Remarks')] = ''; r[col('Qty')] = ''; }
    a[1][col('Delivery Date')] = '2026-10-09';
    a[2][col('Delivery Date')] = '2026-10-09';
  });
  const p = plan(aoa);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.docs[0].headerChanges.map((c) => [c.key, c.from, c.to]), [['deliveryDate', '2026-10-05', '2026-10-09']]);
  const { ctx, calls } = fakeCtx();
  await doImportAdapter.update(ctx, p.docs[0]);
  assert.deepEqual(calls[0].body, { deliveryDate: '2026-10-09' }, 'blank Remarks is not sent (kept)');
});

test('edit: a line qty is read-only (warned, ignored); adding a line to a DO is refused', () => {
  const p = plan(edit((a) => { a[1][col('Qty')] = 5; }));
  assert.equal(p.warnings.length, 1);
  assert.equal(planHasWork(p), false);
  const p2 = plan([...EXPORT, ['DO', 'DO-1', '', '', '', 'SO-1', '', 'BF-9']]);
  assert.match(p2.errors[0].message, /ADD a production order/);
});

test('create: by Item Code + PO No. and by Item Code + SO → POST / with the production order ids', async () => {
  const H = EXPORT[0];
  const row = (o) => H.map((h) => o[h] ?? '');
  const aoa = [H,
    row({ 'Doc Type': 'DO', 'Doc No.': 'NEW-1', 'Item Code': 'BF-7', 'PO No.': 'PO-7', Remarks: 'Rush', 'Delivery Date': '2026-10-20' }),
    row({ 'Doc Type': 'DO', 'Doc No.': 'NEW-1', 'Ref Doc No.': 'SO-3', 'Item Code': 'BF-3', Qty: 2 }),
  ];
  const p = plan(aoa, new Map());
  assert.deepEqual(p.errors, []);
  const { ctx, calls } = fakeCtx({
    rows: { 'poNo = ?': [{ id: 'po-7', poNo: 'PO-7', quantity: 1 }], 'companySOId = ?': [{ id: 'po-3', poNo: 'PO-3', quantity: 2 }] },
    onRoute: () => ({ success: true, data: { id: 'do-9', doNo: 'DO-9' } }),
  });
  const r = await doImportAdapter.create(ctx, p.docs[0]);
  assert.deepEqual(r, { id: 'do-9', docNo: 'DO-9' });
  assert.deepEqual(calls, [{ method: 'POST', path: '/', body: { productionOrderIds: ['po-7', 'po-3'], deliveryDate: '2026-10-20', remarks: 'Rush' } }]);
});

test('create: an ambiguous Item Code, or a Qty that is not the whole PO, is refused', async () => {
  const H = EXPORT[0];
  const row = (o) => H.map((h) => o[h] ?? '');
  const p = plan([H, row({ 'Doc Type': 'DO', 'Ref Doc No.': 'SO-3', 'Item Code': 'BF-3' })], new Map());
  const two = fakeCtx({ rows: { 'companySOId = ?': [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 1 }] } });
  await assert.rejects(doImportAdapter.create(two.ctx, p.docs[0]), /2 production orders match/);
  assert.deepEqual(plan([H, row({ 'Doc Type': 'DO', 'PO No.': 'PO-7' })], new Map()).errors.map((e) => e.message.slice(0, 30)), ['A new DO needs at least one li']);
  const p2 = plan([H, row({ 'Doc Type': 'DO', 'Item Code': 'BF-7', 'PO No.': 'PO-7', Qty: 3 })], new Map());
  const one = fakeCtx({ rows: { 'poNo = ?': [{ id: 'po-7', poNo: 'PO-7', quantity: 1 }] } });
  await assert.rejects(doImportAdapter.create(one.ctx, p2.docs[0]), /whole production order/);
  assert.equal(two.calls.length + one.calls.length, 0, 'no route reached');
  const p3 = plan([H, row({ 'Doc Type': 'DO', 'Item Code': 'BF-3' })], new Map());
  assert.match(p3.errors[0].message, /Name the production order/);
});

test('all-or-nothing: one bad row and no DO in the file is written', async () => {
  const committed = [];
  const db = { transaction: async (fn) => { const pending = []; const r = await fn({ pending }); committed.push(...pending); return r; } };
  let updates = 0;
  const adapter = {
    ...doImportAdapter,
    // Two stored DOs, from the real builder.
    async load() {
      const two = buildDoDetailListingAoa([
        { doNo: 'DO-1', items: [{ id: 'doi-1', productCode: 'A', quantity: 1 }] },
        { doNo: 'DO-2', items: [{ id: 'doi-2', productCode: 'B', quantity: 1 }] },
      ]);
      return currentFromListing(two, DO_IMPORT_SPEC, new Map([['DO-1', 'do-1'], ['DO-2', 'do-2']]));
    },
    async update() { updates++; },
  };
  const H = EXPORT[0];
  const row = (o) => H.map((h) => o[h] ?? '');
  const rows = [H,
    row({ 'Doc Type': 'DO', 'Doc No.': 'DO-1', 'Line ID': 'doi-1', 'Item Code': 'A', Remarks: 'ok' }),
    row({ 'Doc Type': 'DO', 'Doc No.': 'DO-2', 'Line ID': 'doi-2', 'Item Code': 'B', 'Delivery Date': 'next week' }),
  ];
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('DB', db); await next(); });
  app.post('/', async (c) => c.json(await runDocImport(c, adapter, rows, { execute: true, checkPermission: async () => null })));
  const r = await (await app.request('/', { method: 'POST' })).json();
  assert.equal(r.success, false);
  assert.equal(r.rolledBack, true);
  assert.equal(updates, 0, 'DO-1 is fine but is not written either');
  assert.deepEqual(committed, []);
  assert.equal(r.errors[0].row, 3);
});
