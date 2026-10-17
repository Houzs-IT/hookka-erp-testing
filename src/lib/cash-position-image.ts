// ---------------------------------------------------------------------------
// The Daily Cash Position share image, drawn from data on a canvas (moved out
// of the desktop DailyCashTab for finance v2 mobile, so the phone shares the
// same picture). Both DOM-capture libraries were tried and rejected on prod:
// html2canvas dies silently on modern CSS colour functions, and html-to-image
// spent 56 SECONDS serialising the board's thousands of nodes (measured
// 2026-09-03). A plain canvas render of the same numbers takes <100ms and can
// never rot with the stylesheet.
// ---------------------------------------------------------------------------
import { formatCurrency } from "./utils";
import { fmtDocDate, pendingReceiptsFirst } from "./finance-daily";

export type CashImageLine = { day: string; sourceId: string; description: string; amountSen: number; ticked: boolean };
export type CashImageAccount = {
  code: string;
  name: string;
  reconciled: boolean;
  bankEstSen: number;
  availableSen: number;
  unbookedSen: number;
  unbookedCount: number;
  oldPendingSen: number;
  oldPendingCount: number;
  pending: CashImageLine[];
};
export type CashImageData = { date: string; accounts: CashImageAccount[]; totalAvailableSen: number };

/** The bottom line under the board: available − to repay − trade finance due
 *  + to receive. */
export type CashImageTotals = { netAfterSen: number; repayShownSen: number; recvShownSen: number; tfShownSen: number };

/** A trade-finance draw still owed, as the cash-position API sends it. */
export type CashTfRow = { dueDate: string; outstandingSen: number };

/** The default trade-finance scope (owner 2026-10-17): every draw due by the
 *  end of the viewed month, overdue ones included. A draw with no due date
 *  counts as due — money owed is never hidden. */
export function tfDueByMonthEnd(row: CashTfRow, curMonth: string): boolean {
  return !row.dueDate || row.dueDate <= `${curMonth}-31`;
}

/** Draws the board and resolves to a PNG; rejects with a short reason. */
export function drawCashPositionImage(cur: CashImageData, totals: CashImageTotals): Promise<Blob> {
  const { netAfterSen, repayShownSen, recvShownSen, tfShownSen } = totals;
  const W = 1000;
  const line = 26;
  const acctRows = cur.accounts.map((a) => ({ a, rows: pendingReceiptsFirst(a.pending.filter((p) => !p.ticked)) }));
  let H = 96; // title block
  for (const { a, rows } of acctRows) {
    H += 44; // dark band
    if (a.unbookedCount > 0) H += line;
    if (rows.length > 0) H += line + rows.length * line; // header + rows
    if (a.oldPendingCount > 0) H += line;
    H += 36; // available band
    H += 14; // gap
  }
  H += 52 + 46 + 40; // current cash + net + footer
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas unavailable"));
  ctx.scale(2, 2);
  const rm = (n: number) => formatCurrency(n);
  const trunc = (s: string, max: number) => {
    let t = s;
    while (t.length > 3 && ctx.measureText(t).width > max) t = t.slice(0, -2);
    return t === s ? s : `${t}…`;
  };
  ctx.fillStyle = "#FAF8F5";
  ctx.fillRect(0, 0, W, H);
  let y = 40;
  ctx.fillStyle = "#1F1D1B";
  ctx.font = "bold 22px Arial";
  ctx.fillText(`Cash Position — ${cur.date}`, 24, y);
  ctx.font = "12px Arial";
  ctx.fillStyle = "#6B7280";
  ctx.fillText("Hookka ERP · estimated from the books ± bank reconciliation", 24, y + 20);
  y += 56;
  for (const { a, rows } of acctRows) {
    ctx.fillStyle = "#1F2937";
    ctx.fillRect(16, y, W - 32, 34);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 14px Arial";
    ctx.fillText(trunc(`${a.code} ${a.name}${a.reconciled ? "" : " (book only)"}`, 560), 28, y + 22);
    const bankTxt = `Bank balance (est.) ${rm(a.bankEstSen)}`;
    ctx.fillText(bankTxt, W - 28 - ctx.measureText(bankTxt).width, y + 22);
    y += 44;
    ctx.font = "12px Arial";
    if (a.unbookedCount > 0) {
      ctx.fillStyle = "#7A5B12";
      ctx.fillText(trunc(`Includes ${a.unbookedCount} bank items not booked yet (${rm(a.unbookedSen)})`, W - 60), 28, y + 12);
      y += line;
    }
    if (rows.length > 0) {
      ctx.fillStyle = "#6B7280";
      ctx.fillText("Date", 28, y + 12);
      ctx.fillText("PV No.", 110, y + 12);
      ctx.fillText("Description", 230, y + 12);
      const h1 = "Received", h2 = "Pending payment";
      ctx.fillText(h1, W - 200 - ctx.measureText(h1).width, y + 12);
      ctx.fillText(h2, W - 28 - ctx.measureText(h2).width, y + 12);
      y += line;
      for (const p of rows) {
        ctx.fillStyle = "#6B7280";
        ctx.fillText(fmtDocDate(p.day), 28, y + 12);
        ctx.fillStyle = "#1F1D1B";
        ctx.fillText(trunc(p.sourceId, 110), 110, y + 12);
        ctx.fillText(trunc(p.description, W - 230 - 260), 230, y + 12);
        if (p.amountSen > 0) {
          ctx.fillStyle = "#27500A";
          const t = rm(p.amountSen);
          ctx.fillText(t, W - 200 - ctx.measureText(t).width, y + 12);
        } else {
          ctx.fillStyle = "#1F1D1B";
          const t = rm(-p.amountSen);
          ctx.fillText(t, W - 28 - ctx.measureText(t).width, y + 12);
        }
        y += line;
      }
    }
    if (a.oldPendingCount > 0) {
      ctx.fillStyle = "#9CA3AF";
      ctx.fillText(`Older reconciliation items: ${a.oldPendingCount} · ${rm(a.oldPendingSen)} (counted above)`, 28, y + 12);
      y += line;
    }
    ctx.fillStyle = "#EAF3DE";
    ctx.fillRect(16, y, W - 32, 28);
    ctx.fillStyle = "#1F1D1B";
    ctx.font = "bold 13px Arial";
    ctx.fillText("Available (after pending)", 28, y + 19);
    const avTxt = rm(a.availableSen);
    ctx.fillText(avTxt, W - 28 - ctx.measureText(avTxt).width, y + 19);
    y += 36 + 14;
    ctx.font = "12px Arial";
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(16, y, W - 32, 40);
  ctx.strokeStyle = "#E2DDD8";
  ctx.strokeRect(16, y, W - 32, 40);
  ctx.fillStyle = "#1F1D1B";
  ctx.font = "bold 15px Arial";
  ctx.fillText("CURRENT CASH AVAILABLE", 28, y + 26);
  ctx.fillStyle = "#27500A";
  const totTxt = rm(cur.totalAvailableSen);
  ctx.fillText(totTxt, W - 28 - ctx.measureText(totTxt).width, y + 26);
  y += 52;
  ctx.fillStyle = "#1F1D1B";
  ctx.font = "bold 14px Arial";
  ctx.fillText("CASH AFTER REPAY & RECEIVE", 28, y + 18);
  ctx.fillStyle = netAfterSen >= 0 ? "#27500A" : "#9A3A2D";
  const netTxt = rm(netAfterSen);
  ctx.fillText(netTxt, W - 28 - ctx.measureText(netTxt).width, y + 18);
  ctx.fillStyle = "#9CA3AF";
  ctx.font = "11px Arial";
  const sub = `= available ${rm(cur.totalAvailableSen)} − to repay ${rm(repayShownSen)}${tfShownSen ? ` − trade finance ${rm(tfShownSen)}` : ""} + to receive ${rm(recvShownSen)}`;
  ctx.fillText(sub, W - 28 - ctx.measureText(sub).width, y + 36);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render the image"))), "image/png");
  });
}

/** The phone's and the desktop's bottom line, with the desktop's default
 *  scopes: suppliers owed from before this month, customers owing from before
 *  this month (owner 2026-09-05), trade finance due by this month's end
 *  (owner 2026-10-17). Amounts as the API sends them. */
export function cashAfterRepayReceive(
  cur: { totalAvailableSen: number; repay: { month: string; outstandingSen?: number }[]; receive: { month: string; totalSen?: number }[]; tradeFinance?: CashTfRow[] },
  curMonth: string,
): CashImageTotals {
  const repayShownSen = cur.repay.filter((r) => r.month < curMonth).reduce((s, r) => s + (r.outstandingSen ?? 0), 0);
  const recvShownSen = cur.receive.filter((r) => r.month < curMonth).reduce((s, r) => s + (r.totalSen ?? 0), 0);
  const tfShownSen = (cur.tradeFinance ?? []).filter((t) => tfDueByMonthEnd(t, curMonth)).reduce((s, t) => s + t.outstandingSen, 0);
  return { repayShownSen, recvShownSen, tfShownSen, netAfterSen: cur.totalAvailableSen - repayShownSen - tfShownSen + recvShownSen };
}
