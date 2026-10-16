// ---------------------------------------------------------------------------
// doc-import-po — the Purchase Order import adapter (HK-0002), run through the
// real runner (runDocImport) with a stub DB and a stand-in purchase-orders
// route (GET /:id, PUT /:id, POST /), so load → plan → validate → apply is the
// adapter's own code end to end.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { runDocImport } from '../src/api/lib/doc-import.ts';
import { makePoImportAdapter } from '../src/api/lib/doc-import-po.ts';
import { buildPoDetailListingAoa } from '../src/lib/doc-detail-listings.ts';

const item = (id, code, qty, priceSen, extra = {}) => ({
  id, materialCategory: 'FABRIC', materialCode: code, materialName: `${code} name`, supplierSKU: '',
  quantity: qty, unitPriceSen: priceSen, totalSen: Math.round(qty * priceSen), receivedQty: 0, unit: 'M', ...extra,
});
const POS = () => ({
  'po-1': { id: 'po-1', poNo: 'PO-1', orderDate: '2026-10-01', supplierId: 's1', supplierName: 'Acme', status: 'DRAFT', totalSen: 0,
    // L2 has a sub-sen rate: an untouched line must go back exactly as stored.
    items: [item('L1', 'RM-A', 10, 1250), item('L2', 'RM-B', 3, 333.3333)] },
  'po-2': { id: 'po-2', poNo: 'PO-2', orderDate: '2026-10-02', supplierId: 's1', supplierName: 'Acme', status: 'CONFIRMED', totalSen: 0,
    items: [item('L3', 'RM-A', 5, 1000, { receivedQty: 2 })] },
});

function makeDb() {
  const committed = [];
  const mk = (log) => ({
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async run() { log.push({ sql, args: this.args }); return { success: true, meta: {} }; },
        async all() {
          if (/FROM purchase_orders/.test(sql)) return { results: Object.values(POS()).filter((p) => this.args.includes(p.poNo)).map((p) => ({ id: p.id, poNo: p.poNo })) };
          if (/FROM suppliers/.test(sql)) return { results: [{ id: 's1', code: 'SUP-1' }] };
          if (/FROM raw_materials/.test(sql)) return { results: [{ itemCode: 'RM-C', description: 'Cotton', itemGroup: 'FABRIC' }].filter((r) => this.args.includes(r.itemCode)) };
          return { results: [] };
        },
        async first() { return /FROM suppliers/.test(sql) && this.args.includes('SUP-1') ? { id: 's1', name: 'Acme' } : null; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return []; },
  });
  const db = mk(committed);
  db.committed = committed;
  db.transaction = async (fn) => {
    const pending = [];
    const r = await fn(mk(pending));
    committed.push(...pending);
    return r;
  };
  return db;
}

// Stand-in for src/api/routes/purchase-orders.ts.
const seen = [];
const route = new Hono();
route.get('/:id', (c) => c.json({ success: true, data: POS()[c.req.param('id')] }));
route.put('/:id', async (c) => {
  const body = await c.req.json();
  seen.push({ method: 'PUT', id: c.req.param('id'), body });
  if (body.items?.some((it) => it.quantity === 999)) return c.json({ success: false, error: 'Refused by the route' }, 409);
  await c.var.DB.prepare('UPDATE purchase_orders').bind(c.req.param('id')).run();
  return c.json({ success: true });
});
route.post('/', async (c) => {
  const body = await c.req.json();
  seen.push({ method: 'POST', body });
  await c.var.DB.prepare('INSERT INTO purchase_orders').bind(body.supplierId).run();
  return c.json({ success: true, data: { id: 'po-new', poNo: 'PO-2610-001' } }, 201);
});
const adapter = makePoImportAdapter(route);

async function run(rows, execute = true) {
  const db = makeDb();
  seen.length = 0;
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('DB', db); c.set('orgId', 'org1'); c.set('userId', 'u1'); await next(); });
  app.post('/', async (c) => c.json(await runDocImport(c, adapter, rows, { execute, checkPermission: async () => null })));
  const r = await (await app.request('/', { method: 'POST' })).json();
  return { r, db };
}

// The export, exactly as the PO list page builds it.
const exported = () => buildPoDetailListingAoa(Object.values(POS()), new Map([['s1', 'SUP-1']]));
const H = exported()[0];
const col = (name) => H.indexOf(name);
const blankRow = (cells) => { const row = H.map(() => ''); for (const [k, v] of Object.entries(cells)) row[col(k)] = v; return row; };

test('round trip: an unedited export imports back with no changes and no route write', async () => {
  const { r, db } = await run(exported());
  assert.deepEqual(r.errors, []);
  assert.equal(r.success, true);
  assert.ok(r.docs.every((d) => d.action === 'update' && !d.result));
  assert.ok(r.docs.every((d) => d.headerChanges.length === 0 && d.lines.every((l) => l.changes.length === 0)));
  assert.equal(seen.filter((s) => s.method !== 'GET').length, 0);
  assert.deepEqual(db.committed, []);
});

test('edit: typed Qty / Unit Price / Doc Date go through PUT; every stored line is sent', async () => {
  const aoa = exported().filter((row, i) => i === 0 || row[1] === 'PO-1');
  aoa[1][col('Qty')] = 12;
  aoa[1][col('Unit Price')] = 13.5;
  aoa[1][col('UOM')] = 'ROLL'; // read-only: ignored with a warning
  aoa[1][col('Doc Date')] = '2026-10-05';
  aoa[2][col('Doc Date')] = '2026-10-05';
  const { r, db } = await run(aoa);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /UOM/.test(w.message)));
  const put = seen.find((s) => s.method === 'PUT');
  assert.equal(put.id, 'po-1');
  assert.equal(put.body.orderDate, '2026-10-05');
  assert.deepEqual(put.body.items.map((it) => [it.id, it.quantity, it.unitPriceSen, it.unit]), [
    ['L1', 12, 1350, 'M'],
    ['L2', 3, 333.3333, 'M'], // untouched: exact stored rate, stored unit
  ]);
  assert.equal(db.committed.length, 1);
});

test('edit: a blank cell keeps the stored value; a row with no Line ID adds a line with no UOM', async () => {
  const aoa = [H, blankRow({ 'Doc No.': 'PO-1', 'Line ID': 'L1', Qty: 4 }), blankRow({ 'Doc No.': 'PO-1', 'Item Code': 'RM-C', Qty: 2, 'Unit Price': 0 })];
  const { r } = await run(aoa);
  assert.deepEqual(r.errors, []);
  const items = seen.find((s) => s.method === 'PUT').body.items;
  assert.deepEqual([items[0].quantity, items[0].unitPriceSen, items[0].materialName], [4, 1250, 'RM-A name'], 'blank price/description kept');
  assert.deepEqual(items[2], { materialCode: 'RM-C', materialName: 'Cotton', materialCategory: 'FABRIC', supplierSKU: '', quantity: 2, unitPriceSen: 0 });
  assert.ok(!('unit' in items[2]), 'UOM comes from the raw material on the server');
});

test('create: blank Doc No. + Party Code → POST with the supplier and lines, no unit', async () => {
  const aoa = [H,
    blankRow({ 'Doc Type': 'PO', 'Doc Date': '2026-10-10', 'Party Code': 'SUP-1', 'Item Code': 'RM-C', Qty: 7, 'Unit Price': 2.5, UOM: 'ROLL' }),
  ];
  const { r, db } = await run(aoa);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.docs[0].result, { id: 'po-new', docNo: 'PO-2610-001' });
  const post = seen.find((s) => s.method === 'POST').body;
  assert.equal(post.supplierId, 's1');
  assert.equal(post.supplierName, 'Acme');
  assert.equal(post.orderDate, '2026-10-10');
  assert.deepEqual(post.items, [{ materialCode: 'RM-C', materialName: 'Cotton', materialCategory: 'FABRIC', supplierSKU: '', quantity: 7, unitPriceSen: 250 }]);
  assert.equal(db.committed.length, 1);
});

test('create refusals: chosen PO No., no Party Code, blank price, unknown item', async () => {
  let { r } = await run([H, blankRow({ 'Doc No.': 'PO-XYZ', 'Party Code': 'SUP-1', 'Item Code': 'RM-C', Qty: 1, 'Unit Price': 1 })]);
  assert.match(r.errors.map((e) => e.message).join('|'), /assigned on save/);
  ({ r } = await run([H, blankRow({ 'Item Code': 'RM-C', Qty: 1 })]));
  assert.match(r.errors.map((e) => e.message).join('|'), /Party Code is blank/);
  assert.match(r.errors.map((e) => e.message).join('|'), /Unit Price is blank/);
  ({ r } = await run([H, blankRow({ 'Party Code': 'SUP-1', 'Item Code': 'NOPE', Qty: 1, 'Unit Price': 1 })]));
  assert.equal(r.success, false);
  assert.match(r.errors[0].message, /no raw material with Item Code NOPE/);
});

test('all-or-nothing: one bad row and nothing from the file is written', async () => {
  // PO-1 edit is fine; PO-2 has goods received → locked.
  const aoa = [H, blankRow({ 'Doc No.': 'PO-1', 'Line ID': 'L1', Qty: 4 }), blankRow({ 'Doc No.': 'PO-2', 'Line ID': 'L3', Qty: 9 })];
  let { r, db } = await run(aoa);
  assert.equal(r.success, false);
  assert.match(r.errors[0].message, /can no longer be edited/);
  assert.equal(seen.filter((s) => s.method === 'PUT').length, 0);
  assert.deepEqual(db.committed, []);

  // A route refusal on the second doc rolls back the first doc's write too.
  ({ r, db } = await run([H,
    blankRow({ 'Doc Type': 'PO', 'Party Code': 'SUP-1', 'Item Code': 'RM-C', Qty: 1, 'Unit Price': 1 }),
    blankRow({ 'Doc No.': 'PO-1', 'Line ID': 'L2', Qty: 999 }),
  ]));
  assert.equal(r.success, false);
  assert.deepEqual(seen.map((s) => s.method), ['POST', 'PUT'], 'the create ran, then the edit was refused');
  assert.match(r.errors[0].message, /Refused by the route/);
  assert.deepEqual(db.committed, []);
});
