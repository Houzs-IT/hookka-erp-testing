// ---------------------------------------------------------------------------
// Payment Vouchers on the phone: /m/finance/vouchers (list) and /m/finance/vouchers/:id (detail, edit, workflow).
// Reads GET /api/accounting/payment-vouchers (the desktop's list, lines and attachment counts included). Every action is
// the desktop's, by the same status rules and the same permission keys (lib/pv-mobile.ts):
//   Prepare / Withdraw (update) · Check / Reject (check) · Approve & post (approve) — one explicit tap each, never chained
//   Edit (DRAFT / PREPARED) · Edit posted voucher = restate · Void / Delete / Restore · Settle an accrual
// Attachments: view inline, add while the voucher is live, delete only while DRAFT / PREPARED (the server's rule).
// The phone edits the EXPENSE kind only; AP payments and fund transfers are listed and ride the ladder, their forms stay on the desktop.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, CircleCheck, FileText, MoreHorizontal, Paperclip, Pencil, Plus, ScanLine, Search, Trash2, Undo2 } from "lucide-react";
import { useCachedJson, invalidateCachePrefix, isUnknownOutcome } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { MobileCard, Sheet } from "../../components";
import { M, M_ACCENT } from "../../theme";
import { money } from "../../config/helpers";
import {
  PV_ACTION_LABEL, PV_ACTION_PERM, PV_CHIP_LABEL, bankAccounts, pvActions, pvBillNo, pvBody, pvChip, pvFormBlockers, pvFormFromRow, pvIsPosted, pvKind,
  type PvActionKey, type PvForm, type PvRaw,
} from "../../lib/pv-mobile";
import { BottomDock, PrimaryButton, SheetFooter, SheetSub } from "../delivery/ui";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { card, ghost, input, sectionLabel } from "../so/so-style";
import { Field } from "../so/so-ui";
import { FinanceHeader, FinanceNote, FinanceNoAccess } from "./finance-shell";
import { PvFormFields } from "./pv-ui";
import { attachPvFileOnce, listPvAttachments, useCoa, type PvAttachments } from "./pv-data";
import { ScanPvSheet } from "./ScanPvSheet";

type ListResp = { success?: boolean; data?: PvRaw[]; migrationMissing?: boolean };
const LIST_URL = "/api/accounting/payment-vouchers";
const s = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number => Math.round(Number(v) || 0);
const refreshAll = () => { invalidateCachePrefix("/api/accounting"); };

const CHIP_TONE: Record<string, { fg: string; bg: string }> = {
  DRAFT: { fg: M.ink, bg: M.divider }, PREPARED: { fg: M_ACCENT.warning.fg, bg: M_ACCENT.warning.bg }, CHECKED: { fg: M_ACCENT.warning.fg, bg: M_ACCENT.warning.bg },
  APPROVED: { fg: M_ACCENT.moss.fg, bg: M_ACCENT.moss.bg }, CANCELLED: { fg: M_ACCENT.danger.fg, bg: M_ACCENT.danger.bg },
};
function Chip({ chip }: { chip: string }) {
  const t = CHIP_TONE[chip] ?? CHIP_TONE.DRAFT;
  return <span style={{ display: "inline-block", height: 20, lineHeight: "20px", padding: "0 9px", borderRadius: 999, backgroundColor: t.bg, color: t.fg, fontSize: 11, fontWeight: 700 }}>{PV_CHIP_LABEL[chip] ?? chip}</span>;
}
const numberOf = (r: PvRaw): string => (s(r.pvNo).startsWith("DRAFT-") ? "No number yet" : s(r.pvNo));

// ================================ list ==================================================================================
const FILTERS = ["ALL", "DRAFT", "PREPARED", "CHECKED", "APPROVED", "CANCELLED"] as const;

export function VoucherListScreen() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { data, loading, error, refresh } = useCachedJson<ListResp>(LIST_URL);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.data ?? [])
      .filter((r) => filter === "ALL" || pvChip(r) === filter)
      .filter((r) => !t || [s(r.pvNo), s(r.payee), s(r.description), pvBillNo(r)].some((x) => x.toLowerCase().includes(t)));
  }, [data, filter, q]);
  if (!hasPermission("accounting", "read")) return <FinanceNoAccess title="Payment Vouchers" />;
  return (
    <>
      <FinanceHeader title="Payment Vouchers" trailing={hasPermission("accounting", "create") ? (
        <button type="button" onClick={() => setScanOpen(true)} aria-label="Scan a bill" style={{ width: 36, height: 36, border: "none", borderRadius: 18, background: M.divider, color: M.taupe, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ScanLine size={18} strokeWidth={2} aria-hidden="true" /></button>
      ) : undefined} />
      <div style={{ padding: "6px 14px 24px" }}>
        <div style={{ position: "relative" }}>
          <Search size={15} strokeWidth={2} color={M.muted} style={{ position: "absolute", left: 12, top: 15 }} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, payee, bill" aria-label="Search vouchers" style={{ ...input(), marginTop: 0, paddingLeft: 34 }} />
        </div>
        <div role="tablist" aria-label="Status" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "10px -14px 0", padding: "0 14px 4px" }}>
          {FILTERS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} style={{ flex: "none", height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${filter === f ? M.taupe : M.border}`, backgroundColor: filter === f ? M.taupe : M.card, color: filter === f ? M.paper : M.raisin, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{f === "ALL" ? "All" : PV_CHIP_LABEL[f]}</button>
          ))}
        </div>
        {loading && !data ? <FinanceNote>Loading…</FinanceNote> : null}
        {error && !data ? <FinanceNote tone="error">Could not load the vouchers. <button type="button" onClick={refresh} style={{ ...ghost, height: 34, padding: "0 12px", marginLeft: 6 }}>Retry</button></FinanceNote> : null}
        {data?.migrationMissing ? <FinanceNote tone="error">The vouchers could not be read (the server reported its tables are not ready).</FinanceNote> : null}
        {data && rows.length === 0 ? <FinanceNote>No vouchers match.</FinanceNote> : null}
        <MobileCard padded={false} radius={16} style={{ marginTop: 10, display: rows.length ? undefined : "none" }}>
          {rows.map((r, i) => {
            const kind = pvKind(r);
            return (
              <button key={s(r.id)} type="button" onClick={() => navigate(`/m/finance/vouchers/${encodeURIComponent(s(r.id))}`)} style={{ width: "100%", display: "block", textAlign: "left", padding: "12px 15px", background: "none", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", fontFamily: "inherit", cursor: "pointer" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{s(r.payee) || (kind === "TRANSFER" ? "Fund transfer" : "—")}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(n(r.totalSen))}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <Chip chip={pvChip(r)} />
                  <span style={{ fontSize: 12, color: M.ink }}>{numberOf(r)} · {s(r.date).slice(0, 10)}</span>
                  {kind !== "EXPENSE" ? <span style={{ fontSize: 11, fontWeight: 700, color: M.taupe }}>{kind === "AP" ? "AP payment" : "Transfer"}</span> : null}
                  {n(r.attachmentCount) > 0 ? <Paperclip size={12} strokeWidth={2} color={M.muted} aria-label="Has attachments" /> : null}
                </span>
              </button>
            );
          })}
        </MobileCard>
      </div>
      {scanOpen ? <ScanPvSheet open onClose={() => { setScanOpen(false); refresh(); }} /> : null}
    </>
  );
}

// ================================ detail ================================================================================
function ReasonSheet({ open, title, busy, onCancel, onConfirm }: { open: boolean; title: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onCancel} title={title}>
      <SheetSub>Sends the voucher back to draft. A reason is required.</SheetSub>
      <Field first label="Reason"><textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reject reason" rows={3} style={{ ...input(reason.trim() ? undefined : "missing"), height: "auto", padding: 10, resize: "vertical" }} /></Field>
      <SheetFooter onCancel={onCancel} confirmLabel="Reject" busy={busy} disabled={!reason.trim()} onConfirm={() => onConfirm(reason.trim())} />
    </Sheet>
  );
}

export function VoucherDetailScreen({ id }: { id: string }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { coa } = useCoa();
  const { data, loading, error, failure, refresh } = useCachedJson<ListResp>(LIST_URL);
  const r = useMemo(() => (data?.data ?? []).find((x) => s(x.id) === id) ?? null, [data, id]);
  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState<"edit" | "restate" | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [files, setFiles] = useState<PvAttachments | null>(null);
  const [filesTick, setFilesTick] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let live = true;
    void listPvAttachments(id).then((a) => { if (live) setFiles(a); });
    return () => { live = false; };
  }, [id, filesTick, r?.status, r?.approvalState, r?.approval_state]);

  const done = (msg: string) => { refreshAll(); refresh(); toast.show(msg, "success"); };
  const allowed = (k: PvActionKey) => hasPermission(...PV_ACTION_PERM[k]);

  const post = async (url: string, body: unknown): Promise<{ ok: true; data?: { pvNo?: string; state?: string } } | { ok: false; error: string }> => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { pvNo?: string; state?: string } } | null;
      return res.ok && j?.success ? { ok: true, data: j.data } : { ok: false, error: j?.error || `Failed (HTTP ${res.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  };

  const ladder = async (action: "prepare" | "withdraw" | "reject" | "check" | "approve", reason = "") => {
    if (!r) return;
    setBusy(true);
    const res = await post(`${LIST_URL}/${encodeURIComponent(id)}/approval`, { action, reason });
    setBusy(false);
    if (!res.ok) { toast.show(res.error, "error"); return false; }
    done(action === "check" ? `Checked — formal No. ${res.data?.pvNo ?? ""}` : action === "approve" ? `${res.data?.pvNo ?? s(r.pvNo)} approved & posted` : `${s(r.pvNo)} → ${res.data?.state ?? action}`);
    return true;
  };

  const run = async (k: PvActionKey) => {
    if (!r || busy) return;
    setMoreOpen(false);
    const no = numberOf(r);
    const total = money(n(r.totalSen));
    if (k === "EDIT") return setEditing("edit");
    if (k === "RESTATE") return setEditing("restate");
    if (k === "REJECT") return setRejectOpen(true);
    if (k === "SETTLE") return setSettleOpen(true);
    const lines: Record<string, { title: string; text: string; label: string }> = {
      PREPARE: { title: "Prepare voucher", text: "Moves the draft to Prepared. Nothing is posted.", label: "Prepare" },
      WITHDRAW: { title: "Withdraw voucher", text: "Takes the prepared voucher back to draft.", label: "Withdraw" },
      CHECK: { title: "Check voucher", text: "Moves it to Checked and issues its formal number. It is locked from editing until rejected. Nothing is posted yet.", label: "Check" },
      APPROVE: { title: "Approve & post", text: `Approves the voucher and posts ${total} to the ledger${Number(r.accrued) === 1 ? " (accrued)" : ` from ${s(r.payFrom)}`}. This is the step that books it.`, label: "Approve & post" },
      VOID: { title: "Void voucher", text: pvIsPosted(r) ? "Posts a reversal entry (nothing is deleted)." : "Cancels the voucher. It has no ledger entries yet.", label: "Void" },
      DELETE: { title: "Delete voucher", text: pvIsPosted(r) ? "Hides it from the ledger (still visible in the audit log)." : "Removes it from the list. It has no ledger entries.", label: "Delete" },
      UNVOID: { title: "Restore voucher", text: "Brings the cancelled voucher back.", label: "Restore" },
    };
    const spec = lines[k];
    const ok = await confirmSheet.confirm({ title: spec.title, sub: no, lines: [{ icon: k === "VOID" || k === "DELETE" ? "warning" : "info", text: spec.text }], confirmLabel: spec.label });
    if (!ok) return;
    if (k === "PREPARE" || k === "WITHDRAW" || k === "CHECK" || k === "APPROVE") { await ladder(k.toLowerCase() as "prepare" | "withdraw" | "check" | "approve"); return; }
    setBusy(true);
    const res = await post(`${LIST_URL}/${encodeURIComponent(id)}/lifecycle`, { action: k.toLowerCase() });
    setBusy(false);
    if (!res.ok) return toast.show(res.error, "error");
    refreshAll();
    if (k === "DELETE") { navigate("/m/finance/vouchers", { replace: true }); return; }
    done(k === "VOID" ? `${s(r.pvNo)} voided` : `${s(r.pvNo)} restored`);
  };

  const onPickFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    const res = await attachPvFileOnce(id, f);
    setBusy(false);
    if (!res.ok) return toast.show(res.error, "error");
    setFilesTick((t) => t + 1);
    refreshAll();
    toast.show(res.already ? "That file is already attached" : "Document attached", "success");
  };
  const removeFile = async (fileId: string, name: string) => {
    const ok = await confirmSheet.confirm({ title: "Remove document", sub: name, lines: [{ icon: "warning", text: "Removes this attachment from the voucher." }], confirmLabel: "Remove" });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`${LIST_URL}/${encodeURIComponent(id)}/attachments/${encodeURIComponent(fileId)}`, { method: "DELETE", credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) toast.show(j?.error || `Failed (HTTP ${res.status})`, "error");
      else { setFilesTick((t) => t + 1); refreshAll(); }
    } finally { setBusy(false); }
  };

  if (!hasPermission("accounting", "read")) return <FinanceNoAccess title="Payment Voucher" />;
  if (!r) {
    return (
      <>
        <FinanceHeader title="Payment Voucher" />
        {loading && !data ? <FinanceNote>Loading…</FinanceNote> : (error || isUnknownOutcome(failure)) && !data ? <FinanceNote tone="error">Could not load the voucher. <button type="button" onClick={refresh} style={{ ...ghost, height: 34, padding: "0 12px", marginLeft: 6 }}>Retry</button></FinanceNote> : <FinanceNote>This voucher was not found (it may have been deleted).</FinanceNote>}
      </>
    );
  }
  const acts = pvActions(r);
  const primaryAct = acts.primary && allowed(acts.primary) ? acts.primary : null;
  const menu = acts.menu.filter(allowed);
  const lines = Array.isArray(r.lines) ? (r.lines as PvRaw[]) : [];
  const chip = pvChip(r);
  const kind = pvKind(r);
  const facts: [string, string][] = ([
    ["Voucher date", s(r.date).slice(0, 10)], ["Bill number", pvBillNo(r)], ["Bill date", s(r.billDate ?? r.bill_date).slice(0, 10)],
    [Number(r.accrued) === 1 ? "Accrual account" : "Paid from", s(Number(r.accrued) === 1 ? r.accrualAccount : r.payFrom)], ["Notes", s(r.notes)],
  ] as [string, string][]).filter(([, v]) => v);
  const reject = s(r.rejectReason ?? r.reject_reason);

  return (
    <>
      <FinanceHeader title={numberOf(r)} trailing={menu.length ? (
        <button type="button" onClick={() => setMoreOpen(true)} aria-label="More actions" style={{ width: 36, height: 36, border: "none", borderRadius: 18, background: M.divider, color: M.raisin, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><MoreHorizontal size={18} strokeWidth={2} aria-hidden="true" /></button>
      ) : undefined} />
      <div style={{ padding: "6px 14px", paddingBottom: primaryAct ? 150 : 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Chip chip={chip} />
          {kind !== "EXPENSE" ? <span style={{ fontSize: 12, fontWeight: 700, color: M.taupe }}>{kind === "AP" ? "AP payment" : "Fund transfer"}</span> : null}
        </div>
        <h1 style={{ margin: "10px 0 0", fontSize: 20, lineHeight: 1.25, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{s(r.payee) || (kind === "TRANSFER" ? "Fund transfer" : "—")}</h1>
        <div style={{ fontSize: 22, fontWeight: 700, color: M.raisin, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{money(n(r.totalSen))}</div>
        {s(r.description) ? <div style={{ fontSize: 13, color: M.ink, marginTop: 4, overflowWrap: "anywhere" }}>{s(r.description)}</div> : null}
        {reject && chip === "DRAFT" ? <div role="note" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, fontSize: 12.5, color: "#3A352C", overflowWrap: "anywhere" }}>Rejected: {reject}</div> : null}
        {kind !== "EXPENSE" ? <div role="note" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, backgroundColor: M.divider, fontSize: 12.5, color: M.ink }}>{kind === "AP" ? "An AP payment" : "A fund transfer"} is edited on the desktop. You can still move it along the approval steps here.</div> : null}

        {facts.length ? (
          <div style={{ ...card, padding: "4px 14px", marginTop: 14 }}>
            {facts.map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none", fontSize: 13 }}>
                <span style={{ color: M.muted }}>{k}</span><span style={{ color: M.raisin, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
              </div>
            ))}
          </div>
        ) : null}

        {lines.length ? (
          <>
            <div style={{ ...sectionLabel, marginTop: 16 }}>LINES</div>
            <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
              {lines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{s(l.description) || s(l.accountCode)}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink }}>{s(l.accountCode)}</span>
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(n(l.amountSen))}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
          <span style={sectionLabel}>DOCUMENTS</span>
          {files?.canAdd && hasPermission("accounting", "update") ? (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...ghost, height: 32, padding: "0 12px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 5 }}><Plus size={14} strokeWidth={2} aria-hidden="true" /> Add document</button>
          ) : null}
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
        <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
          {files == null ? <div style={{ padding: "12px 0", fontSize: 12.5, color: M.muted }}>Documents could not be loaded.</div> : null}
          {files && files.rows.length === 0 ? <div style={{ padding: "12px 0", fontSize: 12.5, color: M.muted }}>No document attached.</div> : null}
          {files?.rows.map((f, i) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
              <FileText size={16} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />
              <a href={`/api/files/${encodeURIComponent(f.id)}/download?inline=1`} target="_blank" rel="noreferrer" aria-label={`View ${f.filename}`} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere", textDecoration: "none" }}>{f.filename}</a>
              {files.canDelete && hasPermission("accounting", "update") ? (
                <button type="button" onClick={() => void removeFile(f.id, f.filename)} aria-label={`Remove ${f.filename}`} style={{ width: 32, height: 32, border: "none", background: "none", color: M.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={1.9} aria-hidden="true" /></button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {primaryAct ? (
        <BottomDock variant="detail" scope="content">
          <PrimaryButton icon={primaryAct === "APPROVE" ? CircleCheck : primaryAct === "PREPARE" ? Pencil : CircleCheck} iconSize={17} onClick={() => void run(primaryAct)} disabled={busy} style={{ flex: 1.4 }}>
            {busy ? "Working…" : PV_ACTION_LABEL[primaryAct]}
          </PrimaryButton>
        </BottomDock>
      ) : null}

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
        <div style={{ ...card, padding: "0 14px" }}>
          {menu.map((k, i) => (
            <button key={k} type="button" onClick={() => void run(k)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 50, padding: "0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, textAlign: "left", cursor: "pointer", color: k === "VOID" || k === "DELETE" ? M_ACCENT.danger.fg : M.raisin }}>
              {k === "VOID" || k === "DELETE" ? <Ban size={17} strokeWidth={1.9} aria-hidden="true" /> : k === "UNVOID" ? <Undo2 size={17} strokeWidth={1.9} aria-hidden="true" /> : <Pencil size={17} strokeWidth={1.9} aria-hidden="true" />}
              {PV_ACTION_LABEL[k]}
            </button>
          ))}
        </div>
        <div style={{ height: 16 }} />
      </Sheet>

      <ReasonSheet open={rejectOpen} title="Reject to draft" busy={busy} onCancel={() => setRejectOpen(false)} onConfirm={(reason) => { void ladder("reject", reason).then((ok) => { if (ok) setRejectOpen(false); }); }} />
      <SettleSheet open={settleOpen} voucher={r} coa={coa} busy={busy} onCancel={() => setSettleOpen(false)} onConfirm={async (payFrom) => {
        setBusy(true);
        const res = await post(`${LIST_URL}/${encodeURIComponent(id)}/settle`, { payFrom });
        setBusy(false);
        if (!res.ok) return toast.show(res.error, "error");
        setSettleOpen(false);
        done(`${s(r.pvNo)} settled`);
      }} />
      {editing ? (
        <VoucherEditSheet
          voucher={r}
          restate={editing === "restate"}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); done(msg); }}
        />
      ) : null}
      {confirmSheet.node}
      {toast.node}
    </>
  );
}

function SettleSheet({ open, voucher, coa, busy, onCancel, onConfirm }: { open: boolean; voucher: PvRaw; coa: ReturnType<typeof useCoa>["coa"]; busy: boolean; onCancel: () => void; onConfirm: (payFrom: string) => void }) {
  const banks = useMemo(() => bankAccounts(coa), [coa]);
  const [pay, setPay] = useState("");
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onCancel} title="Settle accrual">
      <SheetSub>{`${s(voucher.pvNo)} · ${money(n(voucher.totalSen))} — pay from which account?`}</SheetSub>
      <Field first label="Paid from" flag={pay ? undefined : "missing"}>
        <select value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Settle paid from" style={input(pay ? undefined : "missing")}>
          <option value="">Pick the bank or cash account</option>
          {banks.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
        </select>
      </Field>
      <SheetFooter onCancel={onCancel} confirmLabel="Settle" busy={busy} disabled={!pay} onConfirm={() => onConfirm(pay)} />
    </Sheet>
  );
}

function VoucherEditSheet({ voucher, restate, onClose, onSaved }: { voucher: PvRaw; restate: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const { coa } = useCoa();
  const [form, setForm] = useState<PvForm>(() => pvFormFromRow(voucher));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const stops = pvFormBlockers(form, coa);
  const save = async () => {
    if (stops.length) return setErr(stops[0]);
    setBusy(true);
    setErr("");
    try {
      const url = restate ? `${LIST_URL}/${encodeURIComponent(s(voucher.id))}/restate` : `${LIST_URL}/${encodeURIComponent(s(voucher.id))}`;
      const res = await fetch(url, { method: restate ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(pvBody(form, false)) });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) { setErr(j?.error || `Failed (HTTP ${res.status})`); return; }
      onSaved(restate ? "Voucher restated" : "Voucher updated");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={busy ? () => undefined : onClose} title={restate ? "Edit posted voucher" : "Edit voucher"}>
      {restate ? <div role="note" style={{ margin: "0 0 10px", padding: "10px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, fontSize: 12.5, lineHeight: 1.45, color: "#3A352C" }}>This voucher is already posted. Saving reverses its ledger entries and posts the corrected ones under the same number.</div> : null}
      <PvFormFields form={form} setForm={setForm} coa={coa} />
      {err || stops.length ? <div role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: M_ACCENT.danger.fg, overflowWrap: "anywhere" }}>{err || stops[0]}</div> : null}
      <SheetFooter onCancel={onClose} confirmLabel={restate ? "Save and re-post" : "Save"} busy={busy} disabled={stops.length > 0} onConfirm={() => void save()} />
    </Sheet>
  );
}
