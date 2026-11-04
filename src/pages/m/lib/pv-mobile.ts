// ---------------------------------------------------------------------------
// pv-mobile — the Payment Voucher rules the phone follows, taken from the desktop Payment Vouchers page
// (src/pages/accounting/index.tsx) and the server (src/api/routes/accounting.ts, /payment-vouchers*):
//
//   the four-tier ladder     DRAFT ──prepare──▶ PREPARED ──check──▶ CHECKED ──approve──▶ APPROVED (posted)
//     prepare / withdraw     accounting:update
//     check / reject         accounting:check   (reject needs a reason; check mints the formal number)
//     approve                accounting:approve (the GL is posted HERE, nowhere earlier)
//   edit                     DRAFT / PREPARED only, PUT (accounting:update). A POSTED voucher is edited by "restate"
//                            (reverses + re-posts the legs under the same number). CHECKED is locked: reject it first.
//   void / delete / unvoid   POST /:id/lifecycle (accounting:update)
//   settle                   a POSTED voucher that was ACCRUED and not yet settled (accounting:update)
//
// The phone creates and edits the EXPENSE kind (payee + account lines). An AP payment (pays creditor bills) and a fund
// TRANSFER are shown and can ride the ladder, but their forms stay on the desktop. A scan only ever creates a DRAFT.
// Pure — no network.
// ---------------------------------------------------------------------------
import { moneyFieldToSen } from "../../../lib/money-field";

export type PvRaw = Record<string, unknown>;
export type PvState = "DRAFT" | "PREPARED" | "CHECKED" | "APPROVED";

const str = (v: unknown): string => (v == null ? "" : String(v));
const get = (r: PvRaw, camel: string, snake: string): unknown => r[camel] ?? r[snake];

export const pvState = (r: PvRaw): PvState => {
  const s = str(get(r, "approvalState", "approval_state")).toUpperCase();
  return s === "DRAFT" || s === "PREPARED" || s === "CHECKED" ? s : "APPROVED";
};
export const pvIsVoid = (r: PvRaw): boolean => str(r.status).toUpperCase() === "VOID";
export const pvIsPosted = (r: PvRaw): boolean => !pvIsVoid(r) && pvState(r) === "APPROVED";
export const pvKind = (r: PvRaw): "AP" | "TRANSFER" | "EXPENSE" => {
  const k = str(get(r, "pvKind", "pv_kind")).toUpperCase();
  return k === "AP" ? "AP" : k === "TRANSFER" ? "TRANSFER" : "EXPENSE";
};
export const pvChip = (r: PvRaw): "CANCELLED" | PvState => (pvIsVoid(r) ? "CANCELLED" : pvState(r));
export const PV_CHIP_LABEL: Record<string, string> = { DRAFT: "Draft", PREPARED: "Prepared", CHECKED: "Checked", APPROVED: "Approved", CANCELLED: "Cancelled" };
export const pvBillNo = (r: PvRaw): string => str(get(r, "billNo", "bill_no"));

export type PvActionKey = "EDIT" | "PREPARE" | "WITHDRAW" | "REJECT" | "CHECK" | "APPROVE" | "RESTATE" | "SETTLE" | "VOID" | "DELETE" | "UNVOID";
export const PV_ACTION_PERM: Record<PvActionKey, [string, string]> = {
  EDIT: ["accounting", "update"], PREPARE: ["accounting", "update"], WITHDRAW: ["accounting", "update"],
  REJECT: ["accounting", "check"], CHECK: ["accounting", "check"], APPROVE: ["accounting", "approve"],
  RESTATE: ["accounting", "update"], SETTLE: ["accounting", "update"], VOID: ["accounting", "update"], DELETE: ["accounting", "update"], UNVOID: ["accounting", "update"],
};
export const PV_ACTION_LABEL: Record<PvActionKey, string> = {
  EDIT: "Edit voucher", PREPARE: "Prepare", WITHDRAW: "Withdraw", REJECT: "Reject to draft", CHECK: "Check", APPROVE: "Approve & post",
  RESTATE: "Edit posted voucher", SETTLE: "Settle accrual", VOID: "Void voucher", DELETE: "Delete voucher", UNVOID: "Restore voucher",
};

/** The actions the desktop offers for this row's state, before the user's permissions are applied. `primary` is the next ladder rung. */
export function pvActions(r: PvRaw): { primary: PvActionKey | null; menu: PvActionKey[] } {
  const st = pvState(r);
  const live = !pvIsVoid(r);
  const kind = pvKind(r);
  const menu: PvActionKey[] = [];
  let primary: PvActionKey | null = null;
  if (live) {
    if (st === "DRAFT") primary = "PREPARE";
    if (st === "PREPARED") primary = "CHECK";
    if (st === "CHECKED") primary = "APPROVE";
    if ((st === "DRAFT" || st === "PREPARED") && kind === "EXPENSE") menu.push("EDIT");
    if (st === "PREPARED") menu.push("WITHDRAW", "REJECT");
    if (st === "CHECKED") menu.push("REJECT");
    if (st === "APPROVED" && kind === "EXPENSE") menu.push("RESTATE");
    if (st === "APPROVED" && kind === "EXPENSE" && Number(r.accrued) === 1 && !get(r, "settledAt", "settled_at")) menu.push("SETTLE");
  }
  // lifecycle (lifecycleMenuItems): a cancelled voucher can be restored or deleted; a live one voided or deleted
  const lc = str(r.lifecycleState ?? "ACTIVE").toUpperCase() || "ACTIVE";
  if (pvIsVoid(r) || lc === "VOID") menu.push("UNVOID", "DELETE");
  else menu.push("VOID", "DELETE");
  return { primary, menu };
}

// ---- the edit form (EXPENSE kind) -----------------------------------------------------------------------------------
export type PvFormLine = { key: string; accountCode: string; description: string; amount: string };
export type PvForm = {
  date: string; payee: string; description: string; billNo: string; billDate: string; notes: string;
  accrued: boolean; payFrom: string; accrualAccount: string; lines: PvFormLine[];
};
export type CoaAccount = { code: string; name: string; type?: string; specialAccountType?: string | null; isPostable?: boolean | number | null; isActive?: boolean | number | null };

export const isBankCash = (a: CoaAccount): boolean => a.specialAccountType === "SBK" || a.specialAccountType === "SCH";
const postable = (a: CoaAccount): boolean => a.isPostable == null || a.isPostable === true || a.isPostable === 1;
const active = (a: CoaAccount): boolean => a.isActive == null || a.isActive === true || a.isActive === 1;
/** Accounts a line may use: postable, active, not a bank / cash account, not a debtor control (the server refuses those). */
export const lineAccounts = (coa: CoaAccount[]): CoaAccount[] => coa.filter((a) => postable(a) && active(a) && !isBankCash(a) && a.specialAccountType !== "SDC");
export const bankAccounts = (coa: CoaAccount[]): CoaAccount[] => coa.filter((a) => isBankCash(a) && active(a));
/** Accrual accounts: a postable LIABILITY, never 405 Other Creditors (the server's rule). */
export const accrualAccounts = (coa: CoaAccount[]): CoaAccount[] => coa.filter((a) => a.type === "LIABILITY" && postable(a) && active(a) && !a.code.startsWith("405"));

export const senToField = (sen: number): string => (Math.round(sen) / 100).toFixed(2);

export function pvFormFromRow(r: PvRaw): PvForm {
  const lines = Array.isArray(r.lines) ? (r.lines as PvRaw[]) : [];
  return {
    date: str(r.date).slice(0, 10), payee: str(r.payee), description: str(r.description), billNo: pvBillNo(r), billDate: str(get(r, "billDate", "bill_date")).slice(0, 10), notes: str(r.notes),
    accrued: Number(r.accrued) === 1, payFrom: str(get(r, "payFrom", "pay_from")), accrualAccount: str(get(r, "accrualAccount", "accrual_account")),
    lines: lines.map((l, i) => ({ key: `l${i}`, accountCode: str(l.accountCode), description: str(l.description), amount: senToField(Number(l.amountSen) || 0) })),
  };
}

export const pvFormTotalSen = (f: PvForm): number => f.lines.reduce((s, l) => s + (moneyFieldToSen(l.amount) ?? 0), 0);

/** Why a voucher cannot be saved (the server's own validators, said before the round trip). */
export function pvFormBlockers(f: PvForm, coa: CoaAccount[]): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) out.push("Enter the voucher date.");
  if (!f.payee.trim()) out.push("Enter the payee.");
  if (f.lines.length === 0) out.push("Add at least one line.");
  const ok = new Set(lineAccounts(coa).map((a) => a.code));
  f.lines.forEach((l, i) => {
    const sen = moneyFieldToSen(l.amount);
    if (sen == null) out.push(`Line ${i + 1}: the amount can't be read.`);
    else if (sen <= 0) out.push(`Line ${i + 1}: enter an amount above zero.`);
    if (!l.accountCode) out.push(`Line ${i + 1}: pick an account.`);
    else if (coa.length > 0 && !ok.has(l.accountCode)) out.push(`Line ${i + 1}: ${l.accountCode} can't be used on a voucher line.`);
  });
  if (f.accrued) {
    if (!f.accrualAccount) out.push("Pick the accrual account (410-x).");
  } else if (!f.payFrom) out.push("Pick the bank or cash account it is paid from.");
  return out;
}

/** The POST / PUT / restate body the desktop sends for a payment voucher. `draft` is only meaningful on create. */
export function pvBody(f: PvForm, draft: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    date: f.date, payee: f.payee.trim(), description: f.description, notes: f.notes, billNo: f.billNo.trim(), billDate: f.billDate || undefined,
    accrued: f.accrued, payFrom: f.accrued ? undefined : f.payFrom, accrualAccount: f.accrued ? f.accrualAccount : undefined,
    lines: f.lines.map((l) => ({ accountCode: l.accountCode, description: l.description, amountSen: moneyFieldToSen(l.amount) ?? 0 })),
  };
  if (draft) body.saveAs = "draft";
  return body;
}

export const newPvLine = (key: string): PvFormLine => ({ key, accountCode: "", description: "", amount: "" });
