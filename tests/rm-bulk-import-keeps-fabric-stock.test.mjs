// BUG-2026-11-12-506 (HK-0142) — re-importing an existing fabric code through
// Raw Materials → Batch Import reset fabrics.sohMeters and fabric_trackings.soh
// to 0: the fabric cascade was always handed balanceQty: 0, even on UPDATE,
// while raw_materials.balanceQty itself was (correctly) left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Hono } from 'hono';
try { register('tsx/esm', pathToFileURL('./')); } catch {}
register('./tests/_alias-loader.mjs', pathToFileURL('./'));
const { default: rmApp } = await import(pathToFileURL(resolve(process.cwd(), 'src/api/routes/raw-materials.ts')).href);

// SIENNA 02 exists with 12.5 m in stock, and so do its fabric mirror rows.
const RM = [{ id: 'rm-s2', orgId: 'hookka', itemCode: 'SIENNA 02', itemGroup: 'S.M-FABR', baseUOM: 'MTR', balanceQty: 12.5, description: 'DESSERT SAND', status: 'ACTIVE' }];
const MIRROR = { fabrics: { 'SIENNA 02': 'fab-s2' }, fabric_trackings: { 'SIENNA 02': 'ft-s2' } };

function makeDb() {
  const writes = [];
  function prepare(sql) {
    const o = { sql, bound: [],
      bind(...a) { o.bound = a; return o; },
      async all() { return { results: /FROM raw_materials/i.test(sql) ? RM : [] }; },
      async first() {
        const t = /FROM (fabrics|fabric_trackings) WHERE/i.exec(sql)?.[1];
        const id = t && MIRROR[t][o.bound[0]];
        return id ? { id } : null;
      },
      async run() { return { success: true }; },
    };
    return o;
  }
  return { db: { prepare, batch: async (st) => { writes.push(...st); return []; } }, writes };
}

async function post(rows) {
  const { db, writes } = makeDb();
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('DB', db); c.set('orgId', 'hookka'); c.set('userRole', 'ADMIN'); c.set('userId', 'u1'); await next(); });
  app.route('/', rmApp);
  const res = await app.request('/bulk-import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) }, {});
  return { body: await res.json(), writes };
}

test('re-importing an existing fabric code updates its name but leaves its stock alone', async () => {
  const { body, writes } = await post([{ itemCode: 'SIENNA 02', description: 'DESSERT SAND V2', baseUOM: 'MTR', itemGroup: 'S.M-FABR' }]);
  assert.equal(body.data.updated, 1, JSON.stringify(body));
  const fab = writes.find((w) => /UPDATE fabrics/i.test(w.sql));
  const trk = writes.find((w) => /UPDATE fabric_trackings/i.test(w.sql));
  assert.ok(fab && trk, 'both mirror rows are updated');
  assert.ok(fab.bound.includes('DESSERT SAND V2') && trk.bound.includes('DESSERT SAND V2'), 'new name reaches the mirror');
  assert.doesNotMatch(fab.sql, /sohMeters/i, 'fabrics.sohMeters must not be overwritten');
  assert.doesNotMatch(trk.sql, /\bsoh\b/i, 'fabric_trackings.soh must not be overwritten');
});

test('a new fabric code still starts at 0 stock in both mirror tables', async () => {
  const { body, writes } = await post([{ itemCode: 'SIENNA 11', description: 'NEW', baseUOM: 'MTR', itemGroup: 'S.M-FABR' }]);
  assert.equal(body.data.created, 1, JSON.stringify(body));
  const fab = writes.find((w) => /INSERT INTO fabrics/i.test(w.sql));
  const trk = writes.find((w) => /INSERT INTO fabric_trackings/i.test(w.sql));
  assert.equal(fab.bound[5], 0, 'fabrics.sohMeters');
  assert.equal(trk.bound[6], 0, 'fabric_trackings.soh');
});
