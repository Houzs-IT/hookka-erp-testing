// Shared pieces of the phone's Payment Voucher screens: the voucher form fields (payee, dates, bill, paid-from /
// accrual, and the account lines with a searchable account picker), the chart-of-accounts hook, and the attachment
// calls. The scan review and the Edit sheet both render PvFormFields, so a scanned draft and a hand-edited one are
// the same form.
import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import { M, M_ACCENT } from "../../theme";
import { Sheet } from "../../components";
import { Field, Tag } from "../so/so-ui";
import { card, ghost, input, miniLabel, sectionLabel } from "../so/so-style";
import { accrualAccounts, bankAccounts, lineAccounts, newPvLine, pvFormTotalSen, type CoaAccount, type PvForm } from "../../lib/pv-mobile";
import type { ScanLineMeta } from "../../lib/scan-pv";
import { sen } from "../scan/scan-fmt";

/** Searchable account picker (sheet). `options` are already filtered to what the field may use. */
export function AccountPicker({ open, title, options, current, onPick, onClose }: { open: boolean; title: string; options: CoaAccount[]; current: string; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((a) => a.code.toLowerCase().includes(t) || a.name.toLowerCase().includes(t)) : options).slice(0, 80);
  }, [options, q]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div style={{ position: "relative" }}>
        <Search size={15} strokeWidth={2} color={M.muted} style={{ position: "absolute", left: 12, top: 15 }} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name" aria-label="Search accounts" style={{ ...input(), marginTop: 0, paddingLeft: 34 }} />
      </div>
      <div style={{ ...card, marginTop: 10, padding: "0 14px", maxHeight: 360, overflowY: "auto" }}>
        {shown.length === 0 ? <div style={{ padding: "16px 0", fontSize: 13, color: M.ink }}>Nothing matches.</div> : null}
        {shown.map((a, i) => (
          <button key={a.code} type="button" onClick={() => onPick(a.code)} style={{ width: "100%", display: "block", textAlign: "left", padding: "9px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{a.code}{a.code === current ? <Tag kind="check">Current</Tag> : null}</span>
            <span style={{ display: "block", fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{a.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

const nameOf = (coa: CoaAccount[], code: string): string => coa.find((a) => a.code === code)?.name ?? "";

export function PvFormFields({ form, setForm, coa, meta }: { form: PvForm; setForm: (f: PvForm) => void; coa: CoaAccount[]; meta?: Record<string, { guess: ScanLineMeta["guess"]; isTax: boolean }> }) {
  const [pick, setPick] = useState<string | null>(null);
  const lineOpts = useMemo(() => lineAccounts(coa), [coa]);
  const banks = useMemo(() => bankAccounts(coa), [coa]);
  const accruals = useMemo(() => accrualAccounts(coa), [coa]);
  const patch = (p: Partial<PvForm>) => setForm({ ...form, ...p });
  const patchLine = (key: string, p: Partial<PvForm["lines"][number]>) => setForm({ ...form, lines: form.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) });
  return (
    <div>
      <div style={sectionLabel}>VOUCHER</div>
      <div style={{ ...card, padding: "4px 14px", marginTop: 8 }}>
        <Field first label="Payee" flag={form.payee.trim() ? undefined : "missing"}><input value={form.payee} onChange={(e) => patch({ payee: e.target.value })} aria-label="Payee" style={input(form.payee.trim() ? undefined : "missing")} /></Field>
        <Field label="Voucher date"><input type="date" value={form.date} onChange={(e) => patch({ date: e.target.value })} aria-label="Voucher date" style={input()} /></Field>
        <Field label="Description"><input value={form.description} onChange={(e) => patch({ description: e.target.value })} aria-label="Description" style={input()} /></Field>
        <Field label="Bill number"><input value={form.billNo} onChange={(e) => patch({ billNo: e.target.value })} aria-label="Bill number" style={input()} /></Field>
        <Field label="Bill date"><input type="date" value={form.billDate} onChange={(e) => patch({ billDate: e.target.value })} aria-label="Bill date" style={input()} /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${M.divider}`, fontSize: 13, color: M.raisin }}>
          <input type="checkbox" checked={form.accrued} onChange={(e) => patch({ accrued: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--m-taupe)" }} />
          Accrue it (pay later) instead of paying now
        </label>
        {form.accrued ? (
          <Field label="Accrual account" flag={form.accrualAccount ? undefined : "missing"}>
            <select value={form.accrualAccount} onChange={(e) => patch({ accrualAccount: e.target.value })} aria-label="Accrual account" style={input(form.accrualAccount ? undefined : "missing")}>
              <option value="">Pick the accrual account</option>
              {accruals.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Paid from" flag={form.payFrom ? undefined : "missing"}>
            <select value={form.payFrom} onChange={(e) => patch({ payFrom: e.target.value })} aria-label="Paid from" style={input(form.payFrom ? undefined : "missing")}>
              <option value="">Pick the bank or cash account</option>
              {banks.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Notes (internal)"><input value={form.notes} onChange={(e) => patch({ notes: e.target.value })} aria-label="Notes" style={input()} /></Field>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14 }}>
        <span style={sectionLabel}>LINES</span>
        <span style={{ fontSize: 12, color: M.muted }}>{form.lines.length} line{form.lines.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
        {form.lines.map((l, i) => {
          const m = meta?.[l.key];
          const n = i + 1;
          return (
            <div key={l.key} style={{ padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.muted }}>LINE {n}</span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => setForm({ ...form, lines: form.lines.filter((x) => x.key !== l.key) })} aria-label={`Remove line ${n}`} style={{ width: 32, height: 32, border: "none", background: "none", color: M.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={1.9} aria-hidden="true" /></button>
              </div>
              <label style={{ display: "block" }}>
                <span style={miniLabel}>DESCRIPTION</span>
                <input value={l.description} onChange={(e) => patchLine(l.key, { description: e.target.value })} aria-label={`Line ${n} description`} style={{ ...input(), marginTop: 3, height: 38, fontSize: 13.5 }} />
              </label>
              <div style={{ marginTop: 6 }}>
                <span style={miniLabel}>ACCOUNT</span>
                <button type="button" onClick={() => setPick(l.key)} aria-label={`Line ${n} account`} style={{ ...input(l.accountCode ? undefined : "missing"), marginTop: 3, height: 38, display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: "pointer", fontSize: 13.5 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.accountCode ? `${l.accountCode} · ${nameOf(coa, l.accountCode)}` : "Pick the account"}</span>
                  <ChevronRight size={15} strokeWidth={2} color={M.taupe} aria-hidden="true" />
                </button>
              </div>
              {m?.guess ? <div style={{ fontSize: 11.5, color: M_ACCENT.warning.fg, marginTop: 5 }}>{m.guess.source === "suggested" ? `Suggested — like ${m.guess.basis}` : m.guess.source === "payee-description" ? `Learned — this payee's “${m.guess.basis}”` : `Learned — this payee's usual account (${m.guess.basis})`}</div> : null}
              {m?.isTax ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 5 }}>SST added as its own line because the printed lines leave it out.</div> : null}
              <label style={{ display: "block", marginTop: 6 }}>
                <span style={miniLabel}>AMOUNT (RM)</span>
                <input value={l.amount} inputMode="decimal" onChange={(e) => patchLine(l.key, { amount: e.target.value })} aria-label={`Line ${n} amount`} style={{ ...input(), marginTop: 3, height: 38, textAlign: "right", fontSize: 13.5 }} />
              </label>
            </div>
          );
        })}
        <button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, newPvLine(`n${Date.now()}`)] })} style={{ ...ghost, height: 38, width: "100%", margin: "4px 0 12px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Plus size={15} strokeWidth={2} aria-hidden="true" /> Add line</button>
      </div>
      <div style={{ ...card, padding: "10px 14px", marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: M.raisin }}><span>Total</span><span>{sen(pvFormTotalSen(form))}</span></div>
      <AccountPicker
        open={pick != null}
        title="Account"
        options={lineOpts}
        current={form.lines.find((l) => l.key === pick)?.accountCode ?? ""}
        onClose={() => setPick(null)}
        onPick={(code) => { if (pick) patchLine(pick, { accountCode: code }); setPick(null); }}
      />
    </div>
  );
}
