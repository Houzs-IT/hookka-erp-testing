// ---------------------------------------------------------------------------
// The yuan is CNY (owner 2026-10-20, Currency & FX), but 0001_init gave three
// tables a currency CHECK of ('MYR','RMB'): the supplier price list, its price
// history and goods in transit. Before the first CNY write into one of them,
// ask the catalogue which currency CHECK the table carries (the e-invoices /
// grns lesson: a guessed constraint name is not a migration), drop it unless
// it already admits CNY, and add <table>_currency_chk_v2. NOT VALID: old rows
// are not re-checked. Once per isolate per table; a failed round is retried
// by the next request (memoizeSelfApply). Only a CNY write calls it — a MYR
// write never touches the schema.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { memoizeSelfApply, runSelfApply } from "./self-apply";

type Db = Env["Variables"]["DB"];

export const CURRENCY_CHECK_TABLES = ["supplier_material_bindings", "price_histories", "goods_in_transit"] as const;
export type CurrencyCheckTable = (typeof CURRENCY_CHECK_TABLES)[number];

/** What a table's currency CHECK admits once widened (RMB stays for any old row). */
export const CURRENCY_CHECK_V2 = "CHECK (currency IN ('MYR','RMB','CNY'))";

/** The DDL that lets `table` hold CNY, given the currency CHECKs it has now —
 *  nothing when one already admits CNY. */
export function currencyCheckStatements(table: CurrencyCheckTable, checks: { conname: string; def: string }[]): string[] {
  if (checks.some((r) => String(r.def ?? "").includes("'CNY'"))) return [];
  return [
    ...checks.filter((r) => r.conname).map((r) => `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "${r.conname}"`),
    `ALTER TABLE ${table} ADD CONSTRAINT ${table}_currency_chk_v2 ${CURRENCY_CHECK_V2} NOT VALID`,
  ];
}

const memo = new Map<CurrencyCheckTable, Promise<void> | null>();

/** Make `table` accept CNY (see the header). Await it before a CNY write. */
export function ensureCnyCurrency(db: Db, table: CurrencyCheckTable): Promise<void> {
  return memoizeSelfApply(
    () => memo.get(table) ?? null,
    (p) => {
      memo.set(table, p);
    },
    async () => {
      let checks: { conname: string; def: string }[];
      try {
        const found = await db
          .prepare(
            `SELECT conname AS "conname", pg_get_constraintdef(oid) AS "def"
               FROM pg_constraint
              WHERE conrelid = '${table}'::regclass
                AND contype = 'c'
                AND pg_get_constraintdef(oid) ILIKE '%currency%'`,
          )
          .all<{ conname: string; def: string }>();
        checks = found.results ?? [];
      } catch (err) {
        console.warn(`[currency-checks] could not read pg_constraint for ${table}, using the default name:`, err);
        checks = [{ conname: `${table}_currency_check`, def: "" }];
      }
      const stmts = currencyCheckStatements(table, checks);
      if (stmts.length) await runSelfApply(db as unknown as Parameters<typeof runSelfApply>[0], `currency-${table}`, stmts);
    },
  );
}
