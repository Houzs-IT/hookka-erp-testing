// ---------------------------------------------------------------------------
// Cost Structure line split for the phone P&L (Batch 3): the desktop
// CostStructureTab's own rule, copied as it is. Plain module (react-refresh).
// ---------------------------------------------------------------------------
export type CsGroup = { group: string; description: string; months: { opening: number; purchase: number; closing: number; spend: number }[] };
export type CsData = { fyLabel: string; cols: string[]; groups: CsGroup[]; salesSofa: number[]; salesBed: number[]; salesAll: number[] };

/** Which line a material group belongs to — read off the purchase account's
 *  name, exactly as the desktop table splits it. */
export function csSection(g: CsGroup): "bedframe" | "sofa" | "shared" {
  const t = `${g.group} ${g.description}`.toUpperCase();
  if (/(^|[^A-Z])B\./.test(t)) return "bedframe";
  if (/(^|[^A-Z])S[.\s-]/.test(t)) return "sofa";
  return "shared";
}

/** The groups a line shows: Overall = every group; a single line = its own
 *  groups plus the shared ones apportioned by that line's share of each
 *  month's sales (the desktop table's rule, owner 2026-07-29). */
export function csGroupsFor(d: CsData, line: "all" | "sofa" | "bedframe"): CsGroup[] {
  if (line === "all") return d.groups;
  const share = (i: number) => {
    const bed = d.salesBed[i] ?? 0;
    const sofa = d.salesSofa[i] ?? 0;
    const tot = bed + sofa;
    if (tot <= 0) return 0;
    return line === "bedframe" ? bed / tot : sofa / tot;
  };
  const own = d.groups.filter((g) => csSection(g) === line);
  const shared = d.groups.filter((g) => csSection(g) === "shared").map((g) => ({
    ...g,
    description: `${g.description} (shared)`,
    months: g.months.map((m, i) => {
      const s = share(i);
      return { opening: Math.round(m.opening * s), purchase: Math.round(m.purchase * s), closing: Math.round(m.closing * s), spend: Math.round(m.spend * s) };
    }),
  }));
  return [...own, ...shared];
}
