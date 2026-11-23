// ---------------------------------------------------------------------------
// MRP material groups (owner 2026-11-23).
//
// The MRP page tabs are NOT the 20 raw RM categories (raw_materials.itemGroup
// = the AutoCount stock group). Sofa and bedframe are not split — one tab per
// kind of material: 「filler / fabric / plywood+wood strip=wood / others /
// merc+merchan 这些merge成一个在MRP」「不需要分sofa bedframe」. The same rule
// was applied to webbing and accessories and confirmed by the owner ("ok").
//
// Display-only: the item group itself (and its GL mapping) is untouched. Any
// category NOT listed here — e.g. one the owner adds later — becomes its own
// tab automatically, labelled with its code.
// ---------------------------------------------------------------------------
export const MRP_GROUP_OF_ITEM_GROUP: Readonly<Record<string, string>> = {
  "B.M-FABR": "Fabric",
  "S.M-FABR": "Fabric",
  "S-FABRIC": "Fabric",
  "B.FILLER": "Filler",
  "S.FILLER": "Filler",
  PLYWOOD: "Wood",
  "WD STRIP": "Wood",
  "B.MECHAN": "Mechanism",
  "S.MECH": "Mechanism",
  "B.OTHERS": "Others",
  "S.OTHERS": "Others",
  OTHERS: "Others",
  "B.WEBB": "Webbing",
  "S.WEBB": "Webbing",
  "B.ACCE": "Accessories",
  "S.ACC": "Accessories",
  PACKING: "Packing",
  MAINTENA: "Maintenance",
  EQUIPMEN: "Equipment",
  "R&D": "R&D",
};

// Tab order for the known groups; unknown (new) groups follow alphabetically.
export const MRP_GROUP_ORDER: readonly string[] = [
  "Fabric",
  "Filler",
  "Wood",
  "Mechanism",
  "Others",
  "Webbing",
  "Accessories",
  "Packing",
  "Maintenance",
  "Equipment",
  "R&D",
];

export function mrpGroupOf(itemGroup: string | null | undefined): string {
  const g = String(itemGroup ?? "").trim().toUpperCase();
  if (!g) return "Uncategorised";
  return MRP_GROUP_OF_ITEM_GROUP[g] ?? g;
}

// Every tab for a set of live item groups: known groups in MRP_GROUP_ORDER,
// then any new ones alphabetically. Driven by the item groups that exist in
// raw_materials right now, so a new category appears without a code change.
export function mrpGroupTabs(itemGroups: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const g of itemGroups) set.add(mrpGroupOf(g));
  const known = MRP_GROUP_ORDER.filter((g) => set.has(g));
  const extra = [...set].filter((g) => !MRP_GROUP_ORDER.includes(g)).sort();
  return [...known, ...extra];
}
