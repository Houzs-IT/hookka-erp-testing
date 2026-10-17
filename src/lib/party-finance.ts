// The finance fields every party master carries (owner 2026-10-17, Finance v2
// party form): TIN, SST Reg. No., Currency, Bank & account no. Shared by the
// form block (src/components/party/party-finance-fields.tsx), the three APIs'
// tests and the voucher print. Currency is recorded only — nothing converts
// with it. Pure.

export const PARTY_CURRENCIES = ["MYR", "RMB", "USD", "SGD", "EUR"] as const;

export type PartyFinanceValue = {
  tin: string;
  sstRegNo: string;
  currency: string;
  bankAccount: string;
};

/** The currency options, keeping a stored code that is not in the list. */
export function partyCurrencyOptions(current: string): string[] {
  const list: string[] = [...PARTY_CURRENCIES];
  const c = (current || "").trim().toUpperCase();
  if (c && !list.includes(c)) list.push(c);
  return list;
}

/** A currency off a request body: trimmed, upper-case, MYR when blank. */
export function normalisePartyCurrency(v: unknown): string {
  const c = typeof v === "string" ? v.trim().toUpperCase() : "";
  return c || "MYR";
}

/** A free-text party field off a request body: trimmed, "" when absent. */
export function partyText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
