// ---------------------------------------------------------------------------
// Add / Edit supplier — the prototype's full-page form (Identity · Contact ·
// Address · Purchasing) with its "Unsaved" flag, inline errors, save-failed
// strip and "Discard changes?" dialog.
//   POST /api/suppliers      (suppliers:create)
//   PUT  /api/suppliers/:id  (suppliers:update) — sends only the fields drawn
//        here, never `materials`, so the SKU bindings are left alone. A rename
//        propagates to the supplier's documents server-side (the help says so).
// Email rules are the shared ones (src/lib/supplier-emails.ts); a failed save
// shows the server's own text (400 message / 403 missing permission).
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { DiscardDialog, FormArea, FormHead, FormInput, FormPage, FormSelect } from "./sup-kit";
import { EMPTY_FORM, STATUS, TERMS, formErrors, formOf, payloadOf, saveErrorText, termsLabel, type FormV, type SupStatus, type Supplier } from "./sup-lib";

export type OrgOpt = { code: string; name: string };

export function SupplierForm({ editing, orgs, onClose, onSaved }: {
  /** null = Add supplier. */
  editing: Supplier | null;
  orgs: OrgOpt[];
  onClose: () => void;
  onSaved: (r: { id: string; message: string }) => void;
}) {
  const init = useMemo<FormV>(() => (editing ? formOf(editing) : { ...EMPTY_FORM }), [editing]);
  const [v, setV] = useState<FormV>(init);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const set = (o: Partial<FormV>) => setV((x) => ({ ...x, ...o }));

  const E = formErrors(v);
  const errs = Object.values(E).filter(Boolean) as string[];
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const renamed = !!editing && v.name.trim() !== editing.name;
  const origTerms = editing?.terms ?? "";
  const otherTerms = !!origTerms && !(TERMS as readonly string[]).includes(origTerms);
  const termOpts = [...TERMS, ...(otherTerms ? [origTerms] : [])].map((k) => ({ v: k, l: termsLabel(k) }));
  const orgList = [...orgs];
  if (v.org && !orgList.some((o) => o.code === v.org)) orgList.push({ code: v.org, name: "" });
  const orgOpts = orgList.map((o) => ({ v: o.code, l: o.name ? `${o.code} — ${o.name}` : o.code }));
  const e = (k: keyof typeof E) => (tried ? E[k] : undefined);

  const cancel = () => {
    if (busy) return;
    if (dirty) setConfirm(true);
    else onClose();
  };
  const save = async () => {
    if (busy) return;
    if (errs.length) {
      setTried(true);
      setAttempt((x) => x + 1);
      return;
    }
    setBusy(true);
    setFail("");
    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch(editing ? `/api/suppliers/${encodeURIComponent(editing.id)}` : "/api/suppliers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadOf(v)),
      });
      status = res.status;
      body = await res.json().catch(() => null);
      const ok = res.ok && (body as { success?: boolean } | null)?.success !== false;
      if (!ok) throw new Error("save failed");
    } catch {
      setBusy(false);
      setFail(saveErrorText(status, body));
      setAttempt((x) => x + 1);
      return;
    }
    invalidateCachePrefix("/api/suppliers");
    const id = editing?.id ?? String((body as { data?: { id?: unknown } } | null)?.data?.id ?? "");
    setBusy(false);
    onSaved({ id, message: editing ? (renamed ? "Supplier renamed on its documents" : "Supplier updated") : "Supplier added" });
  };

  const err = fail || (tried && errs.length ? `Can't save yet — ${errs[0]}` : "");
  return (
    <>
      <FormPage open title={editing ? "Edit supplier" : "Add supplier"} dirty={dirty} onCancel={cancel} err={err} errTone={fail ? "bad" : "warn"}
        saveL={busy ? "Saving…" : editing ? "Update" : "Add supplier"} onSave={() => void save()} busy={busy} attempt={attempt}>
        <FormHead t="IDENTITY" />
        <FormInput l="Supplier code *" v={v.code} on={(x) => set({ code: x })} ph="SUP-XXX" err={e("code")} />
        <FormInput l="Supplier name *" v={v.name} on={(x) => set({ name: x })} ph="Company name" err={e("name")} auto="organization"
          help={editing ? (renamed ? "Saving renames this supplier on its existing POs, GRNs, invoices and other linked documents." : "Renaming updates the supplier name on its existing documents.") : undefined} />
        <FormInput l="Registration no. (SSM)" v={v.ssm} on={(x) => set({ ssm: x })} ph="e.g. 201901012345" />
        <FormHead t="CONTACT" />
        <FormInput l="Contact person" v={v.contact} on={(x) => set({ contact: x })} ph="Full name" />
        <FormInput l="Phone" v={v.phone} on={(x) => set({ phone: x })} mode="tel" ph="012-345 6789" />
        <FormInput l="Email" v={v.email} on={(x) => set({ email: x })} mode="email" ph="a@x.com, b@y.com" err={e("email")} help="The PO email goes to every address here." />
        <FormInput l="Email 2" v={v.email2} on={(x) => set({ email2: x })} mode="email" ph="Cc on PO emails" err={e("email2")} />
        <FormInput l="Email 3" v={v.email3} on={(x) => set({ email3: x })} mode="email" ph="Cc on PO emails" err={e("email3")} />
        <FormHead t="ADDRESS" />
        <FormArea l="Address" v={v.address} on={(x) => set({ address: x })} ph="Full address" />
        <FormHead t="PURCHASING" />
        <FormSelect l="Payment terms" v={v.terms} on={(x) => set({ terms: x })} opts={termOpts}
          help={otherTerms ? `${termsLabel(origTerms)} is kept because it's already saved. It isn't offered for new suppliers.` : undefined} />
        <FormSelect l="Purchase company" v={v.org} on={(x) => set({ org: x })} opts={orgOpts}
          help="Letterhead printed on this supplier's PO. HOOKKA INDUSTRIES is always the legal buyer." />
        <FormSelect l="Status" v={v.status} on={(x) => set({ status: x as SupStatus })} opts={(Object.keys(STATUS) as SupStatus[]).map((k) => ({ v: k, l: STATUS[k].l }))} />
      </FormPage>
      <DiscardDialog open={confirm} onKeep={() => setConfirm(false)} onDiscard={() => { setConfirm(false); onClose(); }} />
    </>
  );
}
