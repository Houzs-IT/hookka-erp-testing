// ---------------------------------------------------------------------------
// MonthlyPlForecastEditor — the Monthly P&L's Edit forecast (owner 2026-11-10
// 「我可以不可以把forecastP&L 自己做去现有的monthly P&L？因为我想要refer 数据」
// → 「我想要A, 因为我的forecast cash flow 也是在cash flow 变动」 → 「做」; spec
// docs/superpowers/specs/2026-11-10-monthly-pl-forecast-edit-design.md).
//
// The Forecast P&L sheet keyed in the P&L's own layout, the actual months
// beside it. The sheet is the Forecast P&L page's (src/lib/forecast-sheet.ts),
// saved the same way (PUT /forecast); the table is the route's own layout
// (plForecastMatrix) with the forecast worked out from the sheet as it is
// typed, so every figure, total and % follows each keystroke.
// ---------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ReportFrame, ReportToolbar } from "@/components/finance/report-shell";
import { COMPANY } from "@/lib/constants";
import { useNavGuard } from "@/lib/use-nav-guard";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { fmtAmt, foldStatementRows, plMonthHeads } from "@/lib/finance-reports";
import { firstMoneyFieldError, moneyFieldToSen } from "@/lib/money-field";
import { parseMoneyInput } from "@/lib/parse-money";
import { forecastSnapshot } from "@/lib/forecast-snapshot";
import { cellKeyed, newSheetMonth, sheetFromSaved, sheetMoneyFields, sheetPayload, toFcMonth, type CellEntry, type SavedMonth, type SheetMonth } from "@/lib/forecast-sheet";
import {
  forecastCustomerRows,
  forecastDepts,
  forecastLineGroups,
  forecastMonthFigures,
  forecastSupplierRows,
  forecastTypeSupplierCells,
  forecastTypeSuppliers,
  type FcMonthFigures,
  type FcSupplierMix,
} from "@/lib/forecast-pnl";
import { forecastLinesWindow, forecastPnlWindow, plForecastMatrix, type PlForecastColumn } from "@/lib/pnl-forecast";
import type { PnlMatrixRow, PnlWindowLike } from "@/lib/pnl-matrix";
import { deptsPostingTo, plEditKey } from "@/lib/pl-forecast-edit";
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

// An RM box: the grouped figure while not focused, the raw draft while typing.
function RmBox({ value, hint, onChange, label }: { value: string; hint: string; onChange: (v: string) => void; label: string }) {
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
        className={INPUT}
      />
    </span>
  );
}
function PctBox({ value, hint, onChange, label }: { value: string; hint: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className={`${BOX} w-[4.25rem]`}>
      <input type="number" step="0.01" aria-label={label} value={value} placeholder={hint || "-"} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      <span className="ml-0.5 text-[10px] text-[#9CA3AF]">%</span>
    </span>
  );
}

export function MonthlyPlForecastEditor({ anchor, onClose }: { anchor: string; onClose: (saved: boolean) => void }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [base, setBase] = useState<EditBase | null>(null);
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
    forecastSupplierRows(supplierMaster, forecastTypeSuppliers(supplierMix, type), Object.values(sheet).flatMap((m) => Object.entries(m.suppliers?.[type] ?? {}).filter(([, e]) => cellKeyed(e)).map(([id]) => id)));
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
    onClose(savedOnce);
  };

  // Months that can be added: the year's months and the twelve ahead that
  // have no forecast yet (each starts from the previous month's percentages).
  const addable = useMemo(() => {
    const ahead = anchor === curYm ? Array.from({ length: 12 }, (_, i) => addMonthsYm(curYm, i + 1)) : [];
    return [...new Set([...(base?.months ?? []), ...ahead])].filter((ym) => !sheet[ym]).sort();
  }, [anchor, curYm, base, sheet]);

  if (loadError) return <p className="text-sm text-[#9A3412]">Couldn't open Edit forecast: {loadError}</p>;
  if (!base || !matrix || savedSnap === null) return <div className="py-12 text-center text-sm text-[#6B7280]">Loading the forecast…</div>;

  const cols = matrix.columns;
  const span = cols.length * 2 + 1;
  const tagOf = (c: PlForecastColumn) => `${c.accum ? " acc" : ""}${c.forecast ? " fc fp" : ""}`;
  const keyMonth = (c: PlForecastColumn) => (c.forecast && !c.accum && c.ym ? c.ym : null);
  const shown = foldStatementRows(matrix.rows, new Set());
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
        <RmBox label={`${label} RM`} value={e.a ?? ""} hint={(e.p ?? "").trim() !== "" ? group((amtSen / 100).toFixed(2)) : ""} onChange={onAmt} />
      </td>
      <td data-cell={`num pct${tagOf(c)}`}>
        <PctBox label={`${label} %`} value={e.p ?? ""} hint={(e.a ?? "").trim() !== "" && salesSen > 0 ? ((amtSen / salesSen) * 100).toFixed(2) : ""} onChange={onPct} />
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
    cols.map((c, j) => {
      const ym = keyMonth(c);
      if (!ym) return figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, show);
      const m = sheet[ym];
      if (!m) return noMonth(c);
      const f = figures.get(ym);
      if (!f) return noMonth(c);
      const label = `${labelOfYm(ym)} ${r.label}`;
      if (k === "sales") {
        if (Object.values(m.customers ?? {}).some((v) => (v ?? "").trim() !== "")) return figure(c, f.salesSen, 100, true, true);
        return (
          <Fragment key={c.key}>
            <td data-cell={`num split${tagOf(c)}`}><RmBox label={`${label} RM`} value={m.salesStr} hint="" onChange={(v) => setSales(ym, v)} /></td>
            <td data-cell={`num pct${tagOf(c)}`} />
          </Fragment>
        );
      }
      if (k.startsWith("cat:") && f.supplierKeyed(k)) return figure(c, f.amt(k), r.pctValues[j] ?? 0, true, true);
      if (f.superseded(k)) return figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true, true);
      return boxes(c, label, m.pct[k] ?? {}, f.amt(k), f.salesSen, (v) => setLine(ym, k, side(v, "a")), (v) => setLine(ym, k, side(v, "p")));
    });

  // A detail row under a keyed row: boxes in the forecast months only.
  const detailRow = (key: string, depth: number, name: string, cell: (ym: string, c: PlForecastColumn) => ReactNode) => (
    <tr key={key} data-row="line">
      <td data-cell="stick" className="text-[12px] text-[#4B5563]" style={{ paddingLeft: `${14 + depth * 18}px` }}>{name}</td>
      {cols.map((c) => {
        const ym = keyMonth(c);
        if (!ym) return <Fragment key={c.key}><td data-cell={`num split${tagOf(c)}`} /><td data-cell={`num pct${tagOf(c)}`} /></Fragment>;
        if (!sheet[ym]) return noMonth(c);
        return cell(ym, c);
      })}
    </tr>
  );
  const details = (k: string, depth: number): ReactNode => {
    if (!open[k]) return null;
    if (k === "sales")
      return customerRows.map((cr) =>
        detailRow(`cu-${cr.id}`, depth, cr.name, (ym, c) => {
          const f = figures.get(ym);
          const sen = Math.max(0, moneyFieldToSen(sheet[ym].customers?.[cr.id] ?? "") ?? 0);
          return (
            <Fragment key={c.key}>
              <td data-cell={`num split${tagOf(c)}`}><RmBox label={`${labelOfYm(ym)} ${cr.name} sales`} value={sheet[ym].customers?.[cr.id] ?? ""} hint="" onChange={(v) => setCustomer(ym, cr.id, v)} /></td>
              <td data-cell={`num pct${tagOf(c)}`} className="text-[#9CA3AF]">{sen > 0 && f && f.salesSen > 0 ? `${((sen / f.salesSen) * 100).toFixed(1)}%` : ""}</td>
            </Fragment>
          );
        }),
      );
    if (k.startsWith("cat:")) {
      const type = k.slice(4);
      return supplierRowsOf(type).map((sr) =>
        detailRow(`su-${type}-${sr.id}`, depth, sr.name, (ym, c) => {
          const e = sheet[ym].suppliers?.[type]?.[sr.id] ?? {};
          const sen = new Map(forecastTypeSupplierCells(toFcMonth(sheet[ym]), type)).get(sr.id) ?? 0;
          return boxes(c, `${labelOfYm(ym)} ${type} ${sr.name}`, e, sen, figures.get(ym)?.salesSen ?? 0, (v) => setSupplier(ym, type, sr.id, side(v, "a")), (v) => setSupplier(ym, type, sr.id, side(v, "p")));
        }),
      );
    }
    return deptsPostingTo(k, groups, deptAccount).map((d) =>
      detailRow(`de-${k}-${d.code}`, depth, d.name, (ym, c) => {
        const f = figures.get(ym);
        return boxes(c, `${labelOfYm(ym)} ${d.name}`, sheet[ym].pct[d.code] ?? {}, f?.amt(d.code) ?? 0, f?.salesSen ?? 0, (v) => setLine(ym, d.code, side(v, "a")), (v) => setLine(ym, d.code, side(v, "p")));
      }),
    );
  };
  const hasDetail = (k: string) => k === "sales" || k.startsWith("cat:") || deptsPostingTo(k, groups, deptAccount).length > 0;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
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
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void close()}>
          <X className="mr-1 h-4 w-4" /> Done
        </Button>
      </ReportToolbar>
      {dirty && (
        <div data-fin-banner="todo" className="flex min-h-10 flex-wrap items-center gap-2.5 rounded-[10px] border border-[#E9D9B4] bg-[#FBF6EC] px-3.5 py-2.5">
          <span className="text-[13px] font-bold text-[#7A5B12]">You have unsaved changes</span>
          <span className="text-[12px] text-[#4B5563]">Save keeps them for the Forecast P&L, Cash Flow and the Dashboard; leaving asks first.</span>
        </div>
      )}
      <ReportFrame
        company={COMPANY.HOOKKA.name}
        title="Monthly Profit-and-Loss (Overall) — Edit forecast"
        note={`${base.fyLabel} · each month's Forecast takes RM or % of that month's sales · ▸ opens customers, suppliers or departments · all amounts RM`}
        maxHeight="calc(100vh - 340px)"
      >
        <table data-col-resize="first" data-fin-report data-fin-fit>
          <thead>
            <tr data-row="h1">
              <th rowSpan={2} data-cell="stick" className="min-w-[260px]">Item</th>
              {plMonthHeads(cols).map((h) => (
                <th key={h.key} colSpan={h.span} data-cell={`split center${h.accum ? " acc" : ""}${h.forecastOnly ? " fc fp" : ""}`}>{h.label}</th>
              ))}
            </tr>
            <tr data-row="h2">
              {cols.map((c) => (
                <Fragment key={c.key}>
                  <th data-cell={`num split${tagOf(c)}`}>{c.forecast ? "Forecast" : "Actual"}</th>
                  <th data-cell={`num pct${tagOf(c)}`}>%</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, close: isClose }, i) => {
              const pad = { paddingLeft: `${14 + r.depth * 18}px` };
              if (isClose) {
                return (
                  <tr key={`c${i}`} data-row="sub">
                    <td data-cell="stick" className="uppercase" style={pad}>{r.totalLabel ?? `TOTAL ${r.label}`}</td>
                    {cols.map((c, j) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true))}
                  </tr>
                );
              }
              if (r.kind === "gap") return <tr key={`gap${i}`} aria-hidden="true" data-row="gap"><td colSpan={span} /></tr>;
              if (r.kind === "grandtotal" || r.kind === "total") {
                const grand = r.kind === "grandtotal";
                return (
                  <tr key={i} data-row={grand ? "res" : "sub"} data-fin-double={grand && r === lastGrand ? "" : undefined}>
                    <td data-cell="stick" className="uppercase" style={pad}>{r.label}</td>
                    {cols.map((c, j) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true))}
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
                      {k ? editCells(r, k, false) : cols.map((c, j) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, false))}
                    </tr>
                    {k && details(k, r.depth + 1)}
                  </Fragment>
                );
              }
              return (
                <Fragment key={i}>
                  <tr data-row="line">
                    <td data-cell="stick" className={`uppercase ${r.depth >= 3 ? "text-[12px] text-[#6B7280]" : ""}`} style={pad}>{k ? opener(k, r.label) : r.label}</td>
                    {k ? editCells(r, k, true) : cols.map((c, j) => figure(c, r.values[j] ?? 0, r.pctValues[j] ?? 0, true))}
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
