// ---------------------------------------------------------------------------
// DataGrid org-wide layouts — shared column presets for the generic DataGrid.
//
// Problem this fixes: the DataGrid's "Save as Org Default" and the print
// preset ("Save as Production Schedule") used to write ONLY to the local
// browser's localStorage, so a different browser / consultant / user never
// saw them (the old toast even admitted "new users on THIS browser"). This
// route persists those two presets to the backend, scoped to the org, so any
// user on any browser loads them.
//
// Two kinds per grid:
//   - 'org-default' : the curated initial layout for users who have not yet
//                     personalised this grid. Published by a SUPER_ADMIN.
//   - 'print'       : the curated layout a printout uses instead of the live
//                     on-screen columns (Wei Siang #25 "Save as Production
//                     Schedule"). Also SUPER_ADMIN-gated to publish (same bar
//                     as the FE save button on the org-wide presets).
//
// The PERSONAL per-user layout stays in localStorage — per-user-per-browser is
// fine for a personal view and keeps the hot path free of a round-trip.
//
// A third kind (finance v2, owner 2026-10-16): 'user:<userId>' — the layout a
// user saved with "Save Layout", so it follows them to any PC. Any signed-in
// user may save or clear their OWN row (never another's: the client can only
// name "user", see lib/datagrid-layout-kind.ts); GET returns it as `mine` with
// its updated_at, and the grid applies it when it is newer than the browser's.
//
// Resolution order on the client stays: personal localStorage (or the saved
// user layout when that is newer) > server org-default (mirrored into the
// localStorage cache keys) > code defaults.
//
// Deliberate isolation (same posture as routes/mail-center.ts): ALL SQL here
// is snake_case so it passes the camelCase→snake translator (supabase-compat)
// UNCHANGED and needs ZERO edits to column-rename-map.json. The table is
// created lazily here (CREATE TABLE IF NOT EXISTS at the top of every handler)
// because migration files are INERT on prod — a new table reaches prod ONLY
// via this runtime self-apply.
//
// Tenancy: every row carries org_id; reads + writes scope by getOrgId(c).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requireSuperAdmin } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { layoutKindFor, USER_LAYOUT_KIND } from "../lib/datagrid-layout-kind";

const app = new Hono<Env>();

const KIND_ERROR = "kind must be 'org-default', 'print' or 'user'";
const userIdOf = (c: { get: unknown }) =>
  (c.get as unknown as (k: string) => string | undefined)("userId");

// ---------------------------------------------------------------------------
// Lazy schema. Module-level promise = one flight per isolate; per-statement
// try/catch so a benign "already exists" never poisons the cached promise.
// Same pattern as routes/mail-center.ts (ensureMailSchema).
// ---------------------------------------------------------------------------
let pendingSchema = false;
async function ensureLayoutSchema(db: D1Database): Promise<void> {
  if (pendingSchema) return;

  const stmts = [
    // One row per (org, grid, kind). visible_cols / col_order are JSON-stringified
    // arrays; col_widths is a JSON-stringified object (or NULL when never saved).
    // updated_at is written via new Date().toISOString() so it MUST stay TEXT
    // (never timestamptz) for the SupabaseAdapter to round-trip it unchanged.
    `CREATE TABLE IF NOT EXISTS datagrid_org_layouts (
       id TEXT PRIMARY KEY,
       org_id TEXT NOT NULL DEFAULT 'hookka',
       grid_id TEXT NOT NULL,
       kind TEXT NOT NULL,
       visible_cols TEXT,
       col_order TEXT,
       col_widths TEXT,
       updated_by TEXT,
       updated_at TEXT
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_datagrid_org_layouts_org_grid_kind
       ON datagrid_org_layouts (org_id, grid_id, kind)`,
  ];
  for (const stmt of stmts) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      console.error("[datagrid-layouts] schema init failed:", e);
    }
  }
  pendingSchema = true;
}

type LayoutRow = {
  visibleCols?: string | null;
  visible_cols?: string | null;
  colOrder?: string | null;
  col_order?: string | null;
  colWidths?: string | null;
  col_widths?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  kind?: string;
};

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Shape one DB row into the FE-friendly preset object, or null when absent.
function rowToPreset(row: LayoutRow | null): {
  visibleCols: string[];
  colOrder: string[];
  colWidths: Record<string, string> | null;
} | null {
  if (!row) return null;
  const visibleCols = parseJson<string[]>(row.visibleCols ?? row.visible_cols);
  const colOrder = parseJson<string[]>(row.colOrder ?? row.col_order);
  const colWidths = parseJson<Record<string, string>>(
    row.colWidths ?? row.col_widths,
  );
  // A preset is only meaningful if at least the visible columns survived
  // parsing; otherwise treat as absent so the client falls back cleanly.
  if (!Array.isArray(visibleCols)) return null;
  return {
    visibleCols,
    colOrder: Array.isArray(colOrder) ? colOrder : visibleCols,
    colWidths: colWidths && typeof colWidths === "object" ? colWidths : null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/datagrid-layouts?gridId=...
// Returns { orgDefault, print, mine } for the caller's org: the two shared
// presets and the caller's own saved layout (with updatedAt), each or null.
// Any authenticated user may read (so every browser loads the shared layout).
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const orgId = getOrgId(c);
  const gridId = c.req.query("gridId");
  if (!gridId) {
    return c.json({ success: false, error: "gridId is required" }, 400);
  }
  const userId = userIdOf(c);
  // A caller without a user id matches no personal row ("" is never a kind).
  const mineKind = layoutKindFor(USER_LAYOUT_KIND, userId) ?? "";
  await ensureLayoutSchema(c.var.DB);
  try {
    const res = await c.var.DB.prepare(
      `SELECT kind, visible_cols, col_order, col_widths, updated_at
         FROM datagrid_org_layouts
        WHERE org_id = ? AND grid_id = ?
          AND (kind IN ('org-default', 'print') OR kind = ?)`,
    )
      .bind(orgId, gridId, mineKind)
      .all<LayoutRow>();
    let orgDefault: ReturnType<typeof rowToPreset> = null;
    let print: ReturnType<typeof rowToPreset> = null;
    let mine: (NonNullable<ReturnType<typeof rowToPreset>> & { updatedAt: string | null }) | null = null;
    for (const row of res.results ?? []) {
      if (row.kind === "org-default") orgDefault = rowToPreset(row);
      else if (row.kind === "print") print = rowToPreset(row);
      else if (mineKind && row.kind === mineKind) {
        const preset = rowToPreset(row);
        if (preset) mine = { ...preset, updatedAt: row.updatedAt ?? row.updated_at ?? null };
      }
    }
    return c.json({ success: true, orgDefault, print, mine });
  } catch (e) {
    console.error("[datagrid-layouts] GET failed:", e);
    // Fail soft — the FE falls back to its localStorage behavior on any error,
    // so a 500 here must never break a grid. Return empty presets.
    return c.json({ success: true, orgDefault: null, print: null, mine: null });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/datagrid-layouts
// Body: { gridId, kind, visibleCols, colOrder, colWidths? }
// Upsert a preset. The org-wide kinds are SUPER_ADMIN only (same bar as the FE
// save button); kind "user" saves the caller's own layout, for anyone signed in.
// ---------------------------------------------------------------------------
app.put("/", async (c) => {
  const orgId = getOrgId(c);
  const userId = userIdOf(c);

  let body: {
    gridId?: string;
    kind?: string;
    visibleCols?: unknown;
    colOrder?: unknown;
    colWidths?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const gridId = typeof body.gridId === "string" ? body.gridId.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (kind !== USER_LAYOUT_KIND) {
    const denied = requireSuperAdmin(c);
    if (denied) return denied;
  }
  if (!gridId) {
    return c.json({ success: false, error: "gridId is required" }, 400);
  }
  const storedKind = layoutKindFor(kind, userId);
  if (!storedKind) {
    return c.json({ success: false, error: KIND_ERROR }, 400);
  }
  if (!Array.isArray(body.visibleCols) || !Array.isArray(body.colOrder)) {
    return c.json(
      { success: false, error: "visibleCols and colOrder must be arrays" },
      400,
    );
  }

  const visibleCols = JSON.stringify(
    (body.visibleCols as unknown[]).map(String),
  );
  const colOrder = JSON.stringify((body.colOrder as unknown[]).map(String));
  const colWidths =
    body.colWidths && typeof body.colWidths === "object"
      ? JSON.stringify(body.colWidths)
      : null;
  const now = new Date().toISOString();

  await ensureLayoutSchema(c.var.DB);
  try {
    // UPSERT keyed on the unique (org_id, grid_id, kind) index. ON CONFLICT
    // keeps it to a single statement so concurrent admin saves can't duplicate.
    await c.var.DB.prepare(
      `INSERT INTO datagrid_org_layouts
         (id, org_id, grid_id, kind, visible_cols, col_order, col_widths, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_id, grid_id, kind) DO UPDATE SET
         visible_cols = excluded.visible_cols,
         col_order    = excluded.col_order,
         col_widths   = excluded.col_widths,
         updated_by   = excluded.updated_by,
         updated_at   = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        orgId,
        gridId,
        storedKind,
        visibleCols,
        colOrder,
        colWidths,
        userId ?? null,
        now,
      )
      .run();
    return c.json({ success: true });
  } catch (e) {
    console.error("[datagrid-layouts] PUT failed:", e);
    return c.json({ success: false, error: "Could not save layout" }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/datagrid-layouts?gridId=&kind=
// Remove a preset ("Reset to Org Default" clears the published org-default —
// SUPER_ADMIN only; "Reset Layout" clears the caller's own kind "user").
// ---------------------------------------------------------------------------
app.delete("/", async (c) => {
  const orgId = getOrgId(c);
  const userId = userIdOf(c);
  const gridId = c.req.query("gridId");
  const kind = c.req.query("kind") ?? "";
  if (kind !== USER_LAYOUT_KIND) {
    const denied = requireSuperAdmin(c);
    if (denied) return denied;
  }
  if (!gridId) {
    return c.json({ success: false, error: "gridId is required" }, 400);
  }
  const storedKind = layoutKindFor(kind, userId);
  if (!storedKind) {
    return c.json({ success: false, error: KIND_ERROR }, 400);
  }
  await ensureLayoutSchema(c.var.DB);
  try {
    await c.var.DB.prepare(
      `DELETE FROM datagrid_org_layouts
        WHERE org_id = ? AND grid_id = ? AND kind = ?`,
    )
      .bind(orgId, gridId, storedKind)
      .run();
    return c.json({ success: true });
  } catch (e) {
    console.error("[datagrid-layouts] DELETE failed:", e);
    return c.json({ success: false, error: "Could not clear layout" }, 500);
  }
});

export default app;
