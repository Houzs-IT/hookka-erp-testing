// ---------------------------------------------------------------------------
// AuditLogTab — Accounting → Audit Log.
//
// Two views (finance backlog item 10, the design's "a full Audit Log of every
// change"):
//   · All changes (default) — every change made in Finance in a month: who,
//     when, what (posted / edited / voided / restored / undone / deleted, the
//     payment-voucher ladder, settings), from GET /api/accounting/change-log;
//     double-click a row for the change itself (an edit's ledger lines before
//     and after, a setting's fields before and after).
//   · Voided & deleted — every document currently VOID or DELETED (newest
//     action first) with who/when, and Unvoid — the only way back for DELETED
//     docs, which are hidden from the normal document lists. Each sourceType
//     maps to its /lifecycle endpoint to repost the unvoid.
//
// Extracted verbatim from accounting/index.tsx (2026-07-04 file split). Since
// 2026-10-17 the list is the Payment Vouchers table (DataGrid: header menu,
// filters, resize / reorder, Set as default, its own search); Unvoid is the
// row's right-click / ⋮ menu and its double-click.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { LifecycleBadge } from "@/components/accounting/lifecycle-actions";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { FinanceTitleActions } from "@/components/finance/title-actions";
import { PeriodStepper, ReportToolbar, SegmentedSwitch } from "@/components/finance/report-shell";
import { FinPill } from "@/components/finance/pill";
import type { FinTone } from "@/lib/finance-daily";
import { CHANGE_KIND_LABEL, myTime, type ChangeKind } from "@/lib/change-log";
import { monthOptions, periodLabel, fmtAmt } from "@/lib/finance-reports";
import { useEscapeClose } from "@/lib/escape-stack";
import { todayYmdMY } from "@/lib/utils";
import { asMutationResponse } from "../shared";

type AuditRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  state: string;
  actionAt: string | null;
  actorUserId: string | null;
  actorName?: string | null;
  reference?: string;
  party?: string;
  amountSen?: number;
  docDate?: string;
};

const AUDIT_DOC_MAP: Record<string, { label: string; base: string }> = {
  payment_voucher: { label: "Expense Payment", base: "/api/accounting/payment-vouchers" },
  official_receipt: { label: "Official Receipt", base: "/api/accounting/official-receipts" },
  manual: { label: "Journal Entry", base: "/api/accounting/journals" },
  fund_transfer: { label: "Fund Transfer", base: "/api/accounting/fund-transfers" },
  other_party_bill: { label: "Other Party Bill", base: "/api/accounting/other-party-bills" },
  other_party_payment: { label: "Other Party Payment", base: "/api/accounting/other-party-payments" },
  supplier_payment: { label: "Supplier Payment", base: "/api/supplier-payments" },
};

const typeLabel = (r: AuditRow) => AUDIT_DOC_MAP[r.sourceType]?.label ?? r.sourceType;
const whenText = (r: AuditRow) => (r.actionAt ? r.actionAt.slice(0, 19).replace("T", " ") : "—");

type AuditView = "all" | "voided";

export function AuditLogTab() {
  const today = todayYmdMY();
  const [view, setView] = useState<AuditView>("all");
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const monthOpts = useMemo(() => monthOptions(today.slice(0, 7), 24), [today]);
  return (
    <div className="space-y-4">
      {/* The page title and its (i) name the page (finance v2). */}
      <FinanceTitleActions>
        <ReportToolbar>
          <SegmentedSwitch<AuditView>
            label="Audit Log view"
            options={[
              { key: "all", label: "All changes", hint: "Every change made in Finance, month by month" },
              { key: "voided", label: "Voided & deleted", hint: "Documents voided or deleted now — restore them here" },
            ]}
            value={view}
            onChange={setView}
          />
          {view === "all" && <PeriodStepper value={month} options={monthOpts} onChange={setMonth} today={today} />}
        </ReportToolbar>
      </FinanceTitleActions>
      {view === "all" ? <ChangeLogView month={month} today={today} /> : <VoidedDeletedView />}
    </div>
  );
}

// ------------------------------------------------------------- All changes
type ChangeRow = {
  id: string;
  at: string;
  kind: ChangeKind;
  source: "ledger" | "ladder" | "lifecycle" | "audit";
  action: string | null;
  actionLabel?: string;
  type: string;
  docType: string;
  docId: string;
  reference: string;
  party: string | null;
  amountSen: number | null;
  beforeSen: number | null;
  summary: string;
  who: string | null;
  legs: { side: "before" | "after" | null; accountCode: string; accountName: string; debitSen: number; creditSen: number; description: string }[];
  changes: { field: string; before: string; after: string }[];
};

const KIND_TONE: Record<ChangeKind, FinTone> = {
  posted: "neutral",
  created: "neutral",
  changed: "neutral",
  edited: "warn",
  voided: "err",
  deleted: "err",
  undone: "err",
  restored: "ok",
  prepared: "info",
  checked: "info",
  approved: "info",
};

const SOURCE_LABEL: Record<ChangeRow["source"], string> = {
  ledger: "Ledger entry",
  ladder: "Payment voucher approval",
  lifecycle: "Document state",
  audit: "Audit trail",
};

const kindLabel = (r: ChangeRow) => r.actionLabel || CHANGE_KIND_LABEL[r.kind] || r.kind;

function ChangeLogView({ month, today }: { month: string; today: string }) {
  const [data, setData] = useState<{ month: string; rows: ChangeRow[]; warnings: string[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<ChangeRow | null>(null);
  useEffect(() => {
    let stale = false;
    fetch(`/api/accounting/change-log?month=${month}`)
      .then((r) => r.json() as Promise<{ success?: boolean; error?: string; data?: { month: string; rows: ChangeRow[]; warnings: string[] } }>)
      .then((j) => {
        if (stale) return;
        if (j?.success && j.data) { setData(j.data); setFailed(null); }
        else setFailed(j?.error || "The change log could not be read");
      })
      .catch(() => { if (!stale) setFailed("The change log could not be read"); });
    return () => { stale = true; };
  }, [month]);
  // A month still loading shows the loading state, never the last month's rows.
  const rows = data && data.month === month ? data.rows : null;

  const columns = useMemo<Column<ChangeRow>[]>(() => [
    { key: "at", label: "When", width: "150px", sortAccessor: (r) => r.at, filterAccessor: (r) => myTime(r.at), exportValue: (r) => myTime(r.at), render: (_v, r) => <span className="whitespace-nowrap text-xs text-[#6B7280]">{myTime(r.at)}</span> },
    { key: "who", label: "Who", width: "130px", filterAccessor: (r) => r.who ?? "—", exportValue: (r) => r.who ?? "—", render: (_v, r) => <span className="text-xs">{r.who ?? "—"}</span> },
    { key: "kind", label: "Action", width: "110px", filterAccessor: kindLabel, exportValue: kindLabel, render: (_v, r) => <FinPill tone={KIND_TONE[r.kind] ?? "neutral"} title={SOURCE_LABEL[r.source]}>{kindLabel(r)}</FinPill> },
    { key: "type", label: "Type", width: "170px", render: (_v, r) => <span className="text-xs">{r.type}</span> },
    { key: "reference", label: "Reference", width: "150px", render: (_v, r) => <span className="text-xs font-medium tabular-nums">{r.reference}</span> },
    { key: "party", label: "Party", width: "190px", filterAccessor: (r) => r.party ?? "—", exportValue: (r) => r.party ?? "", render: (_v, r) => <span className="text-xs">{r.party || "—"}</span> },
    { key: "amountSen", label: "Amount", type: "currency", align: "right", width: "130px" },
    { key: "summary", label: "What changed", width: "320px", render: (_v, r) => <span className="text-xs text-[#4B5563]">{r.summary || "—"}</span> },
  ], []);

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows ?? []) by.set(kindLabel(r), (by.get(kindLabel(r)) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <>
      <p className="text-xs text-[#6B7280]">
        Every change made in Finance in {periodLabel(month, today)} (Malaysia time), newest first — postings, edits, voids, restores and deletes,
        payment voucher approvals and settings. Double-click a row to see the change.
        {rows && rows.length > 0 && <> {rows.length} change{rows.length === 1 ? "" : "s"}: {counts.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}.</>}
      </p>
      {data && data.month === month && data.warnings.length > 0 && (
        <p className="rounded-md bg-[#FBF3E4] px-3 py-2 text-xs text-[#7A5B12]">{data.warnings.join("; ")} — the list may be missing those changes.</p>
      )}
      {failed && <p className="rounded-md bg-[#F3E8E5] px-3 py-2 text-xs text-[#9A3A2D]">{failed}</p>}
      <Card>
        <CardContent className="p-0">
          <DataGrid
            columns={columns}
            data={rows ?? []}
            keyField="id"
            gridId="accounting-change-log"
            onDoubleClick={(r) => setOpen(r)}
            contextMenuItems={[{ label: "Show the change", action: (r: ChangeRow) => setOpen(r) }]}
            searchPlaceholder="Search reference / party / who…"
            alwaysSearchKeys={["reference", "party", "who", "type", "summary"]}
            headerMenu
            reorderableHeaders
            exportName={`Audit Log ${month}`}
            emptyMessage={`No changes in ${periodLabel(month, today)}.`}
            loading={rows === null && !failed}
            maxHeight="calc(100vh - 280px)"
          />
        </CardContent>
      </Card>
      {open && <ChangeDetail row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// The change itself: an edit's ledger lines before and after, a posting's
// lines, a setting's fields before and after.
function ChangeDetail({ row, onClose }: { row: ChangeRow; onClose: () => void }) {
  useEscapeClose(onClose);
  const sides: { key: "before" | "after" | null; title: string }[] = row.kind === "edited" && row.legs.some((l) => l.side)
    ? [{ key: "before", title: "Before — the entry as it was" }, { key: "after", title: "After — the entry as posted now" }]
    : [{ key: null, title: "Ledger entry" }];
  // The ledger keeps the old entry as its REVERSAL; shown here as it was
  // (debit and credit swapped back).
  const legsOf = (side: "before" | "after" | null) => row.legs
    .filter((l) => (side === null ? true : l.side === side))
    .map((l) => (side === "before" ? { ...l, debitSen: l.creditSen, creditSen: l.debitSen } : l));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,29,27,0.42)] p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] bg-[#F7F5F2] shadow-[0_24px_60px_rgba(31,29,27,0.28)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between gap-3 border-b border-[#E2DDD8] bg-white px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-[#1F1D1B]">{row.type} {row.reference}</h2>
            <FinPill tone={KIND_TONE[row.kind] ?? "neutral"}>{kindLabel(row)}</FinPill>
          </div>
          <button onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-[#9CA3AF] hover:bg-[#F0ECE9] hover:text-[#6B7280]" title="Close (Esc)">✕</button>
        </div>
        <div data-fin-modal-body className="flex-1 space-y-3 overflow-y-auto p-5 text-sm">
          <div className="grid grid-cols-2 gap-3 rounded-[10px] bg-white p-4 sm:grid-cols-4">
            {[
              ["When", myTime(row.at)],
              ["Who", row.who ?? "—"],
              ["Party", row.party || "—"],
              ["Amount", row.amountSen === null ? "—" : row.beforeSen !== null && row.beforeSen !== row.amountSen ? `${fmtAmt(row.beforeSen)} → ${fmtAmt(row.amountSen)}` : fmtAmt(row.amountSen)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
                <p className="mt-0.5 font-medium text-[#1F1D1B]">{value}</p>
              </div>
            ))}
            {row.summary && (
              <div className="col-span-2 sm:col-span-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">What changed</p>
                <p className="mt-0.5 text-[#1F1D1B]">{row.summary}</p>
              </div>
            )}
            <p className="col-span-2 text-[11px] text-[#9CA3AF] sm:col-span-4">From the {SOURCE_LABEL[row.source].toLowerCase()}{row.action ? ` (${row.action})` : ""}.</p>
          </div>
          {row.legs.length > 0 && sides.map((s) => (
            <div key={s.title} className="overflow-hidden rounded-[10px] bg-white">
              <p className="border-b border-[#E2DDD8] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#3E6570]">{s.title}</p>
              <table data-fin-list className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#6B7280]">
                    <th className="px-3 py-1.5">Account</th>
                    <th className="px-3 py-1.5">Description</th>
                    <th className="px-3 py-1.5 text-right">Debit</th>
                    <th className="px-3 py-1.5 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {legsOf(s.key).map((l, i) => (
                    <tr key={i} className="border-t border-[#F0ECE9]">
                      <td className="px-3 py-1.5 text-xs"><span className="tabular-nums">{l.accountCode}</span> <span className="text-[#6B7280]">{l.accountName}</span></td>
                      <td className="px-3 py-1.5 text-xs text-[#4B5563]">{l.description || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.debitSen ? fmtAmt(l.debitSen) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.creditSen ? fmtAmt(l.creditSen) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {row.changes.length > 0 && (
            <div className="overflow-hidden rounded-[10px] bg-white">
              <p className="border-b border-[#E2DDD8] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#3E6570]">{row.kind === "created" ? "Recorded with" : row.kind === "deleted" ? "As it was" : "Fields changed"}</p>
              <table data-fin-list className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#6B7280]">
                    <th className="px-3 py-1.5">Field</th>
                    <th className="px-3 py-1.5">Before</th>
                    <th className="px-3 py-1.5">After</th>
                  </tr>
                </thead>
                <tbody>
                  {row.changes.map((ch) => (
                    <tr key={ch.field} className="border-t border-[#F0ECE9]">
                      <td className="px-3 py-1.5 text-xs font-medium">{ch.field}</td>
                      <td className="px-3 py-1.5 text-xs break-all text-[#6B7280]">{ch.before}</td>
                      <td className="px-3 py-1.5 text-xs break-all">{ch.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------- Voided & deleted
function VoidedDeletedView() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/accounting/audit-log")
      .then((r) => r.json() as Promise<{ success?: boolean; data?: AuditRow[] }>)
      .then((j) => { if (j?.success) setRows(j.data ?? []); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const unvoid = async (row: AuditRow) => {
    const map = AUDIT_DOC_MAP[row.sourceType];
    if (!map) { toast.error(`Don't know how to restore ${row.sourceType}`); return; }
    if (!(await confirm({ title: "Restore document?", message: `Restore ${map.label} ${row.sourceId}? It will be reposted to the GL.`, danger: false }))) return;
    const res = await fetch(`${map.base}/${encodeURIComponent(row.sourceId)}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unvoid" }),
    });
    const j = asMutationResponse(await res.json());
    if (j?.success) { toast.success(`${row.sourceId} restored`); load(); }
    else toast.error(j?.error || "Restore failed");
  };

  // The grid's search reads type, reference, party, who, state and date (#10).
  const columns = useMemo<Column<AuditRow>[]>(() => [
    { key: "actionAt", label: "When", width: "160px", sortAccessor: (r) => r.actionAt ?? "", filterAccessor: whenText, exportValue: whenText, render: (_v, r) => <span className="text-xs text-[#6B7280] whitespace-nowrap">{whenText(r)}</span> },
    { key: "sourceType", label: "Type", width: "150px", filterAccessor: typeLabel, exportValue: typeLabel, render: (_v, r) => <span className="text-xs">{typeLabel(r)}</span> },
    { key: "reference", label: "Reference", width: "150px", noFilter: true, filterAccessor: (r) => r.reference ?? r.sourceId, exportValue: (r) => r.reference ?? r.sourceId, render: (_v, r) => <span className="tabular-nums text-xs font-medium">{r.reference ?? r.sourceId}</span> },
    { key: "docDate", label: "Doc Date", type: "date", width: "110px", render: (_v, r) => <span className="text-xs text-[#6B7280] whitespace-nowrap">{r.docDate || "—"}</span> },
    { key: "party", label: "Party", width: "200px", render: (_v, r) => <span className="text-xs">{r.party || "—"}</span> },
    { key: "amountSen", label: "Amount", type: "currency", align: "right", width: "130px" },
    { key: "state", label: "State", width: "100px", render: (_v, r) => <LifecycleBadge state={r.state} /> },
    { key: "actorName", label: "By", width: "150px", filterAccessor: (r) => r.actorName ?? r.actorUserId ?? "—", exportValue: (r) => r.actorName ?? r.actorUserId ?? "—", render: (_v, r) => <span className="text-xs text-[#6B7280]">{r.actorName ?? r.actorUserId ?? "—"}</span> },
  ], []);

  return (
    <>
      <p className="text-xs text-[#6B7280]">Voided &amp; deleted documents — the GL keeps every reversal; restore any of them here (right-click a row, or double-click it).</p>
      <Card>
        <CardContent className="p-0">
          <DataGrid
            columns={columns}
            data={rows ?? []}
            keyField="id"
            gridId="accounting-audit-log"
            onDoubleClick={(r) => void unvoid(r)}
            contextMenuItems={[{ label: "Unvoid — restore and repost", action: (r: AuditRow) => void unvoid(r) }]}
            searchPlaceholder="Search reference / party / who…"
            alwaysSearchKeys={["reference", "sourceId", "party", "actorName", "state", "docDate"]}
            headerMenu
            reorderableHeaders
            exportName="Audit Log"
            emptyMessage="No voided or deleted documents."
            loading={rows === null}
            maxHeight="calc(100vh - 260px)"
          />
        </CardContent>
      </Card>
    </>
  );
}
