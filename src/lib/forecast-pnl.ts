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
 *  cell, the month's sales are their sum (forecastSalesSen). */
export type FcMonth = { salesSen?: number; salesByCustomer?: Record<string, number>; pct?: Record<string, FcEntry> };

/** The sales-by-customer row for customers not in the list yet. */
export const FC_OTHER_CUSTOMER = "other";

/** A month's sales: the sum of its customer rows once any is keyed (owner
 *  2026-11-09 「根据 customer 去 key-in 他的预计 sales」, the total is their
 *  sum), else the single keyed total. */
export function forecastSalesSen(m: FcMonth | undefined): number {
  const cells = Object.values(m?.salesByCustomer ?? {}).map((v) => Math.round(Number(v) || 0)).filter((v) => v > 0);
  if (cells.length) return cells.reduce((s, v) => s + v, 0);
  return Math.max(0, Math.round(Number(m?.salesSen) || 0));
}

/** A month's customer cells as stored: whole sen, positive only, a real key
 *  (no longer than any id the system makes). Anything else reads as nothing. */
export function cleanSalesByCustomer(raw: unknown): Record<string, number> {
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

/** The Forecast page's line structure (same classification as the real P&L,
 *  the owner's section-map overrides included). */
export function forecastLineGroups(
  accounts: readonly FcAccount[],
  override: Record<string, string>,
  depts: readonly FcDept[],
): FcLineGroups {
  const postable = accounts.filter((a) => a.isPostable !== false);
  const materialAccts = postable
    .filter(
      (a) =>
        a.type === "COST" &&
        pnlBucketFor(a.code, a.type, override) === null &&
        a.code !== FC_CARRIAGE &&
        a.code !== FC_SST &&
        !/STOCK|PROGRESS/i.test(a.name),
    )
    .sort(byCode);
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
  cogs: number;
  gp: number;
  oi: number;
  exp: number;
  np: number;
};

/** One month's figures, exactly as the Forecast page prints them. */
export function forecastMonthFigures(
  m: FcMonth | undefined,
  g: FcLineGroups,
  mappedAccounts: ReadonlySet<string>,
): FcMonthFigures {
  const salesSen = forecastSalesSen(m);
  const amt = (code: string) => forecastEntryAmount(salesSen, m?.pct?.[code]);
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
  return { salesSen, amt, superseded, cogs, gp, oi, exp, np: gp + oi - exp };
}
