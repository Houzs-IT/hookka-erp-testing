// ---------------------------------------------------------------------------
// /api/doc-import — the ONE import endpoint for every document type (HK-0002).
//
//   POST /api/doc-import/:docType            dry run (default): plan + per-row
//                                            diff + errors; runs the real apply
//                                            inside a transaction and rolls it
//                                            back, so route refusals show too
//   POST /api/doc-import/:docType?execute=1  apply — all-or-nothing, one
//                                            transaction
//
// Body: { rows: unknown[][] } — the sheet as an array of arrays, header row
// first (the Detail Listing export, edited). Permission: the document's own
// create / update permission, per action the plan needs.
//
// Registering a new document type = one line in ADAPTERS. See
// docs/pipeline/2026-10-16/hk0002-adapter-guide.md.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { runDocImport, type DocImportAdapter } from "../lib/doc-import";
import { invoiceImportAdapter } from "../lib/doc-import-invoice";
import { doImportAdapter } from "../lib/doc-import-do";

/** docType (lower-case, as in the URL) → adapter. */
export const ADAPTERS: Record<string, DocImportAdapter> = {
  di: invoiceImportAdapter,
  si: invoiceImportAdapter,
  do: doImportAdapter,
};

const MAX_ROWS = 5000;
const MAX_DOCS = 200;

const app = new Hono<Env>();

app.post("/:docType", async (c) => {
  const adapter = ADAPTERS[c.req.param("docType").toLowerCase()];
  if (!adapter) {
    return c.json(
      { success: false, error: `No importer for "${c.req.param("docType")}". Available: ${Object.keys(ADAPTERS).join(", ")}.` },
      404,
    );
  }
  // Gate before reading anything: a user who can neither create nor update
  // this document has no business previewing an import of it.
  const canUpdate = !(await requirePermission(c, adapter.resource, "update"));
  const canCreate = !(await requirePermission(c, adapter.resource, "create"));
  if (!canUpdate && !canCreate) return (await requirePermission(c, adapter.resource, "update"))!;

  const body = (await c.req.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = body && Array.isArray(body.rows) && body.rows.every(Array.isArray) ? (body.rows as unknown[][]) : null;
  if (!rows) return c.json({ success: false, error: "Body must be { rows: [[header...], [cells...], ...] }." }, 400);
  if (rows.length < 2) return c.json({ success: false, error: "The sheet has no data rows." }, 400);
  if (rows.length - 1 > MAX_ROWS) {
    return c.json({ success: false, error: `${rows.length - 1} rows is more than one import accepts (${MAX_ROWS}).` }, 400);
  }
  const result = await runDocImport(c, adapter, rows, {
    execute: c.req.query("execute") === "1",
    checkPermission: (action) => requirePermission(c, adapter.resource, action),
    maxDocs: MAX_DOCS,
  });
  if (result instanceof Response) return result;
  return c.json(result, result.success ? 200 : 409);
});

export default app;
