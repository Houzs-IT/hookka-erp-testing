// ---------------------------------------------------------------------------
// pnl-forecast.ts — pure. A Forecast P&L month (kv `forecast_pnl`) as a P&L
// window the Monthly P&L matrix (src/lib/pnl-matrix.ts) can lay beside the
// actual one (owner 2026-11-09 「我的 PNL 我也是想要把 forecast 和 live 的对
// 比」; spec docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md
// section 6). Each forecast line sits on the P&L line its money is booked
// to: a department's salary on the account its wages post to (the labour
// map), an account on its own line, a material type in a type group. Net
// profit therefore equals the Forecast P&L page's; gross profit differs only
// by what posts outside COGS. Tests: tests/pnl-forecast.test.mjs.
// ---------------------------------------------------------------------------
import { FC_CARRIAGE, FC_SST, forecastMaterialType, forecastMonthFigures, materialRowType, type FcLineGroups, type FcMonth } from "./forecast-pnl";
import { pnlBucketFor } from "./pnl-bucket";
import { FORECAST_TYPE_GROUP_PREFIX, type PnlExpenseLine, type PnlLine, type PnlRmGroup, type PnlWindowLike } from "./pnl-matrix";

export type ForecastPnlOpts = {
  override: Record<string, string>;
  mappedAccounts: ReadonlySet<string>;
  /** A department's labour-map account (where its wages post), or null. */
  deptAccount: (dept: string) => string | null;
  /** The chart's name and type of an account. */
  accountOf: (code: string) => { name: string; type: string } | undefined;
};

/** A purchase group's material type: a forecast type group says it; an actual
 *  stock group by its description ("PURCHASE - B.M FABRIC" → FABRIC). */
export function rmTypeOf(rg: PnlRmGroup): string {
  return rg.group.startsWith(FORECAST_TYPE_GROUP_PREFIX) ? rg.group.slice(FORECAST_TYPE_GROUP_PREFIX.length) : forecastMaterialType(rg.description);
}

/** One Forecast P&L month as a P&L window. The amounts are the page's own
 *  (forecastMonthFigures, supersede rule and supplier-keyed materials
 *  included); nothing for stock movements, which the plan does not forecast. */
export function forecastPnlWindow(m: FcMonth | undefined, g: FcLineGroups, o: ForecastPnlOpts): PnlWindowLike {
  const f = forecastMonthFigures(m, g, o.mappedAccounts);
  const labour = new Map<string, PnlLine>();
  const overhead = new Map<string, PnlLine>();
  const other = new Map<string, PnlLine>();
  const expense = new Map<string, PnlExpenseLine>();
  const into = <L extends PnlLine>(bucket: Map<string, L>, line: L) => {
    const had = bucket.get(line.code);
    if (had) had.amountSen += line.amountSen;
    else bucket.set(line.code, line);
  };
  // `fallback`: the section a department row files under when its posting
  // account is not known.
  const place = (code: string, amountSen: number, fallback: "DIRECT_LABOUR" | "FACTORY_OVERHEAD" | "OPEX_SALARIES" | null, name?: string) => {
    if (!amountSen) return;
    const a = o.accountOf(code);
    const bucket = a ? pnlBucketFor(code, a.type, o.override) : null;
    const lineName = a?.name ?? name ?? code;
    switch (bucket ?? fallback) {
      case "DIRECT_LABOUR": into(labour, { code, name: lineName, amountSen }); break;
      case "FACTORY_OVERHEAD": into(overhead, { code, name: lineName, amountSen }); break;
      case "OPEX_SALARIES": into(expense, { code, name: lineName, amountSen, salary: true }); break;
      case "OPERATING_EXPENSE": into(expense, { code, name: lineName, amountSen, salary: false }); break;
      case "OTHER_INCOME": into(other, { code, name: lineName, amountSen }); break;
      default: break;
    }
  };

  const rmGroups: PnlRmGroup[] = [];
  for (const a of g.materials) {
    const amt = f.amt(a.code);
    if (!amt) continue;
    const type = materialRowType(a);
    rmGroups.push({ group: `${FORECAST_TYPE_GROUP_PREFIX}${type}`, description: type, openingSen: 0, purchasesSen: amt, closingSen: 0 });
  }
  const has = (code: string) => g.direct.some((a) => a.code === code);
  const carriageSen = has(FC_CARRIAGE) ? f.amt(FC_CARRIAGE) : 0;
  const sstSen = has(FC_SST) ? f.amt(FC_SST) : 0;

  const deptRows: [typeof g.labour, "DIRECT_LABOUR" | "FACTORY_OVERHEAD" | "OPEX_SALARIES"][] = [
    [g.labour, "DIRECT_LABOUR"], [g.labourOvhDepts, "FACTORY_OVERHEAD"], [g.labourExpDepts, "OPEX_SALARIES"],
  ];
  for (const [rows, fallback] of deptRows)
    for (const a of rows) {
      const amt = f.amt(a.code);
      if (!amt) continue;
      const acct = o.deptAccount(a.name);
      if (acct) place(acct, amt, fallback);
      else place(a.code, amt, fallback, a.name);
    }
  for (const a of [...g.labourAccounts, ...g.overhead, ...g.expenses, ...g.otherIncome])
    if (!f.superseded(a.code)) place(a.code, f.amt(a.code), null);

  const sum = (ls: Iterable<{ amountSen: number }>) => [...ls].reduce((s, l) => s + l.amountSen, 0);
  const rmConsumedSen = rmGroups.reduce((s, r) => s + r.purchasesSen, 0);
  const labourSen = sum(labour.values());
  const overheadSen = sum(overhead.values());
  const manufacturingSen = rmConsumedSen + carriageSen + sstSen + labourSen + overheadSen;
  const otherIncomeSen = sum(other.values());
  const expenseSen = sum(expense.values());
  const grossProfitSen = f.salesSen - manufacturingSen;
  return {
    netSalesSen: f.salesSen, revLines: [],
    rmGroups, rmConsumedSen, carriageSen, sstSen,
    labourLines: [...labour.values()], labourSen,
    overheadLines: [...overhead.values()], overheadSen,
    wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0,
    manufacturingSen, cogsSen: manufacturingSen, grossProfitSen,
    otherIncomeSen, otherIncomeLines: [...other.values()],
    expenseLines: [...expense.values()], expenseSen,
    netProfitSen: grossProfitSen + otherIncomeSen - expenseSen,
  };
}

/** Windows added up: figures summed, lines merged by code and name (the
 *  matrix's own line identity), raw-material groups by group, each in the
 *  order first seen — so it also serves as the matrix's spine. */
export function sumPnlWindowLikes(ws: readonly PnlWindowLike[]): PnlWindowLike {
  const lineKey = (l: { code: string; name?: string }) => `${l.code ?? ""} ${l.name ?? ""}`;
  const merge = <L extends { code: string; name?: string; amountSen: number }>(lists: L[][]): L[] => {
    const out = new Map<string, L>();
    for (const list of lists) for (const l of list) {
      const k = lineKey(l);
      const had = out.get(k);
      if (had) had.amountSen += l.amountSen;
      else out.set(k, { ...l });
    }
    return [...out.values()];
  };
  const groups = new Map<string, PnlRmGroup>();
  for (const w of ws) for (const r of w.rmGroups) {
    const had = groups.get(r.group);
    if (had) { had.openingSen += r.openingSen; had.purchasesSen += r.purchasesSen; had.closingSen += r.closingSen; }
    else groups.set(r.group, { ...r });
  }
  const total = (pick: (w: PnlWindowLike) => number) => ws.reduce((s, w) => s + pick(w), 0);
  return {
    netSalesSen: total((w) => w.netSalesSen),
    revLines: merge(ws.map((w) => w.revLines)),
    rmGroups: [...groups.values()],
    rmConsumedSen: total((w) => w.rmConsumedSen),
    carriageSen: total((w) => w.carriageSen),
    sstSen: total((w) => w.sstSen),
    labourLines: merge(ws.map((w) => w.labourLines)),
    labourSen: total((w) => w.labourSen),
    overheadLines: merge(ws.map((w) => w.overheadLines)),
    overheadSen: total((w) => w.overheadSen),
    wipOpen: total((w) => w.wipOpen), wipClose: total((w) => w.wipClose),
    fgOpen: total((w) => w.fgOpen), fgClose: total((w) => w.fgClose),
    manufacturingSen: total((w) => w.manufacturingSen),
    cogsSen: total((w) => w.cogsSen),
    grossProfitSen: total((w) => w.grossProfitSen),
    otherIncomeSen: total((w) => w.otherIncomeSen),
    otherIncomeLines: merge(ws.map((w) => w.otherIncomeLines)),
    expenseLines: merge(ws.map((w) => w.expenseLines)),
    expenseSen: total((w) => w.expenseSen),
    netProfitSen: total((w) => w.netProfitSen),
  };
}
