// ---------------------------------------------------------------------------
// What each supplier sold us lately, by material type: how a Forecast P&L
// month keyed by supplier spreads over the material rows (owner 2026-11-10
// 「supplier 那边还是你可以 set 根据 ratio 也可以，一个个也可以」; spec
// docs/superpowers/specs/2026-11-10-forecast-suppliers-design.md 4).
//
// The window: purchase invoices dated from the 1st of the month three months
// before the current one. The weights: their ledger legs on the material
// purchase accounts, debit minus credit — what the P&L reads — so a
// supplier's spread matches where its purchases land on the P&L. Read only.
// The pure part is supplierMixFromLegs (src/lib/forecast-pnl.ts).
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { addMonthsYm } from "../../lib/cashflow-forecast";
import { forecastMaterialAccountTypes, supplierMixFromLegs, type FcAccount, type FcMonth, type FcSupplierMix } from "../../lib/forecast-pnl";

/** The first day of the window, for a day (YYYY-MM-DD, Malaysia time). */
export const supplierMixFrom = (today: string): string => `${addMonthsYm(today.slice(0, 7), -3)}-01`;

/** Any month keyed by supplier: only then do the readers need the weights. */
export const anySupplierMonth = (months: Record<string, FcMonth>): boolean =>
  Object.values(months).some((m) => Object.values(m?.purchasesBySupplier ?? {}).some((v) => Math.round(Number(v) || 0) > 0));

export async function loadForecastSupplierMix(
  db: Env["Variables"]["DB"],
  o: { today: string; accounts: readonly FcAccount[]; override: Record<string, string>; resolveAcct: (code: string) => string },
): Promise<FcSupplierMix> {
  const types = forecastMaterialAccountTypes(o.accounts, o.override);
  const piRes = await db
    .prepare(`SELECT id, supplierId FROM purchase_invoices WHERE status IN ('CONFIRMED','APPROVED','PARTIAL_PAID','PAID') AND invoiceDate >= ?`)
    .bind(supplierMixFrom(o.today))
    .all<Record<string, unknown>>();
  const supplierOf = new Map<string, string>();
  for (const r of piRes.results ?? []) {
    const sup = String(r.supplierId ?? r.supplier_id ?? "");
    if (sup) supplierOf.set(String(r.id), sup);
  }
  const ids = [...supplierOf.keys()];
  const legs: { supplierId: string; accountCode: string; debitSen: number; creditSen: number }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const res = await db
      .prepare(
        `SELECT accountCode, sourceId, debitSen, creditSen FROM ledger_journal_entries
          WHERE (hidden IS NULL OR hidden = 0) AND sourceType LIKE 'purchase_invoice%' AND sourceId IN (${part.map(() => "?").join(",")})`,
      )
      .bind(...part)
      .all<Record<string, unknown>>();
    for (const l of res.results ?? []) {
      const sup = supplierOf.get(String(l.sourceId ?? l.source_id ?? ""));
      if (!sup) continue;
      legs.push({
        supplierId: sup,
        accountCode: o.resolveAcct(String(l.accountCode ?? l.account_code ?? "")),
        debitSen: Number(l.debitSen ?? l.debit_sen) || 0,
        creditSen: Number(l.creditSen ?? l.credit_sen) || 0,
      });
    }
  }
  return supplierMixFromLegs(legs, (code) => types.get(code));
}
