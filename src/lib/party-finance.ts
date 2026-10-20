// The finance fields every party master carries (owner 2026-10-17, Finance v2
// party form): TIN, SST Reg. No., Currency, Bank & account no. Shared by the
// form block (src/components/party/party-finance-fields.tsx), the three APIs'
// tests and the voucher print. Currency is recorded only — nothing converts
// with it. Pure. The yuan is CNY (owner 2026-10-20, Currency & FX); a stored
// or typed RMB reads as CNY (src/lib/currency-code.ts).

import { normaliseCurrencyCode } from "./currency-code";

export const PARTY_CURRENCIES = ["MYR", "CNY", "USD", "SGD", "EUR"] as const;

export type PartyFinanceValue = {
  tin: string;
  sstRegNo: string;
  currency: string;
  bankAccount: string;
};

/** The currency options, keeping a stored code that is not in the list. */
export function partyCurrencyOptions(current: string): string[] {
  const list: string[] = [...PARTY_CURRENCIES];
  const c = normaliseCurrencyCode(current, "");
  if (c && !list.includes(c)) list.push(c);
  return list;
}

/** A currency off a request body: trimmed, upper-case, MYR when blank, RMB as CNY. */
export function normalisePartyCurrency(v: unknown): string {
  return normaliseCurrencyCode(v);
}

/** A free-text party field off a request body: trimmed, "" when absent. */
export function partyText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
