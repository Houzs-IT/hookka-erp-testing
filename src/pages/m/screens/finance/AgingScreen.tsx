// ---------------------------------------------------------------------------
// Debtor / Creditor Aging on the phone (finance v2 mobile, part A). Reads
// /api/accounting/aging — the desktop page's read — as at today (aging as at
// a chosen month-end is deferred). The Outstanding card and the bucket chips
// are sums of the rows' five buckets, the desktop Total; a tap opens a party's
// documents. Debtor Aging also lists the other debtors, Creditor Aging the
// other creditors and one row per open trade-finance draw with its next due
// date (owner 2026-10-17, Finance v2), from the desktop page's own reads.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import type { APAgingEntry, ARAgingEntry, AgingDocDetail } from "@/types";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote } from "./finance-shell";
import { AGING_BUCKETS, agingBarWidths, agingRowTotal, agingTotals, fmtMoney } from "./m-finance-lib";
import { otherPartyAgingRows, type OtherPartyAgingBill, type OtherPartyAgingRow } from "@/lib/other-party-aging-rows";
import { daysUntil, dueText, dueTone, monthBucket, nextDueOf } from "@/lib/aging-next-due";
import { todayYmdMY } from "@/lib/utils";

// The design's bucket colours: teal while current, warming to red as it ages.
const BUCKET_COLOURS = ["#5AA49B", "#9AC9BF", "#F2B47E", "#E8A07C", "#D9704F"];

type AgingResp = { success?: boolean; error?: string; data?: { ar?: ARAgingEntry[]; ap?: APAgingEntry[] } };
type OtherResp = { success?: boolean; data?: { bills?: OtherPartyAgingBill[] } };
type TfResp = { success?: boolean; data?: { sources?: { lenderName: string; draws: { drawSourceId: string; drawDate: string; dueDate: string; outstandingSen: number; paidSupplier: string }[] }[] } };
type BucketRow = { currentSen: number; days30Sen: number; days60Sen: number; days90Sen: number; over90Sen: number };
type Party = { id: string; name: string; kind: "trade" | "other" | "tf"; sub?: string; nextDue?: string; row: ARAgingEntry | APAgingEntry | OtherPartyAgingRow | BucketRow; total: number; docs: AgingDocDetail[] };
const KIND_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  other: { label: "Other", bg: "#F4EEE3", fg: "#6B5C32" },
  tf: { label: "Trade finance", bg: "#E8EDF2", fg: "#1F2A44" },
};
const BUCKET_KEYS = ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"] as const;
const TONE_COLOUR = { overdue: "#9A3A2D", soon: "#7A5B12", later: "#6B7280" } as const;

export function AgingScreen({ side }: { side: "debtor" | "creditor" }) {
  const { data, loading, error } = useCachedJson<AgingResp>("/api/accounting/aging");
  const { data: other } = useCachedJson<OtherResp>(`/api/accounting/other-party-aging?type=${side === "debtor" ? "DEBTOR" : "CREDITOR"}`);
  const { data: tf } = useCachedJson<TfResp>(side === "creditor" ? "/api/accounting/trade-finance" : null);
  const today = todayYmdMY();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const title = side === "debtor" ? "Debtor Aging" : "Creditor Aging";
  const noun = side === "debtor" ? "customer" : "supplier";

  const parties: Party[] = useMemo(() => {
    const list: (ARAgingEntry | APAgingEntry)[] = (side === "debtor" ? data?.data?.ar : data?.data?.ap) ?? [];
    const trade: Party[] = list.map((r) => ({
      id: "customerId" in r ? r.customerId : r.supplierId,
      name: "customerName" in r ? r.customerName : r.supplierName,
      kind: "trade",
      nextDue: side === "creditor" ? nextDueOf(r.docs ?? []) : undefined,
      row: r,
      total: agingRowTotal(r),
      docs: r.docs ?? [],
    }));
    const others: Party[] = other?.success
      ? otherPartyAgingRows(other.data?.bills ?? []).map((r) => ({ id: `o:${r.partyId}`, name: r.partyName, kind: "other", row: r, total: agingRowTotal(r), docs: r.docs }))
      : [];
    const draws: Party[] = side === "creditor" && tf?.success
      ? (tf.data?.sources ?? []).flatMap((src) => src.draws.filter((d) => d.outstandingSen > 0).map((d) => {
          const mo = monthBucket(d.drawDate, today);
          const row: BucketRow = { currentSen: 0, days30Sen: 0, days60Sen: 0, days90Sen: 0, over90Sen: 0 };
          row[BUCKET_KEYS[mo]] = d.outstandingSen;
          return {
            id: `f:${d.drawSourceId}`, name: src.lenderName, kind: "tf" as const, sub: [d.drawSourceId, d.paidSupplier].filter(Boolean).join(" · "),
            nextDue: d.dueDate, row, total: d.outstandingSen,
            docs: [{ no: d.drawSourceId, date: d.drawDate, mo, amountSen: d.outstandingSen, due: d.dueDate }],
          };
        }))
      : [];
    return [...trade, ...others, ...draws].sort((a, b) => b.total - a.total);
  }, [data, other, tf, side, today]);
  const otherCount = parties.filter((p) => p.kind === "other").length;
  const drawCount = parties.filter((p) => p.kind === "tf").length;
  const totals = useMemo(() => agingTotals(parties.map((p) => p.row)), [parties]);
  const widths = agingBarWidths(totals.buckets);
  const kw = q.trim().toLowerCase();
  const shown = kw ? parties.filter((p) => p.name.toLowerCase().includes(kw)) : parties;
  const failed = !!error || data?.success === false;

  return (
    <>
      <FinanceHeader title={title} />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && !data ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{data?.error || error || "Couldn't load the aging."}</FinanceNote>
        ) : (
          <>
            <MobileCard>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: M.raisin }}>Outstanding</span>
                <span style={{ fontSize: 12, color: M.muted }}>
                  {parties.length - otherCount - drawCount} {noun}{parties.length - otherCount - drawCount === 1 ? "" : "s"}
                  {otherCount ? ` · ${otherCount} other ${side === "debtor" ? "debtor" : "creditor"}${otherCount === 1 ? "" : "s"}` : ""}
                  {drawCount ? ` · ${drawCount} draw${drawCount === 1 ? "" : "s"}` : ""} · as at today
                </span>
              </div>
              <div data-m-fin="outstanding" style={{ fontSize: 28, fontWeight: 700, color: M.raisin, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                {fmtMoney(totals.total)}
              </div>
              <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 12, background: M.hairline }}>
                {widths.map((w, i) => (w > 0 ? <div key={AGING_BUCKETS[i].key} style={{ width: `${w}%`, background: BUCKET_COLOURS[i] }} /> : null))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
                {AGING_BUCKETS.map((b, i) => {
                  const v = totals.buckets[b.key];
                  return (
                    <div key={b.key} data-m-fin={`bucket-${b.key}`} style={{ border: `1px solid ${M.border}`, borderRadius: 10, padding: "7px 9px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: M.body }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: BUCKET_COLOURS[i], flexShrink: 0 }} />
                        {b.label}
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: v < 0 ? "#9A3A2D" : M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(v)}</div>
                    </div>
                  );
                })}
              </div>
            </MobileCard>

            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 12px", border: `1px solid ${M.border}`, borderRadius: 12, background: M.card }}>
              <Search size={16} color={M.faint} />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${noun}`}
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: M.raisin, minHeight: 42 }}
              />
            </label>

            {shown.length === 0 ? (
              <FinanceNote>{parties.length === 0 ? `No ${noun} owes anything today.` : `No ${noun} matches “${q.trim()}”.`}</FinanceNote>
            ) : (
              <MobileCard padded={false} radius={16}>
                {shown.map((p, idx) => {
                  const isOpen = open === p.id;
                  return (
                    <div key={p.id} style={{ borderBottom: idx === shown.length - 1 ? "none" : `1px solid ${M.divider}` }}>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : p.id)}
                        aria-expanded={isOpen}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: 50, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}
                      >
                        {isOpen ? <ChevronDown size={16} color={M.taupe} /> : <ChevronRight size={16} color={M.faint} />}
                        <span style={{ flex: 1, fontSize: 15, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}
                          {KIND_TAG[p.kind] ? <span data-m-fin={`${p.kind}-tag`} style={{ marginLeft: 6, fontSize: 11, color: KIND_TAG[p.kind].fg, background: KIND_TAG[p.kind].bg, borderRadius: 999, padding: "1px 7px" }}>{KIND_TAG[p.kind].label}</span> : null}
                          {p.sub || p.nextDue ? (
                            <span style={{ display: "block", fontSize: 11.5, color: M.muted, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {p.sub}
                              {p.sub && p.nextDue ? " · " : ""}
                              {p.nextDue ? (() => { const days = daysUntil(p.nextDue, today); return <span data-m-fin="next-due" style={{ color: TONE_COLOUR[dueTone(days)] }}>Next due {p.nextDue.split("-").reverse().join("/")} · {dueText(days)}</span>; })() : null}
                            </span>
                          ) : null}
                        </span>
                        <span data-m-fin="party-total" style={{ fontSize: 15, fontWeight: 700, color: p.total < 0 ? "#9A3A2D" : M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(p.total)}</span>
                      </button>
                      {isOpen && (
                        <div style={{ padding: "0 14px 10px 38px" }}>
                          {p.docs.length === 0 ? (
                            <div style={{ fontSize: 12.5, color: M.muted, padding: "4px 0" }}>No document detail.</div>
                          ) : (
                            p.docs.map((d, i) => (
                              <div key={`${d.no}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 0", borderTop: i ? `1px dashed ${M.hairline}` : "none" }}>
                                <span style={{ flex: 1, fontSize: 13, color: M.body }}>
                                  {d.no || "—"}
                                  <span style={{ display: "block", fontSize: 11.5, color: M.muted }}>
                                    {d.date} · {AGING_BUCKETS[d.mo]?.label ?? ""}
                                  </span>
                                </span>
                                <span style={{ fontSize: 13.5, color: d.amountSen < 0 ? "#9A3A2D" : M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(d.amountSen)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </MobileCard>
            )}
          </>
        )}
      </div>
    </>
  );
}
