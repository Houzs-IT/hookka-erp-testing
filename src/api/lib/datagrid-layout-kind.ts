// Which datagrid_org_layouts row a layout save lands in (finance v2, owner
// 2026-10-16: "Save Layout" keeps each person's columns on any PC). The two
// shared kinds keep their names; a user's own layout is "user:<userId>", so it
// rides the existing (org_id, grid_id, kind) unique key with no schema change.
// A caller can only ever name "user" — never another user's row.

export const ORG_LAYOUT_KINDS: ReadonlySet<string> = new Set(["org-default", "print"]);
export const USER_LAYOUT_KIND = "user";

export function layoutKindFor(kind: string, userId: string | undefined): string | null {
  if (ORG_LAYOUT_KINDS.has(kind)) return kind;
  if (kind === USER_LAYOUT_KIND && userId) return `user:${userId}`;
  return null;
}
