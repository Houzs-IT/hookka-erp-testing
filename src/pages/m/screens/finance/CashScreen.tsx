// ---------------------------------------------------------------------------
// Daily Cash Position on the phone (Batch 3 prototype "cashB"). Reads the
// desktop board (/api/accounting/cash-position?date=), one day at a time:
// cash available and what is left after repaying and receiving, the
// vouchers awaiting approval, each bank (tap Available for its pending
// items), then the desktop's panels — to repay, to receive, trade finance,
// foreign-currency bank amounts pending, planned payments and ticked items —
// all display only. The "Before this month / All outstanding" switch is the
// desktop panels' scope (default: before this month, trade finance due by the
// month end — cashAfterRepayReceive); "All outstanding" widens repay, receive
// and trade finance together, as the desktop's three toggles do when all on.
// Share sends the desktop's own image (drawCashPositionImage) through the
// phone's share sheet, or saves it where sharing a file is not offered.
// Read-only: ticks and planned payments stay on the desktop.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, CircleCheck, CloudOff, Globe, Hourglass, Landmark, Share2, Wallet } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency, todayYmdMY } from "@/lib/utils";
import { fmtDocDate, pendingReceiptsFirst } from "@/lib/finance-daily";
import { cashAfterRepayReceive, drawCashPositionImage, tfDueByMonthEnd, type CashImageAccount, type CashImageTotals } from "@/lib/cash-position-image";
import { shareWidths } from "./m-finance-lib";
import { FinBanner, FinCard, FinHero, FinLabel, FinScreen, FinSeg, FinSkel, FinState, FinStep, type Row } from "./fin-kit";
import { F, dayMon, monYear, rm, tile } from "./fin-format";

type PartyRow = { month: string; name: string; outstandingSen?: number; totalSen?: number };
type TfRow = { dueDate: string; drawDate: string; lender: string; ref: string; paidFor: string; outstandingSen: number };
type CashResp = {
  success?: boolean;
  error?: string;
  data?: {
    date: string;
    accounts: (CashImageAccount & { pendingSen: number })[];
    totalBankEstSen: number;
    totalAvailableSen: number;
    repay: PartyRow[];
    receive: PartyRow[];
    receiveOpeningCreditsSen?: number;
    planned?: { id: string; partyName: string; ref: string; expectedDate: string; amountSen: number }[];
    openingMonth?: string | null;
    awaitingApproval?: { id: string; state: string; amountSen: number }[];
    awaitingCheckedSen?: number;
    fxBankPending?: { id: string; pvNo: string; date: string; payee: string; currency: string; foreignSen: number; rate: number; amountSen: number }[];
    tradeFinance?: TfRow[];
  };
};

const shiftDay = (ymd: string, d: number) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");

export function CashScreen() {
  const navigate = useNavigate();
  const today = todayYmdMY();
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const { data: resp, loading, error, refresh } = useCachedJson<CashResp>(`/api/accounting/cash-position?date=${date}`);
  const cur = resp?.success && resp.data?.date === date ? resp.data : null;
  const totals = cur ? cashAfterRepayReceive(cur, date.slice(0, 7)) : null;
  const failed = !!error || resp?.success === false;
  const curMonth = date.slice(0, 7);
  const future = date > today;

  // The panels' scope (the desktop's): before this month by default; all outstanding when widened.
  const repayRows = (cur?.repay ?? []).filter((r) => all || r.month < curMonth);
  const recvRows = (cur?.receive ?? []).filter((r) => all || r.month < curMonth);
  const tfRows = (cur?.tradeFinance ?? []).filter((t) => all || tfDueByMonthEnd(t, curMonth));
  const shown: CashImageTotals | null = !cur || !totals ? null : all
    ? (() => {
        const repayShownSen = repayRows.reduce((s, r) => s + (r.outstandingSen ?? 0), 0);
        const recvShownSen = recvRows.reduce((s, r) => s + (r.totalSen ?? 0), 0);
        const tfShownSen = tfRows.reduce((s, t) => s + t.outstandingSen, 0);
        return { repayShownSen, recvShownSen, tfShownSen, netAfterSen: cur.totalAvailableSen - repayShownSen - tfShownSen + recvShownSen };
      })()
    : totals;

  const share = async () => {
    if (!cur || !shown) return;
    setSharing(true);
    setShareNote(null);
    try {
      const totals = shown; // the image shows the scope on screen, as the desktop's does
      const blob = await drawCashPositionImage(cur, totals);
      const file = new File([blob], `cash-position-${cur.date}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `Daily Cash Position — ${cur.date}` });
      } else {
        // No file sharing here (a desktop browser): save the picture instead.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        // eslint-disable-next-line no-restricted-syntax -- one-shot cleanup inside a click handler, not a component timer
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      // A cancelled share sheet is not a failure.
      if (!(e instanceof DOMException && e.name === "AbortError")) setShareNote("Couldn't make the image — please try again.");
    } finally {
      setSharing(false);
    }
  };

  const awaiting = cur?.awaitingApproval ?? [];
  const checkedSen = cur?.awaitingCheckedSen ?? 0;
  const softSen = awaiting.filter((v) => v.state !== "CHECKED").reduce((s, v) => s + v.amountSen, 0);
  const openingYm = cur?.openingMonth ?? null;
  const ticked = (cur?.accounts ?? []).flatMap((a) => a.pending.filter((p) => p.ticked).map((p) => ({ a, p })));

  const scopeSub = all ? "All outstanding" : `Before ${monYear(curMonth)}`;
  const partyRows = (rows: PartyRow[], pay: boolean): Row[] =>
    rows.map((r, i) => {
      const sen = (pay ? r.outstandingSen : r.totalSen) ?? 0;
      const opening = !!openingYm && r.month <= openingYm;
      const credit = sen < 0;
      return {
        key: `${r.month}-${r.name}-${i}`,
        l: r.name,
        s: opening ? `Opening era · ${monYear(r.month)}` : monYear(r.month),
        tag: credit ? "Credit" : opening ? "Opening" : undefined,
        tagBg: credit ? "#FBE7E3" : undefined,
        tagFg: credit ? F.neg : undefined,
        v: rm(sen),
        vc: pay ? F.neg : credit ? F.neg : F.pos,
      };
    });

  return (
    <FinScreen
      title="Daily Cash Position"
      onBack={() => navigate("/m/finance")}
      actions={[{ icon: Share2, aria: "Share as image", onTap: () => void share(), disabled: !cur || sharing }]}
    >
      <FinStep
        l={dayLabel(date)}
        s={date === today ? "Today · Malaysia time" : future ? "Projection" : "Past day"}
        tone={future ? "run" : "plain"}
        onPrev={() => { setDate(shiftDay(date, -1)); setOpen(null); }}
        onNext={() => { setDate(shiftDay(date, 1)); setOpen(null); }}
      />
      {future ? <FinBanner tone="warn" icon={CalendarClock} t="Projection." s="A future day: nothing has gone through the bank yet." /> : null}
      {shareNote ? <FinBanner tone="bad" icon={CloudOff} t="Share failed." s={shareNote} /> : null}
      {loading && !cur ? (
        <FinSkel n={3} h={150} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the cash position." s={resp?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : !cur || !totals || !shown ? (
        <FinState icon={Landmark} bg={F.cream} c={F.gold} t="No cash position" s="No cash position for this day." />
      ) : (
        <>
          <FinHero
            k="Cash available"
            tag={date === today ? "Live" : undefined}
            v={rm(cur.totalAvailableSen)}
            vc={cur.totalAvailableSen < 0 ? F.neg : F.ink}
            s={`After repay & receive · ${rm(shown.netAfterSen)}`}
            stack={shareWidths([Math.max(0, cur.totalAvailableSen), shown.repayShownSen, shown.tfShownSen, shown.recvShownSen]).map((w, i) => ({ w, c: ["#C9A24B", "#9A3A2D", "#B8601A", "#4F7C3A"][i] }))}
            tiles={[
              { k: "To repay", v: rm(shown.repayShownSen), dot: "#9A3A2D" },
              { k: "Trade finance", v: rm(shown.tfShownSen), dot: "#C9A24B" },
              { k: "To receive", v: rm(shown.recvShownSen), dot: "#4F7C3A" },
            ]}
          />
          {awaiting.length > 0 ? (
            <FinBanner tone="warn" icon={Hourglass} t="Awaiting approval:" s={`${rm(checkedSen)} checked${softSen > 0 ? ` · ${rm(softSen)} in draft` : ""} — not counted yet.`} />
          ) : null}
          <FinLabel l="BANK ACCOUNTS" r="Tap to see pending" />
          {cur.accounts.map((a) => {
            const isOpen = open === a.code;
            const rows = pendingReceiptsFirst(a.pending.filter((p) => !p.ticked));
            const notes = [
              a.unbookedCount > 0 ? `Includes ${a.unbookedCount} bank item${a.unbookedCount === 1 ? "" : "s"} not booked yet (${rm(a.unbookedSen)}).` : "",
              a.oldPendingCount > 0 ? `Older reconciliation items: ${a.oldPendingCount} · ${rm(a.oldPendingSen)} (counted above).` : "",
            ].filter(Boolean).join(" ");
            return (
              <FinCard
                key={a.code}
                test="cash-bank"
                title={`${a.code} · ${a.name}`}
                icon={a.reconciled ? Landmark : Wallet}
                sub={a.reconciled ? `Estimated bank ${rm(a.bankEstSen)}` : `Book only · bank (est.) ${rm(a.bankEstSen)}`}
                right={rows.length ? `${rows.length} pending` : undefined}
                rBg="#FAEFCB"
                rFg="#85600F"
                tiles={[tile("Available", rm(a.availableSen), { span: 2, rail: "#2B5797", tint: "rgba(227,234,245,.9)", c: a.availableSen < 0 ? F.neg : F.ink, onTap: () => setOpen(isOpen ? null : a.code), on: isOpen, s: isOpen ? "Tap to hide pending" : "Tap to see pending" })]}
                rows={isOpen && rows.length ? rows.map((p, i) => ({
                  key: `${p.sourceId}-${i}`,
                  l: p.description || p.sourceId,
                  s: `${fmtDocDate(p.day)} · ${p.sourceId}`,
                  v: `${p.amountSen > 0 ? "+" : "−"}${rm(Math.abs(p.amountSen))}`,
                  vc: p.amountSen > 0 ? F.pos : F.neg,
                })) : undefined}
                empty={isOpen && !rows.length ? "Nothing pending — everything booked has gone through the bank." : undefined}
                note={isOpen && notes ? notes : undefined}
              />
            );
          })}

          <FinLabel l="TO REPAY & RECEIVE" />
          <FinSeg opts={[{ k: "before", l: "Before this month" }, { k: "all", l: "All outstanding" }]} cur={all ? "all" : "before"} set={(k) => setAll(k === "all")} aria="Range" h={40} />
          <FinCard title="To Repay" icon={ArrowUpRight} sub={scopeSub} rows={repayRows.length ? partyRows(repayRows, true) : undefined} empty={repayRows.length ? undefined : "Nothing to repay in this range."} />
          <FinCard
            title="To Receive"
            icon={ArrowDownLeft}
            sub={scopeSub}
            rows={recvRows.length ? partyRows(recvRows, false) : undefined}
            empty={recvRows.length ? undefined : "Nothing to receive in this range."}
            note={(cur.receiveOpeningCreditsSen ?? 0) > 0 ? `Left out, as on Debtor Aging: ${rm(cur.receiveOpeningCreditsSen ?? 0)} received in the opening period and not knocked off yet — it pays invoices from before the opening.` : undefined}
          />
          {(cur.tradeFinance?.length ?? 0) > 0 ? (
            <FinCard
              title="Trade Finance"
              icon={Banknote}
              sub={`${tfRows.length} draw${tfRows.length === 1 ? "" : "s"} · ${all ? "all still owed" : "due by the month end"}`}
              rows={tfRows.length ? tfRows.map((t, i) => ({ key: `${t.ref}-${i}`, l: `${t.lender}${t.ref ? ` · ${t.ref}` : ""}`, s: `Due ${dayMon(t.dueDate)}${t.paidFor ? ` · paid to ${t.paidFor}` : ""}`, v: rm(t.outstandingSen), vc: t.dueDate && t.dueDate < date ? F.neg : F.ink })) : undefined}
              empty={tfRows.length ? undefined : "No draw due in this range."}
            />
          ) : null}
          {(cur.fxBankPending?.length ?? 0) > 0 ? (
            <FinCard
              title="Bank Amount Pending · FX"
              icon={Globe}
              sub="Foreign-currency payments at the estimated rate"
              rows={(cur.fxBankPending ?? []).map((v) => ({ key: v.id, l: v.payee, s: `${v.pvNo} · ${formatCurrency(v.foreignSen, v.currency)} @ ${v.rate}`, v: rm(v.amountSen), vc: F.neg }))}
              note="The bank amount is confirmed on the desktop Payment Vouchers page."
            />
          ) : null}
          {(cur.planned?.length ?? 0) > 0 ? (
            <FinCard
              title="Planned Payments"
              icon={CalendarClock}
              sub="Display only"
              rows={(cur.planned ?? []).map((p) => ({ key: p.id, l: p.partyName, s: `Planned ${dayMon(p.expectedDate)}${p.ref ? ` · ${p.ref}` : ""}`, v: rm(p.amountSen) }))}
            />
          ) : null}
          {ticked.length > 0 ? (
            <FinCard
              title="Ticked as gone through"
              icon={CircleCheck}
              sub="Display only"
              rows={ticked.map(({ a, p }, i) => ({ key: `${a.code}-${p.sourceId}-${i}`, l: p.description || p.sourceId, s: `${a.code} · ${fmtDocDate(p.day)} · ${p.sourceId}`, v: `${p.amountSen > 0 ? "+" : "−"}${rm(Math.abs(p.amountSen))}`, vc: p.amountSen > 0 ? F.pos : F.neg }))}
            />
          ) : null}
        </>
      )}
    </FinScreen>
  );
}
