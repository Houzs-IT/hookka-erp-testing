// ---------------------------------------------------------------------------
// Currency & FX (owner 2026-10-20; plan docs/superpowers/plans/
// 2026-10-20-currency-fx.md): the monthly rates Finance keys (1 unit of the
// currency = RM) and the accounts a realised FX difference posts to.
//
// A month's rate is only a DEFAULT (his ruling): a form fills it in for the
// document's month and it can be changed; each document keeps its own rate,
// so changing the table never changes a posted document (the 2026-06-12 rule
// "rate keyed per document" stands). FX gain and loss both post to 530-0000
// until he splits them on the page.
//
// Pure, no React — the API and the pages share it; tests import it directly.
// ---------------------------------------------------------------------------
import { normaliseCurrencyCode } from "./currency-code";

/** GAIN ON FOREIGN EXCHANGE — gain and loss both, until the page says otherwise. */
export const FX_DEFAULT_ACCOUNT = "530-0000";
/** How many months the rates table shows, ending with this one. */
export const FX_MONTHS_SHOWN = 6;
/** A rate is kept to at most this many decimals. */
export const FX_RATE_DECIMALS = 6;

export type FxCurrency = { code: string; name: string };
export type FxSettings = {
  currencies: FxCurrency[];
  /** code → "YYYY-MM" → RM per 1 unit. */
  rates: Record<string, Record<string, number>>;
  gainAccount: string;
  lossAccount: string;
};

export function emptyFxSettings(): FxSettings {
  return { currencies: [], rates: {}, gainAccount: FX_DEFAULT_ACCOUNT, lossAccount: FX_DEFAULT_ACCOUNT };
}

export const isFxYm = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** A typed rate → a number (above 0, at most six decimals); null when it is not one. */
export function parseFxRate(v: unknown): number | null {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const dec = s.split(".")[1] ?? "";
  if (dec.length > FX_RATE_DECIMALS) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
}

/** The stored JSON → settings. Anything unreadable falls back to the defaults;
 *  never throws (a bad row must not stop a payment from posting). */
export function parseFxSettings(raw: unknown): FxSettings {
  const out = emptyFxSettings();
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Partial<Record<keyof FxSettings, unknown>>;
  if (Array.isArray(o.currencies)) {
    for (const c of o.currencies) {
      const code = normaliseCurrencyCode((c as FxCurrency | null)?.code, "");
      if (!/^[A-Z]{3}$/.test(code) || code === "MYR" || out.currencies.some((x) => x.code === code)) continue;
      out.currencies.push({ code, name: String((c as FxCurrency).name ?? "").trim() });
    }
  }
  if (o.rates && typeof o.rates === "object") {
    for (const [k, months] of Object.entries(o.rates as Record<string, unknown>)) {
      const code = normaliseCurrencyCode(k, "");
      if (!code || !months || typeof months !== "object") continue;
      for (const [ym, rate] of Object.entries(months as Record<string, unknown>)) {
        const r = parseFxRate(rate);
        if (isFxYm(ym) && r !== null) (out.rates[code] ??= {})[ym] = r;
      }
    }
  }
  if (typeof o.gainAccount === "string" && o.gainAccount.trim()) out.gainAccount = o.gainAccount.trim();
  if (typeof o.lossAccount === "string" && o.lossAccount.trim()) out.lossAccount = o.lossAccount.trim();
  return out;
}

/** "YYYY-MM" of a date ("2026-10-20" or an ISO timestamp); "" when unreadable. */
export function fxMonthOf(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ""));
  const ym = m ? `${m[1]}-${m[2]}` : "";
  return isFxYm(ym) ? ym : "";
}

/** This month in Malaysia time (UTC+8). */
export function fxThisMonth(now: number = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** "Oct 2026" for "2026-10". */
export function fxMonthLabel(ym: string): string {
  return isFxYm(ym) ? new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" }) : ym;
}

/** The `n` months ending with `ym`, oldest first. */
export function fxMonthsTo(ym: string, n: number = FX_MONTHS_SHOWN): string[] {
  if (!isFxYm(ym)) return [];
  const [y, m] = ym.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The default rate for a document in `code` dated `date`: 1 for MYR, the
 *  month's keyed rate (RMB reads as CNY), or null when that month has none. */
export function fxRateFor(s: Pick<FxSettings, "rates">, code: string | null | undefined, date: string | null | undefined): number | null {
  const c = normaliseCurrencyCode(code);
  if (c === "MYR") return 1;
  const ym = fxMonthOf(date);
  const r = ym ? s.rates[c]?.[ym] : undefined;
  return typeof r === "number" && r > 0 ? r : null;
}

/** The currencies with no rate keyed for `ym` (the page warns about this month). */
export function fxMissingFor(s: Pick<FxSettings, "currencies" | "rates">, ym: string): string[] {
  return s.currencies.map((c) => c.code).filter((code) => !((s.rates[code]?.[ym] ?? 0) > 0));
}

/** Why `code` cannot be added to the list ("" when it can). */
export function fxNewCodeError(s: Pick<FxSettings, "currencies">, code: unknown): string {
  const c = normaliseCurrencyCode(code, "");
  if (!/^[A-Z]{3}$/.test(c)) return "A currency code is three letters, e.g. USD";
  if (c === "MYR") return "MYR is the home currency — its rate is always 1";
  if (s.currencies.some((x) => x.code === c)) return `${c} is already on the list`;
  return "";
}

/** The account a realised FX difference posts to: a gain (+, paid less RM than
 *  booked) credits the gain account; a loss (−) debits the loss account. */
export function fxLegAccount(fxSen: number, s: Pick<FxSettings, "gainAccount" | "lossAccount">): string {
  return fxSen > 0 ? s.gainAccount : s.lossAccount;
}

/** Every account an FX leg can sit on — the two set now and the original
 *  530-0000 (older legs stay where they posted) — so a lookup for "the other
 *  leg" never takes an FX leg for the bank. */
export function fxLegAccounts(s: Pick<FxSettings, "gainAccount" | "lossAccount">): string[] {
  return [...new Set([FX_DEFAULT_ACCOUNT, s.gainAccount, s.lossAccount])];
}

/** A rate as it reads: at least two decimals, at most six ("4.45", "0.6234"). */
export function fmtFxRate(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = n.toFixed(FX_RATE_DECIMALS).replace(/0+$/, "");
  const [i, d = ""] = s.split(".");
  return `${i}.${d.padEnd(2, "0")}`;
}
