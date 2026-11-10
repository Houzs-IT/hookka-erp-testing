// ---------------------------------------------------------------------------
// Forecasting › Board Report — /board-report?month=YYYY-MM (owner 2026-11-10:
// "every figure from live ERP data; nobody should have to ask Claude each
// month"). Thirteen A4 portrait pages plus the full statements as
// appendices, all from ONE read: GET /api/reports/board (accounting:read),
// which reads the ERP's own report endpoints and arranges their figures
// (src/lib/board-report.ts). Default month = the last closed month.
//
// PDF = the browser's print to PDF: every <BrPage> is exactly one A4 page
// (board-report.css: @page A4, a page break after each), app chrome is
// hidden in print by DashboardLayout, and "Download PDF" calls window.print().
// Page 13's notes are typed here by Finance (accounting:update) and stored in
// kv_config `board_report_notes:<YYYY-MM>` via PUT /api/reports/board/notes.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDown, RefreshCw } from "lucide-react";
import { FinancePageTitle } from "@/components/finance/page-title";
import { useToast } from "@/components/ui/toast";
import { responseErrorMessage } from "@/lib/response-error";
import { addMonths, lastClosedMonth, longMonth, YM_RE, type BoardReport } from "@/lib/board-report";
import { todayYmdMY } from "@/lib/utils";
import { CoverPage, IncomePage, LabourPage, MaterialsPage, TrendPage, BalancePage, CashFlowPage } from "./pages-finance";
import { CashForecastPage, CustomersPage, NewModelsPage, OperationsPage, OutlookPage, NotesPage, NotesEditor } from "./pages-business";
import { Appendices } from "./appendix";
import "./board-report.css";

type Payload = BoardReport & { canEditNotes?: boolean };

export default function BoardReportPage() {
  const [params, setParams] = useSearchParams();
  const today = todayYmdMY();
  const fallback = lastClosedMonth(today);
  const q = params.get("month") ?? "";
  const month = YM_RE.test(q) && q <= today.slice(0, 7) ? q : fallback;
  const [reloadKey, setReloadKey] = useState(0);
  // The answer for one request (month + reload count); loading = no answer
  // for the request in view yet. A failed load is kept as its reason, never
  // shown as an empty report.
  const reqKey = `${month}#${reloadKey}`;
  const [result, setResult] = useState<{ key: string; data: Payload | null; error: string | null } | null>(null);
  const current = result?.key === reqKey ? result : null;
  const loading = current === null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const setData = useCallback((fn: (d: Payload | null) => Payload | null) => {
    setResult((r) => (r ? { ...r, data: fn(r.data) } : r));
  }, []);
  const { toast } = useToast();

  // The twelve months up to the running one, newest first.
  const months = useMemo(() => Array.from({ length: 13 }, (_, i) => addMonths(today.slice(0, 7), -i)), [today]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/reports/board?month=${reqKey.split("#")[0]}`);
        if (!res.ok) throw new Error(await responseErrorMessage(res, "The board report could not be loaded"));
        const json = (await res.json()) as { success?: boolean; data?: Payload; error?: string };
        if (!json.success || !json.data) throw new Error(json.error || "The board report could not be loaded");
        if (alive) setResult({ key: reqKey, data: json.data, error: null });
      } catch (e) {
        if (alive) setResult({ key: reqKey, data: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; };
  }, [reqKey]);

  const saveNotes = useCallback(async (text: string): Promise<boolean> => {
    const res = await fetch("/api/reports/board/notes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, text }),
    });
    if (!res.ok) {
      toast.error(await responseErrorMessage(res, "Notes not saved"));
      return false;
    }
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Payload["notes"]; error?: string } | null;
    if (!json?.success || !json.data) {
      toast.error(json?.error || "Notes not saved");
      return false;
    }
    const saved = json.data;
    setData((d) => (d ? { ...d, notes: { ...d.notes, text: saved.text, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } } : d));
    toast.success("Notes saved");
    return true;
  }, [month, toast, setData]);

  return (
    <div className="brp-root">
      <div className="print:hidden">
        <FinancePageTitle
          title="Board Report"
          explain="The monthly board report, built from live ERP figures each time it is opened: income statement, labour, materials, trend, balance sheet, cash flow and its forecast, customers, new models, operations, outlook, and Finance's notes, then the full statements. Download PDF prints it as A4 pages."
          links={[
            { label: "Financial Dashboard", to: "/finance-dashboard" },
            { label: "Forecast P&L", to: "/forecast" },
            { label: "P&L", to: "/accounting?tab=pl" },
          ]}
          actions={
            <div className="brp-toolbar">
              <label htmlFor="brp-month">Month</label>
              <select id="brp-month" value={month} onChange={(e) => setParams({ month: e.target.value })}>
                {months.map((m) => (
                  <option key={m} value={m}>{longMonth(m)}{m === today.slice(0, 7) ? " (to date)" : m === fallback ? " (last closed)" : ""}</option>
                ))}
              </select>
              <button type="button" className="brp-btn ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} title="Rebuild from the latest figures">
                <RefreshCw size={14} /> Refresh
              </button>
              <button type="button" className="brp-btn" onClick={() => window.print()} disabled={!data || loading}>
                <FileDown size={14} /> Download PDF
              </button>
            </div>
          }
        />
        {month === today.slice(0, 7) && <p className="brp-banner">This month is still running — every figure is to date, not final.</p>}
        <p className="brp-hint">In the print dialog choose “Save as PDF”, paper A4, margins None, and tick Background graphics.</p>
      </div>
      {loading && <div className="brp-state print:hidden">Building the board report for {longMonth(month)} from live figures… The first build of a month can take up to a minute.</div>}
      {!loading && error && (
        <div className="brp-state error print:hidden">
          <strong>The board report could not be built.</strong> {error}
          <div><button type="button" className="brp-btn" onClick={() => setReloadKey((k) => k + 1)}>Try again</button></div>
        </div>
      )}
      {!loading && data && (
        <div className="brp-pages">
          <CoverPage r={data} />
          <IncomePage r={data} />
          <LabourPage r={data} />
          <MaterialsPage r={data} />
          <TrendPage r={data} />
          <BalancePage r={data} />
          <CashFlowPage r={data} />
          <CashForecastPage r={data} />
          <CustomersPage r={data} />
          <NewModelsPage r={data} />
          <OperationsPage r={data} />
          <OutlookPage r={data} />
          <NotesPage r={data} />
          {data.canEditNotes && <NotesEditor key={`${data.month}:${data.notes.updatedAt ?? ""}`} r={data} onSave={saveNotes} />}
          <Appendices r={data} />
        </div>
      )}
    </div>
  );
}
