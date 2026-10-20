// ---------------------------------------------------------------------------
// Chart of Accounts — the design's list and its Edit form (owner 2026-10-20
// 「运用设计稿那样，单拖动的树状图也需要」). Every account by section, in tree
// order with an indent; Cash Flow, Special Type, P&L Category, Balance (Dr /
// Cr; a group shows what sits under it) and Status. Double-click edits; the
// row menu (right-click or ⋮) offers Edit, View Ledger, Add Sub-account and
// Set Inactive / Active. The drag tree stays as the tab's second view.
// ---------------------------------------------------------------------------
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRowMenu } from "@/components/accounting/row-menu";
import { DocPopup, PopupField } from "@/components/finance/doc-popup";
import { formatCurrency } from "@/lib/utils";
import { COA_SECTIONS, coaSectionOf, groupParentsIn, isPnlType, normalBalanceOf } from "@/lib/coa-form";
import { COA_CASH_FLOW_LABEL, coaBalanceLabel, coaInactiveBlock, coaSpecialText, type CoaListRow } from "@/lib/coa-list";
import type { ChartOfAccount } from "@/types";

type Row = CoaListRow<ChartOfAccount>;

const tag = (label: string, cls: string) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
);

export function CoaListView({ rows, onEdit, onAddSub, onViewLedger, onToggleActive }: {
  rows: Row[];
  onEdit: (a: ChartOfAccount) => void;
  onAddSub: (a: ChartOfAccount) => void;
  onViewLedger: (code: string) => void;
  onToggleActive: (row: Row) => void;
}) {
  const [q, setQ] = useState("");
  const rowMenu = useRowMenu();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => r.account.code.toLowerCase().includes(t) || r.account.name.toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  const menu = (r: Row) => [
    [
      { label: "Edit", action: () => onEdit(r.account) },
      { label: "View Ledger", action: () => onViewLedger(r.account.code) },
      // Only under a group: a posting account is never turned into one.
      ...(r.isGroup || r.account.isPostable === false ? [{ label: "Add Sub-account", action: () => onAddSub(r.account) }] : []),
    ],
    [{ label: r.account.isActive ? "Set Inactive" : "Set Active", danger: r.account.isActive, action: () => onToggleActive(r) }],
  ];
  return (
    <div className="space-y-2" data-coa-list="">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code or name"
          aria-label="Search accounts"
          className="w-64 rounded-md border border-[#E2DDD8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#6B5C32]"
        />
        <span className="text-[12px] text-[#9CA3AF]">Double-click to edit · right-click for the ledger</span>
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-[#E2DDD8] bg-white">
        <table data-fin-list className="w-full min-w-[980px] text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left w-[110px]">Code</th>
              <th className="px-3 py-2 text-left">Account Name</th>
              <th className="px-3 py-2 text-left w-[110px]">Cash Flow</th>
              <th className="px-3 py-2 text-left w-[160px]">Special Type</th>
              <th className="px-3 py-2 text-left w-[110px]">P&amp;L Category</th>
              <th className="px-3 py-2 text-right w-[160px]">Balance</th>
              <th className="px-3 py-2 text-left w-[90px]">Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {COA_SECTIONS.map((sec) => {
              const rs = shown.filter((r) => r.section === sec.key);
              if (!rs.length) return null;
              return (
                <Fragment key={sec.key}>
                  <tr data-row="grp" data-fin-nolift="">
                    <td colSpan={8} className="px-3 py-1.5 text-[12px] font-semibold text-[#1F1D1B]">
                      {sec.label} <span className="font-normal text-[#9CA3AF]">· {rs.length} account{rs.length === 1 ? "" : "s"}</span>
                    </td>
                  </tr>
                  {rs.map((r) => {
                    const a = r.account;
                    return (
                      <tr
                        key={a.code}
                        className={`cursor-pointer border-t border-[#F0ECE9] ${a.isActive ? "" : "opacity-55"} ${rowMenu.openKey === a.code ? "bg-[#F6F1E7]" : ""}`}
                        onMouseDown={(e) => { if (e.detail > 1) e.preventDefault(); }}
                        onDoubleClick={() => onEdit(a)}
                        onContextMenu={rowMenu.onContextMenu(a.code, () => menu(r))}
                        title="Double-click to edit"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs text-[#6B5C32]">{a.code}</td>
                        <td className={`px-3 py-1.5 ${r.isGroup ? "font-semibold text-[#1F1D1B]" : "text-[#374151]"}`} style={{ paddingLeft: 12 + (q ? 0 : r.depth * 18) }}>
                          {!q && r.depth > 0 && <span className="mr-1 text-[#C4BDB3]">└</span>}{a.name}
                        </td>
                        <td className="px-3 py-1.5 text-[#374151]">{a.cashFlowCategory ? COA_CASH_FLOW_LABEL[a.cashFlowCategory] : <span className="text-[#C4BDB3]">-</span>}</td>
                        <td className="px-3 py-1.5">{a.specialAccountType ? tag(coaSpecialText(a.specialAccountType), "bg-[#EEF1F4] text-[#4B5563]") : <span className="text-[#C4BDB3]">-</span>}</td>
                        <td className="px-3 py-1.5 text-[#374151]">{a.pnlCategory ? a.pnlCategory.charAt(0) + a.pnlCategory.slice(1).toLowerCase() : <span className="text-[#C4BDB3]">-</span>}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${r.isGroup ? "font-semibold" : ""} ${r.balanceSen ? "text-[#1F1D1B]" : "text-[#C4BDB3]"}`}>{coaBalanceLabel(r.balanceSen, formatCurrency)}</td>
                        <td className="px-3 py-1.5">{a.isActive ? tag("Active", "bg-[#E7F0E3] text-[#27500A]") : tag("Inactive", "bg-[#F3F4F6] text-[#6B7280]")}</td>
                        <td className="px-1 py-1.5 text-right">{rowMenu.button(a.code, () => menu(r))}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {shown.length === 0 && (
              <tr data-fin-nolift=""><td colSpan={8} className="px-3 py-8 text-center text-sm text-[#9CA3AF]">{q ? "Nothing matches" : "No accounts yet"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rowMenu.element}
    </div>
  );
}

const SPECIAL_OPTIONS: [string, string][] = [
  ["", "(None)"],
  ["SDC", "SDC — Debtor Control (AR)"],
  ["SCC", "SCC — Creditor Control (AP)"],
  ["SBK", "SBK — Bank Account (Payment)"],
  ["SCH", "SCH — Cash Account (Payment)"],
  ["SOS", "SOS — Opening Stock (Mfg P&L)"],
  ["SCS", "SCS — Closing Stock (Mfg P&L)"],
  ["SBS", "SBS — Stock (Balance Sheet)"],
  ["SFA", "SFA — Fixed Asset"],
  ["SAD", "SAD — Accum. Depreciation"],
  ["SRE", "SRE — Retained Earnings"],
];

/** Edit an existing account — the New Account form's reporting block, the
 *  parent among its section's groups, its name and status. Its section is its
 *  code band (Change code moves it, with its history). PUT /coa. */
export function CoaEditModal({ account, accounts, balanceSen, onClose, onSaved, onRenameCode }: {
  account: ChartOfAccount;
  accounts: ChartOfAccount[];
  balanceSen: number;
  onClose: () => void;
  onSaved: () => void;
  onRenameCode: (a: ChartOfAccount) => void;
}) {
  const { toast } = useToast();
  const section = coaSectionOf(account.code, account.type);
  const sec = COA_SECTIONS.find((s) => s.key === section);
  const pnl = isPnlType(account.type);
  const [name, setName] = useState(account.name);
  const [parentCode, setParentCode] = useState(account.parentCode ?? "");
  const [cashFlow, setCashFlow] = useState<"" | "O" | "I" | "F">(account.cashFlowCategory ?? "");
  const [pnlCategory, setPnlCategory] = useState<"" | "FIXED" | "VARIABLE" | "OTHERS">(account.pnlCategory ?? "");
  const [special, setSpecial] = useState(account.specialAccountType ?? "");
  const [active, setActive] = useState(account.isActive);
  const [saving, setSaving] = useState(false);
  // The parent: a group of the same section, never the account itself or anything under it.
  const below = useMemo(() => {
    const out = new Set<string>([account.code]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of accounts) if (a.parentCode && out.has(a.parentCode) && !out.has(a.code)) { out.add(a.code); grew = true; }
    }
    return out;
  }, [accounts, account.code]);
  const parents = groupParentsIn(accounts, section).filter((g) => !below.has(g.code));
  const inactiveBlock = !active && account.isActive ? coaInactiveBlock({ balanceSen, account }) : null;
  const seg = <K extends string>(value: K, opts: [K, string][], set: (v: K) => void) => (
    <div className="inline-flex overflow-hidden rounded-md border border-[#D9D3CA]">
      {opts.map(([v, l], i) => (
        <button key={v || "none"} type="button" onClick={() => set(v)} className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${i ? "border-l border-[#D9D3CA]" : ""} ${value === v ? "bg-[#1F1D1B] text-white" : "bg-white text-[#374151] hover:bg-[#F7F5F2]"}`}>{l}</button>
      ))}
    </div>
  );
  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (inactiveBlock) { toast.error(inactiveBlock); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/coa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: account.code,
          name: name.trim(),
          parentCode: parentCode || null,
          cashFlowCategory: cashFlow || null,
          specialAccountType: special || null,
          pnlCategory: pnl ? pnlCategory || null : null,
          isActive: active,
        }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (j?.success) { toast.success(`${account.code} saved`); onSaved(); }
      else toast.error(j?.error || "Save failed");
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };
  const inputCls = "w-full rounded-md border border-[#E2DDD8] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B5C32]";
  return (
    <DocPopup
      title={`Edit Account ${account.code}`}
      onClose={onClose}
      actions={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={saving || !name.trim() || !!inactiveBlock} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PopupField label="Code">
          <span className="font-mono">{account.code}</span>{" "}
          <button type="button" onClick={() => onRenameCode(account)} className="ml-1 text-[11px] font-normal text-[#6B5C32] underline decoration-dotted" title="Change account code (history follows)">change</button>
        </PopupField>
        <PopupField label="Section">{sec?.label ?? section}</PopupField>
        <PopupField label="Normal balance">{normalBalanceOf(account.type)}</PopupField>
        <PopupField label="Balance">{coaBalanceLabel(balanceSen, formatCurrency)}</PopupField>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-[#6B7280] mb-1 block">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="Account name" />
        </div>
        <div>
          <label className="text-xs font-medium text-[#6B7280] mb-1 block">Parent</label>
          <select value={parentCode} onChange={(e) => setParentCode(e.target.value)} className={inputCls} aria-label="Parent account">
            <option value="">(None — top level)</option>
            {parents.map((g) => <option key={g.code} value={g.code}>{g.code} · {g.name}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-[#9CA3AF]">Groups of {sec?.label ?? "the section"} only — the tree view can drag it too.</p>
        </div>
      </div>
      <div className="space-y-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Reporting</div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-24 text-xs text-[#6B7280]">Cash flow</span>
          {seg(cashFlow, [["", "None"], ["O", "Operating"], ["I", "Investing"], ["F", "Financing"]], setCashFlow)}
        </div>
        {pnl && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-xs text-[#6B7280]">P&amp;L category</span>
            {seg(pnlCategory, [["", "None"], ["FIXED", "Fixed"], ["VARIABLE", "Variable"], ["OTHERS", "Others"]], setPnlCategory)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-24 text-xs text-[#6B7280]">Special type</span>
          <select value={special} onChange={(e) => setSpecial(e.target.value)} className="rounded-md border border-[#E2DDD8] bg-white px-2 py-1.5 text-sm" aria-label="Special type">
            {SPECIAL_OPTIONS.map(([v, l]) => <option key={v || "none"} value={v}>{l}</option>)}
            {special && !SPECIAL_OPTIONS.some(([v]) => v === special) && <option value={special}>{special}</option>}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-24 text-xs text-[#6B7280]">Status</span>
          {seg(active ? "on" : "off", [["on", "Active"], ["off", "Inactive"]], (v) => setActive(v === "on"))}
          {inactiveBlock && <span className="text-[11px] font-semibold text-[#9A3A2D]">{inactiveBlock}</span>}
        </div>
      </div>
    </DocPopup>
  );
}
