// ---------------------------------------------------------------------------
// Daily Cash Position on the phone (finance v2 mobile, part C). Reads the
// desktop board (/api/accounting/cash-position?date=), one day at a time:
// current cash available and what is left after repaying and receiving (the
// desktop's default scopes, cashAfterRepayReceive), the vouchers awaiting
// approval, and each bank collapsed until tapped. Share sends the desktop's
// own image (drawCashPositionImage) through the phone's share sheet, or saves
// it where sharing a file is not offered. Read-only: ticks and planned
// payments stay on the desktop.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { ChevronDown, ChevronRight, Share } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { fmtDocDate, pendingReceiptsFirst, weekdayOf } from "@/lib/finance-daily";
import { cashAfterRepayReceive, drawCashPositionImage, type CashImageAccount } from "@/lib/cash-position-image";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote, FinanceStepper } from "./finance-shell";
import { fmtMoney } from "./m-finance-lib";

type CashResp = {
  success?: boolean;
  error?: string;
  data?: {
    date: string;
    accounts: (CashImageAccount & { pendingSen: number })[];
    totalBankEstSen: number;
    totalAvailableSen: number;
    repay: { month: string; name: string; outstandingSen?: number }[];
    receive: { month: string; name: string; totalSen?: number }[];
    awaitingApproval?: { id: string; state: string; amountSen: number }[];
    awaitingCheckedSen?: number;
  };
};

const shiftDay = (ymd: string, d: number) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const longDay = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function CashScreen() {
  const today = todayYmdMY();
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const { data: resp, loading, error } = useCachedJson<CashResp>(`/api/accounting/cash-position?date=${date}`);
  const cur = resp?.success && resp.data?.date === date ? resp.data : null;
  const totals = cur ? cashAfterRepayReceive(cur, date.slice(0, 7)) : null;
  const failed = !!error || resp?.success === false;

  const share = async () => {
    if (!cur || !totals) return;
    setSharing(true);
    setShareNote(null);
    try {
      const blob = await drawCashPositionImage(cur, totals);
      const file = new File([blob], `cash-position-${cur.date}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `Cash Position — ${cur.date}` });
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

  return (
    <>
      <FinanceHeader
        title="Daily Cash Position"
        trailing={
          <button type="button" aria-label="Share as image" disabled={!cur || sharing} onClick={() => void share()} style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: cur ? M.taupe : M.faint, cursor: cur ? "pointer" : "default" }}>
            <Share size={20} />
          </button>
        }
      />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <FinanceStepper
          label={longDay(date)}
          note={`${weekdayOf(date)}${date === today ? " · today" : ""}`}
          onPrev={() => setDate(shiftDay(date, -1))}
          onNext={() => setDate(shiftDay(date, 1))}
        />
        {shareNote && <FinanceNote tone="error">{shareNote}</FinanceNote>}
        {loading && !cur ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{resp?.error || error || "Couldn't load the cash position."}</FinanceNote>
        ) : !cur || !totals ? (
          <FinanceNote>No cash position for this day.</FinanceNote>
        ) : (
          <>
            <MobileCard style={{ border: "1px solid #1F1D1B" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: M.muted }}>Current cash available</div>
              <div data-m-fin="cash-available" style={{ fontSize: 28, fontWeight: 700, color: cur.totalAvailableSen < 0 ? "#9A3A2D" : "#27500A", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                RM {fmtMoney(cur.totalAvailableSen)}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, borderTop: `1px solid ${M.divider}`, marginTop: 10, paddingTop: 10 }}>
                <span style={{ fontSize: 13, color: M.muted }}>After repay &amp; receive</span>
                <span data-m-fin="cash-after" style={{ fontSize: 15, fontWeight: 700, color: totals.netAfterSen < 0 ? "#9A3A2D" : "#27500A", fontVariantNumeric: "tabular-nums" }}>
                  RM {fmtMoney(totals.netAfterSen)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: M.faint, textAlign: "right" }}>
                − to repay {fmtMoney(totals.repayShownSen)} + to receive {fmtMoney(totals.recvShownSen)}
              </div>
            </MobileCard>

            {awaiting.length > 0 && (
              <div data-m-fin="cash-awaiting" style={{ borderRadius: 12, padding: "10px 12px", background: "#FBF3E4", color: "#7A5B12", fontSize: 13 }}>
                Awaiting approval: RM {fmtMoney(checkedSen)} checked{softSen > 0 ? ` · RM ${fmtMoney(softSen)} in draft` : ""} — not counted yet.
              </div>
            )}

            {cur.accounts.map((a) => {
              const isOpen = open === a.code;
              const rows = pendingReceiptsFirst(a.pending.filter((p) => !p.ticked));
              return (
                <MobileCard key={a.code} padded={false} radius={14} style={{ overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : a.code)}
                    aria-expanded={isOpen}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "10px 12px", border: "none", background: "#E2E8F0", textAlign: "left", cursor: "pointer" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#1F2937" }}>{a.code} {a.name}{a.reconciled ? "" : " (book only)"}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "#4B5563" }}>
                        Bank (est.) RM {fmtMoney(a.bankEstSen)}{rows.length ? ` · ${rows.length} pending` : ""}
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span style={{ display: "block", fontSize: 10.5, color: "#4B5563" }}>Available</span>
                      <span data-m-fin="bank-available" style={{ display: "block", fontSize: 15, fontWeight: 700, color: a.availableSen < 0 ? "#9A3A2D" : "#1F2937", fontVariantNumeric: "tabular-nums" }}>RM {fmtMoney(a.availableSen)}</span>
                    </span>
                    {isOpen ? <ChevronDown size={18} color="#4B5563" /> : <ChevronRight size={18} color="#4B5563" />}
                  </button>
                  {isOpen && (
                    <div style={{ padding: "4px 12px 10px" }}>
                      {a.unbookedCount > 0 && (
                        <div style={{ fontSize: 12, color: "#7A5B12", padding: "6px 0" }}>
                          Includes {a.unbookedCount} bank item{a.unbookedCount === 1 ? "" : "s"} not booked yet (RM {fmtMoney(a.unbookedSen)})
                        </div>
                      )}
                      {rows.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: M.muted, padding: "6px 0" }}>Nothing pending — everything booked has gone through the bank.</div>
                      ) : (
                        rows.map((p, i) => (
                          <div key={`${p.sourceId}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "7px 0", borderTop: i ? `1px dashed ${M.hairline}` : "none" }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: M.body }}>
                              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description || p.sourceId}</span>
                              <span style={{ display: "block", fontSize: 11.5, color: M.muted }}>{fmtDocDate(p.day)} · {p.sourceId}</span>
                            </span>
                            <span style={{ fontSize: 13.5, fontVariantNumeric: "tabular-nums", color: p.amountSen > 0 ? "#27500A" : M.raisin }}>
                              {p.amountSen > 0 ? "+" : "−"}{fmtMoney(Math.abs(p.amountSen))}
                            </span>
                          </div>
                        ))
                      )}
                      {a.oldPendingCount > 0 && (
                        <div style={{ fontSize: 11.5, color: M.faint, paddingTop: 6 }}>
                          Older reconciliation items: {a.oldPendingCount} · RM {fmtMoney(a.oldPendingSen)} (counted above)
                        </div>
                      )}
                    </div>
                  )}
                </MobileCard>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
