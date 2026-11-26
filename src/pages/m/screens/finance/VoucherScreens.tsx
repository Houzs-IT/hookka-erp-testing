// ---------------------------------------------------------------------------
// Payment Vouchers on the phone (Batch 3 prototype: pvB / pvdB / pvActs): /m/finance/vouchers (list) and
// /m/finance/vouchers/:id (detail, edit, workflow).
// Reads GET /api/accounting/payment-vouchers (the desktop's list, lines and attachment counts included). Every action is
// the desktop's, by the same status rules and the same permission keys (lib/pv-mobile.ts):
//   Prepare / Withdraw (update) · Check / Reject (check) · Approve & post (approve) — one explicit tap each, never chained
//   Edit (DRAFT / PREPARED) · Edit posted voucher = restate · Void / Delete / Restore · Settle an accrual
// Every one of them is confirmed in the prototype's dialog first (reject asks for a reason, settle for the account).
// Attachments: view inline, add while the server allows it, delete only while DRAFT / PREPARED (the server's rule).
// The phone edits the EXPENSE kind only; AP payments and fund transfers are listed and ride the ladder, their forms stay
// on the desktop.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ban, BadgeCheck, Camera, ClipboardCheck, Clock, CloudOff, Database, ExternalLink, FileSearch, FileText, ListOrdered, Lock, Monitor,
  Paperclip, Pencil, RefreshCw, RotateCcw, ScanLine, Send, Trash2, Undo, Undo2, Upload, Wallet, type LucideIcon, Ellipsis } from "lucide-react";
import { useCachedJson, invalidateCachePrefix, isUnknownOutcome } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import {
  PV_ACTION_LABEL, PV_ACTION_PERM, PV_CHIP_LABEL, bankAccounts, pvActions, pvBillNo, pvBody, pvChip, pvFormBlockers, pvFormFromRow, pvIsPosted, pvKind,
  type CoaAccount, type PvActionKey, type PvForm, type PvRaw,
} from "../../lib/pv-mobile";
import { FinBanner, FinCard, FinChips, FinDock, FinDoc, FinHero, FinLabel, FinScreen, FinSearch, FinSheet, FinSkel, FinState, type Row, type SheetRow } from "./fin-kit";
import { F, dayMon, docAmt, rm } from "./fin-format";
import { useFinToast } from "./fin-toast";
import { FinPage, PageBanner, type DialogSpec } from "./fin-overlay";
import { useFinDialog } from "./fin-dialog";
import { PvFormFields } from "./pv-ui";
import { attachPvFileOnce, listPvAttachments, useCoa, type PvAttachment, type PvAttachments } from "./pv-data";
import { ScanPvSheet } from "./ScanPvSheet";

type ListResp = { success?: boolean; data?: PvRaw[]; migrationMissing?: boolean };
const LIST_URL = "/api/accounting/payment-vouchers";
const s = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number => Math.round(Number(v) || 0);
const refreshAll = () => { invalidateCachePrefix("/api/accounting"); };

/** The prototype's status colours: [text, background]. */
const PVST: Record<string, [string, string]> = {
  DRAFT: ["#6B7280", "#F5F2ED"], PREPARED: ["#3E6570", "#E0EDF0"], CHECKED: ["#3E6570", "#E0EDF0"],
  APPROVED: ["#4F7C3A", "#EEF3E4"], CANCELLED: ["#9A3A2D", "#F9E1DA"],
};
const numberOf = (r: PvRaw): string => (s(r.pvNo).startsWith("DRAFT-") || !s(r.pvNo) ? "No number yet" : s(r.pvNo));
const kindLabel = (r: PvRaw): string => (pvKind(r) === "AP" ? "AP payment" : pvKind(r) === "TRANSFER" ? "Fund transfer" : "Expense");
const payeeOf = (r: PvRaw): string => s(r.payee) || (pvKind(r) === "TRANSFER" ? "Fund transfer" : "—");
const accrued = (r: PvRaw): boolean => Number(r.accrued) === 1;
const acctCode = (r: PvRaw): string => s(accrued(r) ? r.accrualAccount ?? r.accrual_account : r.payFrom ?? r.pay_from);
const acctName = (coa: CoaAccount[], code: string): string => coa.find((a) => a.code === code)?.name ?? "";
const fileSub = (f: PvAttachment): string => {
  const kind = (f.contentType ?? "").includes("pdf") ? "PDF" : (f.contentType ?? "").startsWith("image/") ? "Image" : "File";
  const size = f.sizeBytes ? (f.sizeBytes >= 1048576 ? `${(f.sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.sizeBytes / 1024))} KB`) : "";
  return [kind, size].filter(Boolean).join(" · ");
};

// ================================ list ==================================================================================
const FILTERS = ["ALL", "DRAFT", "PREPARED", "CHECKED", "APPROVED", "CANCELLED"] as const;
type Filter = (typeof FILTERS)[number];

export function VoucherListScreen() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { coa } = useCoa();
  const { data, loading, error, refresh } = useCachedJson<ListResp>(LIST_URL);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const all = data?.data ?? [];
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all
      .filter((r) => filter === "ALL" || pvChip(r) === filter)
      .filter((r) => !t || [s(r.pvNo), s(r.payee), s(r.description), pvBillNo(r)].some((x) => x.toLowerCase().includes(t)));
  }, [all, filter, q]);
  const back = () => navigate("/m/finance");
  if (!hasPermission("accounting", "read")) {
    return (
      <FinScreen title="Payment Vouchers" onBack={back}>
        <FinState icon={Lock} bg={F.track} c={F.muted} t="No access" s="You don't have permission for this page." />
      </FinScreen>
    );
  }
  const canScan = hasPermission("accounting", "create");
  return (
    <FinScreen
      title="Payment Vouchers"
      onBack={back}
      actions={canScan ? [{ icon: ScanLine, aria: "Scan a bill to create a draft", gold: true, onTap: () => setScanOpen(true) }] : undefined}
    >
      {loading && !data ? (
        <FinSkel n={3} h={108} />
      ) : error && !data ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load vouchers" s="Could not load the vouchers. The finance service didn't answer." btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : data?.migrationMissing ? (
        <FinState icon={Database} bg="#FAEFCB" c="#85600F" t="Payment vouchers aren't set up yet" s="The vouchers could not be read (the server reported its tables are not ready)." />
      ) : (
        <>
          <FinSearch v={q} on={setQ} ph="Voucher no., payee or bill" />
          <FinChips
            opts={FILTERS.map((f) => ({
              k: f,
              l: f === "ALL" ? "All" : PV_CHIP_LABEL[f],
              n: f === "ALL" ? all.length : all.filter((r) => pvChip(r) === f).length,
              dot: f === "ALL" ? undefined : PVST[f][0],
            }))}
            cur={filter}
            set={setFilter}
          />
          <FinLabel l={`${rows.length} ${rows.length === 1 ? "VOUCHER" : "VOUCHERS"}`} r={rm(rows.reduce((t, r) => t + n(r.totalSen), 0))} />
          {rows.length === 0 ? (
            <FinState icon={FileSearch} bg={F.cream} c={F.gold} t="No vouchers" s={q.trim() ? "Nothing matches your search." : "No vouchers in this status."} />
          ) : (
            rows.map((r) => {
              const chip = pvChip(r);
              const [fg, bg] = PVST[chip] ?? PVST.DRAFT;
              const code = acctCode(r);
              const bill = pvBillNo(r);
              const files = n(r.attachmentCount);
              return (
                <FinDoc
                  key={s(r.id)}
                  test="pv-card"
                  code={numberOf(r)}
                  st={PV_CHIP_LABEL[chip]}
                  stFg={fg}
                  stBg={bg}
                  rail={fg}
                  date={dayMon(s(r.date))}
                  party={payeeOf(r)}
                  op={chip === "CANCELLED" ? 0.65 : 1}
                  aria={`${payeeOf(r)}, ${PV_CHIP_LABEL[chip]}`}
                  refs={[
                    { k: "Type", v: kindLabel(r) },
                    ...(bill ? [{ k: "Bill", v: bill }] : []),
                    ...(files > 0 ? [{ k: "Files", v: String(files) }] : []),
                    ...(n(r.advanceOpenSen) > 0 ? [{ k: "Advance", v: "Open" }] : []),
                  ]}
                  amts={[
                    docAmt("Total", rm(n(r.totalSen)), { gold: true }),
                    docAmt(accrued(r) ? "Accrual" : "Paid from", code ? acctName(coa, code) || code : "—", { fs: 12.5 }),
                  ]}
                  onTap={() => navigate(`/m/finance/vouchers/${encodeURIComponent(s(r.id))}`)}
                />
              );
            })
          )}
        </>
      )}
      {scanOpen ? <ScanPvSheet open onClose={() => { setScanOpen(false); refresh(); }} /> : null}
    </FinScreen>
  );
}

// ================================ detail ================================================================================
const PRIMARY_ICON: Partial<Record<PvActionKey, LucideIcon>> = { PREPARE: Send, CHECK: ClipboardCheck, APPROVE: BadgeCheck };
const MENU_ICON: Record<PvActionKey, LucideIcon> = {
  EDIT: Pencil, PREPARE: Send, WITHDRAW: Undo, REJECT: Undo2, CHECK: ClipboardCheck, APPROVE: BadgeCheck,
  RESTATE: Pencil, SETTLE: Wallet, VOID: Ban, DELETE: Trash2, UNVOID: RotateCcw,
};
const DANGER = new Set<PvActionKey>(["VOID", "DELETE", "REJECT"]);

export function VoucherDetailScreen({ id }: { id: string }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { coa } = useCoa();
  const { data, loading, error, failure, refresh } = useCachedJson<ListResp>(LIST_URL);
  const r = useMemo(() => (data?.data ?? []).find((x) => s(x.id) === id) ?? null, [data, id]);
  const toast = useFinToast();
  const dialog = useFinDialog();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState<"edit" | "restate" | null>(null);
  const [files, setFiles] = useState<PvAttachments | null>(null);
  const [filesTick, setFilesTick] = useState(0);
  const [docOpen, setDocOpen] = useState<PvAttachment | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const camRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const back = () => navigate("/m/finance/vouchers");

  useEffect(() => {
    let live = true;
    void listPvAttachments(id).then((a) => { if (live) setFiles(a); });
    return () => { live = false; };
  }, [id, filesTick, r?.status, r?.approvalState, r?.approval_state]);

  const done = (msg: string) => { refreshAll(); refresh(); toast.show(msg); };
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
    if (!r) return false;
    setBusy(true);
    const res = await post(`${LIST_URL}/${encodeURIComponent(id)}/approval`, { action, reason });
    setBusy(false);
    if (!res.ok) { toast.show(res.error); return false; }
    done(action === "check" ? `Checked — formal No. ${res.data?.pvNo ?? ""}` : action === "approve" ? `${res.data?.pvNo ?? s(r.pvNo)} approved & posted` : `${s(r.pvNo)} → ${res.data?.state ?? action}`);
    return true;
  };

  // Reject (a reason is required), settle (pick the bank / cash account) and edit-a-posted-voucher, each behind its dialog.
  const rejectFlow = async () => {
    const reason = await dialog.ask({ title: "Reject to draft?", body: "It goes back to Draft for changes. Tell them why — a reason is required.", icon: Undo2, okL: "Reject", danger: true, reason: true });
    if (reason) await ladder("reject", reason);
  };
  const settleFlow = async () => {
    if (!r) return;
    const banks = bankAccounts(coa).map((a) => ({ v: a.code, l: `${a.code} · ${a.name}` }));
    const payFrom = await dialog.ask({ title: "Settle accrual", body: `${s(r.pvNo)} · ${rm(n(r.totalSen))} — pick the bank or cash account it was paid from.`, icon: Wallet, okL: "Settle", accounts: banks });
    if (!payFrom) return;
    setBusy(true);
    const res = await post(`${LIST_URL}/${encodeURIComponent(id)}/settle`, { payFrom });
    setBusy(false);
    if (!res.ok) return toast.show(res.error);
    done(`${s(r.pvNo)} settled`);
  };
  const restateFlow = async () => {
    if (!r) return;
    const ok = await dialog.ask({ title: "Edit a posted voucher?", body: `This voucher is already posted. Saving reverses its ledger entries and posts the corrected ones under the same number ${s(r.pvNo)}.`, icon: RefreshCw, okL: "Continue" });
    if (ok !== null) setEditing("restate");
  };

  const run = async (k: PvActionKey) => {
    if (!r || busy) return;
    setMoreOpen(false);
    if (k === "EDIT") return setEditing("edit");
    if (k === "RESTATE") return void restateFlow();
    if (k === "REJECT") return void rejectFlow();
    if (k === "SETTLE") return void settleFlow();
    const total = rm(n(r.totalSen));
    const lines: Record<string, Omit<DialogSpec, "icon"> & { icon: LucideIcon }> = {
      PREPARE: { title: "Prepare this voucher?", body: "Moves the draft to Prepared. Nothing is posted.", okL: "Prepare", icon: Send },
      WITHDRAW: { title: "Withdraw to draft?", body: "Takes the prepared voucher back to draft.", okL: "Withdraw", icon: Undo },
      CHECK: { title: "Check this voucher?", body: "Moves it to Checked and issues its formal number. It is locked from editing until rejected. Nothing is posted yet.", okL: "Check", icon: ClipboardCheck },
      APPROVE: { title: "Approve and post?", body: `Approves the voucher and posts ${total} to the ledger${accrued(r) ? " (accrued)" : ` from ${s(r.payFrom)}`}. This is the step that books it.`, okL: "Approve & post", icon: BadgeCheck },
      VOID: { title: "Void this voucher?", body: pvIsPosted(r) ? "It's posted — voiding posts a reversal entry (nothing is deleted)." : "It's not posted — it will be cancelled. It has no ledger entries yet.", okL: "Void", danger: true, icon: Ban },
      DELETE: { title: "Delete this voucher?", body: pvIsPosted(r) ? "Hides it from the ledger (still visible in the audit log)." : "Removes it from the list. It has no ledger entries.", okL: "Delete", danger: true, icon: Trash2 },
      UNVOID: { title: "Restore this voucher?", body: "Brings the cancelled voucher back.", okL: "Restore", icon: RotateCcw },
    };
    const ok = await dialog.ask(lines[k]);
    if (ok === null) return;
    if (k === "PREPARE" || k === "WITHDRAW" || k === "CHECK" || k === "APPROVE") { await ladder(k.toLowerCase() as "prepare" | "withdraw" | "check" | "approve"); return; }
    setBusy(true);
    const res = await post(`${LIST_URL}/${encodeURIComponent(id)}/lifecycle`, { action: k.toLowerCase() });
    setBusy(false);
    if (!res.ok) return toast.show(res.error);
    refreshAll();
    if (k === "DELETE") { navigate("/m/finance/vouchers", { replace: true }); return; }
    done(k === "VOID" ? `${s(r.pvNo)} voided` : `${s(r.pvNo)} restored`);
  };

  const onPickFile = async (f: File | undefined) => {
    setAttachOpen(false);
    if (!f) return;
    setBusy(true);
    const res = await attachPvFileOnce(id, f);
    setBusy(false);
    if (!res.ok) return toast.show(res.error);
    setFilesTick((t) => t + 1);
    refreshAll();
    toast.show(res.already ? "That file is already on the voucher — nothing to add" : "Document added");
  };
  const removeFile = async (f: PvAttachment) => {
    setDocOpen(null);
    const ok = await dialog.ask({ title: "Remove this document?", body: `${f.filename} is taken off the voucher.`, icon: Trash2, okL: "Remove", danger: true });
    if (ok === null) return;
    setBusy(true);
    try {
      const res = await fetch(`${LIST_URL}/${encodeURIComponent(id)}/attachments/${encodeURIComponent(f.id)}`, { method: "DELETE", credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) toast.show(j?.error || `Failed (HTTP ${res.status})`);
      else { setFilesTick((t) => t + 1); refreshAll(); toast.show("Document removed"); }
    } finally { setBusy(false); }
  };

  if (!hasPermission("accounting", "read")) {
    return (
      <FinScreen title="Payment Voucher" onBack={back}>
        <FinState icon={Lock} bg={F.track} c={F.muted} t="No access" s="You don't have permission for this page." />
      </FinScreen>
    );
  }
  if (!r) {
    return (
      <FinScreen title="Payment Voucher" onBack={back}>
        {loading && !data ? (
          <FinSkel n={3} h={108} />
        ) : (error || isUnknownOutcome(failure)) && !data ? (
          <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the voucher" s="Could not load the voucher." btn={{ l: "Try again", onTap: () => refresh() }} />
        ) : (
          <FinState icon={FileSearch} bg={F.cream} c={F.gold} t="Voucher not found" s="This voucher was not found (it may have been deleted)." />
        )}
      </FinScreen>
    );
  }

  const acts = pvActions(r);
  const primaryAct = acts.primary && allowed(acts.primary) ? acts.primary : null;
  const menu = acts.menu.filter((k) => hasPermission(...PV_ACTION_PERM[k]));
  const lines = Array.isArray(r.lines) ? (r.lines as PvRaw[]) : [];
  const chip = pvChip(r);
  const kind = pvKind(r);
  const reject = s(r.rejectReason ?? r.reject_reason);
  const code = acctCode(r);
  const canUpdate = hasPermission("accounting", "update");
  const kv = (l: string, v: string, i: number): Row => ({ key: l, l, w: 500, lc: F.muted, fs: 12.5, v: v || "—", vfs: 12.5, vw: 600, bt: i ? undefined : "none" });
  const details: Row[] = [
    ["Description", s(r.description)],
    ["Voucher date", s(r.date).slice(0, 10)],
    ["Bill number", pvBillNo(r)],
    ["Bill date", s(r.billDate ?? r.bill_date).slice(0, 10)],
    [accrued(r) ? "Accrual account" : "Paid from", code ? `${code}${acctName(coa, code) ? ` · ${acctName(coa, code)}` : ""}` : ""],
    ["Notes", s(r.notes)],
  ].map(([l, v], i) => kv(l, v, i));
  const lineRows: Row[] = [
    ...lines.map((l, i) => ({
      key: `l${i}`,
      l: `${s(l.accountCode)}${acctName(coa, s(l.accountCode)) ? ` · ${acctName(coa, s(l.accountCode))}` : ""}`,
      s: s(l.description) || undefined,
      v: rm(n(l.amountSen)),
    })),
    { key: "total", l: "Total", w: 800, v: rm(n(r.totalSen)), vw: 800, bg: F.cream },
  ];
  const fileRows: Row[] | undefined = files && files.rows.length
    ? files.rows.map((f) => ({ key: f.id, l: f.filename, s: fileSub(f), go: true, onTap: () => setDocOpen(f) }))
    : undefined;
  const nFiles = files?.rows.length ?? 0;
  const menuRows: SheetRow[] = menu.map((k) => ({
    key: k,
    l: PV_ACTION_LABEL[k],
    icon: MENU_ICON[k],
    icBg: DANGER.has(k) ? "#FBE7E3" : F.cream,
    icC: DANGER.has(k) ? F.neg : F.gold,
    lc: k === "VOID" || k === "DELETE" ? F.neg : F.ink,
    w: 700,
    onTap: () => void run(k),
  }));
  const docRemovable = !!files?.canDelete && canUpdate;

  return (
    <FinScreen
      title={numberOf(r) === "No number yet" ? "Draft voucher" : numberOf(r)}
      onBack={back}
      // With no step to take, the remaining actions sit behind the header's "…" (like the other detail pages), not a floating dock.
      actions={!primaryAct && menu.length ? [{ icon: Ellipsis, aria: "More actions", onTap: () => setMoreOpen(true) }] : undefined}
      dock={!!primaryAct}
    >
      <FinHero k={`${kindLabel(r)} voucher`} tag={PV_CHIP_LABEL[chip]} v={rm(n(r.totalSen))} s={`${payeeOf(r)} · ${numberOf(r)}`} />
      {reject && chip === "DRAFT" ? <FinBanner tone="bad" icon={Undo2} t="Rejected to draft:" s={reject} /> : null}
      {kind !== "EXPENSE" ? <FinBanner tone="info" icon={Monitor} t="Edit on desktop." s={`Changes to ${kindLabel(r).toLowerCase()} vouchers are made on desktop. You can still prepare, check and approve here.`} /> : null}
      {chip === "APPROVED" && accrued(r) && !(r.settledAt ?? r.settled_at) ? <FinBanner tone="warn" icon={Clock} t="Accrued, not settled." s="Settle it once it's paid from a bank or cash account." /> : null}
      <FinCard title="Details" icon={FileText} rows={details} />
      <FinCard title="Account lines" icon={ListOrdered} head={{ a: "Account", b: "RM" }} rows={lineRows} />
      <FinCard
        title="Supporting documents"
        icon={Paperclip}
        sub={files == null ? "Couldn't be loaded" : nFiles ? `${nFiles} file${nFiles === 1 ? "" : "s"}` : "None yet"}
        rows={fileRows}
        empty={files == null ? "Documents could not be loaded." : nFiles ? undefined : "No document attached."}
        btn={files?.canAdd && canUpdate ? { l: busy ? "Working…" : "Add photo or PDF", onTap: () => setAttachOpen(true) } : undefined}
      />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />

      {primaryAct ? (
        <FinDock
          primary={{ l: PV_ACTION_LABEL[primaryAct], icon: PRIMARY_ICON[primaryAct], busy, onTap: () => void run(primaryAct) }}
          more={menu.length ? () => setMoreOpen(true) : null}
        />
      ) : null}

      <FinSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Voucher actions" sub={numberOf(r)} rows={menuRows} />
      <FinSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Add document"
        sub="Image or PDF"
        rows={[
          { key: "cam", l: "Take a photo", icon: Camera, w: 700, onTap: () => camRef.current?.click() },
          { key: "up", l: "Upload a file", icon: Upload, w: 700, onTap: () => fileRef.current?.click() },
        ]}
      />
      <FinSheet
        open={!!docOpen}
        onClose={() => setDocOpen(null)}
        title={docOpen?.filename ?? ""}
        sub="Supporting document"
        rows={docOpen ? [
          { key: "view", l: "View document", s: "Opens in a new tab", icon: ExternalLink, w: 700, onTap: () => { window.open(`/api/files/${encodeURIComponent(docOpen.id)}/download?inline=1`, "_blank", "noopener"); } },
          ...(docRemovable ? [{ key: "rm", l: "Remove document", icon: Trash2, icBg: "#FBE7E3", icC: F.neg, lc: F.neg, w: 700, onTap: () => void removeFile(docOpen) }] : []),
        ] : null}
        note={docOpen && canUpdate && !docRemovable ? "Documents can only be removed while the voucher is Draft or Prepared." : undefined}
      />
      {editing ? (
        <VoucherEditPage
          voucher={r}
          restate={editing === "restate"}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); done(msg); }}
        />
      ) : null}
      {dialog.node}
      {toast.node}
    </FinScreen>
  );
}

function VoucherEditPage({ voucher, restate, onClose, onSaved }: { voucher: PvRaw; restate: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const { coa } = useCoa();
  const [form, setForm] = useState<PvForm>(() => pvFormFromRow(voucher));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState("");
  const stops = pvFormBlockers(form, coa);
  const save = async () => {
    if (busy) return;
    if (stops.length) { setTried(true); return; }
    setBusy(true);
    setErr("");
    try {
      const url = restate ? `${LIST_URL}/${encodeURIComponent(s(voucher.id))}/restate` : `${LIST_URL}/${encodeURIComponent(s(voucher.id))}`;
      const res = await fetch(url, { method: restate ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(pvBody(form, false)) });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) { setErr(j?.error || `Failed (HTTP ${res.status})`); return; }
      onSaved(restate ? "Voucher restated" : "Voucher saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally { setBusy(false); }
  };
  return (
    <FinPage
      open
      title={restate ? "Edit posted voucher" : "Edit voucher"}
      onCancel={busy ? () => undefined : onClose}
      err={err || (tried && stops.length ? stops[0] : "")}
      foot={{ l: busy ? "Saving…" : restate ? "Save and re-post" : "Save changes", onTap: () => void save(), disabled: busy }}
    >
      {restate ? <PageBanner icon={RefreshCw} bg="#FAEFCB" fg="#85600F" t="This voucher is already posted. Saving reverses its ledger entries and posts the corrected ones under the same number." /> : null}
      <PvFormFields form={form} setForm={setForm} coa={coa} tried={tried} />
    </FinPage>
  );
}
