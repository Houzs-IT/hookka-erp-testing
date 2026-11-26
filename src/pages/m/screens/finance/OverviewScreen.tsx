// ---------------------------------------------------------------------------
// The Finance Overview on the phone (Batch 3 prototype "ovB"). Reads the
// desktop Overview's trend (/api/accounting/overview-trend?months=3|6|12) and
// draws its five figures as bar cards — sales orders vs invoices, gross and
// net profit, raw material and direct labour as a % of sales (shareOfSales,
// as the desktop) — then the month's most produced models and the AR / AP
// aging summaries (/api/accounting/aging, the desktop Overview's read). A tap
// on a bar opens how that month's figure is made (explainMonth, the desktop's
// hover). A month before the books opened shows "—", never 0.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BedDouble, ChartColumn, CloudOff, Coins, HandCoins, HardHat, Package, Receipt, ShoppingCart, Sofa, TrendingUp, type LucideIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { explainMonth, shareOfSales, type ModelQty, type OverviewMetric, type OverviewMonth } from "@/lib/overview-trend";
import type { APAgingEntry, ARAgingEntry } from "@/types";
import { AGING_BUCKETS, agingBarWidths, agingTotals } from "./m-finance-lib";
import { FinCard, FinScreen, FinSeg, FinSheet, FinSkel, FinState, type SheetRow } from "./fin-kit";
import { AGE_COLOURS, F, barGeometry, monYear, rm, rmShort, tile } from "./fin-format";

type Range = "3" | "6" | "12";
const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
const shortMon = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

type Series = { title: string; icon: LucideIcon; c: string; metric: OverviewMetric; bar: (m: OverviewMonth) => number | null; label: (m: OverviewMonth) => string; head: (m: OverviewMonth) => string; sub: (m: OverviewMonth) => string };

const SERIES: Series[] = [
  {
    title: "Sales Orders vs Invoices", icon: ShoppingCart, c: "#2B5797", metric: "orders",
    bar: (m) => m.inv.sen,
    label: (m) => (m.so.sen > 0 ? pctTxt((m.inv.sen / m.so.sen) * 100) : "—"),
    head: (m) => (m.so.sen > 0 ? pctTxt((m.inv.sen / m.so.sen) * 100) : "—"),
    sub: (m) => `invoiced ${rm(m.inv.sen)} of ${rm(m.so.sen)} ordered`,
  },
  {
    title: "Gross Profit", icon: TrendingUp, c: "#4F7C3A", metric: "gp",
    bar: (m) => m.pnl?.grossProfitSen ?? null,
    label: (m) => rmShort(m.pnl?.grossProfitSen ?? null),
    head: (m) => rm(m.pnl?.grossProfitSen ?? null),
    sub: (m) => (m.pnl ? `${pctTxt(shareOfSales(m.pnl.grossProfitSen, m.pnl.netSalesSen))} of sales` : "before the books opened"),
  },
  {
    title: "Net Profit", icon: Coins, c: "#6B5C32", metric: "np",
    bar: (m) => m.pnl?.netProfitSen ?? null,
    label: (m) => rmShort(m.pnl?.netProfitSen ?? null),
    head: (m) => rm(m.pnl?.netProfitSen ?? null),
    sub: (m) => (m.pnl ? `${pctTxt(shareOfSales(m.pnl.netProfitSen, m.pnl.netSalesSen))} of sales` : "before the books opened"),
  },
  {
    title: "Raw Material % of sales", icon: Package, c: "#85600F", metric: "rm",
    bar: (m) => (m.pnl ? shareOfSales(m.pnl.rm.usedSen, m.pnl.netSalesSen) : null),
    label: (m) => pctTxt(m.pnl ? shareOfSales(m.pnl.rm.usedSen, m.pnl.netSalesSen) : null),
    head: (m) => pctTxt(m.pnl ? shareOfSales(m.pnl.rm.usedSen, m.pnl.netSalesSen) : null),
    sub: (m) => (m.pnl ? `${rm(m.pnl.rm.usedSen)} used` : "before the books opened"),
  },
  {
    title: "Direct Labour % of sales", icon: HardHat, c: "#6B4A6D", metric: "dl",
    bar: (m) => (m.pnl ? shareOfSales(m.pnl.labourSen, m.pnl.netSalesSen) : null),
    label: (m) => pctTxt(m.pnl ? shareOfSales(m.pnl.labourSen, m.pnl.netSalesSen) : null),
    head: (m) => pctTxt(m.pnl ? shareOfSales(m.pnl.labourSen, m.pnl.netSalesSen) : null),
    sub: (m) => (m.pnl ? rm(m.pnl.labourSen) : "before the books opened"),
  },
];

type AgingResp = { success?: boolean; data?: { ar?: ARAgingEntry[]; ap?: APAgingEntry[] } };

export function OverviewScreen() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("3");
  const [expl, setExpl] = useState<{ s: Series; m: OverviewMonth } | null>(null);
  const { data: resp, loading, error, refresh } = useCachedJson<{ success?: boolean; error?: string; data?: { months: OverviewMonth[] } }>(
    `/api/accounting/overview-trend?months=${range}`,
  );
  const { data: aging } = useCachedJson<AgingResp>("/api/accounting/aging");
  const months = resp?.success ? resp.data?.months ?? [] : [];
  const last = months[months.length - 1];
  const failed = !!error || resp?.success === false;
  const n = months.length;
  const crowded = n > 6;
  const lastName = last ? `${monYear(last.ym)}${last.running ? " *" : ""}` : "";

  const chart = (s: Series) => {
    const vals = months.map(s.bar);
    const geo = barGeometry(vals, null, 100);
    return (
      <FinCard
        key={s.title}
        test={`ov-${s.metric}`}
        title={s.title}
        icon={s.icon}
        sub={`Last ${n} month${n === 1 ? "" : "s"}`}
        val={{ v: s.head(last), s: `${lastName} · ${s.sub(last)}` }}
        bars={months.map((m, i) => ({
          l: crowded ? shortMon(m.ym)[0] : `${shortMon(m.ym)}${m.running ? "*" : ""}`,
          sel: i === n - 1,
          v: crowded ? "" : s.label(m),
          vneg: (vals[i] ?? 0) < 0,
          h: vals[i] == null ? 0 : geo[i].h,
          c: (vals[i] ?? 0) < 0 ? (i === n - 1 ? F.neg : `${F.neg}88`) : i === n - 1 ? s.c : `${s.c}88`,
          aria: `${monYear(m.ym)}: ${s.label(m)}`,
          onTap: () => setExpl({ s, m }),
        }))}
      />
    );
  };

  const topCard = (title: string, icon: LucideIcon, items: ModelQty[]) => (
    <FinCard
      key={title}
      title={title}
      icon={icon}
      sub={`${lastName} · pieces completed`}
      rows={items.length ? items.map((t, i) => ({ key: t.model, l: t.model, s: `${t.orders} order${t.orders === 1 ? "" : "s"}`, v: `${t.qty.toLocaleString("en-MY")} pcs`, rail: i === 0 ? "#C9A24B" : "transparent" })) : undefined}
      empty={items.length ? undefined : "No pieces completed this month."}
    />
  );

  const agingCard = (title: string, icon: LucideIcon, who: string, rows: (ARAgingEntry | APAgingEntry)[], to: string, btn: string) => {
    const t = agingTotals(rows);
    const w = agingBarWidths(t.buckets);
    return (
      <FinCard
        key={title}
        title={title}
        icon={icon}
        sub={`${who} · ${rm(t.total)}`}
        stack={w.map((x, i) => ({ w: x, c: AGE_COLOURS[i] }))}
        tiles={AGING_BUCKETS.map((b, i) => tile(b.label, rm(t.buckets[b.key]), { dot: AGE_COLOURS[i] }))}
        btn={{ l: btn, onTap: () => navigate(to) }}
      />
    );
  };

  const explRows: SheetRow[] = expl
    ? explainMonth(expl.m, expl.s.metric).map((x, i) => ({
        key: `${x.label}-${i}`,
        l: x.label,
        s: x.note,
        v: x.sen !== undefined ? rm(x.sen) : x.pct !== undefined ? pctTxt(x.pct) : undefined,
        w: x.total ? 800 : 600,
      }))
    : [];

  return (
    <FinScreen title="Overview" onBack={() => navigate("/m/finance")}>
      <FinSeg opts={[{ k: "3", l: "3 months" }, { k: "6", l: "6 months" }, { k: "12", l: "12 months" }]} cur={range} set={setRange} aria="Months shown" />
      {loading && !resp ? (
        <FinSkel n={3} h={220} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the overview." s={resp?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : !last ? (
        <FinState icon={ChartColumn} bg={F.cream} c={F.gold} t="No months to show" s="The overview has no month with figures yet." />
      ) : (
        <>
          {SERIES.map(chart)}
          {topCard("Top 5 Sofa models", Sofa, last.top?.SOFA ?? [])}
          {topCard("Top 5 Bedframe models", BedDouble, last.top?.BEDFRAME ?? [])}
          {aging?.success ? (
            <>
              {agingCard("AR Aging", HandCoins, "Who owes us", aging.data?.ar ?? [], "/m/finance/debtors", "Open Debtor Aging")}
              {agingCard("AP Aging", Receipt, "What we owe", aging.data?.ap ?? [], "/m/finance/creditors", "Open Creditor Aging")}
            </>
          ) : null}
        </>
      )}
      <FinSheet
        open={!!expl}
        onClose={() => setExpl(null)}
        title={expl ? `${expl.s.title} · ${monYear(expl.m.ym)}${expl.m.running ? " *" : ""}` : ""}
        rows={explRows}
        note="Same calculation as the desktop Overview."
      />
    </FinScreen>
  );
}
