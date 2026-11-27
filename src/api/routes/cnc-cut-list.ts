// ---------------------------------------------------------------------------
// /api/cnc-cut-list — HK-0036 CNC cut list + bedframe batch markers (.plt).
//
// The logic (grouping, stamp, only-new, changed-since-export) is in
// src/api/lib/cnc-cut-list.ts. This file is the HTTP shell plus the .plt
// marker files: bytes in Supabase Storage (hookka-files), metadata in
// cnc_cut_markers, keys never sent to the client (same as cnc-templates.ts).
// ERP never sends anything to the cutter software; a human presses Send.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import {
  SupabaseStorageNotConfiguredError,
  DEFAULT_BUCKET,
  putFile,
  getFile,
  signedDownloadUrl,
  deleteFile,
} from "../lib/supabase-storage";
import {
  ensureCutListTables,
  exportCutList,
  listCutBatches,
  loadCutBatch,
  parseMetresFromName,
} from "../lib/cnc-cut-list";

const app = new Hono<Env>();

let tablesReady: Promise<void> | null = null;
app.use("*", async (c, next) => {
  tablesReady ??= ensureCutListTables(c.var.DB).catch((e) => {
    tablesReady = null; // retry on the next request
    throw e;
  });
  await tablesReady;
  await next();
});

const userIdOf = (c: unknown) =>
  (c as { get: (k: string) => string | undefined }).get("userId") ?? null;

const storageDown = (c: { json: (b: unknown, s: 503) => Response }) =>
  c.json({ success: false, error: "File storage unavailable." }, 503);

// GET /batches — recent exports, newest first.
app.get("/batches", async (c) => {
  const denied = await requirePermission(c, "production-orders", "read");
  if (denied) return denied;
  return c.json({ success: true, data: await listCutBatches(c.var.DB, getOrgId(c)) });
});

// GET /batches/:id — re-export one batch (its cards with today's PO data).
app.get("/batches/:id", async (c) => {
  const denied = await requirePermission(c, "production-orders", "read");
  if (denied) return denied;
  const data = await loadCutBatch(c.var.DB, getOrgId(c), c.req.param("id"));
  if (!data) return c.json({ success: false, error: "Batch not found." }, 404);
  return c.json({ success: true, data });
});

// POST /export — stamp the new cards into a batch. data = null: nothing new.
app.post("/export", async (c) => {
  const denied = await requirePermission(c, "production-orders", "update");
  if (denied) return denied;
  const data = await exportCutList(c.var.DB, getOrgId(c), userIdOf(c), new Date().toISOString());
  if (data) {
    await emitAudit(c, {
      resource: "cnc-cut-list",
      resourceId: data.batch.id,
      action: "create",
      after: { cardCount: data.batch.cardCount, changeCount: data.batch.changeCount },
    });
  }
  return c.json({ success: true, data });
});

// POST /batches/:id/markers — upload a bedframe batch marker (.plt) for one
// group. multipart: file, groupKey. Metres from the "NNMTR" in the name.
app.post("/batches/:id/markers", async (c) => {
  const denied = await requirePermission(c, "production-orders", "update");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const batchId = c.req.param("id");
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ success: false, error: "Invalid multipart body." }, 400);
  }
  const file = form.get("file");
  const groupKey = String(form.get("groupKey") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) {
    return c.json({ success: false, error: "Choose a .plt file." }, 400);
  }
  const fileName = file.name.split(/[\\/]/).pop() || "marker.plt";
  if (!/\.plt$/i.test(fileName)) {
    return c.json({ success: false, error: "Only .plt files can be uploaded here." }, 400);
  }
  if (!groupKey) return c.json({ success: false, error: "groupKey is required." }, 400);
  const batch = await c.var.DB.prepare("SELECT id FROM cnc_cut_batches WHERE id = ? AND org_id = ?")
    .bind(batchId, orgId)
    .first();
  if (!batch) return c.json({ success: false, error: "Batch not found." }, 404);

  const id = `mk-${crypto.randomUUID().slice(0, 12)}`;
  const key = `cnc-cut-markers/${batchId}/${id}.plt`;
  const metres = parseMetresFromName(fileName);
  try {
    await putFile(c.env, DEFAULT_BUCKET, key, await file.arrayBuffer(), "application/octet-stream");
  } catch (err) {
    if (err instanceof SupabaseStorageNotConfiguredError) return storageDown(c);
    throw err;
  }
  try {
    await c.var.DB.prepare(
      `INSERT INTO cnc_cut_markers (id, org_id, batch_id, group_key, file_name, storage_key,
              metres, size_bytes, uploaded_at, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, orgId, batchId, groupKey, fileName, key, metres, file.size, new Date().toISOString(), userIdOf(c))
      .run();
  } catch (err) {
    await deleteFile(c.env, DEFAULT_BUCKET, key).catch(() => {}); // no orphan bytes
    throw err;
  }
  await emitAudit(c, {
    resource: "cnc-cut-list",
    resourceId: id,
    action: "create",
    after: { batchId, groupKey, fileName, metres, sizeBytes: file.size },
  });
  return c.json({ success: true, data: { id, groupKey, fileName, metres, sizeBytes: file.size } }, 201);
});

async function markerRow(c: { var: { DB: Env["Variables"]["DB"] } }, orgId: string, id: string) {
  return c.var.DB.prepare(
    "SELECT id, file_name, storage_key, metres FROM cnc_cut_markers WHERE id = ? AND org_id = ?",
  )
    .bind(id, orgId)
    .first<{ id: string; fileName: string; storageKey: string; metres: number | null }>();
}

// GET /markers/:id/file — download (signed-URL 302, else streamed).
app.get("/markers/:id/file", async (c) => {
  const denied = await requirePermission(c, "production-orders", "read");
  if (denied) return denied;
  const m = await markerRow(c, getOrgId(c), c.req.param("id"));
  if (!m) return c.json({ success: false, error: "Marker not found." }, 404);
  try {
    const url = await signedDownloadUrl(c.env, DEFAULT_BUCKET, m.storageKey, 300);
    if (url) return c.redirect(url, 302);
    const obj = await getFile(c.env, DEFAULT_BUCKET, m.storageKey);
    if (!obj) return c.json({ success: false, error: "File not found." }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${m.fileName.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof SupabaseStorageNotConfiguredError) return storageDown(c);
    throw err;
  }
});

// PATCH /markers/:id — fix the metres by hand ({ metres: number | null }).
app.patch("/markers/:id", async (c) => {
  const denied = await requirePermission(c, "production-orders", "update");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const body = (await c.req.json().catch(() => null)) as { metres?: unknown } | null;
  const raw = body?.metres;
  const metres = raw == null || raw === "" ? null : Number(raw);
  if (metres !== null && !(Number.isFinite(metres) && metres >= 0)) {
    return c.json({ success: false, error: "Metres must be a number of 0 or more." }, 400);
  }
  const m = await markerRow(c, orgId, c.req.param("id"));
  if (!m) return c.json({ success: false, error: "Marker not found." }, 404);
  await c.var.DB.prepare("UPDATE cnc_cut_markers SET metres = ? WHERE id = ? AND org_id = ?")
    .bind(metres, m.id, orgId)
    .run();
  await emitAudit(c, {
    resource: "cnc-cut-list",
    resourceId: m.id,
    action: "update",
    before: { metres: m.metres },
    after: { metres },
  });
  return c.json({ success: true, data: { id: m.id, metres } });
});

// DELETE /markers/:id — remove a wrongly uploaded marker (bytes + row).
app.delete("/markers/:id", async (c) => {
  const denied = await requirePermission(c, "production-orders", "update");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const m = await markerRow(c, orgId, c.req.param("id"));
  if (!m) return c.json({ success: false, error: "Marker not found." }, 404);
  try {
    await deleteFile(c.env, DEFAULT_BUCKET, m.storageKey);
  } catch (err) {
    if (!(err instanceof SupabaseStorageNotConfiguredError)) throw err;
  }
  await c.var.DB.prepare("DELETE FROM cnc_cut_markers WHERE id = ? AND org_id = ?")
    .bind(m.id, orgId)
    .run();
  await emitAudit(c, { resource: "cnc-cut-list", resourceId: m.id, action: "delete", before: { fileName: m.fileName } });
  return c.json({ success: true });
});

export default app;
