// ---------------------------------------------------------------------------
// Debtor / Creditor Aging on the phone (finance v2 mobile, part A). Reads
// /api/accounting/aging — the desktop page's read — as at today (aging as at
// a chosen month-end is deferred). The Outstanding card and the bucket chips
// are sums of the rows' five buckets, the desktop Total; a tap opens a party's
// documents.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import type { APAgingEntry, ARAgingEntry, AgingDocDetail } from "@/types";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote } from "./finance-shell";
import { AGING_BUCKETS, agingBarWidths, agingRowTotal, agingTotals, fmtMoney } from "./m-finance-lib";

// The design's bucket colours: teal while current, warming to red as it ages.
const BUCKET_COLOURS = ["#5AA49B", "#9AC9BF", "#F2B47E", "#E8A07C", "#D9704F"];

type AgingResp = { success?: boolean; error?: string; data?: { ar?: ARAgingEntry[]; ap?: APAgingEntry[] } };
type Party = { id: string; name: string; row: ARAgingEntry | APAgingEntry; total: number; docs: AgingDocDetail[] };

export function AgingScreen({ side }: { side: "debtor" | "creditor" }) {
  const { data, loading, error } = useCachedJson<AgingResp>("/api/accounting/aging");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const title = side === "debtor" ? "Debtor Aging" : "Creditor Aging";
  const noun = side === "debtor" ? "customer" : "supplier";

  const parties: Party[] = useMemo(() => {
    const list: (ARAgingEntry | APAgingEntry)[] = (side === "debtor" ? data?.data?.ar : data?.data?.ap) ?? [];
    return list
      .map((r) => ({
        id: "customerId" in r ? r.customerId : r.supplierId,
        name: "customerName" in r ? r.customerName : r.supplierName,
        row: r,
        total: agingRowTotal(r),
        docs: r.docs ?? [],
      }))
      .sort((a, b) => b.total - a.total);
  }, [data, side]);
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
                  {parties.length} {noun}{parties.length === 1 ? "" : "s"} · as at today
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
                        <span style={{ flex: 1, fontSize: 15, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
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
