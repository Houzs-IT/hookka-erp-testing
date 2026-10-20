// ---------------------------------------------------------------------------
// coa-list.ts — the Chart of Accounts as the design's list (owner 2026-10-20
// 「运用设计稿那样，单拖动的树状图也需要」: the list, and the drag tree kept as
// a second view). Accounts by section in the chart's order; inside a section
// in tree order — each group, then its accounts, by code — with the depth for
// the indent and a group's balance as the sum of what sits under it. Pure.
// ---------------------------------------------------------------------------
import { COA_SECTIONS, coaSectionOf, type CoaType } from "./coa-form";

export type CoaListAccount = {
  code: string;
  name: string;
  type: CoaType;
  parentCode?: string;
  balance: number;
  isActive: boolean;
  isPostable?: boolean;
  cashFlowCategory?: "O" | "I" | "F";
  specialAccountType?: string;
  pnlCategory?: "FIXED" | "VARIABLE" | "OTHERS";
};

export type CoaListRow<A extends CoaListAccount = CoaListAccount> = {
  account: A;
  section: string;
  sectionLabel: string;
  depth: number;
  /** The account's own balance, or for a group the sum of everything under it. */
  balanceSen: number;
  isGroup: boolean;
};

export function coaListRows<A extends CoaListAccount>(accounts: readonly A[]): CoaListRow<A>[] {
  const out: CoaListRow<A>[] = [];
  for (const sec of COA_SECTIONS) {
    const inSec = accounts.filter((a) => coaSectionOf(a.code, a.type) === sec.key);
    const codes = new Set(inSec.map((a) => a.code));
    const kids = new Map<string, A[]>();
    for (const a of inSec) {
      const p = a.parentCode && codes.has(a.parentCode) && a.parentCode !== a.code ? a.parentCode : "";
      const arr = kids.get(p) ?? [];
      arr.push(a);
      kids.set(p, arr);
    }
    for (const arr of kids.values()) arr.sort((x, y) => x.code.localeCompare(y.code));
    // A group carries no balance of its own (a parent is never postable) —
    // it shows the sum of what sits under it.
    const sumMemo = new Map<string, number>();
    const subtree = (a: A, stack: Set<string>): number => {
      const cached = sumMemo.get(a.code);
      if (cached !== undefined) return cached;
      const ch = (kids.get(a.code) ?? []).filter((k) => !stack.has(k.code));
      const v = ch.length
        ? ch.reduce((s, k) => s + subtree(k, new Set([...stack, k.code])), 0)
        : Number(a.balance) || 0;
      sumMemo.set(a.code, v);
      return v;
    };
    const visited = new Set<string>();
    const walk = (a: A, depth: number) => {
      if (visited.has(a.code)) return; // a cycle in the data never loops
      visited.add(a.code);
      const ch = kids.get(a.code) ?? [];
      out.push({ account: a, section: sec.key, sectionLabel: sec.label, depth, balanceSen: subtree(a, new Set([a.code])), isGroup: ch.length > 0 });
      for (const k of ch) walk(k, depth + 1);
    };
    for (const top of kids.get("") ?? []) walk(top, 0);
    // Anything left (only reachable through a cycle) still shows, at the top.
    for (const a of inSec) if (!visited.has(a.code)) walk(a, 0);
  }
  return out;
}

/** "1,234.50 Dr" / "Cr" / "-" — a balance the way the chart reads it. */
export function coaBalanceLabel(sen: number, fmt: (sen: number) => string): string {
  if (!sen) return "-";
  return `${fmt(Math.abs(sen))} ${sen < 0 ? "Cr" : "Dr"}`;
}

/** Why an account cannot be set inactive — null when it can: its balance (or
 *  its group's) must be clear first (the design's rule). */
export function coaInactiveBlock(row: Pick<CoaListRow, "balanceSen" | "account">): string | null {
  return row.balanceSen !== 0 ? `${row.account.code} still has a balance — clear it first` : null;
}

export const COA_SPECIAL_LABEL: Record<string, string> = {
  SDC: "Debtor Control",
  SCC: "Creditor Control",
  SBK: "Bank",
  SCH: "Cash",
  SOS: "Opening Stock",
  SCS: "Closing Stock",
};

export const COA_CASH_FLOW_LABEL: Record<string, string> = { O: "Operating", I: "Investing", F: "Financing" };
