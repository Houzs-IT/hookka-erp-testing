// ---------------------------------------------------------------------------
// Trade finance on Creditor Aging (owner 2026-08-11) — money owed to a LENDER
// (Houzs Century) for supplier bills it paid on our behalf. Drawing on the
// line and repaying it are AP Payments on Payment Vouchers.
//
// Since 2026-10-21 (owner 「就把那些信息显示在这边不行？」, then 「可以，全部做」)
// there is no separate block under the list: each open drawdown is a row of
// the aging list's Trade finance section (by due date) that opens (›) to its
// principal, interest, bank charges, repaid, outstanding and due date — the
// due date, interest and bank charges typed in place (TfDrawDetail); the
// repaid drawdowns sit behind a "show" line at the end of the section
// (TfRepaidRows). The line's limit card above the list (tfLineSummary) carries
// the limit, used, available and the check the owner reads at a glance:
// Σ drawdown outstanding + unallocated = the line's account balance. The
// line's setup lives in Settings › Trade Finance Lines (TfSetupCard).
// Amounts are ledger-derived server-side (loadTfDraws).
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { moneyFieldToRinggit, firstMoneyFieldError } from "@/lib/money-field";
import { Landmark } from "lucide-react";
import { tfPrincipalSen } from "@/lib/trade-finance";

export type TfDrawRow = {
  drawSourceId: string;
  drawDate: string;
  dueDate: string;
  amountSen: number;
  interestSen: number;
  bankChargeSen: number;
  repaidSen: number;
  outstandingSen: number;
  paidSupplier: string;
};
export type TfSourceRow = {
  accountCode: string;
  lenderSupplierId: string;
  lenderName: string;
  tenorDays: number;
  accountName: string;
  accountNetSen: number;
  limitSen?: number | null;
  availableSen?: number | null;
  unallocatedSen: number;
  totals: { notDue: number; d1_30: number; d31_60: number; d61_90: number; over90: number; total: number };
  draws: TfDrawRow[];
};

const rm = (sen: number) =>
  (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The two saves a drawdown takes (its due date; its interest or bank
// charges), then `onSaved` reloads the list.
function useTfDrawSave(onSaved: () => void) {
  const { toast } = useToast();
  const saveDue = async (drawSourceId: string, dueDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
    const res = await fetch("/api/accounting/trade-finance/draw-due", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drawSourceId, dueDate }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (j?.success) { toast.success("Due date saved"); onSaved(); }
    else toast.error(j?.error || "Couldn't save the due date");
  };

  // Keys the draw's TOTAL interest / bank charges (the bank's figure); the
  // server delta-posts DR INTEREST ON TRADE FINANCE or BANK CHARGES / CR the
  // TF account under this draw, so outstanding + the identity include it.
  // Same figure twice = no-op.
  // Interest is recorded AT DRAWDOWN (owner 2026-10-17 「提款时就记」): a figure
  // keyed here later is still dated on the drawdown day, so it lands in the
  // drawdown's month. Bank charges keep the day they are keyed.
  const saveCharge = async (kind: "interest" | "bankCharge", drawSourceId: string, rmStr: string, drawDate?: string) => {
    const label = kind === "interest" ? "Interest" : "Bank charges";
    // BUG-2026-08-13-095 — the interest cell is a free-text input, so the
    // bank's "1,250.00" reached `parseFloat` whole and posted RM 1.00 of
    // interest against the draw. Silence was the danger: the old guard simply
    // `return`ed, so an unreadable figure looked like a saved one.
    const tfMoneyError = firstMoneyFieldError([{ label: `${label} (RM)`, value: rmStr }]);
    if (tfMoneyError) { toast.error(tfMoneyError); return; }
    const rmv = moneyFieldToRinggit(rmStr) as number;
    if (rmv < 0) { toast.error(`${label} cannot be negative`); return; }
    const sen = Math.round(rmv * 100);
    const res = await fetch(`/api/accounting/trade-finance/${kind === "interest" ? "draw-interest" : "draw-bank-charge"}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "interest"
        ? { drawSourceId, interestSen: sen, ...(drawDate && /^\d{4}-\d{2}-\d{2}$/.test(drawDate) ? { date: drawDate } : {}) }
        : { drawSourceId, bankChargeSen: sen }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { success?: boolean; error?: string; data?: { unchanged?: boolean } } | null;
    if (j?.success) { if (!j.data?.unchanged) { toast.success(`${label} posted`); } onSaved(); }
    else toast.error(j?.error || `Couldn't save the ${label.toLowerCase()}`);
  };
  return { saveDue, saveCharge };
}

const fieldLabel = "block text-[10px] font-semibold uppercase tracking-[.4px] text-[#9CA3AF]";
const inputCls = "rounded border border-[#E2DDD8] px-1.5 py-0.5 text-[12px] bg-white";

/** One drawdown's figures under its aging row (or a repaid one's): principal,
 *  interest, bank charges, repaid, outstanding, due date — the due date,
 *  interest and bank charges typed in place unless the list is as at a past
 *  date. */
export function TfDrawDetail({ d, editable, onSaved }: { d: TfDrawRow; editable: boolean; onSaved: () => void }) {
  const { saveDue, saveCharge } = useTfDrawSave(onSaved);
  return (
    <div data-tf-draw={d.drawSourceId} className="flex flex-wrap items-end gap-x-7 gap-y-2 text-xs text-[#374151]">
      <div><span className={fieldLabel}>Paid supplier</span>{d.paidSupplier || "-"}</div>
      <div className="text-right"><span className={fieldLabel}>Principal</span><span className="tabular-nums">{rm(tfPrincipalSen(d))}</span></div>
      <div className="text-right">
        <span className={fieldLabel}>Interest (RM)</span>
        {editable ? (
          // The bank's charged interest — posts to the dedicated INTEREST ON
          // TRADE FINANCE account and joins the balance.
          <input
            key={`${d.drawSourceId}:${d.interestSen}`}
            type="number"
            step="0.01"
            min="0"
            defaultValue={d.interestSen ? (d.interestSen / 100).toFixed(2) : ""}
            placeholder="0.00"
            onBlur={(e) => {
              const cur = d.interestSen ? (d.interestSen / 100).toFixed(2) : "";
              if (e.target.value !== cur && e.target.value !== "") void saveCharge("interest", d.drawSourceId, e.target.value, d.drawDate);
            }}
            className={`w-24 text-right tabular-nums ${inputCls}`}
          />
        ) : <span className="tabular-nums">{rm(d.interestSen)}</span>}
      </div>
      <div className="text-right">
        <span className={fieldLabel}>Bank charges (RM)</span>
        {editable ? (
          // The bank's charges on the draw — posts to BANK CHARGES and joins the balance.
          <input
            key={`${d.drawSourceId}:bc:${d.bankChargeSen}`}
            type="number"
            step="0.01"
            min="0"
            defaultValue={d.bankChargeSen ? (d.bankChargeSen / 100).toFixed(2) : ""}
            placeholder="0.00"
            onBlur={(e) => {
              const cur = d.bankChargeSen ? (d.bankChargeSen / 100).toFixed(2) : "";
              if (e.target.value !== cur && e.target.value !== "") void saveCharge("bankCharge", d.drawSourceId, e.target.value);
            }}
            className={`w-24 text-right tabular-nums ${inputCls}`}
          />
        ) : <span className="tabular-nums">{rm(d.bankChargeSen)}</span>}
      </div>
      <div className="text-right"><span className={fieldLabel}>Repaid</span><span className="tabular-nums">{d.repaidSen ? rm(d.repaidSen) : "-"}</span></div>
      <div className="text-right"><span className={fieldLabel}>Outstanding</span><span className="tabular-nums font-semibold">{rm(d.outstandingSen)}</span></div>
      <div>
        <span className={fieldLabel}>Due date</span>
        {editable ? (
          // The bank's real maturity date.
          <input
            key={`${d.drawSourceId}:due:${d.dueDate}`}
            type="date"
            defaultValue={d.dueDate}
            onBlur={(e) => { if (e.target.value && e.target.value !== d.dueDate) void saveDue(d.drawSourceId, e.target.value); }}
            className={inputCls}
          />
        ) : <span className="tabular-nums">{d.dueDate || "-"}</span>}
      </div>
    </div>
  );
}

/** The drawdowns already repaid, behind one line at the end of the Trade
 *  finance section (rows of a table with `colSpan` columns). */
export function TfRepaidRows({ draws, colSpan, editable, onSaved }: { draws: TfDrawRow[]; colSpan: number; editable: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  if (draws.length === 0) return null;
  return (
    <>
      <tr data-fin-nolift="" data-tf-repaid="" className="border-b border-[#F0ECE9]">
        <td colSpan={colSpan} className="py-1.5 px-4">
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12px] text-[#6B5C32] underline decoration-dotted">
            {open ? "Hide" : "Show"} {draws.length} repaid drawdown{draws.length === 1 ? "" : "s"}
          </button>
        </td>
      </tr>
      {open && draws.map((d) => (
        <tr key={d.drawSourceId} data-fin-nolift="" className="border-b border-[#F7F4F1] bg-[#FAF8F6]">
          <td colSpan={colSpan} className="py-2 px-4 pl-10">
            <div className="mb-1 text-[11px] text-[#6B7280]">
              <span className="tabular-nums">{d.drawSourceId}</span> · drawn {d.drawDate} · repaid
            </div>
            <TfDrawDetail d={d} editable={editable} onSaved={onSaved} />
          </td>
        </tr>
      ))}
    </>
  );
}

// Setup = the ONE owner-pressed write that also reclasses the account in
// place (LIABILITY, renamed, out of the bank lists). The confirm spells that
// out — nothing here happens silently. Lives in Settings › Trade Finance Lines.
export function TfSetupCard({ existing, onSaved }: { existing: TfSourceRow | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [accountCode, setAccountCode] = useState(existing?.accountCode ?? "310-0020");
  const [lenderSupplierId, setLenderSupplierId] = useState(existing?.lenderSupplierId ?? "");
  const [tenorDays, setTenorDays] = useState(String(existing?.tenorDays ?? 90));
  const [accountName, setAccountName] = useState(existing?.accountName ?? "");
  const [nameTouched, setNameTouched] = useState(!!existing);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/suppliers")
      .then((r) => r.json() as Promise<{ success?: boolean; data?: { id: string; name: string }[] }>)
      .then((j) => {
        const list = Array.isArray(j?.data) ? j.data : [];
        setSuppliers(list.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
  }, []);
  const lenderName = suppliers.find((s) => s.id === lenderSupplierId)?.name ?? "";
  // Derived, not synced: until the owner touches the name field it follows the
  // picked lender (`TRADE FINANCE - <LENDER>`), no effect needed.
  const effectiveAccountName = nameTouched || !lenderName ? accountName : `TRADE FINANCE - ${lenderName}`;

  const save = async () => {
    if (!accountCode.trim() || !lenderSupplierId || !effectiveAccountName.trim()) {
      toast.error("Account, lender and the new account name are all required");
      return;
    }
    const ok = window.confirm(
      `Set up trade finance?\n\nAccount ${accountCode} becomes a LIABILITY named "${effectiveAccountName}" and leaves the bank / cash-book lists. The ledger itself is not touched — history reads correctly at every date.\n\nDraws (money ${lenderName} paid suppliers for us) will be tracked with due dates; repay with an AP Payment to ${lenderName} on Payment Vouchers.`,
    );
    if (!ok) return;
    setSaving(true);
    const res = await fetch("/api/accounting/trade-finance/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountCode: accountCode.trim(), lenderSupplierId, tenorDays: Math.round(Number(tenorDays) || 90), accountName: effectiveAccountName.trim() }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    setSaving(false);
    if (j?.success) { toast.success("Trade finance configured"); onSaved(); }
    else toast.error(j?.error || "Setup failed");
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#1F1D1B] flex items-center gap-2">
          <Landmark className="h-4 w-4 text-[#6B5C32]" /> Trade finance — set up
        </h3>
        <p className="text-[11px] text-[#6B7280]">
          For supplier bills a related company pays on our behalf (their trade-finance line). Saving reclasses the
          account below to a LIABILITY and starts per-draw due-date tracking.
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-[#6B7280]">
            Account code
            <input value={accountCode} onChange={(e) => setAccountCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#E2DDD8] px-2 py-1.5 text-sm bg-white" />
          </label>
          <label className="text-xs text-[#6B7280]">
            Lender (supplier)
            <select value={lenderSupplierId} onChange={(e) => setLenderSupplierId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#E2DDD8] px-2 py-1.5 text-sm bg-white">
              <option value="">— pick —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#6B7280]">
            Default tenor (days)
            <input type="number" min={1} max={365} value={tenorDays} onChange={(e) => setTenorDays(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#E2DDD8] px-2 py-1.5 text-sm bg-white" />
          </label>
          <label className="text-xs text-[#6B7280]">
            New account name
            <input value={effectiveAccountName} onChange={(e) => { setNameTouched(true); setAccountName(e.target.value); }}
              className="mt-1 w-full rounded-md border border-[#E2DDD8] px-2 py-1.5 text-sm bg-white" />
          </label>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save & reclassify"}
        </Button>
      </CardContent>
    </Card>
  );
}
