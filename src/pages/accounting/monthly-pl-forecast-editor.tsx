// ---------------------------------------------------------------------------
// MonthlyPlForecastEditor — the Monthly P&L's Edit forecast (owner 2026-11-10
// 「我可以不可以把forecastP&L 自己做去现有的monthly P&L？因为我想要refer 数据」
// → 「我想要A, 因为我的forecast cash flow 也是在cash flow 变动」 → 「做」; spec
// docs/superpowers/specs/2026-11-10-monthly-pl-forecast-edit-design.md).
//
// The Forecast P&L sheet keyed in the P&L's own layout, the actual months
// beside it. The sheet is saved as PUT /forecast (src/lib/forecast-sheet.ts);
// the table is the route's own layout (plForecastMatrix) with the forecast
// worked out from the sheet as it is typed, so every figure, total and %
// follows each keystroke.
//
// Since 2026-11-11 it is also the whole Forecast P&L page (owner 「这个actual
// purchase 会confuse」「这个forecast P&L 就align with montly report 那个的功能就好
// 不就行了？就是两边都应该是一样的view等等」): one editor, two doors. What only
// the old page could do comes with it — removing a month, arrow keys between
// the boxes — and both doors step the financial year here (`period`). Done
// goes back to the view that opened it, where there is one (`onClose`).
// ---------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { HidePastMonthsToggle, PeriodStepper, ReportFrame, ReportToolbar } from "@/components/finance/report-shell";
import { caretEdges, nextCell, type CellPos } from "@/lib/grid-keys";
import { COMPANY } from "@/lib/constants";
import { useNavGuard } from "@/lib/use-nav-guard";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { fmtAmt, foldStatementRows, plMonthHeads } from "@/lib/finance-reports";
import { firstMoneyFieldError, moneyFieldToSen } from "@/lib/money-field";
import { parseMoneyInput } from "@/lib/parse-money";
import { forecastSnapshot } from "@/lib/forecast-snapshot";
import { cellKeyed, customersKeyed, newSheetMonth, partySen, sheetFromSaved, sheetMoneyFields, sheetPayload, toFcMonth, type CellEntry, type SavedMonth, type SheetMonth } from "@/lib/forecast-sheet";
import {
  forecastCustomerRows,
  forecastDepts,
  forecastLineGroups,
  forecastMonthFigures,
  forecastSupplierRows,
  forecastTypeSupplierCells,
  forecastTypeSuppliers,
  supplierActualIds,
  type FcMonthFigures,
  type FcSupplierActuals,
  type FcSupplierMix,
} from "@/lib/forecast-pnl";
import { forecastLinesWindow, forecastPnlWindow, plForecastMatrix, type PlForecastColumn } from "@/lib/pnl-forecast";
import type { PnlMatrixRow, PnlWindowLike } from "@/lib/pnl-matrix";
import { deptsPostingTo, foldMaterialDetail, plEditKey, plPastForecastCol, plRowUnused } from "@/lib/pl-forecast-edit";
import { addMonthsYm } from "@/lib/cashflow-forecast";

type CoaAcct = { code: string; name: string; type: string; isPostable?: boolean };
type DeptLite = { code: string; account: string | null; bucket: string };
type PartyLite = { id: string; name: string; isActive?: boolean };
type EditBase = { fyLabel: string; windows: Record<string, PnlWindowLike>; months: string[]; labels: Record<string, string> };
type Wrapped = { success?: boolean; error?: string; data?: unknown };

// The route's own month label ("Nov 2026").
const labelOfYm = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
const amtTxt = (sen: number) => (sen === 0 ? "-" : fmtAmt(sen));
const pctTxt = (p: number) => (p === 0 ? "-" : p < 0 ? `(${Math.abs(p).toFixed(1)}%)` : `${p.toFixed(1)}%`);
// "400000" → "400,000.00" while not focused (the Forecast P&L page's boxes).
const group = (s: string): string => {
  if (s === "") return "";
  const n = parseMoneyInput(s);
  return n !== null ? n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : s;
};
const BOX = "inline-flex items-center rounded border border-[#E2DDD8] bg-[#FFFBF2] px-1";
const INPUT = "w-full min-w-0 bg-transparent py-0.5 text-right text-[11px] tabular-nums outline-none placeholder:text-[#C7C1BA]";

// A box's place for the arrow keys: its column on the sheet and the handler.
type KeyNav = { col?: number; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void };

// An RM box: the grouped figure while not focused, the raw draft while typing.
function RmBox({ value, hint, onChange, label, col, onKeyDown }: { value: string; hint: string; onChange: (v: string) => void; label: string } & KeyNav) {
  const [focused, setFocused] = useState(false);
  return (
    <span className={`${BOX} w-[7.5rem]`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={focused ? value : group(value)}
        placeholder={hint || "-"}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/,/g, ""))}
        onKeyDown={onKeyDown}
        data-fc-col={col}
        className={INPUT}
      />
    </span>
  );
}
function PctBox({ value, hint, onChange, label, col, onKeyDown }: { value: string; hint: string; onChange: (v: string) => void; label: string } & KeyNav) {
  return (
    <span className={`${BOX} w-[4.25rem]`}>
      <input type="number" step="0.01" aria-label={label} value={value} placeholder={hint || "-"} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} data-fc-col={col} className={INPUT} />
      <span className="ml-0.5 text-[10px] text-[#9CA3AF]">%</span>
    </span>
  );
}

export function MonthlyPlForecastEditor({
  anchor,
  onClose,
  hidePast: hidePastInitial = false,
  period,
  frameTitle,
}: {
  /** A month of the financial year shown (the route's anchor). */
  anchor: string;
  /** Done goes back to the view that opened the editor; the Forecast P&L page has none. */
  onClose?: (saved: boolean) => void;
  hidePast?: boolean;
  /** The months to step through (each stands for its financial year), shown as the editor's own stepper. */
  period?: { options: string[]; onChange: (ym: string) => void };
  frameTitle?: string;
}) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [base, setBase] = useState<EditBase | null>(null);
  // The year `base` was read for: another year stepped to shows Loading until it is in.
  const [baseAnchor, setBaseAnchor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CoaAcct[]>([]);
  const [override, setOverride] = useState<Record<string, string>>({});
  const [depts, setDepts] = useState<DeptLite[]>([]);
  const [mappedAccounts, setMappedAccounts] = useState<Set<string>>(new Set());
  const [customerMaster, setCustomerMaster] = useState<PartyLite[]>([]);
  const [supplierMaster, setSupplierMaster] = useState<PartyLite[]>([]);
  const [supplierMix, setSupplierMix] = useState<FcSupplierMix>({ bySupplier: {}, all: {} });
  const [sheet, setSheet] = useState<Record<string, SheetMonth>>({});
  const [savedSnap, setSavedSnap] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  // Rows opened to their detail (▸): "sales", "cat:<TYPE>", an account code.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Owner 2026-11-10 「我也要一个按钮和cash flow 一样，hide 已经过了的month」:
  // as the view was when Edit forecast opened. And 「点开全部和收起没用到的」:
  // Hide unused takes away every row with no figure in any month.
  const [hidePast, setHidePast] = useState(hidePastInitial);
  const [hideUnused, setHideUnused] = useState(false);
  // Owner 2026-11-11 「我要看到actual 的categories 的actual 那个月的purchase
  // total罢了」: a material type's row shows the month's actual purchases, and
  // the stock detail under it (opening / purchase / closing per stock group)
  // stays folded until Show detail.
  const [showDetail, setShowDetail] = useState(false);
  // Who each actual purchase was from (owner 2026-11-11 「我看不到actual 的fabric
  // … 是从谁买」): month → material type → supplier → sen, for the
  // supplier rows' Actual cells (GET /forecast/supplier-actuals).
  const [supplierActs, setSupplierActs] = useState<FcSupplierActuals>({});

  useEffect(() => {
    let live = true;
    const json = (r: Response) => r.json() as Promise<Wrapped>;
    Promise.all([
      fetch(`/api/accounting/pl-monthly?line=all&anchor=${anchor}&forecast=1&edit=1`, { cache: "no-store" }).then(json),
      fetch("/api/accounting/coa").then(json),
      fetch("/api/accounting/pnl/section-map").then(json),
      fetch("/api/accounting/forecast", { cache: "no-store" }).then(json),
      fetch("/api/accounting/labor/departments").then(json).catch(() => ({}) as Wrapped),
      fetch("/api/customers").then(json).catch(() => ({}) as Wrapped),
      fetch("/api/accounting/forecast/suppliers").then(json).catch(() => ({}) as Wrapped),
    ])
      .then(([plJ, coaJ, mapJ, fcJ, deptJ, custJ, supJ]) => {
        if (!live) return;
        const pl = plJ?.data as { fyLabel?: string; columns?: PlForecastColumn[]; edit?: { windows?: Record<string, PnlWindowLike>; months?: string[] } } | undefined;
        if (!plJ?.success || !pl?.edit?.windows?.acc || !Array.isArray(pl.edit.months)) throw new Error(plJ?.error || "Could not load the Monthly P&L");
        if (!fcJ?.success) throw new Error(fcJ?.error || "Could not load the forecast");
        const labels: Record<string, string> = {};
        for (const c of pl.columns ?? []) if (c.ym && !c.forecast) labels[c.ym] = c.label;
        setBase({ fyLabel: pl.fyLabel ?? "", windows: pl.edit.windows, months: pl.edit.months, labels });
        setBaseAnchor(anchor);
        const coa = (coaJ?.data ?? coaJ ?? []) as CoaAcct[];
        setAccounts(Array.isArray(coa) ? coa : []);
        setOverride(((mapJ?.data as { map?: Record<string, string> } | undefined)?.map ?? {}) as Record<string, string>);
        const dd = deptJ?.data as { departments?: { code?: unknown; account?: unknown; bucket?: unknown }[]; mappedAccounts?: unknown[] } | undefined;
        setDepts((dd?.departments ?? []).filter((d) => typeof d?.code === "string" && d.code !== "").map((d) => ({ code: String(d.code), account: d.account ? String(d.account) : null, bucket: String(d.bucket ?? "DIRECT_LABOUR") })));
        setMappedAccounts(new Set((dd?.mappedAccounts ?? []).map(String)));
        const custs = custJ?.data;
        setCustomerMaster(Array.isArray(custs) ? (custs as { id?: unknown; name?: unknown; isActive?: unknown }[]).filter((x) => typeof x?.id === "string" && x.id !== "").map((x) => ({ id: String(x.id), name: String(x.name ?? x.id), isActive: x.isActive !== false })) : []);
        const sup = supJ?.success ? (supJ.data as { suppliers?: PartyLite[]; mix?: FcSupplierMix } | undefined) : undefined;
        if (sup?.mix && Array.isArray(sup.suppliers)) {
          setSupplierMaster(sup.suppliers.filter((s) => typeof s?.id === "string" && s.id !== ""));
          setSupplierMix({ bySupplier: sup.mix.bySupplier ?? {}, all: sup.mix.all ?? {} });
        }
        const next = sheetFromSaved(((fcJ.data as { months?: Record<string, SavedMonth> } | undefined)?.months ?? {}));
        setSheet(next);
        setSavedSnap(forecastSnapshot(next));
      })
      .catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [anchor]);

  useEffect(() => {
    if (!base || base.months.length === 0) return;
    let live = true;
    const sorted = [...base.months].sort();
    fetch(`/api/accounting/forecast/supplier-actuals?from=${sorted[0]}&to=${sorted[sorted.length - 1]}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ success?: boolean; data?: { months?: FcSupplierActuals } }>)
      .then((j) => { if (live && j?.success) setSupplierActs(j.data?.months ?? {}); })
      .catch(() => {});
    return () => { live = false; };
  }, [base]);

  // The forecast's line structure, the route's way (loadMonthlyPlForecast).
  const groups = useMemo(
    () => forecastLineGroups(accounts, override, forecastDepts(depts, Object.values(sheet).map((m) => m.pct))),
    [accounts, override, depts, sheet],
  );
  const deptAccount = useMemo(() => {
    const m = new Map(depts.map((d) => [d.code, d.account] as const));
    return (d: string) => m.get(d) ?? null;
  }, [depts]);
  const opts = useMemo(() => {
    const coaBy = new Map(accounts.map((a) => [a.code, { name: a.name, type: a.type }] as const));
    return { override, mappedAccounts, deptAccount, accountOf: (code: string) => coaBy.get(code) };
  }, [accounts, override, mappedAccounts, deptAccount]);

  // The months ahead shown: as the route, only when the year shown is the
  // current one, up to the last forecast month within twelve.
  const curYm = todayYmdMY().slice(0, 7);
  const futureYms = useMemo(() => {
    if (anchor !== curYm) return [] as string[];
    const reach = Object.keys(sheet).filter((ym) => /^\d{4}-\d{2}$/.test(ym) && ym > curYm && ym <= addMonthsYm(curYm, 12)).sort().pop();
    const out: string[] = [];
    for (let ym = addMonthsYm(curYm, 1); reach && ym <= reach; ym = addMonthsYm(ym, 1)) out.push(ym);
    return out;
  }, [anchor, curYm, sheet]);

  const fcWindows = useMemo(() => {
    const out = new Map<string, PnlWindowLike>();
    for (const ym of [...(base?.months ?? []), ...futureYms]) out.set(ym, forecastPnlWindow(toFcMonth(sheet[ym]), groups, opts));
    return out;
  }, [base, futureYms, sheet, groups, opts]);
  const figures = useMemo(() => {
    const out = new Map<string, FcMonthFigures>();
    for (const ym of Object.keys(sheet)) out.set(ym, forecastMonthFigures(toFcMonth(sheet[ym]), groups, mappedAccounts));
    return out;
  }, [sheet, groups, mappedAccounts]);

  const matrix = useMemo(() => {
    if (!base) return null;
    const labelOf = (ym: string) => base.labels[ym] ?? labelOfYm(ym);
    return plForecastMatrix({
      accWindow: base.windows.acc,
      monthCols: base.months.filter((ym) => base.windows[ym]).map((ym) => ({ key: ym, label: labelOf(ym), accum: false, window: base.windows[ym] })),
      futureYms,
      forecastOf: (ym) => fcWindows.get(ym) ?? forecastPnlWindow(undefined, groups, opts),
      labelOf,
      // Every line the forecast keys gets a row, figures or not.
      extraSpine: forecastLinesWindow(groups, opts),
    });
  }, [base, futureYms, fcWindows, groups, opts]);

  // ---- The sheet, as the Forecast P&L page keys it ----
  const setMonth = (ym: string, fn: (m: SheetMonth) => SheetMonth) => setSheet((prev) => (prev[ym] ? { ...prev, [ym]: fn(prev[ym]) } : prev));
  // Keying one side clears the other (owner: "就是其中一个").
  const setLine = (ym: string, code: string, cell: CellEntry) => setMonth(ym, (m) => ({ ...m, pct: { ...m.pct, [code]: cell } }));
  const setSales = (ym: string, v: string) => setMonth(ym, (m) => ({ ...m, salesStr: v }));
  const setCustomer = (ym: string, id: string, v: string) => setMonth(ym, (m) => ({ ...m, customers: { ...(m.customers ?? {}), [id]: v } }));
  const setSupplier = (ym: string, type: string, id: string, cell: CellEntry) =>
    setMonth(ym, (m) => ({ ...m, suppliers: { ...(m.suppliers ?? {}), [type]: { ...(m.suppliers?.[type] ?? {}), [id]: cell } } }));
  const side = (v: string, s: "a" | "p"): CellEntry => (v === "" ? {} : s === "a" ? { a: v } : { p: v });

  const customerRows = useMemo(
    () => forecastCustomerRows(customerMaster, Object.values(sheet).flatMap((m) => Object.entries(m.customers ?? {}).filter(([, v]) => (v ?? "").trim() !== "").map(([id]) => id))),
    [customerMaster, sheet],
  );
  const customerName = (id: string) => customerRows.find((r) => r.id === id)?.name ?? id;
  const supplierRowsOf = (type: string) =>
    forecastSupplierRows(supplierMaster, forecastTypeSuppliers(supplierMix, type), [
      ...Object.values(sheet).flatMap((m) => Object.entries(m.suppliers?.[type] ?? {}).filter(([, e]) => cellKeyed(e)).map(([id]) => id)),
      // A supplier we actually bought this material from in the year shown, active or not.
      ...supplierActualIds(supplierActs, type),
    ]);
  const supplierNames = useMemo(() => new Map(supplierMaster.map((s) => [s.id, s.name] as const)), [supplierMaster]);
  const supplierName = (id: string) => (id === "other" ? "Other (new suppliers)" : supplierNames.get(id) ?? `Unknown supplier (${id})`);

  const snap = useMemo(() => forecastSnapshot(sheet), [sheet]);
  const dirty = savedSnap !== null && snap !== savedSnap;
  useNavGuard(dirty, "You have unsaved forecast changes. Leave without saving?");
  const moneyError = firstMoneyFieldError(sheetMoneyFields(sheet, { customerName, supplierName }));

  const save = async () => {
    if (moneyError) { toast.error(moneyError); return; }
    setSaving(true);
    try {
      const payload = sheetPayload(sheet);
      const res = await fetch("/api/accounting/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: payload }),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (res.ok && j?.success) {
        toast.success("Forecast saved");
        setSavedSnap(snap);
        setSavedOnce(true);
        // The Cash Flow forecast is worked out from this sheet (as on the Forecast P&L page).
        invalidateCachePrefix("/api/accounting/cashflow-forecast");
      } else toast.error(j?.error || "Couldn't save the forecast — please try again.");
    } catch {
      toast.error("Couldn't save the forecast — connection hiccup, please try again.");
    }
    setSaving(false);
  };
  const close = async () => {
    if (dirty && !(await confirm({ title: "Discard changes?", message: "Your forecast changes are not saved. Leave Edit forecast without saving?", danger: true }))) return;
    onClose?.(savedOnce);
  };
  // Another financial year: the sheet is read again, so unsaved changes would go.
  const stepPeriod = async (ym: string) => {
    if (!period || ym === anchor) return;
    if (dirty && !(await confirm({ title: "Discard changes?", message: "Your forecast changes are not saved. Show another year without saving?", danger: true }))) return;
    period.onChange(ym);
  };
  // A month's forecast taken off the sheet (the old Forecast P&L page's ×): asks
  // first, and like every change it goes when you Save.
  const removeMonth = async (ym: string) => {
    if (!(await confirm({ title: "Remove month?", message: `Remove ${labelOfYm(ym)}'s forecast? It goes when you Save.`, danger: true }))) return;
    setSheet((prev) => {
      const next = { ...prev };
      delete next[ym];
      return next;
    });
  };

  // Months that can be added: the year's months and the twelve ahead that
  // have no forecast yet (each starts from the previous month's percentages).
  const addable = useMemo(() => {
    const ahead = anchor === curYm ? Array.from({ length: 12 }, (_, i) => addMonthsYm(curYm, i + 1)) : [];
    return [...new Set([...(base?.months ?? []), ...ahead])].filter((ym) => !sheet[ym]).sort();
  }, [anchor, curYm, base, sheet]);

  if (loadError) return <p className="text-sm text-[#9A3412]">Couldn't open Edit forecast: {loadError}</p>;
  if (!base || !matrix || savedSnap === null || baseAnchor !== anchor) return <div className="py-12 text-center text-sm text-[#6B7280]">Loading the forecast…</div>;

  const cols = matrix.columns;
  // Hide past months (as on Cash Flow): a past month's Forecast columns go,
  // its Actual stays. `vis` keeps each column's place in the row values.
  const vis = cols.map((c, j) => [c, j] as const).filter(([c]) => !(hidePast && plPastForecastCol(c, curYm)));
  const hasPast = cols.some((c) => plPastForecastCol(c, curYm));
  const span = vis.length * 2 + 1;
  // Arrow keys and Enter move between the keyed boxes, as the Forecast P&L page
  // always did (src/lib/grid-keys.ts): Up / Down never nudge a number; Left /
  // Right move only from the edge of the text. A box's column is 2 × its
  // column's place (the RM box), + 1 for the % box.
  const colOf = (c: PlForecastColumn) => vis.findIndex(([v]) => v.key === c.key) * 2;
  const onCellKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
    const el = e.currentTarget;
    const table = el.closest("table");
    const tr = el.closest("tr");
    if (!table || !tr) return;
    const rowsEls = [...table.querySelectorAll<HTMLTableRowElement>("tbody > tr")].filter((r) => r.querySelector("input[data-fc-col]"));
    const width = vis.length * 2;
    const caret = caretEdges(el);
    let pos: CellPos | null = { row: rowsEls.indexOf(tr), col: Number(el.dataset.fcCol) };
    for (let step = 0; step < rowsEls.length + width; step++) {
      pos = nextCell(pos, e.key, caret, rowsEls.length, width);
      if (!pos) return;
      const target = rowsEls[pos.row]?.querySelector<HTMLInputElement>(`input[data-fc-col="${pos.col}"]`);
      if (target) {
        e.preventDefault();
        target.focus();
        target.select();
        return;
      }
    }
  };
  const tagOf = (c: PlForecastColumn) => `${c.accum ? " acc" : ""}${c.forecast ? " fc fp" : ""}`;
  const keyMonth = (c: PlForecastColumn) => (c.forecast && !c.accum && c.ym ? c.ym : null);
  const shown = foldStatementRows(matrix.rows, new Set());
  const rowsShown = showDetail ? shown : foldMaterialDetail(shown);
  const lastGrand = matrix.rows.filter((r) => r.kind === "grandtotal").pop();

  // A figure cell pair, as the read-only view draws it.
  const figure = (c: PlForecastColumn, v: number, p: number, show: boolean, muted = false) => (
    <Fragment key={c.key}>
      <td data-cell={`num split${tagOf(c)}`} data-neg={show && v < 0 ? "" : undefined} className={muted ? "text-[#9CA3AF]" : undefined}>{show ? amtTxt(v) : ""}</td>
      <td data-cell={`num pct${tagOf(c)}`} className={muted ? "text-[#9CA3AF]" : undefined}>{show ? pctTxt(p) : ""}</td>
    </Fragment>
  );
  // The RM and % boxes of one keyed cell; the empty box shows the other side.
  const boxes = (c: PlForecastColumn, label: string, e: CellEntry, amtSen: number, salesSen: number, onAmt: (v: string) => void, onPct: (v: string) => void) => (
    <Fragment key={c.key}>
      <td data-cell={`num split${tagOf(c)}`}>
        <RmBox label={`${label} RM`} value={e.a ?? ""} hint={(e.p ?? "").trim() !== "" ? group((amtSen / 100).toFixed(2)) : ""} onChange={onAmt} col={colOf(c)} onKeyDown={onCellKey} />
      </td>
      <td data-cell={`num pct${tagOf(c)}`}>
        <PctBox label={`${label} %`} value={e.p ?? ""} hint={(e.a ?? "").trim() !== "" && salesSen > 0 ? ((amtSen / salesSen) * 100).toFixed(2) : ""} onChange={onPct} col={colOf(c) + 1} onKeyDown={onCellKey} />
      </td>
    </Fragment>
  );
  const noMonth = (c: PlForecastColumn) => (
    <Fragment key={c.key}>
      <td data-cell={`num split${tagOf(c)}`} title="No forecast for this month yet — add it with Add month" className="text-[#C4BDB3]">-</td>
      <td data-cell={`num pct${tagOf(c)}`} />
    </Fragment>
  );

  // What a keyed row shows in each column.
  const editCells = (r: PnlMatrixRow, k: string, show: boolean) =>
    vis.map(([c, j]) => {
      const ym = keyMonth(c);
      // A material type's Actual (and Accumulated) cells: that column's
      // purchases of the type and their % of sales — what the forecast is
      // keyed from — rather than the cost after stock.
      if (!ym && r.purchaseValues) return figure(c, r.purchaseValues[j] ?? 0, r.purchasePctValues?.[j] ?? 0, true);
      if (!ym) return figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, show);
      const m = sheet[ym];
      if (!m) return noMonth(c);
      const f = figures.get(ym);
      if (!f) return noMonth(c);
      const label = `${labelOfYm(ym)} ${r.label}`;
      if (k === "sales") {
        // Only a customer figure above 0 makes Sales their total (customersKeyed).
        if (customersKeyed(m)) return figure(c, f.salesSen, 100, true, true);
        return (
          <Fragment key={c.key}>
            <td data-cell={`num split${tagOf(c)}`}><RmBox label={`${label} RM`} value={m.salesStr} hint="" onChange={(v) => setSales(ym, v)} col={colOf(c)} onKeyDown={onCellKey} /></td>
            <td data-cell={`num pct${tagOf(c)}`} />
          </Fragment>
        );
      }
      if (k.startsWith("cat:") && f.supplierKeyed(k)) return figure(c, f.amt(k), r.pctValues[j] ?? 0, true, true);
      if (f.superseded(k)) return figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true, true);
      return boxes(c, label, m.pct[k] ?? {}, f.amt(k), f.salesSen, (v) => setLine(ym, k, side(v, "a")), (v) => setLine(ym, k, side(v, "p")));
    });

  // A detail row under a keyed row: boxes in the forecast months; `actual`
  // fills the other columns (a supplier's actual purchases), blank without it.
  const blankPair = (c: PlForecastColumn) => <Fragment key={c.key}><td data-cell={`num split${tagOf(c)}`} /><td data-cell={`num pct${tagOf(c)}`} /></Fragment>;
  const detailRow = (key: string, depth: number, name: string, cell: ((ym: string, c: PlForecastColumn) => ReactNode) | null, actual?: (c: PlForecastColumn, j: number) => ReactNode) => (
    <tr key={key} data-row="line">
      <td data-cell="stick" className="text-[12px] text-[#4B5563]" style={{ paddingLeft: `${14 + depth * 18}px` }}>{name}</td>
      {vis.map(([c, j]) => {
        const ym = keyMonth(c);
        if (!ym || !cell) return actual ? actual(c, j) : blankPair(c);
        if (!sheet[ym]) return noMonth(c);
        return cell(ym, c);
      })}
    </tr>
  );
  // A supplier's actual purchases of a material (owner 2026-11-11 「我看不到
  // actual 的fabric … 是从谁买」): an Actual column's month, or the
  // year's months added up in Accumulated; the forecast columns are not theirs.
  const colSales = (c: PlForecastColumn) => (c.accum ? base.windows.acc?.netSalesSen : c.ym ? base.windows[c.ym]?.netSalesSen : 0) ?? 0;
  const pctOfSales = (sen: number, c: PlForecastColumn) => { const s = colSales(c); return s ? Math.round((sen / s) * 1000) / 10 : 0; };
  const actualMonths = (c: PlForecastColumn) => (c.accum ? base.months : c.ym ? [c.ym] : []);
  const supplierActualSen = (type: string, id: string, c: PlForecastColumn) =>
    actualMonths(c).reduce((s, ym) => s + (supplierActs[ym]?.[type]?.[id] ?? 0), 0);
  const allSuppliersActualSen = (type: string, c: PlForecastColumn) =>
    actualMonths(c).reduce((s, ym) => s + Object.values(supplierActs[ym]?.[type] ?? {}).reduce((a, v) => a + v, 0), 0);
  const supplierActualCell = (type: string, id: string) => (c: PlForecastColumn) => {
    if (c.forecast) return blankPair(c);
    const sen = supplierActualSen(type, id, c);
    return figure(c, sen, pctOfSales(sen, c), true);
  };
  // What the supplier invoices do not explain of a material's purchases (a
  // journal, an other-creditor bill): its row's purchases less the suppliers'.
  const remainderOf = (k: string, c: PlForecastColumn, j: number) => {
    const typeRow = matrix.rows.find((r) => r.kind === "group" && r.fcKey === k);
    return (typeRow?.purchaseValues?.[j] ?? 0) - allSuppliersActualSen(k.slice(4), c);
  };
  // A customer, supplier or department row with something keyed in some
  // month — Hide unused keeps only these.
  const detailUsed = (kind: "cu" | "su" | "de", type: string, id: string) =>
    Object.values(sheet).some((m) =>
      kind === "cu" ? (partySen(m.customers)[id] ?? 0) > 0 : kind === "su" ? cellKeyed(m.suppliers?.[type]?.[id]) : cellKeyed(m.pct[id]),
    );
  const details = (k: string, depth: number): ReactNode => {
    if (!open[k]) return null;
    if (k === "sales")
      return customerRows.filter((cr) => !hideUnused || detailUsed("cu", "", cr.id)).map((cr) =>
        detailRow(`cu-${cr.id}`, depth, cr.name, (ym, c) => {
          const f = figures.get(ym);
          const sen = Math.max(0, moneyFieldToSen(sheet[ym].customers?.[cr.id] ?? "") ?? 0);
          return (
            <Fragment key={c.key}>
              <td data-cell={`num split${tagOf(c)}`}><RmBox label={`${labelOfYm(ym)} ${cr.name} sales`} value={sheet[ym].customers?.[cr.id] ?? ""} hint="" onChange={(v) => setCustomer(ym, cr.id, v)} col={colOf(c)} onKeyDown={onCellKey} /></td>
              <td data-cell={`num pct${tagOf(c)}`} className="text-[#9CA3AF]">{sen > 0 && f && f.salesSen > 0 ? `${((sen / f.salesSen) * 100).toFixed(1)}%` : ""}</td>
            </Fragment>
          );
        }),
      );
    if (k.startsWith("cat:")) {
      const type = k.slice(4);
      const rows = supplierRowsOf(type).filter((sr) => !hideUnused || detailUsed("su", type, sr.id) || supplierActualIds(supplierActs, type).includes(sr.id)).map((sr) =>
        detailRow(`su-${type}-${sr.id}`, depth, sr.name, (ym, c) => {
          const e = sheet[ym].suppliers?.[type]?.[sr.id] ?? {};
          const sen = new Map(forecastTypeSupplierCells(toFcMonth(sheet[ym]), type)).get(sr.id) ?? 0;
          return boxes(c, `${labelOfYm(ym)} ${type} ${sr.name}`, e, sen, figures.get(ym)?.salesSen ?? 0, (v) => setSupplier(ym, type, sr.id, side(v, "a")), (v) => setSupplier(ym, type, sr.id, side(v, "p")));
        }, supplierActualCell(type, sr.id)),
      );
      // The rest of the material's actual purchases, so the rows add up to it.
      const rest = vis.some(([c, j]) => !c.forecast && remainderOf(k, c, j) !== 0);
      if (rest) {
        rows.push(detailRow(`su-${type}-rest`, depth, "Other purchases (no supplier invoice)", null, (c, j) => {
          if (c.forecast) return blankPair(c);
          const sen = remainderOf(k, c, j);
          return figure(c, sen, pctOfSales(sen, c), true, true);
        }));
      }
      return rows;
    }
    return deptsPostingTo(k, groups, deptAccount).filter((d) => !hideUnused || detailUsed("de", "", d.code)).map((d) =>
      detailRow(`de-${k}-${d.code}`, depth, d.name, (ym, c) => {
        const f = figures.get(ym);
        return boxes(c, `${labelOfYm(ym)} ${d.name}`, sheet[ym].pct[d.code] ?? {}, f?.amt(d.code) ?? 0, f?.salesSen ?? 0, (v) => setLine(ym, d.code, side(v, "a")), (v) => setLine(ym, d.code, side(v, "p")));
      }),
    );
  };
  const hasDetail = (k: string) => k === "sales" || k.startsWith("cat:") || deptsPostingTo(k, groups, deptAccount).length > 0;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // Open all / Close all (owner 2026-11-10 「点开全部」): every ▸ on the sheet.
  const detailKeys = [...new Set(matrix.rows.map((r) => plEditKey(r, groups)).filter((k): k is string => !!k && hasDetail(k)))];
  const allOpen = detailKeys.length > 0 && detailKeys.every((k) => open[k]);
  const opener = (k: string, label: string) =>
    hasDetail(k) ? (
      <button type="button" onClick={() => toggle(k)} className="cursor-pointer text-left uppercase hover:underline decoration-dotted"
        title={k === "sales" ? "Key Sales per customer" : k.startsWith("cat:") ? "Key this material per supplier" : "Key the departments whose wages post here"}>
        <span aria-hidden="true" className="mr-1.5 inline-block w-3 text-[10px] text-[#9CA3AF]">{open[k] ? "▾" : "▸"}</span>{label}
      </button>
    ) : label;

  return (
    <div className="space-y-3">
      <ReportToolbar>
        {period && <PeriodStepper value={anchor} options={period.options} onChange={(ym) => void stepPeriod(ym)} />}
        <span className="text-[12px] font-semibold text-[#6B5C32]">Edit forecast</span>
        <select
          aria-label="Add month"
          value=""
          onChange={(e) => { const ym = e.target.value; if (ym) setSheet((prev) => (prev[ym] ? prev : { ...prev, [ym]: newSheetMonth(prev, ym) })); }}
          className="h-8 rounded-md border border-[#E2DDD8] bg-white px-2 text-xs text-[#4B5563]"
          disabled={addable.length === 0}
        >
          <option value="">Add month…</option>
          {addable.map((ym) => <option key={ym} value={ym}>{labelOfYm(ym)}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(detailKeys.map((k) => [k, true])))}
          title="Open or close every ▸ at once: customers, suppliers and departments">
          {allOpen ? "Close all" : "Open all"}
        </Button>
        <Button size="sm" variant={showDetail ? "default" : "outline"} aria-pressed={showDetail} onClick={() => setShowDetail((v) => !v)}
          title="A material's row shows the month's actual purchases; Show detail adds its stock groups (opening, purchase, closing) under it">
          {showDetail ? "Hide detail" : "Show detail"}
        </Button>
        <Button size="sm" variant={hideUnused ? "default" : "outline"} aria-pressed={hideUnused} onClick={() => setHideUnused((v) => !v)}
          title="Hide every row with no figure in any month, the opened customers, suppliers and departments included; press again to show them all">
          Hide unused
        </Button>
        {hasPast && <HidePastMonthsToggle on={hidePast} onToggle={() => setHidePast((v) => !v)} />}
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
        </Button>
        {onClose && (
          <Button size="sm" variant="outline" onClick={() => void close()}>
            <X className="mr-1 h-4 w-4" /> Done
          </Button>
        )}
      </ReportToolbar>
      {dirty && (
        <div data-fin-banner="todo" className="flex min-h-10 flex-wrap items-center gap-2.5 rounded-[10px] border border-[#E9D9B4] bg-[#FBF6EC] px-3.5 py-2.5">
          <span className="text-[13px] font-bold text-[#7A5B12]">You have unsaved changes</span>
          <span className="text-[12px] text-[#4B5563]">Save keeps them for the Forecast P&L, Cash Flow and the Dashboard; leaving asks first.</span>
        </div>
      )}
      <ReportFrame
        company={COMPANY.HOOKKA.name}
        title={frameTitle ?? "Monthly Profit-and-Loss (Overall) — Edit forecast"}
        note={`${base.fyLabel} · each month's Forecast takes RM or % of that month's sales · a material's Actual is that month's purchases · ▸ opens customers, suppliers or departments · all amounts RM${hidePast ? " · past months' forecasts hidden" : ""}${hideUnused ? " · rows with no figure hidden" : ""}`}
        maxHeight="calc(100vh - 340px)"
      >
        <table data-col-resize="first" data-fin-report data-fin-fit>
          <thead>
            <tr data-row="h1">
              <th rowSpan={2} data-cell="stick" className="min-w-[260px]">Item</th>
              {plMonthHeads(vis.map(([c]) => c)).map((h) => (
                <th key={h.key} colSpan={h.span} data-cell={`split center${h.accum ? " acc" : ""}${h.forecastOnly ? " fc fp" : ""}`}>{h.label}</th>
              ))}
            </tr>
            <tr data-row="h2">
              {vis.map(([c]) => {
                // A month on the sheet: its Forecast head carries the ×.
                const ym = keyMonth(c);
                return (
                  <Fragment key={c.key}>
                    <th data-cell={`num split${tagOf(c)}`}>
                      {c.forecast ? "Forecast" : "Actual"}
                      {ym && sheet[ym] && (
                        <button
                          type="button"
                          onClick={() => void removeMonth(ym)}
                          aria-label={`Remove ${labelOfYm(ym)}'s forecast`}
                          title="Remove this month's forecast — asks first, goes when you Save"
                          className="ml-1 rounded px-0.5 font-normal text-[#9CA3AF] hover:bg-[#F0ECE9] hover:text-[#1F1D1B]"
                        >
                          ×
                        </button>
                      )}
                    </th>
                    <th data-cell={`num pct${tagOf(c)}`}>%</th>
                  </Fragment>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowsShown.map(({ row: r, close: isClose }, i) => {
              // Hide unused: a line or group (and its total line) with no
              // figure in any column; Sales and the totals always stay.
              if (hideUnused && (r.kind === "line" || r.kind === "group") && r.fcKey !== "sales" && plRowUnused(r)) return null;
              const pad = { paddingLeft: `${14 + r.depth * 18}px` };
              if (isClose) {
                return (
                  <tr key={`c${i}`} data-row="sub">
                    <td data-cell="stick" className="uppercase" style={pad}>{r.totalLabel ?? `TOTAL ${r.label}`}</td>
                    {vis.map(([c, j]) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true))}
                  </tr>
                );
              }
              if (r.kind === "gap") return <tr key={`gap${i}`} aria-hidden="true" data-row="gap"><td colSpan={span} /></tr>;
              if (r.kind === "grandtotal" || r.kind === "total") {
                const grand = r.kind === "grandtotal";
                return (
                  <tr key={i} data-row={grand ? "res" : "sub"} data-fin-double={grand && r === lastGrand ? "" : undefined}>
                    <td data-cell="stick" className="uppercase" style={pad}>{r.label}</td>
                    {vis.map(([c, j]) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true))}
                  </tr>
                );
              }
              const k = plEditKey(r, groups);
              if (r.kind === "group") {
                // An open group shows its figures on its total line; a keyed
                // group (Sales, a material) takes its boxes on this heading.
                return (
                  <Fragment key={i}>
                    <tr data-row={r.depth === 0 ? "sec" : "grp"}>
                      <td data-cell="stick" className="uppercase" style={pad}>{k ? opener(k, r.label) : r.label}</td>
                      {k ? editCells(r, k, false) : vis.map(([c, j]) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, false))}
                    </tr>
                    {k && details(k, r.depth + 1)}
                  </Fragment>
                );
              }
              return (
                <Fragment key={i}>
                  <tr data-row="line">
                    <td data-cell="stick" className={`uppercase ${r.depth >= 3 ? "text-[12px] text-[#6B7280]" : ""}`} style={pad}>{k ? opener(k, r.label) : r.label}</td>
                    {k ? editCells(r, k, true) : vis.map(([c, j]) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true))}
                  </tr>
                  {k && details(k, r.depth + 1)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </ReportFrame>
    </div>
  );
}
