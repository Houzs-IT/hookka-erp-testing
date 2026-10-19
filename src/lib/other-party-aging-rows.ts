// Other debtors / creditors as aging rows (owner 2026-10-17, Finance v2:
// "Debtor Aging includes other-debtor aging"; Creditor Aging mirrors it). The
// bills come from GET /api/accounting/other-party-aging, each carrying `mo` —
// the same calendar-month bucket /aging gives an invoice — so an other party's
// row lines up with the trade rows column for column. Pure; integer sen.

export type OtherPartyAgingBill = {
  partyId: string;
  partyName: string;
  billNo: string;
  billDate: string;
  outstandingSen: number;
  /** 0..4 = Current / 1 / 2 / 3 / 3+ months since the bill date. */
  mo?: number;
};

export type OtherPartyAgingRow = {
  partyId: string;
  partyName: string;
  currentSen: number;
  days30Sen: number;
  days60Sen: number;
  days90Sen: number;
  over90Sen: number;
  docs: { no: string; date: string; mo: number; amountSen: number }[];
};

const KEYS = ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"] as const;

/** One row per party, its open bills bucketed by `mo`; rows by name, a
 *  row's bills oldest bucket last and newest first inside (as /aging does). */
export function otherPartyAgingRows(bills: OtherPartyAgingBill[]): OtherPartyAgingRow[] {
  const byParty = new Map<string, OtherPartyAgingRow>();
  for (const b of bills) {
    const sen = Math.round(Number(b.outstandingSen) || 0);
    if (sen === 0) continue;
    let row = byParty.get(b.partyId);
    if (!row) {
      row = { partyId: b.partyId, partyName: b.partyName, currentSen: 0, days30Sen: 0, days60Sen: 0, days90Sen: 0, over90Sen: 0, docs: [] };
      byParty.set(b.partyId, row);
    }
    const mo = Math.min(4, Math.max(0, Math.round(Number(b.mo) || 0)));
    row[KEYS[mo]] += sen;
    row.docs.push({ no: b.billNo, date: b.billDate, mo, amountSen: sen });
  }
  const rows = [...byParty.values()];
  for (const r of rows) r.docs.sort((a, b) => a.mo - b.mo || b.date.localeCompare(a.date));
  return rows.sort((a, b) => a.partyName.localeCompare(b.partyName));
}
