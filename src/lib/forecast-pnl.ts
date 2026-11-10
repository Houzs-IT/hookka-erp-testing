// ---------------------------------------------------------------------------
// Forecast P&L figures — pure. The line classification and the amount rule of
// the Forecast P&L page (src/pages/forecast.tsx), moved here unchanged so the
// page and the Cash Flow forecast (src/lib/cashflow-forecast.ts) read the
// SAME lines, the same supersede rule and the same amounts: a salary or
// expense figure in the cash forecast must never disagree with what the
// owner's own page shows (spec 2026-11-08-cash-flow-forecast-design.md 6.2).
// Tests: tests/forecast-pnl.test.mjs.
// ---------------------------------------------------------------------------
import { pnlBucketFor } from "./pnl-bucket";
import { monthHasDeptForecast, forecastEntryKind } from "./salary-dept";

/** One keyed cell as stored in kv `forecast_pnl`: a legacy bare basis-point
 *  number, `{ bp }` (a % of sales) or `{ amtSen }` (an RM amount). */
export type FcEntry = number | { bp?: number; amtSen?: number };
/** One month of kv `forecast_pnl.months`. `salesByCustomer` (owner
 *  2026-11-09): customer id (or FC_OTHER_CUSTOMER) → sen; when it has any
 *  cell, the month's sales are their sum (forecastSalesSen).
 *  `purchasesByType` (owner 2026-11-10 「让他在每个categories 出现相关的
 *  supplier, 我从那边填」): material type → supplier id (or
 *  FC_OTHER_SUPPLIER) → sen; a material with any cell that month is their
 *  sum, one without keeps its own % / RM (forecastMonthFigures). */
export type FcMonth = {
  salesSen?: number;
  salesByCustomer?: Record<string, number>;
  purchasesByType?: Record<string, Record<string, number>>;
  pct?: Record<string, FcEntry>;
};

/** The sales-by-customer row for customers not in the list yet. */
export const FC_OTHER_CUSTOMER = "other";
/** The purchases-by-supplier row for suppliers not in the list yet. */
export const FC_OTHER_SUPPLIER = "other";

/** A month's sales: the sum of its customer rows once any is keyed (owner
 *  2026-11-09 「根据 customer 去 key-in 他的预计 sales」, the total is their
 *  sum), else the single keyed total. */
export function forecastSalesSen(m: FcMonth | undefined): number {
  const cells = Object.values(m?.salesByCustomer ?? {}).map((v) => Math.round(Number(v) || 0)).filter((v) => v > 0);
  if (cells.length) return cells.reduce((s, v) => s + v, 0);
  return Math.max(0, Math.round(Number(m?.salesSen) || 0));
}

/** A month's customer or supplier cells as stored: whole sen, positive only,
 *  a real key (no longer than any id the system makes). Anything else reads
 *  as nothing. */
function cleanPartyCells(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim();
    const sen = Math.round(Number(v));
    if (!key || key.length > 64 || !Number.isSafeInteger(sen) || sen <= 0) continue;
    out[key] = sen;
  }
  return out;
}
export const cleanSalesByCustomer = (raw: unknown): Record<string, number> => cleanPartyCells(raw);

/** A month's supplier figures per material as stored: each material (a real
 *  key) with its supplier cells cleaned as above; a material left with no
 *  cell is dropped. Anything else reads as nothing. */
export function cleanPurchasesByType(raw: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [t, cells] of Object.entries(raw as Record<string, unknown>)) {
    const type = t.trim();
    if (!type || type.length > 64) continue;
    const clean = cleanPartyCells(cells);
    if (Object.keys(clean).length) out[type] = clean;
  }
  return out;
}

/** A material's supplier figures in a month, positive whole sen only. */
export function forecastTypeSupplierCells(m: FcMonth | undefined, type: string): [string, number][] {
  return Object.entries(m?.purchasesByType?.[type] ?? {})
    .map(([id, v]) => [id, Math.round(Number(v) || 0)] as [string, number])
    .filter(([, v]) => v > 0);
}
/** A material's supplier figures added up (0 when it is keyed by its %). */
export function forecastTypeSupplierSen(m: FcMonth | undefined, type: string): number {
  return forecastTypeSupplierCells(m, type).reduce((s, [, v]) => s + v, 0);
}

/** What each supplier sold us lately, by material type (sen), and all
 *  suppliers together (spec 2026-11-10-forecast-suppliers-design.md 4): which
 *  suppliers the page lists under each material. */
export type FcSupplierMix = { bySupplier: Record<string, Record<string, number>>; all: Record<string, number> };

/** The weights from the recent purchase invoices' ledger legs: debit minus
 *  credit on the material purchase accounts (`typeOf` names an account's
 *  material type, undefined for any other account), by supplier and type;
 *  nothing that nets to zero or less. */
export function supplierMixFromLegs(
  legs: readonly { supplierId: string; accountCode: string; debitSen: number; creditSen: number }[],
  typeOf: (code: string) => string | undefined,
): FcSupplierMix {
  const net = new Map<string, Map<string, number>>();
  for (const l of legs) {
    const type = typeOf(l.accountCode);
    if (!type || !l.supplierId) continue;
    const m = net.get(l.supplierId) ?? new Map<string, number>();
    m.set(type, (m.get(type) ?? 0) + Math.round(Number(l.debitSen) || 0) - Math.round(Number(l.creditSen) || 0));
    net.set(l.supplierId, m);
  }
  const bySupplier: Record<string, Record<string, number>> = {};
  const all: Record<string, number> = {};
  for (const [sup, m] of [...net].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [type, sen] of [...m].sort(([a], [b]) => a.localeCompare(b))) {
      if (sen <= 0) continue;
      (bySupplier[sup] ??= {})[type] = sen;
      all[type] = (all[type] ?? 0) + sen;
    }
  }
  return { bySupplier, all };
}

/** The suppliers that sold us a material lately (the page lists them under
 *  that material's row). */
export function forecastTypeSuppliers(mix: FcSupplierMix, type: string): string[] {
  return Object.entries(mix.bySupplier)
    .filter(([, w]) => (w[type] ?? 0) > 0)
    .map(([id]) => id);
}

/** A material row's supplier rows on the Forecast page (owner 2026-11-10: 太久
 *  没使用的 supplier 就不在选项): active suppliers that sold us that material
 *  lately (`recentIds`), and any supplier keyed under it in some month, active
 *  or not (an id the master no longer knows is named as such), by name; Other
 *  last. */
export function forecastSupplierRows(
  master: readonly { id: string; name: string; isActive?: boolean | null }[],
  recentIds: Iterable<string>,
  keyedIds: Iterable<string>,
): { id: string; name: string }[] {
  const recent = new Set(recentIds);
  const keyed = new Set([...keyedIds].filter((id) => id !== FC_OTHER_SUPPLIER));
  const rows: { id: string; name: string }[] = [];
  const known = new Set<string>();
  for (const s of master) {
    known.add(s.id);
    if ((recent.has(s.id) && s.isActive !== false) || keyed.has(s.id)) rows.push({ id: s.id, name: s.name });
  }
  for (const id of keyed) if (!known.has(id)) rows.push({ id, name: `Unknown supplier (${id})` });
  rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return [...rows, { id: FC_OTHER_SUPPLIER, name: "Other (new suppliers)" }];
}

/** The Forecast page's customer rows: every active customer and any customer
 *  keyed in some month (an inactive one stays while it carries a figure; an
 *  id the master no longer knows is named as such), by name; Other last. */
export function forecastCustomerRows(
  master: readonly { id: string; name: string; isActive?: boolean | null }[],
  keyedIds: Iterable<string>,
): { id: string; name: string }[] {
  const keyed = new Set([...keyedIds].filter((id) => id !== FC_OTHER_CUSTOMER));
  const rows: { id: string; name: string }[] = [];
  const known = new Set<string>();
  for (const c of master) {
    known.add(c.id);
    if (c.isActive !== false || keyed.has(c.id)) rows.push({ id: c.id, name: c.name });
  }
  for (const id of keyed) if (!known.has(id)) rows.push({ id, name: `Unknown customer (${id})` });
  rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return [...rows, { id: FC_OTHER_CUSTOMER, name: "Other (new customers)" }];
}
export type FcAccount = { code: string; name: string; type: string; isPostable?: boolean };
/** A department and the P&L bucket its row files under (GET /labor/departments). */
export type FcDept = { code: string; bucket: string };
export type FcLineGroups = {
  materials: FcAccount[];
  direct: FcAccount[];
  labour: FcAccount[];
  labourOvhDepts: FcAccount[];
  labourExpDepts: FcAccount[];
  labourAccounts: FcAccount[];
  overhead: FcAccount[];
  otherIncome: FcAccount[];
  expenses: FcAccount[];
};

/** The department rows: the departments master (GET /labor/departments,
 *  each with its bucket) plus any department already keyed in the saved
 *  months — a keyed dept must never vanish from the grid; one the master no
 *  longer knows files under DIRECT_LABOUR. Sorted by code. */
export function forecastDepts(
  master: readonly (string | { code?: string; bucket?: string })[],
  monthPcts: Iterable<Record<string, unknown> | undefined>,
): FcDept[] {
  const live = new Map<string, string>();
  for (const d of master) {
    if (typeof d === "string") { if (d) live.set(d, "DIRECT_LABOUR"); }
    else if (d?.code) live.set(String(d.code), String(d.bucket ?? "DIRECT_LABOUR"));
  }
  for (const pct of monthPcts)
    for (const k of Object.keys(pct ?? {}))
      if (k.startsWith("dept:") && !live.has(k.slice(5))) live.set(k.slice(5), "DIRECT_LABOUR");
  return [...live.entries()].map(([code, bucket]) => ({ code, bucket })).sort((a, b) => a.code.localeCompare(b.code));
}

export const FC_CARRIAGE = "700-1015";
export const FC_SST = "706-0000";

const byCode = (a: FcAccount, b: FcAccount) => a.code.localeCompare(b.code);

/** A purchase account's material TYPE, the Forecast P&L's way (owner
 *  2026-07-29: "PURCHASE - B.M FABRIC" / "S FABRIC" / "S.M FABRIC" are one
 *  FABRIC row). Also how the Monthly P&L forecast groups its purchase groups. */
export function forecastMaterialType(name: string): string {
  const stripped = name.replace(/^PURCHASE\s*-\s*/i, "").trim();
  const cat = stripped.replace(/^(B\.M|S\.M|B|S)[.\s]+/i, "").trim();
  return cat || stripped;
}

/** A material purchase account: what the Forecast page folds into its
 *  material rows (a postable cost account outside the P&L's labour /
 *  overhead buckets, not carriage, SST, stock or work in progress). */
function isForecastMaterialAccount(a: FcAccount, override: Record<string, string>): boolean {
  return (
    a.isPostable !== false &&
    a.type === "COST" &&
    pnlBucketFor(a.code, a.type, override) === null &&
    a.code !== FC_CARRIAGE &&
    a.code !== FC_SST &&
    !/STOCK|PROGRESS/i.test(a.name)
  );
}

/** Each material purchase account's material type (its row on the Forecast
 *  page): where a supplier's purchases say what it sells us. */
export function forecastMaterialAccountTypes(accounts: readonly FcAccount[], override: Record<string, string>): Map<string, string> {
  return new Map(accounts.filter((a) => isForecastMaterialAccount(a, override)).map((a) => [a.code, forecastMaterialType(a.name)] as const));
}

/** The Forecast page's line structure (same classification as the real P&L,
 *  the owner's section-map overrides included). */
export function forecastLineGroups(
  accounts: readonly FcAccount[],
  override: Record<string, string>,
  depts: readonly FcDept[],
): FcLineGroups {
  const postable = accounts.filter((a) => a.isPostable !== false);
  const materialAccts = postable.filter((a) => isForecastMaterialAccount(a, override)).sort(byCode);
  // Owner 2026-07-29: materials forecast by TYPE, not by sofa/bedframe —
  // "PURCHASE - B.M FABRIC" / "S FABRIC" / "S.M FABRIC" fold into ONE
  // FABRIC row (likewise FILLER / WEBBING / …). Percentages store under a
  // stable `cat:<TYPE>` key, so a future sofa/bedframe split can add
  // per-line rows without clashing with what was keyed here.
  const catNames = [...new Set(materialAccts.map((a) => forecastMaterialType(a.name)))].sort();
  const materials = catNames.map((n) => ({ code: `cat:${n}`, name: n, type: "COST" }) as FcAccount);
  const byBucket = (bucket: string) =>
    postable.filter((a) => pnlBucketFor(a.code, a.type, override) === bucket).sort(byCode);
  const direct = postable.filter((a) => a.code === FC_CARRIAGE || a.code === FC_SST);
  return {
    materials,
    direct,
    // Owner 2026-08-11: salaries are FORECAST PER DEPARTMENT — pseudo-lines
    // `dept:<CODE>` (same trick as `cat:`). Owner 2026-08-24: every dept in
    // the MASTER is keyable, and each row files in the SAME P&L section its
    // labour-map account posts to (production → direct labour; warehouse /
    // maintenance → factory overhead; office / R&D → operating expenses).
    // Accounts the labour map can post to are SUPERSEDED in dept-mode months.
    labour: depts
      .filter((d) => d.bucket !== "FACTORY_OVERHEAD" && d.bucket !== "OPEX_SALARIES" && d.bucket !== "OPERATING_EXPENSE")
      .map((d) => ({ code: `dept:${d.code}`, name: d.code, type: "COST" }) as FcAccount),
    labourOvhDepts: depts
      .filter((d) => d.bucket === "FACTORY_OVERHEAD")
      .map((d) => ({ code: `dept:${d.code}`, name: d.code, type: "COST" }) as FcAccount),
    labourExpDepts: depts
      .filter((d) => d.bucket === "OPEX_SALARIES" || d.bucket === "OPERATING_EXPENSE")
      .map((d) => ({ code: `dept:${d.code}`, name: d.code, type: "EXPENSE" }) as FcAccount),
    labourAccounts: byBucket("DIRECT_LABOUR"),
    overhead: byBucket("FACTORY_OVERHEAD"),
    otherIncome: byBucket("OTHER_INCOME"),
    expenses: [...byBucket("OPEX_SALARIES"), ...byBucket("OPERATING_EXPENSE")].sort(byCode),
  };
}

/** Owner 2026-08-31 「算法也要改」: the non-production salary dept rows sit
 *  between Direct Labour and Factory Overhead AND count inside TOTAL COGS
 *  (they reduce GROSS PROFIT, not TOTAL EXPENSES). */
export function forecastCogsRows(g: FcLineGroups): FcAccount[] {
  return [...g.materials, ...g.direct, ...g.labour, ...g.labourExpDepts, ...g.labourOvhDepts, ...g.labourAccounts, ...g.overhead];
}

/** A keyed cell's amount: an RM amount wins, else sales × %. */
export function forecastEntryAmount(salesSen: number, e: FcEntry | undefined): number {
  const sales = Math.max(0, Math.round(Number(salesSen) || 0));
  if (typeof e === "number") return Math.round((sales * e) / 10000);
  if (e?.amtSen) return Math.round(Number(e.amtSen) || 0);
  return Math.round((sales * (Number(e?.bp) || 0)) / 10000);
}

/** A keyed cell as a share of the month's sales (spec 6.2): a % line → its %;
 *  an RM line → RM ÷ sales; an RM line in a month with no sales has no share,
 *  so it is paid as keyed. */
export function forecastEntryRatio(
  salesSen: number,
  e: FcEntry | undefined,
): { num: number; den: number } | { fixedSen: number } {
  const sales = Math.max(0, Math.round(Number(salesSen) || 0));
  if (typeof e === "number") return { num: e, den: 10000 };
  if (e?.amtSen) {
    const amt = Math.round(Number(e.amtSen) || 0);
    return sales > 0 ? { num: amt, den: sales } : { fixedSen: amt };
  }
  return { num: Number(e?.bp) || 0, den: 10000 };
}

export type FcMonthFigures = {
  salesSen: number;
  amt: (code: string) => number;
  superseded: (code: string) => boolean;
  /** A material row keyed by supplier this month: its amount is their sum. */
  supplierKeyed: (code: string) => boolean;
  cogs: number;
  gp: number;
  oi: number;
  exp: number;
  np: number;
};

/** A material row's type: `cat:<TYPE>`, or an account's by its name. */
export const materialRowType = (a: FcAccount): string => (a.code.startsWith("cat:") ? a.code.slice(4) : forecastMaterialType(a.name));

/** One month's figures, exactly as the Forecast page prints them. A material
 *  with supplier figures that month is their sum (owner 2026-11-10); its own
 *  % / RM stays stored and counts again once they are cleared. Supplier
 *  figures under a material the page has no row for count nowhere. */
export function forecastMonthFigures(
  m: FcMonth | undefined,
  g: FcLineGroups,
  mappedAccounts: ReadonlySet<string>,
): FcMonthFigures {
  const salesSen = forecastSalesSen(m);
  const bySupplier = new Map<string, number>();
  for (const a of g.materials) {
    const cells = forecastTypeSupplierCells(m, materialRowType(a));
    if (cells.length) bySupplier.set(a.code, cells.reduce((s, [, v]) => s + v, 0));
  }
  const supplierKeyed = (code: string) => bySupplier.has(code);
  const amt = (code: string) => bySupplier.get(code) ?? forecastEntryAmount(salesSen, m?.pct?.[code]);
  const sum = (rows: FcAccount[]) => rows.reduce((s, r) => s + amt(r.code), 0);
  // Supersede rule (salary-dept.ts): a month with any dept row ignores the
  // 750-x accounts AND every account the labour map posts to — keying both
  // a dept row and its account would double-count the same wages.
  const deptMode = monthHasDeptForecast(m?.pct);
  const superseded = (code: string) =>
    deptMode && (forecastEntryKind(code) === "labourAccount" || mappedAccounts.has(code));
  const sumGuard = (rows: FcAccount[]) => rows.reduce((s, r) => (superseded(r.code) ? s : s + amt(r.code)), 0);
  const cogs = sumGuard(forecastCogsRows(g));
  const oi = sum(g.otherIncome);
  const exp = sumGuard(g.expenses);
  const gp = salesSen - cogs;
  return { salesSen, amt, superseded, supplierKeyed, cogs, gp, oi, exp, np: gp + oi - exp };
}
