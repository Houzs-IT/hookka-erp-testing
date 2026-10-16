// ---------------------------------------------------------------------------
// doc-import-di — the REAL invoice adapter (src/api/lib/doc-import-invoice.ts)
// on DI rows, driven through the real runner (runDocImport) on a stub DB.
//
// DI is not a separate document: it is an `invoices` row with deliveryOrderId
// set (invoiceDocType, src/lib/invoice-detail-listing.ts), so it shares the
// SI adapter. Only the in-process invoice route is stood in (callRoute); the
// adapter's load / create / update and the runner's transaction are real.
//
//   create · edit · blank keeps · all-or-nothing · export → import no-op
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { runDocImport, RouteRefusal } from '../src/api/lib/doc-import.ts';
import { invoiceImportAdapter } from '../src/api/lib/doc-import-invoice.ts';
import { buildInvoiceDetailRows } from '../src/lib/invoice-detail-export.ts';

const bed = (id) => ({
  id, productCode: 'BF-1', productName: 'Bed', quantity: 2, unitPriceSen: 76500,
  basePriceSen: 71000, divanPriceSen: 5500, legPriceSen: 0, totalHeightPriceSen: 0, specialOrderPriceSen: 0,
  discountSen: 0, itemCategory: 'BEDFRAME',
});
const INVOICES = {
  'inv-1': { id: 'inv-1', invoiceNo: 'INV-1', invoiceDate: '2026-10-05', deliveryOrderId: 'do-1', doNo: 'DO-1', customerId: 'c1', customerName: 'Acme', status: 'DRAFT', paidAmount: 0, items: [bed('invi-1')] },
  'inv-bad': { id: 'inv-bad', invoiceNo: 'INV-2', invoiceDate: '2026-10-05', deliveryOrderId: 'do-2', doNo: 'DO-2', customerId: 'c1', customerName: 'Acme', status: 'DRAFT', paidAmount: 0, items: [bed('invi-2')] },
};

// Stub DB: answers the adapter's own SELECTs, logs every write.
function makeDb() {
  const committed = [];
  const answer = (sql, args) => {
    if (/FROM invoices/.test(sql)) return Object.values(INVOICES).filter((i) => args.includes(i.invoiceNo));
    if (/FROM customers/.test(sql)) return [{ id: 'c1', code: '300-A001' }];
    if (/FROM delivery_orders/.test(sql)) return args.includes('DO-1') ? [{ id: 'do-1' }] : [];
    if (/FROM delivery_order_items/.test(sql)) return [{ id: 'doi-1', productCode: 'BF-1' }];
    if (/FROM invoice_items/.test(sql)) return [{ id: 'invi-new', deliveryOrderItemId: 'doi-1' }];
    return [];
  };
  const mk = (log) => ({
    prepare(sql) {
      return {
        args: [],
        bind(...a) { this.args = a; return this; },
        async run() { log.push({ sql, args: this.args }); return { success: true, meta: {} }; },
        async all() { return { results: answer(sql, this.args) }; },
        async first() { return answer(sql, this.args)[0] ?? null; },
      };
    },
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

// Stand-in for the in-process /api/invoices route (GET, PUT /:id, POST /).
const calls = [];
async function invoiceRoute(db, method, path, body) {
  calls.push({ method, path, body });
  const m = path.match(/^\/([^/]+)(\/print-extras)?$/);
  if (method === 'GET') return m[2] ? { success: true, data: { items: {} } } : { success: true, data: INVOICES[m[1]] };
  if (method === 'PUT') {
    if (m[1] === 'inv-bad') throw new RouteRefusal('Refused by the route: locked', 409);
    await db.prepare('UPDATE invoices').bind(m[1]).run();
    return { success: true };
  }
  await db.prepare('INSERT invoices').bind(body.deliveryOrderId).run();
  return { success: true, data: { id: 'inv-new', invoiceNo: body.invoiceNo ?? 'INV-9', items: [{ ...bed('invi-new') }] } };
}

const routed = (fn) => (ctx, x) => fn({ ...ctx, callRoute: (_app, m, p, b) => invoiceRoute(ctx.db, m, p, b) }, x);
const adapter = {
  ...invoiceImportAdapter,
  load: routed(invoiceImportAdapter.load),
  create: routed(invoiceImportAdapter.create),
  update: routed(invoiceImportAdapter.update),
};

async function run(db, rows, execute = true) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('DB', db);
    c.set('userId', 'u1');
    c.set('userRole', 'SUPER_ADMIN');
    c.set('orgId', 'hookka');
    await next();
  });
  app.onError((e) => { throw e; });
  app.post('/', async (c) => c.json(await runDocImport(c, adapter, rows, { execute, checkPermission: async () => null })));
  return (await app.request('/', { method: 'POST' })).json();
}

// The export the operator downloads, built by the page's own builder.
const exportOf = (ids) =>
  buildInvoiceDetailRows(ids.map((id) => ({ id, invoiceNo: INVOICES[id].invoiceNo })), {
    fetchJson: (url) => invoiceRoute(null, 'GET', url.replace(/^\/api\/invoices/, '')),
    wait: async () => {},
    partyCodes: new Map([['c1', '300-A001']]),
  });
const col = (aoa, name) => aoa[0].indexOf(name);
const writes = () => calls.filter((c) => c.method !== 'GET');

test('DI export carries Ref Doc No. = the DO and a Line ID', async () => {
  const aoa = await exportOf(['inv-1']);
  assert.equal(aoa[1][col(aoa, 'Doc Type')], 'DI');
  assert.equal(aoa[1][col(aoa, 'Ref Doc No.')], 'DO-1');
  assert.equal(aoa[1][col(aoa, 'Line ID')], 'invi-1');
});

test('round trip: an unedited DI export imports with no changes and no writes', async () => {
  const db = makeDb();
  calls.length = 0;
  const r = await run(db, await exportOf(['inv-1', 'inv-bad']));
  assert.deepEqual(r.errors, []);
  assert.equal(r.success, true);
  assert.ok(r.docs.every((d) => d.action === 'update' && d.lines.every((l) => l.changes.length === 0)));
  assert.deepEqual(writes(), []);
  assert.deepEqual(db.committed, []);
});

test('edit: a typed Divan goes through PUT /:id priceEdits; a blank Base keeps the stored value', async () => {
  const aoa = await exportOf(['inv-1']);
  aoa[1][col(aoa, 'Divan')] = 60;
  aoa[1][col(aoa, 'Base')] = '';
  const db = makeDb();
  calls.length = 0;
  const r = await run(db, aoa);
  assert.deepEqual(r.errors, []);
  assert.equal(r.success, true);
  assert.deepEqual(writes().map((c) => [c.method, c.path]), [['PUT', '/inv-1']]);
  const [e] = writes()[0].body.priceEdits;
  assert.equal(e.id, 'invi-1');
  assert.equal(e.divanSen, 6000);
  assert.equal(e.baseSen, 71000, 'blank Base = stored 710.00');
  assert.equal(db.committed.length, 1);
});

test('blank cells only: every editable cell blank → no write', async () => {
  const aoa = await exportOf(['inv-1']);
  for (const h of ['Base', 'Divan', 'Leg', 'T.Height', 'Special', 'Discount']) aoa[1][col(aoa, h)] = '';
  const db = makeDb();
  calls.length = 0;
  const r = await run(db, aoa);
  assert.equal(r.success, true);
  assert.deepEqual(writes(), []);
});

test('create: a DI row bills the DO line by Item Code via POST /, then prices typed components', async () => {
  const rows = [
    ['Doc Type', 'Doc No.', 'Ref Doc No.', 'Item Code', 'Qty', 'Divan'],
    ['DI', 'NEW-1', 'DO-1', 'BF-1', 2, 50],
  ];
  const db = makeDb();
  calls.length = 0;
  const r = await run(db, rows);
  assert.deepEqual(r.errors, []);
  assert.equal(r.success, true);
  assert.deepEqual(writes().map((c) => [c.method, c.path]), [['POST', '/'], ['PUT', '/inv-new']]);
  assert.deepEqual(writes()[0].body, { deliveryOrderId: 'do-1', lines: [{ deliveryOrderItemId: 'doi-1', quantity: 2 }] });
  const [e] = writes()[1].body.priceEdits;
  assert.equal(e.id, 'invi-new');
  assert.equal(e.divanSen, 5000);
  assert.equal(e.baseSen, 71000, 'untyped components keep the created line value');
  assert.deepEqual(r.docs[0].result, { id: 'inv-new', docNo: 'INV-9' });
});

test('all-or-nothing: one refused DI and nothing from the file is kept', async () => {
  const aoa = await exportOf(['inv-1', 'inv-bad']);
  for (const r of aoa.slice(1)) r[col(aoa, 'Divan')] = 60;
  const db = makeDb();
  calls.length = 0;
  const r = await run(db, aoa);
  assert.equal(r.success, false);
  assert.equal(r.rolledBack, true);
  assert.equal(writes().length, 2, 'INV-1 was written inside the transaction');
  assert.deepEqual(db.committed, [], 'then rolled back with INV-2');
  assert.equal(r.errors[0].docNo, 'INV-2');
  assert.match(r.errors[0].message, /locked/);
});

test('create: an unknown DO (Ref Doc No.) refuses the file', async () => {
  const db = makeDb();
  const r = await run(db, [['Doc Type', 'Doc No.', 'Ref Doc No.', 'Item Code', 'Qty'], ['DI', '', 'DO-404', 'BF-1', 1]]);
  assert.equal(r.success, false);
  assert.match(r.errors[0].message, /DO-404/);
  assert.deepEqual(db.committed, []);
});
