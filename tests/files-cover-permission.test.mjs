// BUG-2026-11-28-614 — PATCH /api/files/:id/cover ("Set as cover" on the
// Products Catalog) was the one file write with no permission check: any
// signed-in user could change which photo is the cover of any product or
// document. It now takes the upload gate (flow document → that document's
// update permission; anything else → files:create). Drives the REAL handler.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));

const { default: filesApp } = await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/files.ts")).href);

function harness(role) {
  const writes = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/FROM file_assets WHERE id = \?/.test(sql)) {
        return { id: "f-1", resourceType: "product", resourceId: "p-1", filename: "a.jpg", contentType: "image/jpeg", sizeBytes: 1 };
      }
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      if (/^\s*(UPDATE|ALTER)/i.test(sql)) writes.push(sql);
      return { success: true, meta: { changes: 1 } };
    },
  });
  const DB = {
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      for (const s of stmts) writes.push(s.sql);
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", DB);
    c.set("orgId", "hookka");
    c.set("userId", "u-1");
    if (role) c.set("userRole", role);
    await next();
  });
  app.route("/", filesApp);
  return { writes, patch: () => app.request("/f-1/cover", { method: "PATCH" }, { SESSION_CACHE: undefined }) };
}

test("Set as cover with no role is refused and writes nothing", async () => {
  const { patch, writes } = harness(null);
  const res = await patch();
  assert.equal(res.status, 401, await res.clone().text());
  assert.deepEqual(writes, []);
});

test("Set as cover by an admin still works", async () => {
  const { patch, writes } = harness("SUPER_ADMIN");
  const res = await patch();
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(writes.some((s) => /sort_order = 0/.test(s)));
});

test("the cover route carries the same gate as upload", () => {
  const src = readFileSync("src/api/routes/files.ts", "utf8").replace(/\r\n/g, "\n");
  const block = src.slice(src.indexOf('app.patch("/:id/cover"'), src.indexOf("// GET /api/files/:id — metadata"));
  assert.match(block, /flowFileResource\(coverType\)\s*\?\s*await flowGate\(c, coverType, "update"\)\s*:\s*await requirePermission\(c, "files", "create"\)/);
  assert.ok(block.indexOf("if (denied) return denied;") < block.indexOf("UPDATE file_assets"), "gate before the write");
});
