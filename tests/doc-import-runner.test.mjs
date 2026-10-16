// ---------------------------------------------------------------------------
// doc-import-runner — the server half of the shared importer (HK-0002),
// against a stub DB with transaction() and a stand-in "real route".
//
//   1. a dry run writes NOTHING (it runs the apply, then rolls back)
//   2. one refused document → NOTHING from the file is kept (all-or-nothing)
//   3. adapters write through callRoute: the route sees the transaction's DB
//      and the caller's identity (every c.var), and its refusal is reported
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { runDocImport } from '../src/api/lib/doc-import.ts';
import { currentFromListing, withFields } from '../src/lib/doc-import/core.ts';

function makeDb() {
  const committed = [];
  const mk = (log) => ({
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async run() { log.push({ sql, args: this.args }); return { success: true, meta: {} }; },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return []; },
  });
  const db = mk(committed);
  db.committed = committed;
  db.transaction = async (fn) => {
    const pending = [];
    const r = await fn(mk(pending)); // throws → pending is simply dropped
    committed.push(...pending);
    return r;
  };
  return db;
}

// The stand-in for a real document route (e.g. PUT /api/invoices/:id).
const seen = [];
const docRoute = new Hono();
docRoute.put('/:id', async (c) => {
  seen.push({ id: c.req.param('id'), userId: c.get('userId'), body: await c.req.json() });
  if (c.req.param('id') === 'id-BAD') return c.json({ success: false, error: 'Refused by the route: locked' }, 409);
  await c.var.DB.prepare('UPDATE docs SET qty = ? WHERE id = ?').bind(1, c.req.param('id')).run();
  return c.json({ success: true });
});

const SPEC = { docTypes: ['XX'], fields: withFields(['qty']) };
const STORED = [
  ['Doc No.', 'Line ID', 'Item Code', 'Qty'],
  ['D-1', 'L1', 'A', 1],
  ['D-BAD', 'L2', 'B', 1],
  ['D-3', 'L3', 'C', 1],
];
const adapter = {
  docTypes: ['XX'],
  resource: 'invoices',
  spec: SPEC,
  async load(_ctx, docNos) {
    return currentFromListing(STORED, SPEC, new Map(docNos.map((n) => [n, `id-${n.slice(2)}`])));
  },
  async create() { throw new Error('not used'); },
  async update(ctx, doc) {
    await ctx.callRoute(docRoute, 'PUT', `/${doc.current.id}`, { lines: doc.lines.map((l) => l.merged) });
  },
};

async function run(db, rows, execute) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('DB', db);
    c.set('userId', 'u1');
    c.set('userRole', 'SUPER_ADMIN');
    await next();
  });
  app.post('/', async (c) =>
    c.json(await runDocImport(c, adapter, rows, { execute, checkPermission: async () => null })),
  );
  return (await app.request('/', { method: 'POST' })).json();
}

const edit = (...docs) => [STORED[0], ...STORED.slice(1).filter((r) => docs.includes(r[0])).map((r) => [r[0], r[1], r[2], 5])];

test('dry run: runs the apply, writes nothing', async () => {
  const db = makeDb();
  seen.length = 0;
  const r = await run(db, edit('D-1', 'D-3'), false);
  assert.equal(r.success, true);
  assert.equal(r.mode, 'dry-run');
  assert.equal(r.rolledBack, true);
  assert.equal(seen.length, 2, 'the real route ran for both docs');
  assert.deepEqual(db.committed, [], 'and nothing stayed');
  assert.deepEqual(r.docs[0].lines[0].changes.map((c) => [c.key, c.from, c.to]), [['qty', 1, 5]]);
});

test('execute: commits, and the route saw the caller identity', async () => {
  const db = makeDb();
  seen.length = 0;
  const r = await run(db, edit('D-1', 'D-3'), true);
  assert.equal(r.success, true);
  assert.equal(r.rolledBack, false);
  assert.equal(db.committed.length, 2);
  assert.ok(seen.every((s) => s.userId === 'u1'));
});

test('all-or-nothing: one refused doc and NOTHING from the file is kept', async () => {
  const db = makeDb();
  seen.length = 0;
  const r = await run(db, edit('D-1', 'D-BAD', 'D-3'), true);
  assert.equal(r.success, false);
  assert.equal(r.rolledBack, true);
  assert.deepEqual(db.committed, [], 'D-1 was written inside the transaction, then rolled back');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /locked/);
  assert.equal(r.errors[0].docNo, 'D-BAD');
});

test('a planner error stops everything before any route runs', async () => {
  const db = makeDb();
  seen.length = 0;
  const rows = [...edit('D-1'), ['D-3', 'L-NOPE', 'C', 5]];
  const r = await run(db, rows, true);
  assert.equal(r.success, false);
  assert.equal(seen.length, 0);
  assert.deepEqual(db.committed, []);
});

test('unedited export → nothing to do, no route called', async () => {
  const db = makeDb();
  seen.length = 0;
  const r = await run(db, STORED, true);
  assert.equal(r.success, true);
  assert.equal(seen.length, 0);
});
