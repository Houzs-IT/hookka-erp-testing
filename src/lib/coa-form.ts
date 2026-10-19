// ---------------------------------------------------------------------------
// coa-form.ts — the Chart of Accounts sections and the New Account form's
// rules (finance backlog item 15, owner 2026-10-17 「可以，但前提不要碰现在的」:
// rework the form, existing accounts untouched).
//
// The nine sections are the owner's (Phase 2 follow-up): each maps onto a DB
// type plus a code band —
//   ASSET   <300 → Non-Current Assets; ≥300 → Current Assets
//   LIABILITY 480-489 (hire purchase) → Non-Current; else Current
//   REVENUE ≥530 (forex gain, discount received) → Other Income
//   COST → Cost of Goods Sold · EXPENSE → Expenses · EQUITY → Equity
// (Moved here from COATab so the tree and the form share one definition.)
//
// "Existing accounts untouched": a new account may only go under an account
// that is ALREADY a group. Creating under a posting (leaf) account would turn
// that account into a group (the server's promotion rule), which changes an
// existing account — so the form never offers one.
// ---------------------------------------------------------------------------

export type CoaType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "COST";
export type CoaLike = { code: string; name: string; type: CoaType; parentCode?: string; isPostable?: boolean; cashFlowCategory?: "O" | "I" | "F"; pnlCategory?: "FIXED" | "VARIABLE" | "OTHERS" };

export const COA_SECTIONS: { key: string; label: string; type: CoaType }[] = [
  { key: "NCA", label: "Non-Current Assets", type: "ASSET" },
  { key: "CA", label: "Current Assets", type: "ASSET" },
  { key: "CL", label: "Current Liabilities", type: "LIABILITY" },
  { key: "NCL", label: "Non-Current Liabilities", type: "LIABILITY" },
  { key: "EQ", label: "Equity", type: "EQUITY" },
  { key: "REV", label: "Revenue", type: "REVENUE" },
  { key: "COGS", label: "Cost of Goods Sold", type: "COST" },
  { key: "OI", label: "Other Income", type: "REVENUE" },
  { key: "EXP", label: "Expenses", type: "EXPENSE" },
];

// Code bands per section — the placeholder example and the rejection hint.
export const COA_SECTION_BAND: Record<string, { example: string; hint: string }> = {
  NCA: { example: "200-1000", hint: "below 300" },
  CA: { example: "330-5000", hint: "300 and above" },
  CL: { example: "440-0000", hint: "outside 480–489" },
  NCL: { example: "480-0050", hint: "480–489" },
  EQ: { example: "100-0005", hint: "any band" },
  REV: { example: "500-0040", hint: "below 530" },
  OI: { example: "530-0010", hint: "530 and above" },
  COGS: { example: "701-0040", hint: "any band" },
  EXP: { example: "900-A001", hint: "any band" },
};

export function coaSectionOf(code: string, type: CoaType): string {
  const p = parseInt(String(code).split("-")[0], 10) || 0;
  switch (type) {
    case "ASSET": return p < 300 ? "NCA" : "CA";
    case "LIABILITY": return p >= 480 && p < 490 ? "NCL" : "CL";
    case "EQUITY": return "EQ";
    case "REVENUE": return p >= 530 ? "OI" : "REV";
    case "COST": return "COGS";
    default: return "EXP";
  }
}

export const COA_CODE_FORMAT = /^\d{3}-[0-9A-Z]{4}$/;

// Debit-normal for what we own and spend, credit-normal for what we owe,
// own up and earn; where the account shows.
export function normalBalanceOf(type: CoaType): "Debit" | "Credit" {
  return type === "ASSET" || type === "EXPENSE" || type === "COST" ? "Debit" : "Credit";
}
export function isPnlType(type: CoaType): boolean {
  return type === "REVENUE" || type === "EXPENSE" || type === "COST";
}

// Cash-flow bucket a new account in this section usually takes.
export function defaultCashFlowFor(sectionKey: string): "" | "O" | "I" | "F" {
  if (sectionKey === "NCA") return "I";
  if (sectionKey === "EQ" || sectionKey === "NCL") return "F";
  return "O";
}

// The group accounts of a section a new account may go under (never a leaf).
export function groupParentsIn<T extends CoaLike>(accounts: T[], sectionKey: string): T[] {
  const hasKids = new Set(accounts.map((a) => a.parentCode).filter((x): x is string => !!x));
  return accounts
    .filter((a) => coaSectionOf(a.code, a.type) === sectionKey && (hasKids.has(a.code) || a.isPostable === false))
    .sort((a, b) => a.code.localeCompare(b.code));
}

const numSuffix = (code: string): number | null => (/^\d{3}-\d{4}$/.test(code) ? Number(code.slice(4)) : null);

// A suggested code that is free and lands in the section: under a parent,
// the parent's 3-digit prefix and the next step of 10 after its numbered
// children; at the top level, the next 3-digit prefix after the section's
// highest top-level account. "" when nothing fits (the user types one).
export function nextFreeCode(accounts: CoaLike[], sectionKey: string, parentCode: string): string {
  const sec = COA_SECTIONS.find((s) => s.key === sectionKey);
  if (!sec) return "";
  const taken = new Set(accounts.map((a) => a.code));
  const fits = (c: string) => !taken.has(c) && coaSectionOf(c, sec.type) === sectionKey;
  if (parentCode) {
    const prefix = parentCode.slice(0, 3);
    const nums = accounts
      .filter((a) => a.parentCode === parentCode && a.code.startsWith(`${prefix}-`))
      .map((a) => numSuffix(a.code))
      .filter((n): n is number => n !== null);
    let n = nums.length ? Math.max(...nums) + 10 : (numSuffix(parentCode) ?? 0) + 10;
    n = Math.ceil(n / 10) * 10;
    for (; n <= 9990; n += 10) {
      const c = `${prefix}-${String(n).padStart(4, "0")}`;
      if (fits(c)) return c;
    }
    return "";
  }
  const tops = accounts
    .filter((a) => !a.parentCode && coaSectionOf(a.code, a.type) === sectionKey)
    .map((a) => parseInt(a.code.slice(0, 3), 10))
    .filter((n) => !Number.isNaN(n));
  let p = tops.length ? Math.max(...tops) + 1 : parseInt(COA_SECTION_BAND[sectionKey].example.slice(0, 3), 10);
  for (; p <= 999; p++) {
    const c = `${String(p).padStart(3, "0")}-0000`;
    if (fits(c)) return c;
  }
  return "";
}

// The line under the Code box.
export function codeCheck(code: string, accounts: CoaLike[], sectionKey: string, auto: boolean): { tone: "muted" | "ok" | "err"; text: string } {
  const c = code.trim();
  if (!COA_CODE_FORMAT.test(c)) return { tone: "err", text: "format 901-0010" };
  if (accounts.some((a) => a.code === c)) return { tone: "err", text: `${c} already exists` };
  const sec = COA_SECTIONS.find((s) => s.key === sectionKey);
  if (!sec) return { tone: "err", text: "pick a section" };
  const landing = coaSectionOf(c, sec.type);
  if (landing !== sectionKey) {
    const other = COA_SECTIONS.find((s) => s.key === landing);
    return { tone: "err", text: `${c} lands in ${other?.label ?? landing} — ${sec.label} uses codes ${COA_SECTION_BAND[sectionKey].hint}` };
  }
  return auto ? { tone: "muted", text: "next free code — change it if you like" } : { tone: "ok", text: "✓ available" };
}
