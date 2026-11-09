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
  type CfSection,
  type ForecastColumn,
  type ForecastItem,
  type ForecastLeg,
} from "./cashflow-engine";
import { FC_OTHER_CUSTOMER, forecastEntryRatio, forecastMonthFigures, forecastSalesSen, type FcAccount, type FcLineGroups, type FcMonth } from "./forecast-pnl";
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

/** The last month whose customer receipts not knocked off are left out of the
 *  netting: the month after the opening month (owner 2026-11-09 「把这些初期的
 *  排除掉」, narrowed to the customers' receipts). Such receipts pay invoices
 *  from before the opening that the system does not hold yet. Null without an
 *  opening month. */
export function openingCreditCutoffYm(openingYm: string | null): string | null {
  return openingYm ? addMonthsYm(openingYm, 1) : null;
}

/** Splits the opening-period customer receipts off an aging, before
 *  scheduleOpenDocs nets credits: a customer credit dated up to `cutoffYm`
 *  waits for the opening balances instead of lowering current invoices.
 *  Invoices and supplier payments stay whatever their date. */
export function splitOpeningCredits(docs: readonly OpenDoc[], cutoffYm: string | null): { kept: OpenDoc[]; leftOut: OpenDoc[] } {
  if (!cutoffYm) return { kept: [...docs], leftOut: [] };
  const kept: OpenDoc[] = [];
  const leftOut: OpenDoc[] = [];
  for (const d of docs) {
    const opening = d.kind === "invoice" && d.sen < 0 && /^\d{4}-\d{2}/.test(d.date) && d.date.slice(0, 7) <= cutoffYm;
    (opening ? leftOut : kept).push(d);
  }
  return { kept, leftOut };
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
  /** Keyed capex & financing (spec 6.4): month → account code → sen, the
   *  statement's way round (+ money in, − money out). Forecast only. */
  inputs?: Record<string, Record<string, number>>;
};

/** How many months the Capex & financing table offers, from the current
 *  month: a keyed month reaches at most this far (spec 6.4). */
export const KEYED_MONTHS = 12;
/** Who a keyed amount is "from" in the forecast drill. */
export const KEYED_PARTY = "Keyed on Cash Flow (Capex & financing)";

/** The accounts the Capex & financing table offers (spec 6.4): postable, put
 *  by the statement under CAPEX or Loan (`sectionOf` is the statement's own
 *  placement: the owner's mapping, then defaultSectionFor), and not a
 *  depreciation or amortisation account. Sorted by code. */
export function keyableAccounts<A extends { code: string; name: string; isPostable?: boolean | null }>(
  accounts: readonly A[],
  sectionOf: (a: A) => CfSection,
): { code: string; name: string; section: "CAPEX" | "LOAN" }[] {
  const out: { code: string; name: string; section: "CAPEX" | "LOAN" }[] = [];
  for (const a of accounts) {
    if (a.isPostable === false || /DEPRECIATION|DEPRN|AMORTI[SZ]ATION/i.test(a.name)) continue;
    const section = sectionOf(a);
    if (section === "CAPEX" || section === "LOAN") out.push({ code: a.code, name: a.name, section });
  }
  return out.sort((x, y) => x.code.localeCompare(y.code));
}

/** A keyed-amounts map, cleaned (spec 6.4): months as YYYY-MM, whole sen,
 *  zeros dropped. With `allowed`, any other account is refused — listed in
 *  `rejected`, never kept. Anything unreadable reads as nothing. */
export function cleanKeyedInputs(
  raw: unknown,
  allowed: ReadonlySet<string> | null,
): { months: Record<string, Record<string, number>>; rejected: string[] } {
  const months: Record<string, Record<string, number>> = {};
  const rejected = new Set<string>();
  if (!raw || typeof raw !== "object") return { months, rejected: [] };
  for (const [ym, cells] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym) || !cells || typeof cells !== "object") continue;
    for (const [code, v] of Object.entries(cells as Record<string, unknown>)) {
      const sen = Math.round(Number(v));
      if (!Number.isSafeInteger(sen) || sen === 0) continue;
      if (allowed && !allowed.has(code)) { rejected.add(code); continue; }
      (months[ym] ??= {})[code] = sen;
    }
  }
  return { months, rejected: [...rejected].sort() };
}

/** The Capex & financing table's rows (owner 2026-11-09 「输入时就显示全部」):
 *  every offered account, CAPEX then Loan, each in code order; then OTHER,
 *  the accounts keyed in any month that are no longer offered (the mapping
 *  moved them). The server refuses the whole map while one is there, so the
 *  table shows them to be cleared. An empty group is left out. */
export function keyedInputGroups(
  accounts: readonly { code: string; section: "CAPEX" | "LOAN" }[],
  months: Readonly<Record<string, Readonly<Record<string, number>>>>,
): { group: "CAPEX" | "LOAN" | "OTHER"; codes: string[] }[] {
  const offered = new Set(accounts.map((a) => a.code));
  const inSection = (s: "CAPEX" | "LOAN") => accounts.filter((a) => a.section === s).map((a) => a.code).sort();
  const other = new Set<string>();
  for (const cells of Object.values(months)) for (const [code, sen] of Object.entries(cells ?? {})) if (sen && !offered.has(code)) other.add(code);
  const groups: { group: "CAPEX" | "LOAN" | "OTHER"; codes: string[] }[] = [
    { group: "CAPEX", codes: inSection("CAPEX") },
    { group: "LOAN", codes: inSection("LOAN") },
    { group: "OTHER", codes: [...other].sort() },
  ];
  return groups.filter((g) => g.codes.length > 0);
}

/** One row of the Capex & financing table cleared: `code` taken out of the
 *  months `yms` (the twelve shown), or of every month when `yms` is null (an
 *  account no longer offered). A month left empty goes. A new map. */
export function clearKeyedCode(
  months: Readonly<Record<string, Readonly<Record<string, number>>>>,
  code: string,
  yms: readonly string[] | null,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [ym, cells] of Object.entries(months)) {
    const kept = { ...cells };
    if (!yms || yms.includes(ym)) delete kept[code];
    if (Object.keys(kept).length) out[ym] = kept;
  }
  return out;
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string): string => `${MONTH_NAMES[parseInt(ym.slice(5, 7), 10)]}'${ym.slice(2, 4)}`;
const isReceipt = (l: ForecastLeg) => l.item.kind === "invoice" || l.item.kind === "odb";

/** Every forecast leg and column for one statement. */
export function buildForecastLegs(input: ForecastInput): { columns: ForecastColumn[]; legs: ForecastLeg[]; termFlagged: string[] } {
  const { today, period, months, openingYm, baselines, live, pnl, plans, isCreditorControl, inputs = {} } = input;
  const currentYm = today.slice(0, 7);
  const isBlank = (ym: string) => !!openingYm && ym <= openingYm;
  const keyedSen = (v: unknown) => Math.round(Number(v) || 0);

  // Future months only for this month's statement, as far as a document
  // reaches (owner 2026-11-08 「显示」: a month only a bill reaches is shown),
  // or a keyed capex / financing amount within the input table's months.
  const futureYms: string[] = [];
  if (period === currentYm && live) {
    let horizon = "";
    for (const d of live) if (d.dueSen > 0 && d.expectedYm > currentYm && d.expectedYm > horizon) horizon = d.expectedYm;
    const lastKeyable = addMonthsYm(currentYm, KEYED_MONTHS - 1);
    for (const [ym, cells] of Object.entries(inputs))
      if (ym > currentYm && ym <= lastKeyable && ym > horizon && Object.values(cells ?? {}).some((v) => keyedSen(v) !== 0)) horizon = ym;
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

  // Keyed capex & financing (spec 6.4): on its account, in its month's
  // forecast column wherever that column is shown — a past month keeps what
  // was keyed for it, beside its actual.
  for (const ym of docLegs.keys())
    for (const [code, v] of Object.entries(inputs[ym] ?? {})) {
      const sen = keyedSen(v);
      if (sen) legs.push({ col: fcCol(ym), sen, accountCode: code, item: { kind: "input", party: KEYED_PARTY, ref: code, expectedYm: ym, note: "forecast only, nothing posted" } });
    }

  const flagged = new Set<string>();
  for (const docs of [...baselines.values(), live ?? []]) for (const d of docs) if (d.termFlagged && d.dueSen > 0) flagged.add(d.partyName);
  return { columns, legs, termFlagged: [...flagged].sort() };
}

// ---- The P&L forecast column (spec 2026-11-09-forecast-three-columns-design.md 3) ----

/** The P&L forecast's column key of a month. */
export const fpCol = (ym: string): string => `fp:${ym}`;
/** How far past the current month the P&L forecast reaches (spec 2). */
export const PNL_MONTHS_AHEAD = 12;

/** Shares of money and the delay each comes with, in whole months. */
export type TermMix = { months: number; weight: number }[];

/** A term mix from (delay, amount) pairs, shortest delay first. Nothing to go
 *  by = everything a month later (spec 3: the fallback). */
export function termMixOf(rows: Iterable<{ months: number; sen: number }>): TermMix {
  const by = new Map<number, number>();
  for (const r of rows) if (r.sen > 0 && Number.isInteger(r.months) && r.months >= 0) by.set(r.months, (by.get(r.months) ?? 0) + r.sen);
  const mix = [...by.entries()].sort(([a], [b]) => a - b).map(([months, weight]) => ({ months, weight }));
  return mix.length ? mix : [{ months: 1, weight: 1 }];
}

/** An amount spread over a mix's delays; the parts add up to the amount. */
export function spreadByMix(sen: number, mix: TermMix): { months: number; sen: number }[] {
  const parts = splitByLargestRemainder(sen, mix.map((m) => ({ key: String(m.months), weight: m.weight })));
  return Object.entries(parts)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => ({ months: Number(k), sen: v }))
    .sort((a, b) => a.months - b.months);
}

const termWords = (months: number): string =>
  months === 0 ? "same month" : months === 1 ? "a month later" : `${months} months later`;

export type PnlForecastInput = {
  /** Today, Malaysia time (YYYY-MM-DD). */
  today: string;
  /** The statement's period (YYYY-MM). */
  period: string;
  /** The statement's months, newest first. */
  months: string[];
  openingYm: string | null;
  /** kv `forecast_pnl.months`, as stored. */
  fcMonths: Record<string, FcMonth>;
  groups: FcLineGroups;
  override: Record<string, string>;
  mappedAccounts: ReadonlySet<string>;
  /** Where a department's salary lands (the statement's salary line). */
  salaryAccount: string;
  /** The debtor control: where forecast receipts land. */
  arAcct: string;
  nonCash: (code: string, name: string) => boolean;
  resolveAcct?: (code: string) => string;
  /** A customer's term in months (its `creditTerms`). */
  customerTerm: (customerId: string) => number;
  customerName: (customerId: string) => string;
  /** The term mix of the customer invoices of the three complete months
   *  before today: for a month keyed as one total (spec 3.1). */
  receiptMix: TermMix;
  /** A material type's term mix, from its suppliers' recent purchases (3.2). */
  materialMix: (type: string) => TermMix;
  /** The Docs forecast's last future month: the P&L forecast's months reach
   *  at least that far, so the money both carry lands in both (3.3). */
  minHorizon?: string;
};

/** The owner's Forecast P&L turned into cash (spec 3), in the P&L forecast
 *  columns ("fp:YYYY-MM"): sales arrive after each customer's term (a month
 *  keyed as a total, by the recent invoices' term mix); materials are paid
 *  after their suppliers' terms; salaries the month after; carriage, SST,
 *  overhead and expenses in their month; other income in its month. The
 *  page's own figures (forecastMonthFigures), never scaled by receipts. */
export function buildPnlForecastLegs(input: PnlForecastInput): { columns: ForecastColumn[]; legs: ForecastLeg[] } {
  const { today, period, months, openingYm, fcMonths, groups, override, mappedAccounts, salaryAccount, arAcct, nonCash, customerTerm, customerName, receiptMix, materialMix } = input;
  const resolveAcct = input.resolveAcct ?? ((c: string) => c);
  const currentYm = today.slice(0, 7);
  const isBlank = (ym: string) => !!openingYm && ym <= openingYm;
  const raw: ForecastLeg[] = [];
  const add = (target: string, sen: number, leg: Omit<ForecastLeg, "col" | "sen">) => {
    if (sen) raw.push({ col: fpCol(target), sen, ...leg });
  };
  const item = (party: string, ref: string, expectedYm: string, note: string): ForecastItem => ({ kind: "pnl", party, ref, expectedYm, note });

  for (const S of Object.keys(fcMonths).filter((k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(k)).sort()) {
    const m = fcMonths[S];
    const from = `${monthLabel(S)} Forecast P&L`;
    // Money in: each customer after its own term, Other after a month; a
    // month keyed as one total, by the recent invoices' term mix.
    const cells = Object.entries(m?.salesByCustomer ?? {}).map(([id, v]) => [id, Math.round(Number(v) || 0)] as const).filter(([, v]) => v > 0);
    if (cells.length) {
      for (const [id, sen] of cells) {
        const other = id === FC_OTHER_CUSTOMER;
        const delay = other ? 1 : customerTerm(id);
        const to = addMonthsYm(S, delay);
        add(to, sen, { accountCode: arAcct, item: item(other ? "Other (new customers)" : customerName(id), "sales", to, `${from} sales · ${termWords(delay)}`) });
      }
    } else {
      for (const p of spreadByMix(forecastSalesSen(m), receiptMix)) {
        const to = addMonthsYm(S, p.months);
        add(to, p.sen, { accountCode: arAcct, item: item("Forecast sales", "sales", to, `${from} sales · ${termWords(p.months)} (recent invoices' terms)`) });
      }
    }
    const f = forecastMonthFigures(m, groups, mappedAccounts);
    for (const a of groups.otherIncome) {
      const amt = f.amt(a.code);
      if (amt) add(S, amt, { accountCode: resolveAcct(a.code), item: item(a.name, a.code, S, from) });
    }
    // Materials: on the type's own Raw Materials line, after its suppliers'
    // terms.
    for (const a of groups.materials) {
      const amt = f.amt(a.code);
      if (!amt) continue;
      const type = a.code.startsWith("cat:") ? a.code.slice(4) : a.name;
      for (const p of spreadByMix(amt, materialMix(type))) {
        const to = addMonthsYm(S, p.months);
        add(to, -p.sen, { section: "RAW_MATERIALS", label: type, item: item(type, a.code, to, `${from} · ${termWords(p.months)} (its suppliers' terms)`) });
      }
    }
    for (const a of groups.direct) {
      const amt = f.amt(a.code);
      if (amt && !nonCash(a.code, a.name)) add(S, -amt, { accountCode: resolveAcct(a.code), item: item(a.name, a.code, S, from) });
    }
    // Salaries the month after; overhead and expenses in their month.
    for (const l of forecastCashLines(m, groups, override, mappedAccounts, { salaryAccount, nonCash }).lines) {
      const to = l.timing === "salary" ? addMonthsYm(S, 1) : S;
      add(to, -l.amtSen, {
        accountCode: resolveAcct(l.accountCode), ...(l.label ? { label: l.label } : {}),
        item: item(l.name, l.code, to, l.timing === "salary" ? `${from} · paid the month after` : from),
      });
    }
  }

  // Future months only for this month's statement, as far as the plan's money
  // (or the Docs forecast) reaches, at most PNL_MONTHS_AHEAD ahead.
  const futureYms: string[] = [];
  if (period === currentYm) {
    const cap = addMonthsYm(currentYm, PNL_MONTHS_AHEAD);
    let horizon = input.minHorizon && input.minHorizon > currentYm && input.minHorizon <= cap ? input.minHorizon : "";
    for (const l of raw) {
      const ym = l.col.slice(3);
      if (ym > currentYm && ym <= cap && ym > horizon) horizon = ym;
    }
    for (let ym = addMonthsYm(currentYm, 1); horizon && ym <= horizon; ym = addMonthsYm(ym, 1)) futureYms.push(ym);
  }
  const columns: ForecastColumn[] = [
    ...[...futureYms].reverse().map((ym) => ({ ym, future: true, blank: false, kind: "pnl" as const })),
    ...months.map((ym) => ({ ym, future: false, blank: isBlank(ym), kind: "pnl" as const })),
  ];
  const shown = new Set(columns.filter((c) => !c.blank).map((c) => c.ym));
  return { columns, legs: raw.filter((l) => shown.has(l.col.slice(3))) };
}

const SHARED_KINDS = new Set<ForecastItem["kind"]>(["tf", "planned", "input"]);

/** The money both forecasts carry (spec 3.3): trade-finance repayments,
 *  planned payments and keyed capex / financing, copied from a Docs forecast
 *  column into the P&L forecast column of the same month, where one shows. */
export function sharedForecastLegs(docLegs: readonly ForecastLeg[], pnlColumns: readonly ForecastColumn[]): ForecastLeg[] {
  const shown = new Set(pnlColumns.filter((c) => !c.blank).map((c) => c.ym));
  const out: ForecastLeg[] = [];
  for (const l of docLegs) {
    if (!l.col.startsWith("fc:") || !SHARED_KINDS.has(l.item.kind)) continue;
    const ym = l.col.slice(3);
    if (shown.has(ym)) out.push({ ...l, col: fpCol(ym) });
  }
  return out;
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
