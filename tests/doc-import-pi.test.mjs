// ---------------------------------------------------------------------------
// doc-import-pi — the Purchase Invoice adapter (HK-0002).
//
//   * export → import with no edits is an empty plan (round trip)
//   * edit: PUT items[] carries every stored line, full precision, grnItemId
//   * a blank cell keeps the stored value
//   * create: POST with supplier (Party Code), PO (Ref Doc No.) and lines
//   * one bad row and nothing from the file is written (all-or-nothing)
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { piImportAdapter, PI_IMPORT_SPEC } from '../src/api/lib/doc-import-pi.ts';
import purchaseInvoices from '../src/api/routes/purchase-invoices.ts';
import { runDocImport } from '../src/api/lib/doc-import.ts';
import { planDocImport, planHasWork } from '../src/lib/doc-import/core.ts';
import { buildPiDetailRows } from '../src/lib/invoice-detail-export.ts';

const PI_ROWS = {
  'pi-1': {
    id: 'pi-1', piNo: 'PI-2610-001', purchaseOrderId: 'po-1', poRef: 'PO-2610-001', supplierId: 's-1',
    supplierName: 'Ocean Sky', invoiceDate: '2026-10-01', dueDate: '2026-11-30', amountSen: 23300,
    paidAmountSen: 0, status: 'DRAFT', remarks: null, supplier_invoice_no: 'OS-77',
  },
  'pi-2': {
    id: 'pi-2', piNo: 'PI-2610-002', purchaseOrderId: null, poRef: null, supplierId: 's-1',
    supplierName: 'Ocean Sky', invoiceDate: '2026-10-02', dueDate: '2026-11-30', amountSen: 1000,
    paidAmountSen: 0, status: 'DRAFT', remarks: null,
  },
};
const ITEMS = {
  'pi-1': [
    // A sub-cent RATE (600 @ RM0.055): the export shows 0.06, the edit must keep 5.5 sen.
    { id: 'pii-a', pi_id: 'pi-1', material_code: 'FAB-1', material_name: 'Fabric', supplier_sku: 'OS-F1', qty: 600,
      unit_price_sen: 5.5, line_total_sen: 3300, discount_sen: 0, tax_sen: 0, line_type: 'STOCKED', notes: 'n1', grn_item_id: 41 },
    { id: 'pii-b', pi_id: 'pi-1', material_code: 'LEG-1', material_name: 'Leg', supplier_sku: null, qty: 2,
      unit_price_sen: 10000, line_total_sen: 20000, discount_sen: 0, tax_sen: 0, line_type: 'STOCKED', notes: null, grn_item_id: null },
  ],
  'pi-2': [
    { id: 'pii-c', pi_id: 'pi-2', material_code: 'X', material_name: 'Thing', supplier_sku: null, qty: 1,
      unit_price_sen: 1000, line_total_sen: 1000, discount_sen: 0, tax_sen: 0, line_type: 'STOCKED', notes: null, grn_item_id: null },
  ],
};

/** A stub DB that answers the SELECTs load, GET /:id and create make. */
function makeDb() {
  const committed = [];
  const mk = (log) => ({
    prepare(sql) {
      const st = {
        args: [],
        bind(...args) { st.args = args; return st; },
        async run() { log.push({ sql, args: st.args }); return { success: true, meta: {} }; },
        async all() {
          if (/FROM purchase_invoices WHERE piNo IN/.test(sql))
            return { results: Object.values(PI_ROWS).filter((r) => st.args.includes(r.piNo)) };
          if (/FROM suppliers WHERE id IN/.test(sql)) return { results: [{ id: 's-1', code: 'S-OCEAN' }] };
          if (/FROM suppliers WHERE code = \?/.test(sql))
            return { results: st.args[0] === 'S-OCEAN' ? [{ id: 's-1', name: 'Ocean Sky' }] : [] };
          if (/FROM purchase_invoice_items WHERE pi_id/.test(sql)) return { results: ITEMS[st.args[0]] ?? [] };
          return { results: [] };
        },
        async first() {
          if (/FROM purchase_invoices WHERE id = \?/.test(sql)) return PI_ROWS[st.args[0]] ?? null;
          if (/FROM purchase_orders WHERE poNo = \?/.test(sql)) return st.args[0] === 'PO-2610-001' ? { id: 'po-1' } : null;
          return null;
        },
      };
      return st;
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

/** A ctx whose GET runs the real route on the stub DB and whose writes are recorded. */
function makeCtx() {
  const db = makeDb();
  const writes = [];
  const ctx = {
    c: {},
    db,
    async callRoute(app, method, path, body) {
      if (method !== 'GET') {
        writes.push({ method, path, body });
        return { success: true, data: { id: 'pi-new', piNo: body?.piNo ?? 'PI-2610-099' } };
      }
      const wrap = new Hono();
      wrap.use('*', async (c, next) => { c.set('DB', db); await next(); });
      wrap.route('/x', app);
      return (await wrap.request(`/x${path}`)).json();
    },
  };
  return { ctx, writes };
}

/** What the operator downloads: the page's own Detail Listing builder. */
async function exportAoa() {
  const { ctx } = makeCtx();
  return buildPiDetailRows([{ id: 'pi-1', piNo: 'PI-2610-001' }, { id: 'pi-2', piNo: 'PI-2610-002' }], {
    fetchJson: (url) => ctx.callRoute(purchaseInvoices, 'GET', url.replace(/^\/api\/purchase-invoices/, '')),
    wait: async () => {},
    confirmLarge: () => true,
    partyCodes: new Map([['s-1', 'S-OCEAN']]),
  });
}

async function plan(aoa) {
  const { ctx, writes } = makeCtx();
  const docNos = [...new Set(aoa.slice(1).map((r) => String(r[1])).filter((n) => n && !/^new-/i.test(n)))];
  const current = await piImportAdapter.load(ctx, docNos);
  const p = planDocImport(aoa, current, PI_IMPORT_SPEC);
  p.errors.push(...piImportAdapter.validate(p));
  return { p, ctx, writes };
}

const col = (aoa, name) => aoa[0].indexOf(name);

test('round trip: an unedited PI export imports back with zero changes', async () => {
  const aoa = await exportAoa();
  assert.equal(aoa[0][col(aoa, 'Line ID')], 'Line ID');
  assert.equal(aoa.length, 4, 'every line of every PI');
  const { p } = await plan(aoa);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.equal(planHasWork(p), false);
});

test('edit: PUT sends every stored line, the change applied, full precision and GRN link kept', async () => {
  const aoa = await exportAoa();
  const legRow = aoa.findIndex((r) => r[col(aoa, 'Line ID')] === 'pii-b');
  aoa[legRow][col(aoa, 'Qty')] = 3;
  const { p, ctx, writes } = await plan(aoa);
  assert.deepEqual(p.errors, []);
  const doc = p.docs.find((d) => d.docNo === 'PI-2610-001');
  await piImportAdapter.update(ctx, doc);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.equal(writes[0].path, '/pi-1');
  const [fab, leg] = writes[0].body.items;
  assert.equal(writes[0].body.items.length, 2);
  assert.equal(leg.qty, 3);
  assert.equal(leg.unitPriceSen, 10000);
  assert.equal(fab.unitPriceSen, 5.5, 'the export rounded it to 0.06; the edit must not');
  assert.equal(fab.grnItemId, '41');
  assert.equal(fab.notes, 'n1');
});

test('a blank cell keeps the stored value; a typed 0 wins', async () => {
  const aoa = await exportAoa();
  const legRow = aoa.findIndex((r) => r[col(aoa, 'Line ID')] === 'pii-b');
  aoa[legRow][col(aoa, 'Unit Price')] = '';
  aoa[legRow][col(aoa, 'Description')] = '';
  aoa[legRow][col(aoa, 'Tax')] = 0;
  aoa[legRow][col(aoa, 'Discount')] = 5;
  const { p, ctx, writes } = await plan(aoa);
  const doc = p.docs.find((d) => d.docNo === 'PI-2610-001');
  assert.deepEqual(doc.lines.find((l) => l.lineId === 'pii-b').changes.map((c) => c.key), ['discount']);
  await piImportAdapter.update(ctx, doc);
  const leg = writes[0].body.items[1];
  assert.equal(leg.unitPriceSen, 10000);
  assert.equal(leg.materialName, 'Leg');
  assert.equal(leg.discountSen, 500);
});

test('edit: a header change alone sends no items', async () => {
  const aoa = await exportAoa();
  for (const r of aoa.slice(1)) if (r[1] === 'PI-2610-002') r[col(aoa, 'Supplier Invoice No.')] = 'OS-88';
  const { p, ctx, writes } = await plan(aoa);
  await piImportAdapter.update(ctx, p.docs.find((d) => d.docNo === 'PI-2610-002'));
  assert.deepEqual(writes[0].body, { supplierInvoiceNo: 'OS-88' });
});

test('create: POST with the supplier, the PO and the lines', async () => {
  const aoa = await exportAoa();
  const H = aoa[0];
  const row = (cells) => H.map((h) => cells[h] ?? '');
  const sheet = [H,
    row({ 'Doc Type': 'PI', 'Doc No.': 'NEW-1', 'Doc Date': '2026-10-10', 'Party Code': 'S-OCEAN', 'Ref Doc No.': 'PO-2610-001',
      'Supplier Invoice No.': 'OS-90', 'Item Code': 'FAB-1', Description: 'Fabric', Qty: 10, 'Unit Price': 1.5 }),
    row({ 'Doc Type': 'PI', 'Doc No.': 'NEW-1', 'Item Code': 'LEG-1', Description: 'Leg', Qty: 4, 'Unit Price': 100, Tax: 8 }),
  ];
  const { p, ctx, writes } = await plan(sheet);
  assert.deepEqual(p.errors, []);
  const out = await piImportAdapter.create(ctx, p.docs[0]);
  assert.deepEqual(out, { id: 'pi-new', docNo: 'PI-2610-099' });
  const b = writes[0].body;
  assert.equal(writes[0].method, 'POST');
  assert.equal(b.supplierId, 's-1');
  assert.equal(b.purchaseOrderId, 'po-1');
  assert.equal(b.invoiceDate, '2026-10-10');
  assert.equal(b.supplierInvoiceNo, 'OS-90');
  assert.equal(b.status, 'DRAFT');
  assert.equal(b.piNo, undefined, 'NEW-1 = server numbers it');
  assert.deepEqual(b.items.map((i) => [i.materialCode, i.qty, i.unitPriceSen, i.taxSen, i.poId]), [
    ['FAB-1', 10, 150, 0, 'po-1'],
    ['LEG-1', 4, 10000, 800, 'po-1'],
  ]);
});

test('create: missing Party Code / Description / a non-PI number are refused', async () => {
  const H = (await exportAoa())[0];
  const row = (cells) => H.map((h) => cells[h] ?? '');
  const { p } = await plan([H, row({ 'Doc Type': 'PI', 'Doc No.': 'X-1', 'Item Code': 'A', Qty: 1 }), row({ 'Doc Type': 'PI', 'Doc No.': 'X-1', 'Item Code': 'B', Description: 'b' })]);
  const msgs = p.errors.map((e) => e.message).join('\n');
  assert.match(msgs, /Party Code/);
  assert.match(msgs, /not a PI number/);
  assert.match(msgs, /Description is blank/);
  assert.match(msgs, /Qty is blank/);
});

test('all-or-nothing: one bad row and nothing from the file is written', async () => {
  const aoa = await exportAoa();
  const legRow = aoa.findIndex((r) => r[col(aoa, 'Line ID')] === 'pii-b');
  aoa[legRow][col(aoa, 'Qty')] = 9; // a good edit on PI-2610-001…
  const thingRow = aoa.findIndex((r) => r[col(aoa, 'Line ID')] === 'pii-c');
  aoa[thingRow][col(aoa, 'Qty')] = 'lots'; // …and a bad one on PI-2610-002
  const db = makeDb();
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('DB', db); c.set('userId', 'u1'); await next(); });
  app.post('/', async (c) =>
    c.json(await runDocImport(c, piImportAdapter, aoa, { execute: true, checkPermission: async () => null })),
  );
  const r = await (await app.request('/', { method: 'POST' })).json();
  assert.equal(r.success, false);
  assert.equal(r.rolledBack, true);
  assert.match(r.errors[0].message, /Qty: "lots" is not a number/);
  assert.deepEqual(db.committed, [], 'the good PI-2610-001 edit was not written either');
});
