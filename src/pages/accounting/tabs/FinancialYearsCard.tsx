// ---------------------------------------------------------------------------
// FinancialYearsCard — Settings › Financial Years (finance backlog item 9;
// the design's "Financial Year End: Change Year End is Super Admin only,
// closed years are locked, transition-year preview").
//
// The years the books run in — name, start, end, months, status (Closed =
// its year-end close is posted, Current, Future, Open = over but not closed)
// — and, for a Super Admin, Change Year End: pick the year the change starts
// from (the current one or a later one) and the new year-end month; the
// transition years that allows (1–18 months) are offered, and the years that
// follow are previewed before Save. Replaces the old one-box year-end editor,
// which re-based every past year when it was changed.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FinPill } from "@/components/finance/pill";
import type { FinTone } from "@/lib/finance-daily";
import { addMonths, fyPeriods, withYearEndChange, yearEndChangeOptions, type FyPeriod } from "@/lib/fiscal-year";
import { useFiscalYears, type FiscalYearRow } from "../use-fiscal-years";
import { asMutationResponse } from "../shared";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const startText = (ym: string) => `1 ${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const endText = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return `${new Date(Date.UTC(y, m, 0)).getUTCDate()} ${MON[m - 1]} ${y}`;
};

const STATUS: Record<FiscalYearRow["status"], { tone: FinTone; label: string }> = {
  closed: { tone: "neutral", label: "Closed" },
  current: { tone: "ok", label: "Current" },
  future: { tone: "faint", label: "Future" },
  open: { tone: "warn", label: "Open — not closed" },
};

export function FinancialYearsCard() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [reload, setReload] = useState(0);
  const data = useFiscalYears(reload);
  const [form, setForm] = useState<{ from: string; month: number; to: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // A change starts the current year or a later one that is not closed.
  const changeable = (data?.years ?? []).filter((y) => y.status === "current" || y.status === "future");
  const fromYear = form ? changeable.find((y) => y.startYm === form.from) ?? null : null;
  const options = fromYear && form ? yearEndChangeOptions(fromYear, form.month) : [];
  const preview: FyPeriod[] = useMemo(() => {
    if (!data || !form || !form.to) return [];
    const next = withYearEndChange({ fyeMonth: data.fyeMonth, changes: data.changes }, { from: form.from, to: form.to });
    return fyPeriods(next, form.from, addMonths(form.to, 24)).slice(0, 3);
  }, [data, form]);

  const openForm = () => {
    const first = changeable[0];
    if (!first) return;
    const month = Number(first.endYm.slice(5, 7)) === 12 ? 6 : 12;
    const opts = yearEndChangeOptions(first, month);
    setForm({ from: first.startYm, month, to: opts[0]?.to ?? "" });
  };
  const setFrom = (from: string) => {
    const fy = changeable.find((y) => y.startYm === from);
    const opts = fy && form ? yearEndChangeOptions(fy, form.month) : [];
    setForm((f) => (f ? { ...f, from, to: opts[0]?.to ?? "" } : f));
  };
  const setMonth = (month: number) => {
    const opts = fromYear ? yearEndChangeOptions(fromYear, month) : [];
    setForm((f) => (f ? { ...f, month, to: opts[0]?.to ?? "" } : f));
  };

  const save = async () => {
    if (!form || !form.to || !fromYear) return;
    const months = options.find((o) => o.to === form.to)?.months ?? 0;
    const ok = await confirm({
      title: "Change the financial year end?",
      message: `${fromYear.name} becomes a transition year of ${months} month${months === 1 ? "" : "s"}, ${startText(form.from)} to ${endText(form.to)}; every year after it ends on ${endText(form.to).replace(/ \d{4}$/, "")}. The reports read their years from this.`,
      danger: false,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/fiscal-years/year-end", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: form.from, to: form.to }),
      });
      const j = asMutationResponse(await res.json());
      if (j?.success) {
        toast.success("Financial year end changed");
        setForm(null);
        setReload((n) => n + 1);
      } else toast.error(j?.error || "Could not change the year end");
    } catch {
      toast.error("Could not change the year end");
    } finally {
      setSaving(false);
    }
  };

  const label = "text-xs font-medium text-[#6B7280] mb-1 block";
  const select = "rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B5C32]";

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#1F1D1B]">Financial Years</p>
            <p className="text-[11px] text-[#9CA3AF]">
              {data ? `Year end: ${endText(`2000-${String(data.currentFyeMonth).padStart(2, "0")}`).replace(/ 2000$/, "")}` : "Loading…"}
              {" · "}the P&amp;L year to date, the quarters and the year-end close follow these years.
            </p>
          </div>
          {data?.canChangeYearEnd && !form && changeable.length > 0 && (
            <Button variant="outline" size="sm" onClick={openForm}>Change Year End</Button>
          )}
        </div>

        <table data-fin-list className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[#6B7280]">
              <th className="px-3 py-2">Financial Year</th>
              <th className="px-3 py-2">Starts</th>
              <th className="px-3 py-2">Ends</th>
              <th className="px-3 py-2 text-right">Months</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.years ?? []).map((y) => (
              <tr key={y.startYm} className="border-t border-[#F0ECE9]">
                <td className="px-3 py-1.5 font-medium">{y.name}{y.transition && <span className="ml-1.5 text-[11px] font-normal text-[#7A5B12]">(transition)</span>}</td>
                <td className="px-3 py-1.5 text-[#6B7280]">{startText(y.startYm)}</td>
                <td className="px-3 py-1.5 text-[#6B7280]">{endText(y.endYm)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{y.months}</td>
                <td className="px-3 py-1.5"><FinPill tone={STATUS[y.status].tone}>{STATUS[y.status].label}</FinPill></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-[#9CA3AF]">A year closes when its year-end close is posted (Balance Sheet › Year-End Close).</p>

        {form && (
          <div className="space-y-3 rounded-[10px] border border-[#E2DDD8] bg-[#FBFAF8] p-3">
            <p className="text-sm font-semibold text-[#1F1D1B]">Change Year End <span className="text-[11px] font-normal text-[#9CA3AF]">Super Admin only · closed years can't change</span></p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className={label}>Starting with</label>
                <select aria-label="Starting with" value={form.from} onChange={(e) => setFrom(e.target.value)} className={select}>
                  {changeable.map((y) => <option key={y.startYm} value={y.startYm}>{y.name} ({startText(y.startYm)})</option>)}
                </select>
              </div>
              <div>
                <label className={label}>New year end</label>
                <select aria-label="New year end" value={form.month} onChange={(e) => setMonth(Number(e.target.value))} className={select}>
                  {MONTH_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
            </div>
            {options.length === 0 ? (
              <p className="text-xs text-[#9A3A2D]">{fromYear ? `${fromYear.name} already ends in ${MONTH_FULL[form.month - 1]} — nothing to change.` : "Pick the year to start from."}</p>
            ) : (
              <div className="space-y-1">
                <p className={label}>Transition year</p>
                {options.map((o) => (
                  <label key={o.to} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="fy-transition" checked={form.to === o.to} onChange={() => setForm((f) => (f ? { ...f, to: o.to } : f))} />
                    {o.months} month{o.months === 1 ? "" : "s"} — {startText(form.from)} to {endText(o.to)}
                  </label>
                ))}
                <p className="text-[11px] text-[#9CA3AF]">A transition year runs 1 to 18 months.</p>
              </div>
            )}
            {preview.length > 0 && (
              <p className="text-xs text-[#4B5563]">
                Then: {preview.map((p) => `${p.name} ${startText(p.startYm)} – ${endText(p.endYm)} (${p.months} months)`).join(" · ")}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving || !form.to}>{saving ? "Saving…" : "Save Year End"}</Button>
              <Button variant="outline" size="sm" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
