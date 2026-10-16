// fetchAllPages (HK-0002): an export of a server-paged list must read EVERY
// page — the list routes clamp limit to 500, so one request is never "all".
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from '../src/lib/fetch-all-pages.ts';

const server = (n) => {
  const urls = [];
  const get = async (u) => {
    urls.push(u);
    const q = new URL(u, 'http://x').searchParams;
    const page = Number(q.get('page')), limit = Math.min(500, Number(q.get('limit')));
    const all = Array.from({ length: n }, (_, i) => i);
    return { data: all.slice((page - 1) * limit, page * limit), total: n };
  };
  return { urls, get };
};

test('pages until total, keeping the filter query', async () => {
  const s = server(1203);
  const rows = await fetchAllPages('/api/invoices?status=SENT', 500, s.get);
  assert.equal(rows.length, 1203);
  assert.deepEqual(s.urls, [
    '/api/invoices?status=SENT&page=1&limit=500',
    '/api/invoices?status=SENT&page=2&limit=500',
    '/api/invoices?status=SENT&page=3&limit=500',
  ]);
});

test('exact multiple of the page size stops on total, no empty extra request', async () => {
  const s = server(1000);
  assert.equal((await fetchAllPages('/api/grn', 500, s.get)).length, 1000);
  assert.equal(s.urls.length, 2);
  assert.match(s.urls[0], /^\/api\/grn\?page=1/);
});
