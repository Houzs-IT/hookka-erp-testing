// ---------------------------------------------------------------------------
// grid-shared-layouts.ts — named column layouts shared with the whole team
// (cross-system review G6; Houzs#5221). Pure rules, imported by BOTH the
// server route (src/api/routes/datagrid-layouts.ts) and the grid's panel
// (src/components/ui/grid-shared-layouts.tsx), so the two cannot disagree.
//
// A shared layout is one more row in `datagrid_org_layouts`, kind
// `shared:<id>`, riding the existing (org_id, grid_id, kind) unique key. It
// carries a name and its author. Everyone signed in sees the grid's shared
// layouts in the Columns panel with a "Shared" tag and can switch to one (that
// copies it into their own layout; nothing about the shared row changes).
// Only the author or an admin may overwrite or delete it. It holds column
// keys, order and widths only — never a record — so it shows nobody data.
// ---------------------------------------------------------------------------

export const SHARED_LAYOUT_KIND_PREFIX = "shared:";
export const SHARED_LAYOUT_NAME_MAX = 60;
/** Per grid, so the list stays a list and not a dumping ground. */
export const SHARED_LAYOUTS_PER_GRID_MAX = 30;

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

export function sharedLayoutKind(id: string): string {
  return `${SHARED_LAYOUT_KIND_PREFIX}${id}`;
}

/** The shared-layout id inside a stored kind, or null for any other kind. */
export function sharedLayoutIdFromKind(kind: string | null | undefined): string | null {
  const k = String(kind ?? "");
  if (!k.startsWith(SHARED_LAYOUT_KIND_PREFIX)) return null;
  const id = k.slice(SHARED_LAYOUT_KIND_PREFIX.length);
  return id ? id : null;
}

/** A trimmed, single-spaced name, or an error sentence for the operator. */
export function cleanSharedLayoutName(raw: unknown): { name: string } | { error: string } {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the layout a name" };
  if (name.length > SHARED_LAYOUT_NAME_MAX) {
    return { error: `Keep the name to ${SHARED_LAYOUT_NAME_MAX} characters` };
  }
  return { name };
}

/** Same name ignoring case and spacing — one name per grid. */
export function sameLayoutName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

/** Only the author or an admin may change or delete a shared layout. */
export function canEditSharedLayout(
  createdBy: string | null | undefined,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (ADMIN_ROLES.has(String(role ?? "").toUpperCase())) return true;
  return !!userId && !!createdBy && createdBy === userId;
}

export type SharedLayout = {
  id: string;
  name: string;
  createdByName: string;
  updatedAt: string | null;
  visibleCols: string[];
  colOrder: string[];
  colWidths: Record<string, string> | null;
  /** The caller may overwrite / delete it (author or admin). */
  canEdit: boolean;
};

/** Shared layouts sorted by name for the panel list. */
export function sortSharedLayouts(list: SharedLayout[]): SharedLayout[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
