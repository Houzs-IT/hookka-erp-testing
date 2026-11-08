// ---------------------------------------------------------------------------
// Cash Flow forecast — pure. Turns as-at agings, master terms, Forecast P&L
// figures and planned payments into forecast pseudo-legs that the statement
// engine (buildStatement, src/lib/cashflow-engine.ts) places exactly like
// ledger legs, so a forecast lands on the same line as the actual money.
// No DB, no I/O. Spec: docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md.
// Tests: tests/cashflow-forecast.test.mjs.
// ---------------------------------------------------------------------------
import {
  OVERDUE_LABEL,
  PLANNED_LABEL,
  splitByLargestRemainder,
  type ForecastColumn,
  type ForecastItem,
  type ForecastLeg,
} from "./cashflow-engine";
import { forecastEntryRatio, forecastMonthFigures, type FcAccount, type FcLineGroups, type FcMonth } from "./forecast-pnl";
import { pnlBucketFor } from "./pnl-bucket";

export type TermInfo = { months: number; flagged: boolean };

/** A customer's `creditTerms` or a supplier's `paymentTerms` → months (spec 5).
 *  NETn and "n days" round to whole months; "n months" is n; C.O.D. / CASH is
 *  the same month. Anything else — blank included — is taken as one month and
 *  flagged, so the page can name it. */
export function parseTermMonths(raw: string | null | undefined): TermInfo {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return { months: 1, flagged: true };
  const compact = s.replace(/[.\s]/g, "");
  if (compact === "COD" || compact === "CASH") return { months: 0, flagged: false };
  let m = /^NET ?(\d{1,3})$/.exec(s);
  if (m) return { months: Math.round(Number(m[1]) / 30), flagged: false };
  m = /^(\d{1,3}) ?DAYS?$/.exec(s);
  if (m) return { months: Math.round(Number(m[1]) / 30), flagged: false };
  m = /^(\d{1,2}) ?MONTHS?$/.exec(s);
  if (m) return { months: Number(m[1]), flagged: false };
  return { months: 1, flagged: true };
}

/** "2026-11" + 2 → "2027-01". */
export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** The forecast column key of a month. */
export const fcCol = (ym: string): string => `fc:${ym}`;

export type DocKind = "invoice" | "pi" | "ocb" | "odb" | "tf";

/** One line of an aging as at some date. `sen` > 0 is still owed; < 0 is a
 *  credit (an advance, a credit note, a trade-finance repayment not yet
 *  allocated). For `tf`, `date` is the draw's due date. */
export type OpenDoc = {
  kind: DocKind;
  partyId: string;
  partyName: string;
  no: string;
  date: string;
  sen: number;
  /** Where the money is placed: the debtor / creditor control, the facility
   *  account, or the bill's control when it has no item lines. */
  accountCode: string;
  /** Other-party bills: the item accounts the bill was spent on, weighted. */
  mix?: { accountCode: string; weight: number }[];
  /** Purchase invoices: the rmSplit key of the PI's material weights. */
  splitKey?: string;
  /** Trade finance: the line it repays ("Repaid to <lender>"). */
  label?: string;
};

export type ScheduledDoc = OpenDoc & { expectedYm: string; dueSen: number; termFlagged: boolean };

const family = (k: DocKind): string => (k === "invoice" ? "ar" : k === "pi" ? "ap" : k);

/** Owed lines with the month they are expected, after each party's credits
 *  are knocked off its OLDEST expected lines first (owner 2026-11-06: money
 *  received and recorded but not knocked off must not be counted again).
 *  Floored at zero; leftover credit is dropped, never a negative receipt. */
export function scheduleOpenDocs(docs: readonly OpenDoc[], termOf: (d: OpenDoc) => TermInfo): ScheduledDoc[] {
  const groups = new Map<string, OpenDoc[]>();
  for (const d of docs) {
    const k = `${family(d.kind)}|${d.partyId}`;
    const arr = groups.get(k) ?? [];
    arr.push(d);
    groups.set(k, arr);
  }
  const out: ScheduledDoc[] = [];
  for (const arr of groups.values()) {
    const owed: ScheduledDoc[] = [];
    let credit = 0;
    for (const d of arr) {
      if (d.sen < 0) { credit += -d.sen; continue; }
      if (d.sen === 0) continue;
      const t = termOf(d);
      // A line with no readable date (a draw without a due date) cannot be
      // placed in a month; it stays out rather than landing somewhere wrong.
      const expectedYm = /^\d{4}-\d{2}/.test(d.date) ? addMonthsYm(d.date.slice(0, 7), t.months) : "";
      owed.push({ ...d, expectedYm, dueSen: d.sen, termFlagged: t.flagged });
    }
    owed.sort((a, b) => a.expectedYm.localeCompare(b.expectedYm) || a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
    for (const o of owed) {
      if (credit <= 0) break;
      const take = Math.min(credit, o.dueSen);
      o.dueSen -= take;
      credit -= take;
    }
    out.push(...owed);
  }
  return out;
}

/** Sort order of the past-term line: last in its section, after the line the
 *  same money lands on when it is on time (owner reads TRADE DEBTORS, then
 *  what is overdue). Under Raw Materials it also stays flat (rmLineOrder). */
export const OVERDUE_ORDER = 99_999;

const splitMix = (sen: number, mix: { accountCode: string; weight: number }[]): [string, number][] =>
  Object.entries(splitByLargestRemainder(sen, mix.map((m) => ({ key: m.accountCode, weight: m.weight })))).filter(([, v]) => v !== 0);

/** The legs one aging puts in one forecast column.
 *  - "baseline" (the aging as at the column's 1st): lines expected that month
 *    are due; lines expected earlier are overdue and count in this month
 *    (owner: 单独一行但算这个月); later lines belong to later columns.
 *  - "future" (the aging as at today): only lines expected that month. */
export function docLegsForColumn(
  docs: readonly ScheduledDoc[],
  colYm: string,
  mode: "baseline" | "future",
  isCreditorControl: (code: string) => boolean,
): ForecastLeg[] {
  const legs: ForecastLeg[] = [];
  const col = fcCol(colYm);
  for (const d of docs) {
    if (d.dueSen <= 0 || !d.expectedYm) continue;
    const overdue = mode === "baseline" && d.expectedYm < colYm;
    if (!overdue && d.expectedYm !== colYm) continue;
    const sign = d.kind === "invoice" || d.kind === "odb" ? 1 : -1;
    const item: ForecastItem = { kind: d.kind, party: d.partyName, ref: d.no, date: d.date, expectedYm: d.expectedYm };
    const parts = (d.kind === "ocb" || d.kind === "odb") && d.mix?.length ? splitMix(d.dueSen, d.mix) : null;
    if (overdue) {
      if (parts) for (const [acct, sen] of parts) legs.push({ col, sen: sign * sen, accountCode: acct, label: OVERDUE_LABEL, order: OVERDUE_ORDER, item });
      else legs.push({ col, sen: sign * d.dueSen, accountCode: d.accountCode, label: OVERDUE_LABEL, order: OVERDUE_ORDER, item });
      continue;
    }
    switch (d.kind) {
      case "invoice":
        legs.push({ col, sen: d.dueSen, accountCode: d.accountCode, item });
        break;
      case "pi":
        legs.push({ col, sen: -d.dueSen, accountCode: d.accountCode, ...(d.splitKey ? { splitKey: d.splitKey } : {}), item });
        break;
      case "tf":
        legs.push({ col, sen: -d.dueSen, accountCode: d.accountCode, ...(d.label ? { label: d.label } : {}), item });
        break;
      case "ocb":
        // Same re-routing as an actual other-creditor payment: each part on
        // the account the bill was spent on; a part on a creditor control is
        // suppliers paid on our behalf; a bill with no items keeps its payee.
        if (parts) {
          for (const [acct, sen] of parts)
            legs.push({ col, sen: -sen, accountCode: acct, ...(isCreditorControl(acct) ? { label: `Suppliers settled via ${d.partyName}` } : {}), item });
        } else legs.push({ col, sen: -d.dueSen, accountCode: d.accountCode, label: `${d.partyName} (other creditor)`, item });
        break;
      case "odb":
        if (parts) for (const [acct, sen] of parts) legs.push({ col, sen, accountCode: acct, item });
        else legs.push({ col, sen: d.dueSen, accountCode: d.accountCode, item });
        break;
    }
  }
  return legs;
}

// ---- Money without a document: Forecast P&L × forecast receipts (spec 6.2) --

/** One Forecast P&L line as cash. `timing`: a salary is paid the month after
 *  (owner: 11 月薪水应该是 12 月出); an expense in its month; factory overhead
 *  in its month at the amount keyed, not scaled by receipts. `ratio` is the
 *  line's share of that month's forecast sales. */
export type FcCashLine = {
  code: string;
  name: string;
  timing: "salary" | "expense" | "overhead";
  ratio: { num: number; den: number } | { fixedSen: number };
  amtSen: number;
  accountCode: string;
  /** A department row: its line in the statement (the department's code). */
  label?: string;
};

/** Accounts whose P&L amount moves no cash: depreciation, amortisation,
 *  write-offs — and trade-finance interest, which is already inside each
 *  draw's amount and repaid with it. */
export function isNonCashAccount(code: string, name: string, tfInterestCode: string): boolean {
  return code === tfInterestCode || /DEPRECIATION|AMORTI[SZ]ATION|WRITTEN OFF|WRITE[- ]?OFF/i.test(name);
}

/** The Forecast P&L lines the cash forecast uses, in the page's own figures
 *  (forecastMonthFigures, so the dept-mode supersede rule is the page's):
 *  department rows, labour accounts and staff-salary accounts as salaries;
 *  operating expenses; factory overhead. Materials, carriage, SST and other
 *  income are left out (their cash comes from purchase invoices). */
export function forecastCashLines(
  m: FcMonth | undefined,
  g: FcLineGroups,
  override: Record<string, string>,
  mappedAccounts: ReadonlySet<string>,
  opts: { salaryAccount: string; nonCash: (code: string, name: string) => boolean },
): { salesSen: number; lines: FcCashLine[]; excluded: { code: string; name: string; amtSen: number }[] } {
  const f = forecastMonthFigures(m, g, mappedAccounts);
  const lines: FcCashLine[] = [];
  const excluded: { code: string; name: string; amtSen: number }[] = [];
  const add = (a: FcAccount, timing: FcCashLine["timing"], dept: boolean) => {
    if (f.superseded(a.code)) return;
    const ratio = forecastEntryRatio(f.salesSen, m?.pct?.[a.code]);
    if ("fixedSen" in ratio ? !ratio.fixedSen : !ratio.num) return; // not keyed
    const amtSen = f.amt(a.code);
    if (!dept && opts.nonCash(a.code, a.name)) { excluded.push({ code: a.code, name: a.name, amtSen }); return; }
    lines.push({
      code: a.code, name: a.name, timing, ratio, amtSen,
      accountCode: dept ? opts.salaryAccount : a.code,
      ...(dept ? { label: a.name } : {}),
    });
  };
  for (const a of [...g.labour, ...g.labourOvhDepts, ...g.labourExpDepts]) add(a, "salary", true);
  for (const a of g.labourAccounts) add(a, "salary", false);
  for (const a of g.expenses) add(a, pnlBucketFor(a.code, a.type, override) === "OPEX_SALARIES" ? "salary" : "expense", false);
  for (const a of g.overhead) add(a, "overhead", false);
  return { salesSen: f.salesSen, lines, excluded };
}

// ---- Planned payments and the whole forecast ----------------------------------

export type PlannedPayment = {
  id: string;
  party: string;
  ref: string | null;
  expectedDate: string;
  amountSen: number;
  doneAt: string | null;
};

export type ForecastInput = {
  /** Today, Malaysia time (YYYY-MM-DD). */
  today: string;
  /** The statement's period (YYYY-MM). */
  period: string;
  /** The statement's months, newest first (fyMonths). */
  months: string[];
  openingYm: string | null;
  /** Month → its aging as at the 1st, scheduled: every displayed month after
   *  the opening month, plus the month before the earliest one (whose
   *  receipts set the first month's salaries). */
  baselines: Map<string, ScheduledDoc[]>;
  /** The aging as at today, scheduled; null unless `period` is this month. */
  live: ScheduledDoc[] | null;
  /** Month → its Forecast P&L cash lines (forecastCashLines). */
  pnl: Map<string, { salesSen: number; lines: FcCashLine[] }>;
  plans: PlannedPayment[];
  isCreditorControl: (code: string) => boolean;
};

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string): string => `${MONTH_NAMES[parseInt(ym.slice(5, 7), 10)]}'${ym.slice(2, 4)}`;
const isReceipt = (l: ForecastLeg) => l.item.kind === "invoice" || l.item.kind === "odb";

/** Every forecast leg and column for one statement. */
export function buildForecastLegs(input: ForecastInput): { columns: ForecastColumn[]; legs: ForecastLeg[]; termFlagged: string[] } {
  const { today, period, months, openingYm, baselines, live, pnl, plans, isCreditorControl } = input;
  const currentYm = today.slice(0, 7);
  const isBlank = (ym: string) => !!openingYm && ym <= openingYm;

  // Future months only for this month's statement, as far as a document
  // reaches (owner 2026-11-08 「显示」: a month only a bill reaches is shown).
  const futureYms: string[] = [];
  if (period === currentYm && live) {
    let horizon = "";
    for (const d of live) if (d.dueSen > 0 && d.expectedYm > currentYm && d.expectedYm > horizon) horizon = d.expectedYm;
    for (let ym = addMonthsYm(currentYm, 1); horizon && ym <= horizon; ym = addMonthsYm(ym, 1)) futureYms.push(ym);
  }
  const columns: ForecastColumn[] = [
    ...[...futureYms].reverse().map((ym) => ({ ym, future: true, blank: false })),
    ...months.map((ym) => ({ ym, future: false, blank: isBlank(ym) })),
  ];

  // Documents.
  const docLegs = new Map<string, ForecastLeg[]>();
  for (const ym of months) if (!isBlank(ym)) docLegs.set(ym, docLegsForColumn(baselines.get(ym) ?? [], ym, "baseline", isCreditorControl));
  for (const ym of futureYms) docLegs.set(ym, docLegsForColumn(live ?? [], ym, "future", isCreditorControl));

  // Forecast receipts per month (overdue included) — what the salaries and
  // expenses are scaled by.
  const receipts = new Map<string, number>();
  for (const [ym, ls] of docLegs) receipts.set(ym, ls.filter(isReceipt).reduce((s, l) => s + l.sen, 0));
  const before = months.length ? addMonthsYm(months[months.length - 1], -1) : "";
  if (before && !isBlank(before) && baselines.has(before)) {
    const ls = docLegsForColumn(baselines.get(before) ?? [], before, "baseline", isCreditorControl);
    receipts.set(before, ls.filter(isReceipt).reduce((s, l) => s + l.sen, 0));
  }

  // Bills already counted, per column and account (no double count, spec 6.2).
  const billed = new Map<string, number>();
  for (const [ym, ls] of docLegs)
    for (const l of ls) if (l.item.kind === "ocb" && l.accountCode) billed.set(`${ym}|${l.accountCode}`, (billed.get(`${ym}|${l.accountCode}`) ?? 0) - l.sen);

  const legs: ForecastLeg[] = [...docLegs.values()].flat();
  const pct = (r: { num: number; den: number }) => ((r.num / r.den) * 100).toFixed(2);
  for (const [ym, p] of [...pnl.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (isBlank(ym)) continue;
    for (const line of p.lines) {
      const target = line.timing === "salary" ? addMonthsYm(ym, 1) : ym;
      if (!docLegs.has(target)) continue; // not a displayed forecast column
      let sen: number;
      let note: string;
      if (line.timing === "overhead") {
        sen = line.amtSen;
        note = "as keyed";
      } else {
        const r = receipts.get(ym);
        if (r === undefined) continue; // that month's receipts are not known
        if ("fixedSen" in line.ratio) {
          sen = line.ratio.fixedSen;
          note = "as keyed (no forecast sales)";
        } else {
          sen = Math.round((r * line.ratio.num) / line.ratio.den);
          note = `${pct(line.ratio)}% of ${monthLabel(ym)} forecast receipts`;
        }
        if (line.timing === "salary") note += " · paid the month after";
      }
      if (!line.label) {
        const k = `${target}|${line.accountCode}`;
        const b = billed.get(k) ?? 0;
        if (b > 0 && sen > 0) {
          const take = Math.min(b, sen);
          sen -= take;
          billed.set(k, b - take);
          note += " · less bills already counted";
        }
      }
      if (sen <= 0) continue;
      legs.push({
        col: fcCol(target), sen: -sen, accountCode: line.accountCode,
        ...(line.label ? { label: line.label } : {}),
        item: { kind: "pnl", party: line.name, ref: line.code, expectedYm: target, note },
      });
    }
  }

  // Planned payments (spec 6.3): a month's row holds the plans still unpaid
  // on its 1st and expected by then; a future month, the unpaid plans
  // expected in it.
  const planLeg = (ym: string, p: PlannedPayment, overdue: boolean): ForecastLeg => ({
    col: fcCol(ym), sen: -p.amountSen, section: "PLANNED", label: PLANNED_LABEL,
    item: { kind: "planned", party: p.party, ref: p.ref ?? "", date: p.expectedDate, expectedYm: p.expectedDate.slice(0, 7), ...(overdue ? { note: "past its date, not paid" } : {}) },
  });
  for (const ym of months) {
    if (isBlank(ym)) continue;
    const first = `${ym}-01`;
    for (const p of plans) {
      const exp = p.expectedDate.slice(0, 7);
      if (exp > ym) continue;
      if (p.doneAt && p.doneAt.slice(0, 10) < first) continue;
      legs.push(planLeg(ym, p, exp < ym));
    }
  }
  for (const ym of futureYms) for (const p of plans) if (!p.doneAt && p.expectedDate.slice(0, 7) === ym) legs.push(planLeg(ym, p, false));

  const flagged = new Set<string>();
  for (const docs of [...baselines.values(), live ?? []]) for (const d of docs) if (d.termFlagged && d.dueSen > 0) flagged.add(d.partyName);
  return { columns, legs, termFlagged: [...flagged].sort() };
}

/** (supplier, PI number) → PI id. An aging line names its PI by number only;
 *  two PIs of one supplier sharing a number resolve to nothing, so neither
 *  borrows the other's materials. */
export function piIdIndex(rows: readonly { id: string; piNo: string; supplierId: string }[]): (supplierId: string, piNo: string) => string | null {
  const m = new Map<string, string | null>();
  for (const r of rows) {
    const k = `${r.supplierId}|${r.piNo}`;
    m.set(k, m.has(k) && m.get(k) !== r.id ? null : r.id);
  }
  return (supplierId, piNo) => m.get(`${supplierId}|${piNo}`) ?? null;
}
