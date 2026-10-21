// ---------------------------------------------------------------------------
// Balance Sheet parent accounts (owner 2026-10-21 「这个balance sheet 没有分父子
// account？」 → 「可以，做」). Within a section, the accounts that share a Chart
// of Accounts parent sit under it — the parent a row of its own carrying their
// subtotal — by the Cash Flow's rule (2026-09-04, src/lib/cashflow-engine.ts):
// one level, and a parent with a single account in the section adds no row
// (that account stays as it is). A parent that carries a balance of its own
// (an account used before it became a parent) is one of its own members, never
// also a member of its parent's group. The order is the entries' own (code
// order), a group where its first member stands. Display only: every account
// and every total is what it was.
// ---------------------------------------------------------------------------

export type BsGroupable = {
  accountCode: string;
  accountName: string;
  balance: number;
  parentCode?: string | null;
  parentName?: string | null;
};

export type BsItem<E extends BsGroupable> =
  | { kind: "line"; entry: E }
  | { kind: "group"; code: string; name: string; totalSen: number; members: E[] };

export function groupBsEntries<E extends BsGroupable>(entries: readonly E[]): BsItem<E>[] {
  const parentOf = (e: E): string => (e.parentCode && e.parentCode !== e.accountCode ? e.parentCode : "");
  // The parents with at least one account here; such a parent's own balance files under itself.
  const heads = new Set(entries.map(parentOf).filter(Boolean));
  const keyOf = (e: E): string => (heads.has(e.accountCode) ? e.accountCode : parentOf(e));
  const members = new Map<string, E[]>();
  for (const e of entries) {
    const k = keyOf(e);
    if (k) members.set(k, [...(members.get(k) ?? []), e]);
  }
  for (const [k, list] of [...members]) if (list.length < 2) members.delete(k);
  const out: BsItem<E>[] = [];
  const done = new Set<string>();
  for (const e of entries) {
    const k = keyOf(e);
    const list = k ? members.get(k) : undefined;
    if (!list) {
      out.push({ kind: "line", entry: e });
      continue;
    }
    if (done.has(k)) continue;
    done.add(k);
    const name = list.find((x) => x.accountCode === k)?.accountName ?? list.find((x) => x.parentName)?.parentName ?? k;
    out.push({ kind: "group", code: k, name, totalSen: list.reduce((s, x) => s + x.balance, 0), members: list });
  }
  return out;
}
