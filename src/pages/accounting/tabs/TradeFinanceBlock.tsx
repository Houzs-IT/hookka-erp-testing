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
import { Fragment, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { moneyFieldToRinggit, firstMoneyFieldError } from "@/lib/money-field";
import { CalendarDays, ChevronDown, ChevronRight, Landmark } from "lucide-react";
import { tfPrincipalSen } from "@/lib/trade-finance";
import { formatDateDMY } from "@/lib/utils";

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

// The card under an opened drawdown (owner 2026-10-21 「这个点开可以优化一下，
// 不好看」): the drawdown on the left — paid to, drawn, due date — and the
// amount on the right worked as a sum, one figure under another: principal +
// interest + bank charges − repaid = outstanding.
const headCls = "mb-2.5 text-[10.5px] font-semibold uppercase tracking-[.5px] text-[#9CA3AF]";
const termCls = "text-[#6B7280]";
const opCls = "text-center text-[#9CA3AF]";
// A plain figure sits where an input's text does (1px border + 8px padding).
const figCls = "pr-[9px] text-right tabular-nums";
const boxCls = "h-7 rounded-md border border-[#D9D3CA] bg-white text-[12.5px] focus:border-[#6B5C32] focus:outline-none focus:ring-2 focus:ring-[#6B5C32]/20";
const moneyText = (sen: number) => (sen ? rm(sen) : "");

/** The due date day-first like the rest of the page — the browser's own date
 *  box follows its language (12/03/2026 for 3 December in an English-US
 *  Chrome) — with the browser's calendar on click. Saved when it loses focus. */
function DueDateBox({ d, onSave }: { d: TfDrawRow; onSave: (ymd: string) => void }) {
  const [value, setValue] = useState(d.dueDate);
  return (
    <span data-tf-due="" className="relative inline-flex h-7 w-[136px] items-center justify-between rounded-md border border-[#D9D3CA] bg-white px-2 text-[12.5px] tabular-nums focus-within:border-[#6B5C32] focus-within:ring-2 focus-within:ring-[#6B5C32]/20">
      <span>{value ? formatDateDMY(value) : "-"}</span>
      <CalendarDays className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
      <input
        type="date"
        aria-label="Due date"
        defaultValue={d.dueDate}
        onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* the box still takes typing */ } }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => {
          if (!e.target.value) { e.target.value = d.dueDate; setValue(d.dueDate); return; }
          if (e.target.value !== d.dueDate) onSave(e.target.value);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/** One drawdown's figures under its aging row (or a repaid one's): paid to,
 *  drawn, due date; principal + interest + bank charges − repaid =
 *  outstanding — the due date, interest and bank charges typed in place
 *  unless the list is as at a past date. */
export function TfDrawDetail({ d, editable, onSaved }: { d: TfDrawRow; editable: boolean; onSaved: () => void }) {
  const { saveDue, saveCharge } = useTfDrawSave(onSaved);
  return (
    <div data-tf-draw={d.drawSourceId} className="inline-flex flex-wrap items-start gap-x-8 gap-y-4 rounded-lg border border-[#E7E1D8] bg-white px-5 py-4 text-[12.5px] text-[#1F2937] shadow-[0_1px_2px_rgba(31,29,27,.06)]">
      <div>
        <div className={headCls}>Drawdown</div>
        <dl className="grid grid-cols-[auto_auto] items-center gap-x-6 gap-y-2.5">
          <dt className={termCls}>Paid to</dt>
          <dd className="font-medium text-[#1F1D1B]">{d.paidSupplier || "-"}</dd>
          <dt className={termCls}>Drawn</dt>
          <dd className="tabular-nums">{d.drawDate ? formatDateDMY(d.drawDate) : "-"}<span className="text-[#9CA3AF]"> · {d.drawSourceId}</span></dd>
          <dt className={termCls}>Due date</dt>
          <dd>
            {editable ? (
              // The bank's real maturity date.
              <DueDateBox key={`${d.drawSourceId}:due:${d.dueDate}`} d={d} onSave={(ymd) => { void saveDue(d.drawSourceId, ymd); }} />
            ) : <span className="tabular-nums">{d.dueDate ? formatDateDMY(d.dueDate) : "-"}</span>}
          </dd>
        </dl>
      </div>
      <div className="border-l border-[#EDE8E1] pl-8">
        <div className={headCls}>Amount (RM)</div>
        <div data-tf-sum="" className="grid grid-cols-[10px_auto_124px] items-center gap-x-3 gap-y-2">
          <span />
          <span className={termCls}>Principal</span>
          <span className={figCls}>{rm(tfPrincipalSen(d))}</span>
          <span className={opCls}>+</span>
          <span className={termCls}>Interest</span>
          {editable ? (
            // The bank's charged interest — posts to the dedicated INTEREST ON
            // TRADE FINANCE account and joins the balance.
            <input
              key={`${d.drawSourceId}:${d.interestSen}`}
              type="text"
              inputMode="decimal"
              aria-label="Interest (RM)"
              defaultValue={moneyText(d.interestSen)}
              placeholder="0.00"
              onBlur={(e) => {
                if (e.target.value !== moneyText(d.interestSen) && e.target.value !== "") void saveCharge("interest", d.drawSourceId, e.target.value, d.drawDate);
              }}
              className={`w-full px-2 text-right tabular-nums ${boxCls}`}
            />
          ) : <span className={figCls}>{rm(d.interestSen)}</span>}
          <span className={opCls}>+</span>
          <span className={termCls}>Bank charges</span>
          {editable ? (
            // The bank's charges on the draw — posts to BANK CHARGES and joins the balance.
            <input
              key={`${d.drawSourceId}:bc:${d.bankChargeSen}`}
              type="text"
              inputMode="decimal"
              aria-label="Bank charges (RM)"
              defaultValue={moneyText(d.bankChargeSen)}
              placeholder="0.00"
              onBlur={(e) => {
                if (e.target.value !== moneyText(d.bankChargeSen) && e.target.value !== "") void saveCharge("bankCharge", d.drawSourceId, e.target.value);
              }}
              className={`w-full px-2 text-right tabular-nums ${boxCls}`}
            />
          ) : <span className={figCls}>{rm(d.bankChargeSen)}</span>}
          <span className={opCls}>−</span>
          <span className={termCls}>Repaid</span>
          <span className={figCls}>{d.repaidSen ? rm(d.repaidSen) : "-"}</span>
          <span className="col-span-3 border-t border-[#CBD5E1]" />
          <span />
          <span className="font-semibold text-[#1F1D1B]">Outstanding</span>
          <span className={`${figCls} font-semibold text-[#1F1D1B]`}>{rm(d.outstandingSen)}</span>
        </div>
      </div>
    </div>
  );
}

/** A repaid drawdown with the line it was drawn on (the row's code and name). */
export type TfRepaidDraw = TfDrawRow & { accountCode: string; lenderName: string };

/** The drawdowns already repaid, behind one line at the end of the Trade
 *  finance section: each a row like an open one with nothing outstanding,
 *  opening (›) to the same card. `colSpan` = the table's columns (10 with
 *  Next Due). */
export function TfRepaidRows({ draws, colSpan, editable, onSaved }: { draws: TfRepaidDraw[]; colSpan: number; editable: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  if (draws.length === 0) return null;
  const withDue = colSpan >= 10;
  const toggle = (id: string) => setOpenRows((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <tr data-fin-nolift="" data-tf-repaid="" className="border-b border-[#F0ECE9]">
        <td colSpan={colSpan} className="py-2 px-4">
          <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#6B5C32] hover:underline">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? "Hide" : "Show"} {draws.length} repaid drawdown{draws.length === 1 ? "" : "s"}
          </button>
        </td>
      </tr>
      {open && draws.map((d) => {
        const isOpen = openRows.has(d.drawSourceId);
        return (
          <Fragment key={d.drawSourceId}>
            <tr data-tf-repaid-row="" data-fin-nolift={isOpen ? "" : undefined} className="border-b border-[#F0ECE9] text-[#6B7280]">
              <td className="py-3 px-4 font-mono text-xs whitespace-nowrap">{d.accountCode}</td>
              <td className="py-3 px-4">
                <button type="button" className="inline-flex items-start gap-1.5 text-left" onClick={() => toggle(d.drawSourceId)} title="Show this drawdown's figures">
                  {isOpen ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B5C32]" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B5C32]" />}
                  <span className="font-medium">
                    {d.lenderName}
                    <span className="block text-[11px] font-normal">{[d.drawSourceId, d.paidSupplier, `drawn ${formatDateDMY(d.drawDate)}`].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </td>
              <td className="py-3 px-4"><span className="inline-flex rounded-full bg-[#EAF2EC] px-2 py-0.5 text-[11px] font-medium text-[#3F6B4E]">Repaid</span></td>
              {withDue ? <td className="py-3 px-4 whitespace-nowrap tabular-nums">{d.dueDate ? formatDateDMY(d.dueDate) : "-"}</td> : null}
              {[0, 1, 2, 3, 4].map((b) => <td key={b} className="py-3 px-4 text-right">-</td>)}
              <td className="py-3 px-4 text-right">-</td>
            </tr>
            {isOpen && (
              <tr data-fin-nolift="" className="border-b border-[#F7F4F1] bg-[#FAF8F6]">
                <td colSpan={colSpan} className="py-2.5 px-4 pl-10"><TfDrawDetail d={d} editable={editable} onSaved={onSaved} /></td>
              </tr>
            )}
          </Fragment>
        );
      })}
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
