// ---------------------------------------------------------------------------
// Warehouse › Stock Take — a quantity-only month-end count (owner 2026-11-11,
// WORK-TRACKER 133: 「先把我要做的 quantities usage 和 export for stock count
// 功能做好先」; 「放去 warehouse side bar」「分14类，然后在更详细」「他们是点
// quantity 的」).
//   1. Count sheet — Excel, one sheet per type, items by series, blank qty.
//   2. Counted quantities — the filled sheet read back and saved for the month.
//      No money and no posting: Finance values a count in Accounting › Stock
//      Take ("Download for Finance" gives it the file it imports).
//   3. Usage — last month's count + purchased − this month's count, per item.
// API: src/api/routes/stock-count.ts · helpers: src/lib/stock-count.ts
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from "react";
import { Download, Upload, RefreshCw, Pencil, Check, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { humanizeError } from "@/lib/humanize-error";
import { usePermissions } from "@/lib/use-permission";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { exportWorkbookXlsx } from "@/lib/export-report";
import { exportStyledWorkbookXlsx } from "@/lib/styled-xlsx";
import {
  COUNT_SHEET_COLS,
  COUNT_SHEET_WRITE_COLS,
  buildCountSheets,
  countSheetLayout,
  financeCountAoa,
  parseCountWorkbook,
  parseUomFactor,
  prevYm,
  usageExportLayout,
  usageNote,
  ymLabel,
  OTHER_SERIES,
  type CountItem,
  type CountLine,
  type ParsedCount,
  type UsageResult,
  type UsageRow,
} from "@/lib/stock-count";
import { itemCodeKey } from "@/lib/stock-take-import";

type ItemsResp = { success: boolean; data?: { items: CountItem[]; defaultGroups: string[] }; error?: string };
type SavedCount = { ym: string; file?: string; savedAt?: string; savedBy?: string | null; lines: CountLine[] };
type CountResp = {
  success: boolean;
  data?: { count: SavedCount | null; finance: { savedAt: string | null; file: string | null; lines: number } | null };
  error?: string;
};
type CountMeta = { source: "warehouse" | "finance"; ym: string; savedAt: string | null; savedBy: string | null; file: string | null; lines: number };
type UsageResp = {
  success: boolean;
  data?: UsageResult & { ym: string; prevYm: string; opening: CountMeta | null; closing: CountMeta | null; defaultGroups: string[] };
  error?: string;
};

const qtyFmt = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 4 });
const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? "—" : qtyFmt.format(n));
const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const COMPANY_NAME = COMPANY.HOOKKA.name;

function sourceText(meta: CountMeta | null | undefined, ym: string): string {
  if (!meta) return `No count on file for ${ymLabel(ym)}`;
  const who = meta.source === "warehouse" ? "Warehouse count" : "Finance stock take";
  const bits = [`${meta.lines} items`, meta.savedBy ? `by ${meta.savedBy}` : "", fmtWhen(meta.savedAt), meta.file ?? ""].filter(Boolean);
  return `${who} — ${bits.join(" · ")}`;
}

async function readWorkbook(file: File): Promise<{ name: string; aoa: unknown[][] }[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    aoa: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: true, blankrows: true }),
  }));
}

export default function StockTakePage() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { hasPermission } = usePermissions();
  const canSave = hasPermission("inventory", "create");
  const [ym, setYm] = useState(() => todayYmdMY().slice(0, 7));
  const validYm = /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);

  // ── Item master + the types counted before ──────────────────────────────
  const itemsQ = useCachedJson<ItemsResp>("/api/stock-count/items", 300);
  const items = useMemo(() => itemsQ.data?.data?.items ?? [], [itemsQ.data]);
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.active && i.group) m.set(i.group, (m.get(i.group) ?? 0) + 1);
    return m;
  }, [items]);
  const allTypes = useMemo(() => [...typeCounts.keys()].sort(), [typeCounts]);
  const defaultTypes = useMemo(() => {
    const d = (itemsQ.data?.data?.defaultGroups ?? []).filter((g) => typeCounts.has(g));
    return d.length ? d : allTypes;
  }, [itemsQ.data, typeCounts, allTypes]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const types = useMemo(() => (picked ?? defaultTypes).filter((g) => typeCounts.has(g)).sort(), [picked, defaultTypes, typeCounts]);
  const toggleType = (g: string) => setPicked((cur) => {
    const base = cur ?? defaultTypes;
    return base.includes(g) ? base.filter((x) => x !== g) : [...base, g];
  });

  // ── The month's saved count + usage ─────────────────────────────────────
  const countQ = useCachedJson<CountResp>(validYm ? `/api/stock-count/count?ym=${ym}` : null, 30);
  const usageQ = useCachedJson<UsageResp>(validYm ? `/api/stock-count/usage?ym=${ym}` : null, 30);
  const saved = countQ.data?.data?.count ?? null;
  const finance = countQ.data?.data?.finance ?? null;
  const refreshAll = () => {
    invalidateCachePrefix("/api/stock-count/");
    countQ.refresh();
    usageQ.refresh();
  };

  // ── 1. Count sheet ──────────────────────────────────────────────────────
  const sheets = useMemo(() => buildCountSheets(items, types), [items, types]);
  const sheetItems = sheets.reduce((t, s) => t + s.itemCount, 0);
  // With lines (owner 「做成好看一点的表格，有线条的」): borders on every cell,
  // filled header, bold series rows, Counted Qty / Remark shaded to write in.
  const downloadSheet = async () => {
    if (!sheets.length) return;
    await exportStyledWorkbookXlsx(
      `stock-count-sheet-${ym}.xlsx`,
      sheets.map((s) => ({ name: s.group, ...countSheetLayout(s, { company: COMPANY_NAME, ymLabel: ymLabel(ym) }), cols: COUNT_SHEET_COLS, writeCols: COUNT_SHEET_WRITE_COLS, mono: true })),
    );
  };

  // ── 2. Import the filled sheet ──────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: string; parsed: ParsedCount } | null>(null);
  const [saving, setSaving] = useState(false);
  const master = useMemo(() => {
    const m = new Map<string, CountItem>();
    for (const i of items) {
      const k = itemCodeKey(i.code);
      if (k && !m.has(k)) m.set(k, i);
    }
    return m;
  }, [items]);
  // Each item's unit, so a unit changed on the sheet is caught (owner 「然后 UOM 如果他导出来换呢」).
  const masterUnits = useMemo(() => Object.fromEntries([...master].map(([k, it]) => [k, it.uom])), [master]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = parseCountWorkbook(await readWorkbook(f), masterUnits);
      if (!parsed.sheetsRead) {
        toast.error(`No sheet in ${f.name} has an "Item Code" and a "Counted Qty" column.`);
        return;
      }
      setPreview({ file: f.name, parsed });
    } catch (e) {
      toast.error(humanizeError(e, "Could not read the file"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const previewByType = useMemo(() => {
    if (!preview) return [] as [string, number][];
    const m = new Map<string, number>();
    for (const l of preview.parsed.lines) {
      const g = master.get(itemCodeKey(l.code))?.group || "Not in item master";
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [preview, master]);
  const unknownCodes = useMemo(() => (preview ? preview.parsed.lines.filter((l) => !master.has(itemCodeKey(l.code))).map((l) => l.code) : []), [preview, master]);
  const saveCount = async () => {
    if (!preview || !preview.parsed.lines.length) return;
    if (saved) {
      const ok = await confirm({
        title: `Replace the ${ymLabel(ym)} count?`,
        message: `The count saved ${fmtWhen(saved.savedAt)}${saved.savedBy ? ` by ${saved.savedBy}` : ""} (${saved.lines.length} items) is replaced by ${preview.parsed.lines.length} items from ${preview.file}.`,
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/stock-count/count", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym, file: preview.file, lines: preview.parsed.lines }),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { lines: number } } | null;
      if (!res.ok || !j?.success) throw new Error(j?.error || `Save failed (${res.status})`);
      toast.success(`Saved ${j.data?.lines ?? preview.parsed.lines.length} counted items for ${ymLabel(ym)}`);
      setPreview(null);
      refreshAll();
    } catch (e) {
      toast.error(humanizeError(e, "Could not save the count"));
    } finally {
      setSaving(false);
    }
  };
  const downloadForFinance = async () => {
    if (!saved) return;
    await exportWorkbookXlsx(`stock-count-${ym}-for-finance.xlsx`, [{ name: "Count", aoa: financeCountAoa(saved.lines, items), cols: [12, 24, 36, 10, 12, 12] }]);
  };

  // ── 3. Usage ────────────────────────────────────────────────────────────
  const usage = usageQ.data?.data ?? null;
  const [onlyCheck, setOnlyCheck] = useState(false);
  const shownGroups = useMemo(() => {
    if (!usage) return [];
    const want = new Set(types);
    return usage.groups
      .filter((g) => want.has(g.group))
      .map((g) => ({
        ...g,
        series: g.series
          .map((s) => ({ ...s, rows: onlyCheck ? s.rows.filter((r) => r.flags.length > 0) : s.rows }))
          .filter((s) => s.rows.length),
      }))
      .filter((g) => g.series.length);
  }, [usage, types, onlyCheck]);
  const shownSummary = useMemo(() => {
    const t = { items: 0, withUsage: 0, negatives: 0, units: 0 };
    if (!usage) return t;
    for (const g of usage.groups) {
      if (!types.includes(g.group)) continue;
      t.items += g.items;
      t.withUsage += g.withUsage;
      t.negatives += g.negatives;
      t.units += g.units;
    }
    return t;
  }, [usage, types]);
  const exportUsage = async () => {
    if (!usage) return;
    const want = new Set(types);
    const filtered: UsageResult = { ...usage, groups: usage.groups.filter((g) => want.has(g.group)) };
    await exportStyledWorkbookXlsx(`stock-usage-${ym}.xlsx`, [{
      name: `Usage ${ym}`,
      ...usageExportLayout(filtered, {
        company: COMPANY_NAME,
        ymLabel: ymLabel(ym),
        prevLabel: ymLabel(prevYm(ym)),
        openingSource: sourceText(usage.opening, prevYm(ym)),
        closingSource: sourceText(usage.closing, ym),
      }),
      cols: [12, 14, 24, 36, 7, 13, 13, 10, 13, 13, 44],
      numCols: [5, 6, 7, 8, 9],
      negRedCols: [9],
    }]);
  };

  // Unit factor: 1 purchase unit = N count units (a roll bought, metres counted).
  const [factorEdit, setFactorEdit] = useState<{ code: string; value: string } | null>(null);
  const saveFactor = async (code: string, value: string) => {
    const factor = parseUomFactor(value);
    if (factor === undefined) {
      toast.error("Type a number above 0, or leave it blank to clear");
      return;
    }
    try {
      const res = await fetch("/api/stock-count/uom-factor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, factor }),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) throw new Error(j?.error || `Save failed (${res.status})`);
      toast.success(factor === null ? `${code}: unit factor cleared` : `${code}: 1 purchase unit = ${factor} count units`);
      setFactorEdit(null);
      refreshAll();
    } catch (e) {
      toast.error(humanizeError(e, "Could not save the unit factor"));
    }
  };

  const prevLabel = ymLabel(prevYm(ym));
  const curLabel = ymLabel(ym);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Take"
        subtitle="Month-end count in quantities only — no money. Finance values the count in Accounting › Stock Take."
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#6B7280]" htmlFor="st-month">Month</label>
            <Input id="st-month" type="month" value={ym} onChange={(e) => { setYm(e.target.value); setPreview(null); }} className="h-8 w-[150px]" />
            <Button variant="outline" size="sm" onClick={refreshAll} title="Reload">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      {/* Types — shared by the count sheet and the usage table. */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#6B7280] mr-1">Types</span>
            {itemsQ.loading && !items.length ? (
              <span className="text-xs text-[#6B7280]">Loading item master…</span>
            ) : itemsQ.error && !items.length ? (
              <span className="text-xs text-red-700">Couldn&apos;t load the item master — <button className="underline" onClick={() => itemsQ.refresh()}>Retry</button></span>
            ) : (
              allTypes.map((g) => {
                const on = types.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleType(g)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-[#6B5C32] bg-[#6B5C32] text-white" : "border-[#E2DDD8] bg-white text-[#6B7280] hover:bg-[#F0ECE9]"}`}
                    aria-pressed={on}
                  >
                    {g} <span className={on ? "opacity-80" : "opacity-60"}>({typeCounts.get(g)})</span>
                  </button>
                );
              })
            )}
            {items.length > 0 && (
              <span className="ml-auto flex gap-2 text-xs">
                <button type="button" className="text-[#6B5C32] underline" onClick={() => setPicked(null)}>Counted types</button>
                <button type="button" className="text-[#6B5C32] underline" onClick={() => setPicked(allTypes)}>All</button>
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-[#6B7280]">
            Ticked by default: the {defaultTypes.length} types Finance counts at month end. {types.length} ticked · {sheetItems} active items.
          </p>
        </CardContent>
      </Card>

      {/* 1. Count sheet */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>1 · Count sheet — {curLabel}</CardTitle>
            <Button size="sm" onClick={downloadSheet} disabled={!sheets.length} className="bg-[#6B5C32] text-white hover:bg-[#5a4d2a]">
              <Download className="h-3.5 w-3.5" /> Download count sheet (Excel)
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-[#6B7280] space-y-1">
          <p>One sheet per type ({sheets.length}), items grouped by series, {sheetItems} items. Counted Qty is blank — no system quantity is printed, so the count is what is on the shelf.</p>
          <p>Staff write the quantity in the unit shown; 0 when there is none. A blank means not counted.</p>
        </CardContent>
      </Card>

      {/* 2. Counted quantities */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>2 · Counted quantities — {curLabel}</CardTitle>
            <div className="flex items-center gap-2">
              {saved && (
                <Button variant="outline" size="sm" onClick={downloadForFinance} title="The saved count in the item-master layout Accounting › Stock Take imports">
                  <Download className="h-3.5 w-3.5" /> Download for Finance
                </Button>
              )}
              {canSave && (
                <>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
                  <Button size="sm" onClick={() => fileRef.current?.click()} disabled={!validYm || saving} className="bg-[#6B5C32] text-white hover:bg-[#5a4d2a]">
                    <Upload className="h-3.5 w-3.5" /> Import filled sheet
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {countQ.loading && !countQ.data ? (
            <p className="text-[#6B7280]">Loading…</p>
          ) : countQ.error && !countQ.data ? (
            <p className="text-red-700">Couldn&apos;t load the saved count — <button className="underline" onClick={() => countQ.refresh()}>Retry</button></p>
          ) : saved ? (
            <p className="text-[#1F1D1B]">
              Saved: <b>{saved.lines.length}</b> counted items{saved.savedBy ? ` · by ${saved.savedBy}` : ""} · {fmtWhen(saved.savedAt)}{saved.file ? ` · ${saved.file}` : ""}
            </p>
          ) : (
            <p className="text-[#6B7280]">
              No warehouse count saved for {curLabel}.
              {finance ? ` Finance has a priced count for ${curLabel} (${finance.lines} items${finance.file ? `, ${finance.file}` : ""}) — the usage table uses it until the warehouse saves one.` : ""}
            </p>
          )}
          {!canSave && <p className="text-[#6B7280]">Importing a count needs the Inventory create permission.</p>}

          {preview && (
            <div className="rounded border border-[#E2DDD8] bg-[#FAF9F7] p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-[#1F1D1B]">
                  <b>{preview.file}</b>: {preview.parsed.sheetsRead} sheet{preview.parsed.sheetsRead === 1 ? "" : "s"} read · <b>{preview.parsed.lines.length}</b> items counted · {preview.parsed.blank} left blank (not counted)
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreview(null)} disabled={saving}>Cancel</Button>
                  <Button size="sm" onClick={() => void saveCount()} disabled={saving || !preview.parsed.lines.length} className="bg-[#6B5C32] text-white hover:bg-[#5a4d2a]">
                    {saving ? "Saving…" : `Save count for ${curLabel}`}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#6B7280]">
                {previewByType.map(([g, n]) => <span key={g}>{g}: {n}</span>)}
              </div>
              {preview.parsed.unitChanges.length > 0 && (
                <div className="text-amber-800">
                  <p>
                    Counted in another unit than the item master ({preview.parsed.unitChanges.length}) — saved as written and marked in the usage; the item master is not changed:
                  </p>
                  <p>{preview.parsed.unitChanges.slice(0, 12).map((u) => `${u.code}: ${u.from} → ${u.to}`).join(" · ")}{preview.parsed.unitChanges.length > 12 ? " …" : ""}</p>
                </div>
              )}
              {unknownCodes.length > 0 && (
                <p className="text-amber-800">Not in the item master ({unknownCodes.length}, saved as typed): {unknownCodes.slice(0, 12).join(", ")}{unknownCodes.length > 12 ? " …" : ""}</p>
              )}
              {preview.parsed.duplicates.length > 0 && (
                <p className="text-amber-800">On more than one row, quantities added up: {preview.parsed.duplicates.slice(0, 12).join(", ")}{preview.parsed.duplicates.length > 12 ? " …" : ""}</p>
              )}
              {preview.parsed.skippedSheets.length > 0 && (
                <p className="text-[#6B7280]">Sheets without an Item Code / Counted Qty header, skipped: {preview.parsed.skippedSheets.join(", ")}</p>
              )}
              {preview.parsed.problems.length > 0 && (
                <div className="text-amber-800">
                  <p>Rows left out ({preview.parsed.problems.length}):</p>
                  <ul className="list-disc pl-5">
                    {preview.parsed.problems.slice(0, 15).map((p) => (
                      <li key={`${p.sheet}-${p.row}`}>{p.sheet} row {p.row} · {p.code}: {p.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Usage */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>3 · Usage — {curLabel} (quantities)</CardTitle>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} /> Only rows to check
              </label>
              <Button variant="outline" size="sm" onClick={() => void exportUsage()} disabled={!usage || !shownSummary.items}>
                <Download className="h-3.5 w-3.5" /> Export usage (Excel)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {usageQ.loading && !usageQ.data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-6 rounded bg-[#F0ECE9] animate-pulse" />)}
            </div>
          ) : usageQ.error && !usageQ.data ? (
            <p className="text-xs text-red-700">Couldn&apos;t load the usage — <button className="underline" onClick={() => usageQ.refresh()}>Retry</button></p>
          ) : usage ? (
            <>
              <div className="grid gap-1 text-xs text-[#6B7280]">
                <p><span className="text-[#1F1D1B] font-medium">Opening ({prevLabel}):</span> {sourceText(usage.opening, prevYm(ym))}</p>
                <p><span className="text-[#1F1D1B] font-medium">Closing ({curLabel}):</span> {sourceText(usage.closing, ym)}</p>
                <p>Usage = opening + purchased − closing. Purchased = purchase-invoice quantity dated in {curLabel} × the item&apos;s unit factor. An item missing from either count has no usage.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Items listed", value: shownSummary.items },
                  { label: "With a usage", value: shownSummary.withUsage },
                  { label: "Negative usage", value: shownSummary.negatives, tone: shownSummary.negatives ? "text-red-700" : "" },
                  { label: "Unit? to check", value: shownSummary.units, tone: shownSummary.units ? "text-amber-800" : "" },
                ].map((k) => (
                  <div key={k.label} className="rounded border border-[#E2DDD8] px-3 py-2">
                    <div className="text-[10px] uppercase text-[#6B7280]">{k.label}</div>
                    <div className={`text-xl font-semibold tabular-nums ${k.tone || "text-[#1F1D1B]"}`}>{qtyFmt.format(k.value)}</div>
                  </div>
                ))}
              </div>
              {!shownGroups.length ? (
                <p className="text-xs text-[#6B7280]">
                  {onlyCheck ? "Nothing to check in the ticked types." : `No count or purchase in the ticked types for ${curLabel}.`}
                </p>
              ) : (
                <div className="overflow-x-auto rounded border border-[#E2DDD8]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-[#E2DDD8] text-left text-[10px] uppercase text-[#6B7280]">
                        <th className="py-1.5 px-2">Item Code</th>
                        <th className="py-1.5 px-2">Description</th>
                        <th className="py-1.5 px-2">UOM</th>
                        <th className="py-1.5 px-2 text-right">Opening ({prevLabel})</th>
                        <th className="py-1.5 px-2 text-right">Purchased ({curLabel})</th>
                        <th className="py-1.5 px-2 text-right">Closing ({curLabel})</th>
                        <th className="py-1.5 px-2 text-right">Usage</th>
                        <th className="py-1.5 px-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownGroups.map((g) => (
                        <UsageGroupRows
                          key={g.group}
                          group={g.group}
                          meta={`${g.items} items · ${g.withUsage} with usage${g.negatives ? ` · ${g.negatives} negative` : ""}${g.units ? ` · ${g.units} unit?` : ""}`}
                          series={g.series}
                          canSave={canSave}
                          factorEdit={factorEdit}
                          setFactorEdit={setFactorEdit}
                          saveFactor={saveFactor}
                        />
                      ))}
                      {!onlyCheck && usage.unknown.length > 0 && (
                        <UsageGroupRows
                          group="Not in item master"
                          meta={`${usage.unknown.length} counted codes the item master does not know`}
                          series={[{ series: OTHER_SERIES, rows: usage.unknown, total: null }]}
                          canSave={false}
                          factorEdit={null}
                          setFactorEdit={setFactorEdit}
                          saveFactor={saveFactor}
                        />
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function UsageGroupRows(props: {
  group: string;
  meta: string;
  series: { series: string; rows: UsageRow[]; total: { uom: string; opening: number; purchased: number; closing: number; usage: number } | null }[];
  canSave: boolean;
  factorEdit: { code: string; value: string } | null;
  setFactorEdit: (v: { code: string; value: string } | null) => void;
  saveFactor: (code: string, value: string) => Promise<void>;
}) {
  const { group, meta, series, canSave, factorEdit, setFactorEdit, saveFactor } = props;
  return (
    <>
      <tr className="bg-[#F0ECE9] border-b border-[#E2DDD8]">
        <td colSpan={8} className="py-1.5 px-2 font-semibold text-[#1F1D1B]">
          {group} <span className="font-normal text-[#6B7280]">· {meta}</span>
        </td>
      </tr>
      {series.map((s) => (
        <SeriesRows key={s.series} {...s} canSave={canSave} factorEdit={factorEdit} setFactorEdit={setFactorEdit} saveFactor={saveFactor} />
      ))}
    </>
  );
}

function SeriesRows(props: {
  series: string;
  rows: UsageRow[];
  total: { uom: string; opening: number; purchased: number; closing: number; usage: number } | null;
  canSave: boolean;
  factorEdit: { code: string; value: string } | null;
  setFactorEdit: (v: { code: string; value: string } | null) => void;
  saveFactor: (code: string, value: string) => Promise<void>;
}) {
  const { series, rows, total, canSave, factorEdit, setFactorEdit, saveFactor } = props;
  const neg = (n: number | null) => (n !== null && n < 0 ? "text-red-700 font-medium" : "text-[#1F1D1B]");
  return (
    <>
      <tr className="bg-[#FAF9F7] border-b border-[#E2DDD8]">
        <td colSpan={3} className="py-1 px-2 font-medium text-[#6B7280]">{series} <span className="font-normal">({rows.length})</span></td>
        {total ? (
          <>
            <td className="py-1 px-2 text-right tabular-nums text-[#6B7280]">{fmtQty(total.opening)}</td>
            <td className="py-1 px-2 text-right tabular-nums text-[#6B7280]">{fmtQty(total.purchased)}</td>
            <td className="py-1 px-2 text-right tabular-nums text-[#6B7280]">{fmtQty(total.closing)}</td>
            <td className={`py-1 px-2 text-right tabular-nums font-medium ${neg(total.usage)}`}>{fmtQty(total.usage)} {total.uom}</td>
            <td className="py-1 px-2 text-[#6B7280]">Series total</td>
          </>
        ) : (
          <td colSpan={5} />
        )}
      </tr>
      {rows.map((r) => {
        const editing = factorEdit?.code === r.code;
        return (
          <tr key={r.code} className="border-b border-[#E2DDD8] last:border-b-0 hover:bg-[#FAF9F7]">
            <td className="py-1 px-2 whitespace-nowrap text-[#1F1D1B]">{r.code}</td>
            <td className="py-1 px-2 text-[#6B7280]">{r.description}</td>
            <td className="py-1 px-2 text-[#6B7280]">{r.uom}</td>
            <td className="py-1 px-2 text-right tabular-nums text-[#1F1D1B]">{fmtQty(r.opening)}</td>
            <td className="py-1 px-2 text-right tabular-nums text-[#1F1D1B] whitespace-nowrap">
              {editing ? (
                <span className="inline-flex items-center gap-1">
                  <span className="text-[10px] text-[#6B7280]">1 bought =</span>
                  <Input
                    autoFocus
                    value={factorEdit.value}
                    onChange={(e) => setFactorEdit({ code: r.code, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveFactor(r.code, factorEdit.value);
                      if (e.key === "Escape") setFactorEdit(null);
                    }}
                    className="h-6 w-[70px] text-right text-xs"
                  />
                  <span className="text-[10px] text-[#6B7280]">{r.uom || "units"}</span>
                  <button type="button" title="Save" onClick={() => void saveFactor(r.code, factorEdit.value)} className="text-[#6B5C32]"><Check className="h-3.5 w-3.5" /></button>
                  <button type="button" title="Cancel" onClick={() => setFactorEdit(null)} className="text-[#6B7280]"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {r.factor !== null && <span className="text-[10px] text-[#6B7280]">{fmtQty(r.purchasedRaw)} × {fmtQty(r.factor)} =</span>}
                  {fmtQty(r.purchased)}
                  {canSave && (r.purchasedRaw > 0 || r.factor !== null) && (
                    <button
                      type="button"
                      title="Unit factor: 1 purchase unit = N count units"
                      onClick={() => setFactorEdit({ code: r.code, value: r.factor !== null ? String(r.factor) : "" })}
                      className="text-[#9CA3AF] hover:text-[#6B5C32]"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </span>
              )}
            </td>
            <td className="py-1 px-2 text-right tabular-nums text-[#1F1D1B]">{fmtQty(r.closing)}</td>
            <td className={`py-1 px-2 text-right tabular-nums ${neg(r.usage)}`}>{fmtQty(r.usage)}</td>
            <td className={`py-1 px-2 ${r.flags.includes("units") || r.flags.includes("unitChanged") ? "text-amber-800" : "text-[#6B7280]"}`}>{usageNote(r)}</td>
          </tr>
        );
      })}
    </>
  );
}
