// scan-original-file-store.test.mjs — HK-0005 slice 2.
//
// Before: every queued scan (customer PO -> SO/CO, supplier doc -> PI/GRN) was
// stored as base64 TEXT in scan_queue.file_bytes_b64, decoded again by each
// worker, and NULLed at consume — so the original was thrown away unless the
// browser happened to re-upload it for an SO or PI.
// After: the original goes to the existing file store (Supabase Storage +
// file_assets, via storeUploadedFile) and the row keeps file_asset_id; b64 is
// only a fallback when the store refuses, and the reader for old rows.
//
// Tests 1-3 call the real exported functions with a fake DB and a stubbed
// fetch (no network). Test 4 is a source check on the INSERTs, honest about it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stashOriginal, loadOriginal } from "../src/api/routes/scan-queue.ts";

const ENV = { SUPABASE_PROJECT_REF: "proj", SUPABASE_SERVICE_KEY: "svc" };
const PDF = new TextEncoder().encode("%PDF-1.4 a scanned customer PO").buffer;

function fakeDb(firstRow = null) {
  const writes = [];
  return {
    writes,
    prepare: (sql) => ({
      _args: [],
      bind(...a) { this._args = a; return this; },
      first: async () => firstRow,
      run: async function () { writes.push([sql, this._args]); return { meta: { changes: 1 } }; },
    }),
  };
}

function ctx(db, env = ENV) {
  const vars = { orgId: "org-1", userId: "u-1" };
  return { env, var: { DB: db }, get: (k) => vars[k], req: { header: () => undefined } };
}

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("stashOriginal puts the original in the file store and records a scan-original file_assets row", async () => {
  const db = fakeDb();
  const puts = [];
  const id = await withFetch(
    async (url, init) => (puts.push([String(url), init?.method]), new Response("{}", { status: 200 })),
    () => stashOriginal(ctx(db), "sqi-1", PDF, "po.pdf", "application/pdf"),
  );
  assert.match(id ?? "", /^fa-/, "returns the file_assets id");
  assert.equal(puts.length, 1);
  assert.match(puts[0][0], /proj\.supabase\.co\/storage\/v1\/object\/hookka-files\/org-1\/scan-original\/sqi-1\//);
  const insert = db.writes.find(([sql]) => /INSERT INTO file_assets/.test(sql));
  assert.ok(insert, "a file_assets row is written");
  assert.equal(insert[1][1], "scan-original");
  assert.equal(insert[1][2], "sqi-1");
});

test("stashOriginal returns null (caller keeps b64) when the store is not configured", async () => {
  const id = await withFetch(
    () => assert.fail("must not call storage"),
    () => stashOriginal(ctx(fakeDb(), {}), "sqi-2", PDF, "po.pdf", "application/pdf"),
  );
  assert.equal(id, null);
});

test("loadOriginal reads the file store first, and the b64 column for old rows", async () => {
  const fromStore = await withFetch(
    async (url) => {
      assert.match(String(url), /object\/authenticated\/hookka-files\/org-1\/scan-original\//);
      return new Response(PDF, { status: 200 });
    },
    () => loadOriginal(fakeDb({ r2Key: "org-1/scan-original/sqi-1/fa-1-po.pdf" }), ENV, { fileAssetId: "fa-1", fileBytesB64: null }),
  );
  assert.equal(new TextDecoder().decode(fromStore), "%PDF-1.4 a scanned customer PO");

  const b64 = btoa("%PDF-old");
  const legacy = await withFetch(
    () => assert.fail("no asset id, no storage call"),
    () => loadOriginal(fakeDb(), ENV, { fileAssetId: null, fileBytesB64: b64 }),
  );
  assert.equal(new TextDecoder().decode(legacy), "%PDF-old");

  assert.equal(await loadOriginal(fakeDb(), ENV, { fileAssetId: null, fileBytesB64: null }), null);
});

test("every scan_queue INSERT stores file_asset_id and writes b64 only as the fallback", () => {
  const src = readFileSync(new URL("../src/api/routes/scan-queue.ts", import.meta.url), "utf8");
  const inserts = src.match(/INSERT INTO scan_queue[\s\S]*?\)\s*VALUES/g) ?? [];
  assert.equal(inserts.length, 4, "upload hit + miss, split child hit + miss");
  for (const ins of inserts) assert.match(ins, /file_asset_id/);
  // No unconditional base64 of a whole upload any more.
  assert.doesNotMatch(src, /const b64(Cached)? = toBase64\(buf\)/);
  assert.equal((src.match(/= (asset|assetCached|childAsset) \? null : toBase64\(/g) ?? []).length, 4);
  // The worker no longer decodes the row's b64 itself — loadOriginal does.
  assert.match(src, /const original = row \? await loadOriginal\(db, env, row\) : null/);
});
