// ---------------------------------------------------------------------------
// An other debtor's / creditor's form as a popup (owner 2026-10-21 「只留
// Creditor List 一个入口，用弹窗编辑」 → 「可以，全部做」): the Debtor / Creditor
// List opens it for + New and for an other party's Edit, instead of sending
// the owner to the register page (which left the sidebar). The same fields
// and the same POST / PUT /api/accounting/other-parties as that page's form.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DocPopup } from "@/components/finance/doc-popup";
import { PartyFinanceFields } from "@/components/party/party-finance-fields";
import { asMutationResponse } from "../shared";

export type OtherPartyRecord = {
  id: string;
  type: "DEBTOR" | "CREDITOR";
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  tin?: string | null;
  registrationNo?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
  sstRegNo?: string | null;
  currency?: string | null;
  bankAccount?: string | null;
};

type Form = {
  type: "DEBTOR" | "CREDITOR"; name: string; contactPerson: string; phone: string; email: string; tin: string;
  registrationNo: string; address: string; notes: string; sstRegNo: string; currency: string; bankAccount: string;
};
const formOf = (side: "DEBTOR" | "CREDITOR", p: OtherPartyRecord | null): Form => ({
  type: side,
  name: p?.name ?? "", contactPerson: p?.contactPerson ?? "", phone: p?.phone ?? "", email: p?.email ?? "",
  tin: p?.tin ?? "", registrationNo: p?.registrationNo ?? "", address: p?.address ?? "", notes: p?.notes ?? "",
  sstRegNo: p?.sstRegNo ?? "", currency: p?.currency || "MYR", bankAccount: p?.bankAccount ?? "",
});

const inputCls = "w-full rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B5C32]";
const labelCls = "text-xs font-medium text-[#6B7280] mb-1 block";

export function OtherPartyFormPopup({ side, party, onClose, onSaved }: {
  side: "DEBTOR" | "CREDITOR";
  party: OtherPartyRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [start] = useState(() => formOf(side, party));
  const [form, setForm] = useState<Form>(start);
  const [saving, setSaving] = useState(false);
  const word = side === "DEBTOR" ? "Other Debtor" : "Other Creditor";
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const requestClose = async () => {
    if (saving) return;
    if (dirty && !(await confirm({ title: "Close without saving?", message: "What you typed in this form will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", danger: true }))) return;
    onClose();
  };
  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(party ? `/api/accounting/other-parties/${encodeURIComponent(party.id)}` : "/api/accounting/other-parties", {
        method: party ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = asMutationResponse(await res.json());
      if (j?.success) { toast.success(`${form.name.trim()} saved`); onSaved(); }
      else toast.error(j?.error || (party ? "Failed to update party" : "Failed to create party"));
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };
  const field = (key: keyof Form, label: string, placeholder?: string) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input type="text" value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={inputCls} aria-label={label} />
    </div>
  );
  return (
    <DocPopup
      title={party ? `Edit ${word} · ${party.name}` : `New ${word}`}
      onClose={() => void requestClose()}
      actions={<>
        <Button variant="outline" size="sm" onClick={() => void requestClose()} disabled={saving}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving || !form.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div data-other-party-form={side} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field("name", "Name", "e.g. ABC Transport Sdn Bhd")}
        {field("contactPerson", "Contact Person")}
        {field("phone", "Phone")}
        {field("email", "Email")}
        {field("registrationNo", "Registration No (SSM)", "e.g. 202301012345")}
        <div className="sm:col-span-3">
          <label className={labelCls}>Address</label>
          <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="Full address for statements / e-Invoice" className={inputCls} aria-label="Address" />
        </div>
        <div className="sm:col-span-3">
          <PartyFinanceFields
            labelClassName={labelCls}
            value={{ tin: form.tin, sstRegNo: form.sstRegNo, currency: form.currency, bankAccount: form.bankAccount }}
            onChange={(v) => setForm({ ...form, tin: v.tin, sstRegNo: v.sstRegNo, currency: v.currency, bankAccount: v.bankAccount })}
          />
        </div>
        <div className="sm:col-span-3">{field("notes", "Notes")}</div>
      </div>
    </DocPopup>
  );
}
