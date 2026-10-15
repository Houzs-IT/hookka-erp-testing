// ---------------------------------------------------------------------------
// HK-0005: scan originals live in object storage, are readable inline, and
// every read leaves a trail. Behaviour of the pure helpers + source guards on
// the route (same style as scan-queue-client-driven.test.mjs).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import scanQueue from "../src/api/routes/scan-queue.ts";
import {
  scanFileKey,
  originalDisposition,
  stashScanBytes,
  readScanBytes,
} from "../src/api/lib/scan-file-store.ts";

test("scanFileKey: org + content hash, so identical bytes share one object", () => {
  assert.equal(scanFileKey("org1", "abc"), "scan-originals/org1/abc");
  assert.equal(scanFileKey(null, "abc"), "scan-originals/_/abc");
});

test("originalDisposition: only pdf and raster images render inline", () => {
  assert.equal(originalDisposition("application/pdf"), "inline");
  assert.equal(originalDisposition("image/jpeg"), "inline");
  assert.equal(originalDisposition("image/svg+xml"), "attachment", "svg can carry script");
  assert.equal(originalDisposition("text/html"), "attachment");
  assert.equal(originalDisposition(""), "attachment");
});

test("stashScanBytes: storage not configured -> falls back to the b64 column", async () => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  const r = await stashScanBytes({}, "org1", "h1", buf, "application/pdf");
  assert.equal(r.fileKey, null);
  assert.equal(r.b64, "AQID");
});

test("readScanBytes: legacy b64 row still readable; nothing stored -> null", async () => {
  const bytes = await readScanBytes({}, { fileKey: null, fileBytesB64: "AQID" });
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  assert.equal(await readScanBytes({}, { fileKey: null, fileBytesB64: null }), null);
});

// ---- behavioural: the real Hono router against a stub DB ------------------
const ROWS = [
  { id: "s1", org_id: "o1", file_bytes_b64: "AQID", file_key: null, mime_type: "application/pdf", file_name: "a.pdf" },
  { id: "s-legacy", org_id: null, file_bytes_b64: "AQID", file_key: null, mime_type: "application/pdf", file_name: "l.pdf" },
];

function harness({ role = "SUPER_ADMIN", orgId = "o1", failAudit = false } = {}) {
  const access = [];
  const answer = (sql, b) => {
    if (/FROM scan_queue/i.test(sql) && /file_key\s+AS "fileKey"/i.test(sql)) {
      const nullOk = /OR org_id IS NULL/i.test(sql);
      const r = ROWS.find((x) => x.id === b[0] && (x.org_id === b[1] || (nullOk && x.org_id === null)));
      return r ? [{ fileBytesB64: r.file_bytes_b64, fileKey: r.file_key, mimeType: r.mime_type, fileName: r.file_name }] : [];
    }
    return [];
  };
  const stmt = (sql, binds = []) => ({
    bind: (...b) => stmt(sql, b),
    all: async () => ({ results: answer(sql, binds), success: true }),
    first: async () => answer(sql, binds)[0] ?? null,
    run: async () => {
      if (/INSERT INTO scan_original_access/i.test(sql)) {
        if (failAudit) throw new Error("audit down");
        access.push({ scanId: binds[1], orgId: binds[2], userId: binds[3], via: binds[4] });
      }
      return { success: true, meta: { changes: 1 } };
    },
  });
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", { prepare: (sql) => stmt(sql) });
    c.set("orgId", orgId);
    c.set("userRole", role);
    c.set("userId", "u1");
    await next();
  });
  parent.route("/api/scan-queue", scanQueue);
  return { access, get: (p) => parent.request(`/api/scan-queue${p}`, {}, {}) };
}

test("original: role without purchase-orders:create gets 403 and no access row", async () => {
  const h = harness({ role: "NOBODY" });
  const res = await h.get("/s1/original");
  assert.equal(res.status, 403);
  assert.equal(h.access.length, 0);
});

test("original: another org's scan is 404 and leaves no access row", async () => {
  const h = harness({ orgId: "o2" });
  assert.equal((await h.get("/s1/original")).status, 404);
  assert.equal(h.access.length, 0);
});

test("original: own-org scan serves inline and writes who/what/via", async () => {
  const h = harness();
  const res = await h.get("/s1/original");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /^inline;/);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(h.access, [{ scanId: "s1", orgId: "o1", userId: "u1", via: "original" }]);
});

test("bytes: stays an attachment and is trailed as via=bytes", async () => {
  const h = harness();
  const res = await h.get("/s1/bytes");
  assert.match(res.headers.get("content-disposition"), /^attachment;/);
  assert.equal(h.access[0].via, "bytes");
});

test("original: legacy NULL-org row is not served; /bytes keeps its old behaviour", async () => {
  const h = harness();
  assert.equal((await h.get("/s-legacy/original")).status, 404);
  assert.equal((await h.get("/s-legacy/bytes")).status, 200);
});

test("original: audit write fails -> fail closed, file not served", async () => {
  const h = harness({ failAudit: true });
  const res = await h.get("/s1/original");
  assert.equal(res.status, 500);
  assert.notEqual(res.headers.get("content-type"), "application/pdf");
});
