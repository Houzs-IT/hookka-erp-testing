// ---------------------------------------------------------------------------
// Settings › Trade Finance Lines (owner 2026-10-20 「暂时rm300,000」, from the
// design list's "Trade Finance limit per lender line"): each line's default
// tenor and its limit, which the owner keys himself; Used = drawn and not
// repaid (the line's account balance), Available = limit − used. Saving
// posts nothing. Creditor Aging's trade-finance card shows the same figures
// and the AP Payment form warns when a drawdown goes over the limit. Setting
// up a line lives here too (TfSetupCard — it left Creditor Aging with the
// block on 2026-10-21, owner 「可以，全部做」).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/utils";
import { TfSetupCard } from "./TradeFinanceBlock";

type Line = {
  accountCode: string;
  accountName: string;
  lenderName: string;
  tenorDays: number;
  limitSen: number | null;
  accountNetSen: number;
  availableSen: number | null;
};
type Draft = { tenor: string; limitRm: number | null };

const draftOf = (l: Line): Draft => ({ tenor: String(l.tenorDays), limitRm: l.limitSen == null ? null : l.limitSen / 100 });

export function TradeFinanceLinesCard() {
  const { toast } = useToast();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const load = useCallback(() => {
    fetch("/api/accounting/trade-finance", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ success?: boolean; data?: { sources?: Line[] } }>)
      .then((j) => {
        const ls = j?.success ? (j.data?.sources ?? []) : [];
        setLines(ls);
        setDrafts(Object.fromEntries(ls.map((l) => [l.accountCode, draftOf(l)])));
      })
      .catch(() => setLines([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (l: Line) => {
    const d = drafts[l.accountCode] ?? draftOf(l);
    const tenorDays = Math.round(Number(d.tenor));
    if (!(tenorDays >= 1 && tenorDays <= 365)) { toast.error("Tenor must be 1 to 365 days"); return; }
    if (d.limitRm != null && d.limitRm < 0) { toast.error("The limit cannot be negative"); return; }
    setSaving(l.accountCode);
    try {
      const res = await fetch("/api/accounting/trade-finance/line", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCode: l.accountCode, tenorDays, limitSen: d.limitRm == null ? null : Math.round(d.limitRm * 100) }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (j?.success) { toast.success(`${l.lenderName} saved`); load(); }
      else toast.error(j?.error || "Save failed");
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(null);
    }
  };

  if (lines === null) return null;
  // No line yet: setting one up is the only thing to do here.
  if (lines.length === 0) return <div className="mb-4"><TfSetupCard existing={null} onSaved={load} /></div>;
  return (
    <>
    <Card className="mb-4" data-tf-lines="">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-sm font-semibold text-[#1F1D1B]">Trade Finance Lines</h3>
        </div>
        <p className="text-[11px] text-[#9CA3AF] mb-3">
          Each lender line&apos;s default tenor (a drawdown&apos;s due date = payment date + tenor) and its limit. Used = drawn and not repaid; Available = limit − used. A drawdown past the limit gets a warning on the AP Payment form. Saving posts nothing.
        </p>
        <div className="overflow-x-auto">
          <table data-fin-list className="w-full text-sm">
            <thead>
              <tr className="text-[12px] text-[#6B7280]">
                <td className="text-left pb-1">Line</td>
                <td className="text-left pb-1 w-28">Tenor (days)</td>
                <td className="text-left pb-1 w-40">Limit (RM)</td>
                <td className="text-right pb-1 w-36">Used</td>
                <td className="text-right pb-1 w-36">Available</td>
                <td className="pb-1 w-20" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const d = drafts[l.accountCode] ?? draftOf(l);
                const changed = d.tenor !== String(l.tenorDays) || (d.limitRm == null ? l.limitSen != null : Math.round(d.limitRm * 100) !== l.limitSen);
                return (
                  <tr key={l.accountCode} data-fin-nolift="" className="border-t border-[#F0ECE9]">
                    <td className="py-1.5">{l.lenderName} <span className="text-[#6B7280]">· <span className="tabular-nums text-xs">{l.accountCode}</span> {l.accountName}</span></td>
                    <td className="py-1.5">
                      <input
                        aria-label={`Tenor for ${l.accountCode}`}
                        type="number" min={1} max={365}
                        value={d.tenor}
                        onChange={(e) => setDrafts((p) => ({ ...p, [l.accountCode]: { ...d, tenor: e.target.value } }))}
                        className="w-20 rounded border border-[#E2DDD8] px-2 py-1 text-sm tabular-nums"
                      />
                    </td>
                    <td className="py-1.5">
                      <MoneyInput
                        value={d.limitRm}
                        onChange={(v) => setDrafts((p) => ({ ...p, [l.accountCode]: { ...d, limitRm: v } }))}
                        placeholder="No limit"
                        className="w-36 rounded border border-[#E2DDD8] px-2 py-1 text-sm text-right tabular-nums"
                      />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatCurrency(l.accountNetSen)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${l.availableSen != null && l.availableSen < 0 ? "font-semibold text-[#9A3A2D]" : ""}`}>
                      {l.availableSen == null ? <span className="text-[#C4BDB3]">—</span> : formatCurrency(l.availableSen)}
                    </td>
                    <td className="py-1.5 text-right">
                      <Button variant="primary" size="sm" disabled={!changed || saving === l.accountCode} onClick={() => void save(l)}>
                        {saving === l.accountCode ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => setShowSetup((v) => !v)}>
            {showSetup ? "Close set-up" : "+ Set up another line"}
          </Button>
        </div>
      </CardContent>
    </Card>
    {showSetup && <div className="mb-4"><TfSetupCard existing={null} onSaved={() => { setShowSetup(false); load(); }} /></div>}
    </>
  );
}
