// Which part of Hookka an IT request is about, so the IT Hub's Reports can say
// which module has the most problems. The modules are the sidebar's groups
// ("Sales & Customers", "Production", "Finance", ...), read from the sidebar
// itself so a new page is covered without a list to keep up to date.

type Item = { href: string; children?: Item[] };
type Group = { label: string; items: Item[] };

// "SALES & CUSTOMERS" -> "Sales & Customers"; acronyms stay as they are.
const KEEP = new Set(["&", "R&D", "BOM", "HR", "QC", "MRP"]);
export const moduleName = (label: string) =>
  label
    .split(" ")
    .map((w) => (KEEP.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");

const pathOf = (href: string) => {
  try {
    return new URL(href, "http://x").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
};

export function itModuleIndex(groups: Group[]) {
  const entries: { path: string; module: string }[] = [];
  const walk = (items: Item[], module: string) => {
    for (const i of items) {
      entries.push({ path: pathOf(i.href), module });
      if (i.children) walk(i.children, module);
    }
  };
  for (const g of groups) walk(g.items, moduleName(g.label));

  /** The module of a page (path or full address); "" when no sidebar entry covers it. */
  const moduleFor = (page: string) => {
    const path = pathOf(page);
    if (!path) return "";
    let best: { path: string; module: string } | null = null;
    for (const e of entries) {
      const covers = e.path === path || (e.path !== "/" && path.startsWith(`${e.path}/`));
      // The longest path wins; on a tie the first group, as the sidebar lists it.
      if (covers && (!best || e.path.length > best.path.length)) best = e;
    }
    return best?.module ?? "";
  };

  return { moduleFor, options: groups.map((g) => moduleName(g.label)) };
}
