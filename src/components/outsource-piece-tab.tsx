// ---------------------------------------------------------------------------
// outsource-piece-tab.tsx — Employees > Outsource (HK-0130).
//
// Set each outsourced worker's piece rates, import the production orders they
// finished into a payroll month, and review the wages. The wages reach the
// Payroll tab when that month's payslips are generated.
//
// Kept out of employees.tsx on purpose — that file is past 11k lines.
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Trash2, Upload } from "lucide-react";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, todayYmdMY } from "@/lib/utils";
import { parseRateLines, priceListText } from "@/lib/outsource-piece";
import { useDebounced } from "@/pages/m/lib/use-debounced";

type OutsourceWorker = {
  id: string;
  empNo: string;
  name: string;
  status?: string;
  isOutsource?: boolean;
  dailyRateSen?: number | null;
};

type Rate = { id: string; itemCode: string; rateSen: number };

type ImportRow = {
  id: string;
  poNo: string;
  salesOrderNo: string;
  customerPoId: string;
  productCode: string;
  itemCode: string;
  missing: string[];
  quantity: number;
  completedDate: string;
  rateSen: number | null;
  amountSen: number | null;
  importedTo: string;
  importedPeriod: string;
};

type PieceRecord = {
  id: string;
  workerId: string;
  empNo: string;
  workerName: string;
  poNo: string;
  salesOrderNo: string;
  customerPoId: string;
  productCode: string;
  quantity: number;
  rateSen: number;
  amountSen: number;
};

type Drift = { workerId: string; employeeName: string; expectedSen: number; onPayslipSen: number };

type SubTab = "rates" | "import" | "wages";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "rates", label: "Piece Rates" },
  { key: "import", label: "Import from Production" },
  { key: "wages", label: "Wages & Report" },
];

const SELECT = "h-9 rounded-md border border-[#E2DDD8] bg-white px-2 text-sm";
const TH = "px-3 py-2 text-left text-xs font-medium text-[#6B7280]";
const TD = "px-3 py-2 text-sm";

function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && data.success !== false, data };
}

export function OutsourcePieceTab({ workers }: { workers: OutsourceWorker[] }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("payroll", "update");
  const [sub, setSub] = useState<SubTab>("rates");
  const [workerId, setWorkerId] = useState("");
  const [period, setPeriod] = useState(todayYmdMY().slice(0, 7));

  const outsourced = useMemo(
    () => workers.filter((w) => w.isOutsource && (w.status ?? "ACTIVE") === "ACTIVE"),
    [workers],
  );
  const worker = outsourced.find((w) => w.id === workerId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outsource Piece-Rate Wages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select className={SELECT} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Select outsourced worker</option>
            {outsourced.map((w) => (
              <option key={w.id} value={w.id}>
                {w.empNo} - {w.name}
              </option>
            ))}
          </select>
          <Input
            type="month"
            className="w-44"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Payroll month"
          />
          <div className="flex gap-1">
            {SUB_TABS.map((t) => (
              <Button key={t.key} variant={sub === t.key ? "primary" : "outline"} onClick={() => setSub(t.key)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        {worker && (worker.dailyRateSen ?? 0) > 0 && (
          <p className="flex items-center gap-2 rounded-md bg-[#FBF1DC] px-3 py-2 text-sm text-[#9C6F1E]">
            <AlertTriangle className="h-4 w-4" />
            {worker.name} also has a day rate. Piece wages are paid on top of day pay.
          </p>
        )}

        {sub === "rates" && <RatesPanel workerId={workerId} canEdit={canEdit} />}
        {sub === "import" && <ImportPanel key={period} workerId={workerId} period={period} canEdit={canEdit} />}
        {sub === "wages" && <WagesPanel period={period} canEdit={canEdit} />}
      </CardContent>
    </Card>
  );
}

function RatesPanel({ workerId, canEdit }: { workerId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const url = workerId ? `/api/outsource-piece/rates?workerId=${encodeURIComponent(workerId)}` : null;
  const { data: resp, refresh } = useCachedJson<{ data?: Rate[] }>(url);
  const rates = resp?.data ?? [];

  if (!workerId) return <p className="text-sm text-[#6B7280]">Select a worker to see their rates.</p>;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
      const text = priceListText(rows);
      if (!text) toast.error("No prices found in this file");
      setPaste(text);
    } catch {
      toast.error("Could not read this file");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    const { rates: parsed, errors } = parseRateLines(paste);
    if (errors.length > 0) {
      toast.error(errors.slice(0, 3).join("; "));
      return;
    }
    if (parsed.length === 0) return;
    setBusy(true);
    const { ok, data } = await send("/api/outsource-piece/rates", "PUT", { workerId, rates: parsed });
    setBusy(false);
    if (!ok) {
      toast.error(String(data.error ?? "Could not save rates"));
      return;
    }
    toast.success(`${parsed.length} rates saved.`);
    setPaste("");
    invalidateCachePrefix("/api/outsource-piece");
    refresh();
  };

  const remove = async (r: Rate) => {
    const yes = await confirm({ title: "Remove rate", message: `Remove the rate for ${r.itemCode}?` });
    if (!yes) return;
    const { ok } = await send(`/api/outsource-piece/rates/${r.id}`, "DELETE");
    if (!ok) toast.error("Could not remove the rate");
    invalidateCachePrefix("/api/outsource-piece");
    refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="max-h-[28rem] overflow-auto rounded-md border border-[#E2DDD8]">
        <table className="w-full">
          <thead className="bg-[#F7F5F2]">
            <tr>
              <th className={TH}>Item</th>
              <th className={`${TH} text-right`}>Rate per unit</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id} className="border-t border-[#E2DDD8]">
                <td className={TD}>{r.itemCode}</td>
                <td className={`${TD} text-right`}>{formatCurrency(r.rateSen)}</td>
                <td className={`${TD} text-right`}>
                  {canEdit && (
                    <button type="button" aria-label={`Remove ${r.itemCode}`} onClick={() => remove(r)}>
                      <Trash2 className="h-4 w-4 text-[#9A3A2D]" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rates.length === 0 && (
              <tr>
                <td className={`${TD} text-[#6B7280]`} colSpan={3}>No rates set for this worker.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="outsource-rate-paste">
            Add or update rates
          </label>
          <textarea
            id="outsource-rate-paste"
            className="h-56 w-full rounded-md border border-[#E2DDD8] p-2 font-mono text-sm"
            placeholder={"5530-1A  24.07\n5530-2A  31.67\n5530-L  25.97"}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <p className="text-xs text-[#6B7280]">
            Upload this worker's Excel price list, or paste two columns. One rate covers both sides, LHF and RHF.
            Check the list, then save.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            aria-label="Price list file"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />
              Upload Excel
            </Button>
            <Button variant="primary" disabled={busy || !paste.trim()} onClick={save}>
              Save Rates
            </Button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function ImportPanel({ workerId, period, canEdit }: { workerId: string; period: string; canEdit: boolean }) {
  const { toast } = useToast();
  const bounds = monthBounds(period);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [department, setDepartment] = useState("FAB_SEW");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams({ workerId, from, to, department, q: debouncedQ });
  const { data: resp, loading, refresh } = useCachedJson<{ data?: ImportRow[] }>(
    workerId ? `/api/outsource-piece/importable?${params}` : null,
  );
  const rows = resp?.data ?? [];

  if (!workerId) return <p className="text-sm text-[#6B7280]">Select a worker to import their production orders.</p>;

  const selectable = (r: ImportRow) => r.rateSen !== null && !r.importedTo;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const totalSen = rows.reduce((s, r) => s + (selected.has(r.id) ? r.amountSen ?? 0 : 0), 0);

  const doImport = async () => {
    setBusy(true);
    const { ok, data } = await send("/api/outsource-piece/import", "POST", {
      workerId,
      period,
      productionOrderIds: [...selected],
    });
    setBusy(false);
    if (!ok) {
      toast.error(String(data.error ?? "Import failed"));
      return;
    }
    const skipped = Number(data.skipped) || 0;
    toast.success(`${Number(data.imported) || 0} imported${skipped ? `, ${skipped} already imported` : ""}.`);
    setSelected(new Set());
    invalidateCachePrefix("/api/outsource-piece");
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className={SELECT} value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Finished in">
          <option value="">Whole order finished</option>
          <option value="FAB_CUT">Fab Cut finished</option>
          <option value="FAB_SEW">Fab Sew finished</option>
          <option value="FOAM">Foam finished</option>
          <option value="WOOD_CUT">Wood Cut finished</option>
          <option value="FRAMING">Framing finished</option>
          <option value="WEBBING">Webbing finished</option>
          <option value="UPHOLSTERY">Upholstery finished</option>
          <option value="PACKING">Packing finished</option>
        </select>
        <Input
          className="w-64"
          placeholder="Order, SO, customer PO or item"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto rounded-md border border-[#E2DDD8]">
        <table className="w-full">
          <thead className="bg-[#F7F5F2]">
            <tr>
              <th className={TH} />
              <th className={TH}>Production Order</th>
              <th className={TH}>Customer PO</th>
              <th className={TH}>Item</th>
              <th className={TH}>Finished</th>
              <th className={`${TH} text-right`}>Qty</th>
              <th className={`${TH} text-right`}>Rate</th>
              <th className={`${TH} text-right`}>Amount</th>
              <th className={TH}>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#E2DDD8]">
                <td className={TD}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.poNo}`}
                    disabled={!selectable(r) || !canEdit}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td className={TD}>{r.poNo}</td>
                <td className={TD}>{r.customerPoId || "-"}</td>
                <td className={TD}>{r.productCode}</td>
                <td className={TD}>{r.completedDate || "-"}</td>
                <td className={`${TD} text-right`}>{r.quantity}</td>
                <td className={`${TD} text-right`}>{r.rateSen === null ? "-" : formatCurrency(r.rateSen)}</td>
                <td className={`${TD} text-right`}>{r.amountSen === null ? "-" : formatCurrency(r.amountSen)}</td>
                <td className={`${TD} text-xs text-[#6B7280]`}>
                  {r.importedTo ? `Imported to ${r.importedTo} (${r.importedPeriod})` : r.rateSen === null ? `No rate for ${r.missing.join(", ")}` : ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={`${TD} text-[#6B7280]`} colSpan={9}>
                  {loading ? "Loading..." : "No finished production orders in these dates."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={busy || selected.size === 0} onClick={doImport}>
            Import {selected.size} to {period}
          </Button>
          <span className="text-sm font-medium">Total {formatCurrency(totalSen)}</span>
        </div>
      )}
    </div>
  );
}

function csvCell(v: string | number): string {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function WagesPanel({ period, canEdit }: { period: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { data: resp, refresh } = useCachedJson<{ data?: PieceRecord[]; locked?: boolean; drift?: Drift[] }>(
    `/api/outsource-piece/records?period=${period}`,
  );
  const records = useMemo(() => resp?.data ?? [], [resp]);
  const locked = Boolean(resp?.locked);
  const drift = resp?.drift ?? [];

  const byWorker = useMemo(() => {
    const map = new Map<string, { name: string; empNo: string; rows: PieceRecord[]; totalSen: number }>();
    for (const r of records) {
      const g = map.get(r.workerId) ?? { name: r.workerName, empNo: r.empNo, rows: [], totalSen: 0 };
      g.rows.push(r);
      g.totalSen += r.amountSen;
      map.set(r.workerId, g);
    }
    return [...map.values()];
  }, [records]);

  const remove = async (r: PieceRecord) => {
    const yes = await confirm({ title: "Remove record", message: `Remove ${r.poNo} from ${r.workerName}?` });
    if (!yes) return;
    const { ok, data } = await send(`/api/outsource-piece/records/${r.id}`, "DELETE");
    if (!ok) toast.error(String(data.error ?? "Could not remove the record"));
    invalidateCachePrefix("/api/outsource-piece");
    refresh();
  };

  const exportCsv = () => {
    const head = ["Worker", "Payroll Period", "Production Order", "Customer PO", "Model / Item", "Completed Qty", "Piece Rate (RM)", "Total Wages (RM)"];
    const lines = records.map((r) =>
      [r.workerName, period, r.poNo, r.customerPoId, r.productCode, r.quantity, (r.rateSen / 100).toFixed(2), (r.amountSen / 100).toFixed(2)]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([`\uFEFF${[head.join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `outsource-payroll-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {drift.length > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-[#FBF1DC] px-3 py-2 text-sm text-[#9C6F1E]">
          <AlertTriangle className="h-4 w-4" />
          Payslips for {period} do not match these wages. Regenerate them on the Payroll tab before approving.
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="outline" disabled={records.length === 0} onClick={exportCsv}>
          <Download className="mr-1 h-4 w-4" />
          Export Summary
        </Button>
      </div>
      {byWorker.map((g) => (
        <div key={g.empNo + g.name} className="overflow-x-auto rounded-md border border-[#E2DDD8]">
          <div className="flex items-center justify-between bg-[#F7F5F2] px-3 py-2 text-sm font-medium">
            <span>{g.empNo} - {g.name}</span>
            <span>Total {formatCurrency(g.totalSen)}</span>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Production Order</th>
                <th className={TH}>Customer PO</th>
                <th className={TH}>Model / Item</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right`}>Rate</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.id} className="border-t border-[#E2DDD8]">
                  <td className={TD}>{r.poNo}</td>
                  <td className={TD}>{r.customerPoId || "-"}</td>
                  <td className={TD}>{r.productCode}</td>
                  <td className={`${TD} text-right`}>{r.quantity}</td>
                  <td className={`${TD} text-right`}>{formatCurrency(r.rateSen)}</td>
                  <td className={`${TD} text-right`}>{formatCurrency(r.amountSen)}</td>
                  <td className={`${TD} text-right`}>
                    {canEdit && !locked && (
                      <button type="button" aria-label={`Remove ${r.poNo}`} onClick={() => remove(r)}>
                        <Trash2 className="h-4 w-4 text-[#9A3A2D]" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {records.length === 0 && <p className="text-sm text-[#6B7280]">No piece wages imported for {period}.</p>}
      {confirmDialog}
    </div>
  );
}
