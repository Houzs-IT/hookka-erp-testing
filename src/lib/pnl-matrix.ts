// ---------------------------------------------------------------------------
// pnl-matrix.ts — pure builder for the Monthly P&L tab. Takes N PnlWindow
// columns (Accumulated + each FY month, computed by computePnlWindow) and
// emits the full P&L hierarchy as multi-column rows (values[] per column +
// pctValues[] = % of that column's net sales). Mirrors buildPnlRows' layout;
// uses the FIRST column (Accumulated = FY superset) as the row spine, each
// other column looked up by code (0 if absent). Read-only; all sen.
// ---------------------------------------------------------------------------

// estSen / estFrom: the part of the figure that is a running-month estimate for
// a recurring cost not recorded yet, and the month it was taken from
// (src/lib/expense-estimates.ts). Absent on every ledger-only line.
export interface PnlLine { code: string; name: string; amountSen: number; estSen?: number; estFrom?: string }
export interface PnlRmGroup { group: string; description: string; openingSen: number; purchasesSen: number; closingSen: number }
export interface PnlExpenseLine { code: string; name: string; amountSen: number; salary: boolean; estSen?: number; estFrom?: string }

export interface PnlWindowLike {
  netSalesSen: number;
  revLines: PnlLine[];
  rmGroups: PnlRmGroup[];
  rmConsumedSen: number;
  carriageSen: number;
  sstSen: number;
  labourLines: PnlLine[];
  labourSen: number;
  overheadLines: PnlLine[];
  overheadSen: number;
  wipOpen: number; wipClose: number; fgOpen: number; fgClose: number;
  manufacturingSen: number;
  cogsSen: number;
  grossProfitSen: number;
  otherIncomeSen: number;
  otherIncomeLines: PnlLine[];
  expenseLines: PnlExpenseLine[];
  expenseSen: number;
  netProfitSen: number;
}

export interface PnlMatrixCol { key: string; label: string; accum: boolean; window: PnlWindowLike }
export interface PnlMatrixRow {
  kind: "group" | "line" | "total" | "grandtotal" | "gap";
  depth: number;
  label: string;
  groupId?: string;
  // An open group's total line reads this (the statement's own labels).
  totalLabel?: string;
  accountCode?: string;
  // The account a computed line can be opened on (the Monthly P&L drill) —
  // a group's PURCHASE = its purchase account, carriage, SST. Same codes as
  // the statement's drillCode.
  drillCode?: string;
  values: number[];
  pctValues: number[];
  // Per column, the part of the value that is a running-month estimate (only
  // on lines that carry one in some column), and the month it came from.
  estValues?: number[];
  estFrom?: string;
  // What the row is in Forecast P&L terms (owner 2026-11-10: the forecast is
  // keyed in the Monthly P&L; src/lib/pl-forecast-edit.ts): "sales", a
  // material type "cat:<TYPE>", carriage / SST, or the line's account code.
  // Stock and revenue lines carry none.
  fcKey?: string;
}
export interface PnlMatrix { columns: { key: string; label: string; accum: boolean }[]; rows: PnlMatrixRow[] }

/** A raw-material group that stands for a Forecast P&L material TYPE, not a
 *  stock group (src/lib/pnl-forecast.ts). Never a row of its own. */
export const FORECAST_TYPE_GROUP_PREFIX = "type:";

/** `spine`: the window whose line lists make the rows (default: the first
 *  column). `rmTypeOf` (the Monthly P&L forecast, spec 2026-11-09-forecast-
 *  three-columns-design.md 6): each raw-material TYPE gets a row over its
 *  purchase groups, so a type's forecast compares with its groups' sum. */
export function buildPnlMatrix(cols: PnlMatrixCol[], opts: { spine?: PnlWindowLike; rmTypeOf?: (rg: PnlRmGroup) => string } = {}): PnlMatrix {
  const columns = cols.map((c) => ({ key: c.key, label: c.label, accum: c.accum }));
  const windows = cols.map((c) => c.window);
  const rows: PnlMatrixRow[] = [];
  const spine = opts.spine ?? windows[0];
  if (!spine) return { columns, rows };

  const netSales = windows.map((w) => w.netSalesSen);
  const pctOf = (vals: number[]) => vals.map((v, i) => (netSales[i] ? Math.round((v / netSales[i]) * 1000) / 10 : 0));
  // Line identity = code AND name — historical windows share ONE placeholder
  // code ("900") on every line, so a pure-code match would return the FIRST
  // such line of each month for every row. Must mirror pnl-historical's
  // lineKey exactly.
  const keyOf = (l: { code: string; name?: string }) => `${l.code ?? ""} ${l.name ?? ""}`;
  const byCode = (list: { code: string; name?: string; amountSen: number }[], key: string) =>
    list.find((l) => keyOf(l) === key)?.amountSen ?? 0;

  let gid = 0;
  const push = (kind: PnlMatrixRow["kind"], depth: number, label: string, ex: (w: PnlWindowLike) => number, opts: { groupId?: string; totalLabel?: string; accountCode?: string; drillCode?: string; fcKey?: string } = {}) => {
    const values = windows.map(ex);
    rows.push({ kind, depth, label, values, pctValues: pctOf(values), ...opts });
  };
  const group = (label: string, depth: number, ex: (w: PnlWindowLike) => number, totalLabel: string, fcKey?: string) => {
    const id = `g${gid++}`;
    push("group", depth, label, ex, fcKey ? { groupId: id, totalLabel, fcKey } : { groupId: id, totalLabel });
    return id;
  };
  // `fcKey` (forecast key): an account line keys its own code; carriage and
  // SST theirs; a revenue or stock line nothing.
  const line = (label: string, depth: number, ex: (w: PnlWindowLike) => number, accountCode?: string, drillCode?: string, fcKey?: string) =>
    push("line", depth, label, ex, { accountCode, ...(drillCode ? { drillCode } : {}), ...(fcKey ? { fcKey } : {}) });
  const tot = (label: string, depth: number, ex: (w: PnlWindowLike) => number) => push("total", depth, label, ex);
  // The line just pushed: which columns are (partly) estimates.
  const markEst = (pick: (w: PnlWindowLike) => { code: string; name?: string; estSen?: number; estFrom?: string }[], key: string) => {
    const hits = windows.map((w) => pick(w).find((l) => keyOf(l) === key));
    const vals = hits.map((h) => h?.estSen ?? 0);
    if (!vals.some((v) => v !== 0)) return;
    const r = rows[rows.length - 1];
    r.estValues = vals;
    r.estFrom = hits.find((h) => h?.estFrom)?.estFrom;
  };
  const grand = (label: string, ex: (w: PnlWindowLike) => number) => push("grandtotal", 0, label, ex);
  const gap = () => rows.push({ kind: "gap", depth: 0, label: "", values: [], pctValues: [] });

  // SALES
  group("SALES", 0, (w) => w.netSalesSen, "NET SALES", "sales");
  for (const rl of spine.revLines) line(rl.name, 1, (w) => byCode(w.revLines, keyOf(rl)), rl.code);
  gap();

  // COST OF GOODS SOLD
  group("COST OF GOODS SOLD", 0, (w) => w.cogsSen, "TOTAL COST OF GOODS SOLD");
  line("OPENING STOCK - FINISHED GOODS", 1, (w) => w.fgOpen);
  group("RAW MATERIALS", 1, (w) => w.rmConsumedSen, "TOTAL RAW MATERIALS");
  const consumed = (x: PnlRmGroup) => x.openingSen + x.purchasesSen - x.closingSen;
  const rmGroupRows = (rg: PnlRmGroup, depth: number) => {
    const find = (w: PnlWindowLike) => w.rmGroups.find((q) => q.group === rg.group);
    group(rg.description, depth, (w) => { const x = find(w); return x ? consumed(x) : 0; }, `TOTAL ${rg.description}`);
    line("OPENING STOCK", depth + 1, (w) => find(w)?.openingSen ?? 0);
    line("PURCHASE", depth + 1, (w) => find(w)?.purchasesSen ?? 0, undefined, rg.group);
    line("CLOSING STOCK", depth + 1, (w) => -(find(w)?.closingSen ?? 0));
  };
  if (opts.rmTypeOf) {
    const typeOf = opts.rmTypeOf;
    const types: string[] = [];
    for (const rg of spine.rmGroups) { const t = typeOf(rg); if (!types.includes(t)) types.push(t); }
    for (const t of types) {
      group(t, 2, (w) => w.rmGroups.filter((q) => typeOf(q) === t).reduce((s, q) => s + consumed(q), 0), `TOTAL ${t}`, `cat:${t}`);
      for (const rg of spine.rmGroups) if (typeOf(rg) === t && !rg.group.startsWith(FORECAST_TYPE_GROUP_PREFIX)) rmGroupRows(rg, 3);
    }
  } else for (const rg of spine.rmGroups) rmGroupRows(rg, 2);
  line("CARRIAGE INWARDS", 1, (w) => w.carriageSen, undefined, "700-1015", "700-1015");
  line("SST CHARGES", 1, (w) => w.sstSen, undefined, "706-0000", "706-0000");
  group("DIRECT LABOUR", 1, (w) => w.labourSen, "TOTAL DIRECT LABOUR");
  for (const ll of spine.labourLines) line(ll.name, 2, (w) => byCode(w.labourLines, keyOf(ll)), ll.code, undefined, ll.code);
  group("FACTORY OVERHEAD", 1, (w) => w.overheadSen, "TOTAL FACTORY OVERHEAD");
  for (const ol of spine.overheadLines) { line(ol.name, 2, (w) => byCode(w.overheadLines, keyOf(ol)), ol.code, undefined, ol.code); markEst((w) => w.overheadLines, keyOf(ol)); }
  group("WORK IN PROGRESS", 1, (w) => w.wipOpen - w.wipClose, "WIP MOVEMENT (net)");
  line("WIP - OPENING", 2, (w) => w.wipOpen);
  line("WIP - CLOSING", 2, (w) => -w.wipClose);
  tot("MANUFACTURING COST", 1, (w) => w.manufacturingSen);
  line("CLOSING STOCK - FINISHED GOODS", 1, (w) => -w.fgClose);
  grand("GROSS PROFIT / (LOSS)", (w) => w.grossProfitSen);
  gap();

  // OTHER INCOME
  if (spine.otherIncomeLines.length > 0 || windows.some((w) => w.otherIncomeSen !== 0)) {
    group("OTHER INCOME", 0, (w) => w.otherIncomeSen, "TOTAL OTHER INCOME");
    for (const ol of spine.otherIncomeLines) line(ol.name, 1, (w) => byCode(w.otherIncomeLines, keyOf(ol)), ol.code, undefined, ol.code);
  }

  // OPERATING EXPENSES
  group("OPERATING EXPENSES", 0, (w) => w.expenseSen, "TOTAL EXPENSES");
  const salLines = spine.expenseLines.filter((l) => l.salary);
  if (salLines.length > 0) {
    group("SALARIES & CONTRIBUTION", 1, (w) => w.expenseLines.filter((l) => l.salary).reduce((s, l) => s + l.amountSen, 0), "TOTAL SALARIES & CONTRIBUTION");
    for (const sl of salLines) { line(sl.name, 2, (w) => byCode(w.expenseLines, keyOf(sl)), sl.code, undefined, sl.code); markEst((w) => w.expenseLines, keyOf(sl)); }
  }
  for (const el of spine.expenseLines.filter((l) => !l.salary)) { line(el.name, 1, (w) => byCode(w.expenseLines, keyOf(el)), el.code, undefined, el.code); markEst((w) => w.expenseLines, keyOf(el)); }
  grand("NET PROFIT / (LOSS)", (w) => w.netProfitSen);

  return { columns, rows };
}
