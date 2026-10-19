// ---------------------------------------------------------------------------
// fixed-asset-prompt.ts — "Add New Asset" when a payment voucher or an other
// creditor (AP) bill puts money on a fixed-asset account (finance backlog
// item 11, owner 2026-10-17 「这个要」; the design's Fixed Assets note:
// "Picking a fixed-asset account on a PV or AP Invoice opens 'Add New Asset'
// on save").
//
// The saved document posts as before; afterwards the Fixed Assets page opens
// its Add Asset form filled in from each such line — name, purchase date,
// cost, the cost account, its accumulated-depreciation account and a
// depreciation expense account — to check and save, or skip. Registering
// posts nothing (depreciation is the month-end run). Pure, so the account
// rules are tested apart from the screens.
// ---------------------------------------------------------------------------

export type FaAccount = { code: string; name: string; type: string; isPostable?: boolean };
export type FaPrefill = {
  name: string;
  purchaseDate: string;
  costSen: number;
  assetAccount: string;
  accumAccount: string;
  expenseAccount: string;
  sourceRef: string;
};

// Where the prefills wait between the saving page and the Fixed Assets page.
export const FA_QUEUE_KEY = "hookka:fa-add-queue";

const STOP = new Set(["", "&", "AND", "OF", "THE", "FOR"]);
const words = (s: string) => new Set(String(s).toUpperCase().split(/[^A-Z0-9]+/).filter((w) => !STOP.has(w)));
const ncaPrefix = (code: string) => parseInt(String(code).slice(0, 3), 10);

// A fixed-asset COST account: a postable non-current asset (code below 300)
// that is not an accumulated-depreciation contra, nor goodwill / an
// investment / a deposit (nothing to depreciate).
export function isFixedAssetCostAccount(a: FaAccount | undefined): boolean {
  if (!a || a.type !== "ASSET" || a.isPostable === false) return false;
  const p = ncaPrefix(a.code);
  if (!(p < 300)) return false;
  return !/ACCUM|DEPR|AMORT|GOODWILL|INVEST|DEPOSIT/i.test(a.name);
}

// Its accumulated-depreciation account: the non-current "ACCUM…" account
// whose name carries every word of the cost account's name
// ("200-0015 ACCUM. DEPRN. - FURNITURES & FITTINGS" for "FURNITURES &
// FITTINGS"). "" when none does — the user picks.
export function pairedAccumAccount(costCode: string, accounts: FaAccount[]): string {
  const cost = accounts.find((a) => a.code === costCode);
  if (!cost) return "";
  const need = words(cost.name);
  const hit = accounts.find((a) =>
    a.code !== costCode && a.type === "ASSET" && a.isPostable !== false && ncaPrefix(a.code) < 300 &&
    /ACCUM/i.test(a.name) && need.size > 0 && [...need].every((w) => words(a.name).has(w)));
  return hit?.code ?? "";
}

// A depreciation expense account: one whose name carries every word of the
// cost account's name ("DEPRECIATION OF PLANT & MACHINERY"); otherwise the
// general one ("… FIXED ASSETS"), else the first postable depreciation
// expense. "" when the chart has none.
export function suggestedDepreciationAccount(costCode: string, accounts: FaAccount[]): string {
  const cost = accounts.find((a) => a.code === costCode);
  const deps = accounts.filter((a) => (a.type === "EXPENSE" || a.type === "COST") && a.isPostable !== false && /DEPRECIATION/i.test(a.name));
  if (deps.length === 0) return "";
  const need = cost ? words(cost.name) : new Set<string>();
  const exact = need.size > 0 ? deps.find((a) => [...need].every((w) => words(a.name).has(w))) : undefined;
  if (exact) return exact.code;
  const general = deps.find((a) => /FIXED ASSET/i.test(a.name));
  return (general ?? deps[0]).code;
}

// One prefill per line of the document that sits on a fixed-asset cost account.
export function fixedAssetPrefills(
  doc: { ref: string; date: string; description: string; lines: { accountCode: string; description: string; amountSen: number }[] },
  accounts: FaAccount[],
): FaPrefill[] {
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  return doc.lines
    .filter((l) => l.amountSen > 0 && isFixedAssetCostAccount(byCode.get(l.accountCode)))
    .map((l) => ({
      name: (l.description || doc.description || "").trim(),
      purchaseDate: doc.date,
      costSen: Math.round(l.amountSen),
      assetAccount: l.accountCode,
      accumAccount: pairedAccumAccount(l.accountCode, accounts),
      expenseAccount: suggestedDepreciationAccount(l.accountCode, accounts),
      sourceRef: doc.ref,
    }));
}

// The register's remark for an asset added from a document.
export const faRemarkFor = (ref: string) => `From ${ref}`;

// Drop what is already in the register — same document, account and cost —
// counting, so a voucher with two identical machine lines still asks for the
// second while an edited voucher does not ask again for either.
export function withoutRegistered(prefills: FaPrefill[], rows: { remarks?: string | null; assetAccount: string; costSen: number }[]): FaPrefill[] {
  const key = (remark: string, account: string, cost: number) => `${remark}|${account}|${cost}`;
  const have = new Map<string, number>();
  for (const r of rows) {
    const k = key(r.remarks ?? "", r.assetAccount, r.costSen);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  return prefills.filter((p) => {
    const k = key(faRemarkFor(p.sourceRef), p.assetAccount, p.costSen);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      return false;
    }
    return true;
  });
}

// Leave the prefills for the Fixed Assets page (storage may be blocked —
// then the prompt simply does not appear; the document is saved either way).
export function putFaQueue(store: Pick<Storage, "setItem"> | null | undefined, prefills: FaPrefill[]): boolean {
  if (!store || prefills.length === 0) return false;
  try {
    store.setItem(FA_QUEUE_KEY, JSON.stringify(prefills));
    return true;
  } catch {
    return false;
  }
}

// The Fixed Assets page reads the waiting prefills once (a pure read, safe in
// a state initialiser) and clears them after mounting, so a reload never asks
// twice.
export function readFaQueue(store: Pick<Storage, "getItem"> | null | undefined): FaPrefill[] {
  if (!store) return [];
  try {
    const raw = store.getItem(FA_QUEUE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as FaPrefill[]).filter((p) => p && typeof p.assetAccount === "string" && Number(p.costSen) > 0) : [];
  } catch {
    return [];
  }
}
export function clearFaQueue(store: Pick<Storage, "removeItem"> | null | undefined): void {
  try {
    store?.removeItem(FA_QUEUE_KEY);
  } catch {
    /* storage refused — nothing to clear */
  }
}
