// Shared pieces of the phone's Payment Voucher screens (Batch 3 prototype "Edit voucher" page): the voucher form fields
// (payee, dates, bill, the accrue switch with its accrual / paid-from account, notes, and the expense lines) and the
// searchable account picker. The scan review and the Edit page both render PvFormFields, so a scanned draft and a
// hand-edited one are the same form. The rules (which accounts a field may use, what blocks a save) are lib/pv-mobile's.
import { useMemo, useState } from "react";
import { accrualAccounts, bankAccounts, lineAccounts, newPvLine, pvFormTotalSen, type CoaAccount, type PvForm } from "../../lib/pv-mobile";
import type { ScanLineMeta } from "../../lib/scan-pv";
import { moneyFieldToSen } from "../../../../lib/money-field";
import { FinSearch, FinSheet } from "./fin-kit";
import { F, rm } from "./fin-format";
import { PageArea, PageLines, PageSelect, PageSwitch, PageText } from "./fin-overlay";

/** Searchable account picker (the prototype's sheet). `options` are already filtered to what the field may use. */
export function AccountPicker({ open, title, options, current, onPick, onClose }: { open: boolean; title: string; options: CoaAccount[]; current: string; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((a) => a.code.toLowerCase().includes(t) || a.name.toLowerCase().includes(t)) : options).slice(0, 80);
  }, [options, q]);
  return (
    <FinSheet
      open={open}
      onClose={onClose}
      title={title}
      sub="Search by code or name"
      rows={shown.map((a) => ({
        key: a.code,
        l: `${a.code} · ${a.name}`,
        lc: a.code === current ? F.gold : F.ink,
        w: a.code === current ? 700 : 600,
        v: a.code === current ? "Current" : undefined,
        vc: F.gold,
        onTap: () => onPick(a.code),
      }))}
      note={shown.length === 0 ? "Nothing matches." : undefined}
    >
      <div style={{ order: -1 }}>
        <FinSearch v={q} on={setQ} ph="Search code or name" />
      </div>
    </FinSheet>
  );
}

const nameOf = (coa: CoaAccount[], code: string): string => coa.find((a) => a.code === code)?.name ?? "";
const acctLabel = (coa: CoaAccount[], code: string): string => (code ? `${code} · ${nameOf(coa, code)}`.replace(/ · $/, "") : "");

function guessText(m: { guess: ScanLineMeta["guess"]; isTax: boolean } | undefined): string {
  if (!m) return "";
  if (m.isTax) return "SST added as its own line because the printed lines leave it out.";
  if (!m.guess) return "";
  return m.guess.source === "suggested"
    ? `Suggested — like ${m.guess.basis}`
    : m.guess.source === "payee-description"
      ? `Learned — this payee's “${m.guess.basis}”`
      : `Learned — this payee's usual account (${m.guess.basis})`;
}

/**
 * The voucher fields as the prototype's Edit voucher page draws them. `tried` turns on the red outlines and the per-line
 * errors after a save was attempted; nothing here decides whether a voucher can be saved (pvFormBlockers does).
 */
export function PvFormFields({ form, setForm, coa, meta, tried = false }: { form: PvForm; setForm: (f: PvForm) => void; coa: CoaAccount[]; meta?: Record<string, { guess: ScanLineMeta["guess"]; isTax: boolean }>; tried?: boolean }) {
  const [pick, setPick] = useState<string | null>(null);
  const lineOpts = useMemo(() => lineAccounts(coa), [coa]);
  const banks = useMemo(() => bankAccounts(coa), [coa]);
  const accruals = useMemo(() => accrualAccounts(coa), [coa]);
  const okCodes = useMemo(() => new Set(lineOpts.map((a) => a.code)), [lineOpts]);
  const patch = (p: Partial<PvForm>) => setForm({ ...form, ...p });
  const patchLine = (key: string, p: Partial<PvForm["lines"][number]>) => setForm({ ...form, lines: form.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) });
  const acctOpts = form.accrued
    ? [{ v: "", l: "Pick the accrual account" }, ...accruals.map((a) => ({ v: a.code, l: `${a.code} · ${a.name}` }))]
    : [{ v: "", l: "Pick the bank or cash account" }, ...banks.map((a) => ({ v: a.code, l: `${a.code} · ${a.name}` }))];
  const acctV = form.accrued ? form.accrualAccount : form.payFrom;
  return (
    <>
      <PageText l="Payee" req v={form.payee} on={(v) => patch({ payee: v })} bad={tried && !form.payee.trim()} />
      <PageText l="Date" type="date" mode="none" v={form.date} on={(v) => patch({ date: v })} bad={tried && !/^\d{4}-\d{2}-\d{2}$/.test(form.date)} />
      <PageText l="Description" v={form.description} on={(v) => patch({ description: v })} />
      <PageText l="Bill number" v={form.billNo} on={(v) => patch({ billNo: v })} />
      <PageText l="Bill date" type="date" mode="none" v={form.billDate} on={(v) => patch({ billDate: v })} />
      <PageSwitch
        l="Accrue it (pay later)"
        s={form.accrued ? "Posts to an accrual account" : "Paid now from a bank or cash account"}
        on={form.accrued}
        onToggle={() => patch({ accrued: !form.accrued })}
      />
      <PageSelect
        l={form.accrued ? "Accrual account" : "Paid from"}
        req
        v={acctV}
        on={(v) => patch(form.accrued ? { accrualAccount: v } : { payFrom: v })}
        opts={acctOpts}
        bad={tried && !acctV}
      />
      <PageArea l="Notes" v={form.notes} on={(v) => patch({ notes: v })} ph="Optional · internal" />
      <PageLines
        total={rm(pvFormTotalSen(form))}
        lines={form.lines.map((l) => {
          const sen = moneyFieldToSen(l.amount);
          const amtBad = tried && (sen == null || sen <= 0);
          const accBad = tried && (!l.accountCode || (coa.length > 0 && !okCodes.has(l.accountCode)));
          return {
            key: l.key,
            account: acctLabel(coa, l.accountCode),
            desc: l.description,
            amt: l.amount,
            hint: guessText(meta?.[l.key]),
            amtBad,
            accBad,
            err: amtBad ? "Enter an amount like 120.50 — it can't be blank or zero." : accBad ? (l.accountCode ? `${l.accountCode} can't be used on a voucher line.` : "Pick an account.") : "",
          };
        })}
        onAccount={(i) => setPick(form.lines[i]?.key ?? null)}
        onDesc={(i, v) => patchLine(form.lines[i].key, { description: v })}
        onAmt={(i, v) => patchLine(form.lines[i].key, { amount: v })}
        onRemove={(i) => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
        onAdd={() => setForm({ ...form, lines: [...form.lines, newPvLine(`n${Date.now()}`)] })}
      />
      <AccountPicker
        open={pick != null}
        title="Account"
        options={lineOpts}
        current={form.lines.find((l) => l.key === pick)?.accountCode ?? ""}
        onClose={() => setPick(null)}
        onPick={(code) => { if (pick) patchLine(pick, { accountCode: code }); setPick(null); }}
      />
    </>
  );
}
