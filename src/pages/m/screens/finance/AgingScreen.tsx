// ---------------------------------------------------------------------------
// Debtor / Creditor Aging on the phone (Batch 3 prototype "agingB"; shared by
// Finance › Debtor / Creditor Aging and Receivable › Debtor Aging).
//
// The desktop page's reads, nothing of its own (ARTab / APTab in
// src/pages/accounting/index.tsx):
//  · /api/accounting/aging (?asOf= for a past month-end, ?orgId= for a company)
//  · /api/accounting/other-party-aging?type=DEBTOR|CREDITOR (&asOf=)
//  · /api/accounting/trade-finance (&asOf=) — creditor side, one party per open draw
//  · /api/accounting/ar-control | ap-control — the control-account checks today
//  · /api/accounting/trial-balance?asOf= — the controls as at a past month-end
// Bucket totals are the rows' five buckets added up (agingRowTotal / agingTotals,
// the desktop Total); the server decides which bucket a document is in (calendar
// months from the invoice date) and leaves opening-period advances out of the
// columns (their total is the footnote). The Invoices module's AR Aging (its
// own endpoint, day buckets by due date) is a different report and is not
// read here.
// A debtor document opens its invoice only when its number matches exactly one
// sales invoice in /api/accounting/ar-invoices; otherwise it is not a link.
// ---------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CloudOff, History, Receipt, SearchX, ShieldCheck, Sigma } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import type { APAgingEntry, ARAgingEntry, AgingDocDetail } from "@/types";
import { otherPartyAgingRows, type OtherPartyAgingBill } from "@/lib/other-party-aging-rows";
import { daysUntil, dueTone, monthBucket, nextDueOf, overdueSen } from "@/lib/aging-next-due";
import { asAtDate, monthOptions } from "@/lib/finance-reports";
import type { OpeningCredits } from "@/lib/aging-opening-credits";
import { useCompanyOptions } from "@/pages/accounting/shared";
import { todayYmdMY } from "@/lib/utils";
import { AGING_BUCKETS, agingBarWidths, agingRowTotal, agingTotals, uniqueInvoiceIds } from "./m-finance-lib";
import { FinBanner, FinCard, FinChips, FinDoc, FinHero, FinLabel, FinScreen, FinSearch, FinSkel, FinState, FinStep, type DocLine, type DocRef, type Tile } from "./fin-kit";
import { AGE_COLOURS, F, dayMon, docAmt, monYear, rm, tile } from "./fin-format";

type AgingResp = { success?: boolean; error?: string; data?: { ar?: ARAgingEntry[]; ap?: APAgingEntry[]; arOpeningCredits?: OpeningCredits } };
type OtherResp = { success?: boolean; data?: { bills?: OtherPartyAgingBill[] } };
type TfDraw = { drawSourceId: string; drawDate: string; dueDate: string; amountSen: number; interestSen: number; bankChargeSen: number; repaidSen: number; outstandingSen: number; paidSupplier: string };
type TfResp = { success?: boolean; data?: { sources?: { lenderName: string; accountCode: string; draws: TfDraw[] }[] } };
type ArCtl = { controls: { code: string; balanceSen: number }[]; tradeControlSen: number; invoiceOutstandingSen: number; customerCounterSen: number; driftControlVsInvoicesSen: number; driftCounterVsInvoicesSen: number };
type ApCtl = { controls: { code: string; balanceSen: number }[]; tradeControlSen: number; piOutstandingSen: number; netOutstandingSen?: number; driftControlVsPiSen: number };
type TbResp = { success?: boolean; data?: { rows: { accountCode: string; debitSen: number; creditSen: number }[] } };
type ArInvResp = { success?: boolean; data?: { rows?: { kind: string; id: string; no: string }[] } };

type Kind = "trade" | "other" | "tf";
type Party = {
  id: string; name: string; kind: Kind; buckets: number[]; total: number; docs: AgingDocDetail[];
  nextDue?: string; tf?: { lender: string; draw: TfDraw; repaid: TfDraw[] };
};
const BUCKET_KEYS = AGING_BUCKETS.map((b) => b.key);
const OTHER_DEBTOR_CTL = "305-0000";
const OTHER_CREDITOR_CTL = "405-0000";

const TONE_PILL = { overdue: ["Overdue", "#9A3A2D", "#F9E1DA"], soon: ["Due within 7 days", "#9C6F1E", "#FAEFCB"], later: ["Later", "#6B7280", "#F5F2ED"] } as const;

export function AgingScreen({ side, onBack, nav, title }: { side: "debtor" | "creditor"; onBack: () => void; nav?: ReactNode; title?: string }) {
  const navigate = useNavigate();
  const cred = side === "creditor";
  const today = todayYmdMY();
  const months = useMemo(() => monthOptions(today.slice(0, 7), 18), [today]); // newest first
  const [mi, setMi] = useState(0);
  const ym = months[mi];
  const asOf = asAtDate(ym, today);
  const hist = asOf < today;
  const companies = useCompanyOptions();
  const [company, setCompany] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | Kind>("all");
  const [open, setOpen] = useState<string | null>(null);

  const co = company ? `orgId=${encodeURIComponent(company)}` : "";
  const agingUrl = `/api/accounting/aging${hist || co ? "?" : ""}${[hist ? `asOf=${asOf}` : "", co].filter(Boolean).join("&")}`;
  const { data, loading, error, refresh } = useCachedJson<AgingResp>(agingUrl);
  const { data: other } = useCachedJson<OtherResp>(`/api/accounting/other-party-aging?type=${cred ? "CREDITOR" : "DEBTOR"}${hist ? `&asOf=${asOf}` : ""}`);
  const { data: tf } = useCachedJson<TfResp>(cred ? `/api/accounting/trade-finance${hist ? `?asOf=${asOf}` : ""}` : null);
  const { data: arCtl } = useCachedJson<{ success?: boolean; data?: ArCtl }>(!cred ? `/api/accounting/ar-control${co ? `?${co}` : ""}` : null);
  const { data: apCtl } = useCachedJson<{ success?: boolean; data?: ApCtl }>(cred ? `/api/accounting/ap-control${co ? `?${co}` : ""}` : null);
  const { data: tb } = useCachedJson<TbResp>(hist ? `/api/accounting/trial-balance?asOf=${asOf}${co ? `&${co}` : ""}` : null);
  const { data: arInv } = useCachedJson<ArInvResp>(!cred ? "/api/accounting/ar-invoices" : null);
  const invoiceIdByNo = useMemo(() => uniqueInvoiceIds(arInv?.success ? arInv.data?.rows ?? [] : []), [arInv]);

  const parties: Party[] = useMemo(() => {
    const list: (ARAgingEntry | APAgingEntry)[] = (cred ? data?.data?.ap : data?.data?.ar) ?? [];
    const trade: Party[] = list.map((r) => ({
      id: "customerId" in r ? `t:${r.customerId}` : `t:${r.supplierId}`,
      name: "customerName" in r ? r.customerName : r.supplierName,
      kind: "trade",
      buckets: BUCKET_KEYS.map((k) => Number(r[k]) || 0),
      total: agingRowTotal(r),
      docs: r.docs ?? [],
      nextDue: cred ? nextDueOf(r.docs ?? []) || undefined : undefined,
    }));
    const others: Party[] = other?.success
      ? otherPartyAgingRows(other.data?.bills ?? []).map((r) => ({
          id: `o:${r.partyId}`, name: r.partyName, kind: "other", buckets: BUCKET_KEYS.map((k) => Number(r[k]) || 0), total: agingRowTotal(r), docs: r.docs,
        }))
      : [];
    const draws: Party[] = cred && tf?.success
      ? (tf.data?.sources ?? []).flatMap((src) => {
          const repaid = src.draws.filter((d) => d.outstandingSen <= 0);
          return src.draws.filter((d) => d.outstandingSen > 0).map((d) => {
            const mo = monthBucket(d.drawDate, asOf);
            const buckets = [0, 0, 0, 0, 0];
            buckets[mo] = d.outstandingSen;
            return {
              id: `f:${d.drawSourceId}`, name: src.lenderName, kind: "tf" as const, buckets, total: d.outstandingSen,
              docs: [{ no: d.drawSourceId, date: d.drawDate, mo, amountSen: d.outstandingSen, due: d.dueDate }],
              nextDue: d.dueDate, tf: { lender: src.lenderName, draw: d, repaid },
            };
          });
        })
      : [];
    return [...draws, ...trade, ...others].sort((a, b) => b.total - a.total);
  }, [data, other, tf, cred, asOf]);

  const sumOf = (ps: Party[]) => ps.reduce((s, p) => s + p.total, 0);
  const totals = agingTotals(parties.map((p) => Object.fromEntries(BUCKET_KEYS.map((k, i) => [k, p.buckets[i]]))));
  const widths = agingBarWidths(totals.buckets);
  const count = (k: "all" | Kind) => parties.filter((p) => k === "all" || p.kind === k).length;
  const kw = q.trim().toLowerCase();
  const list = parties.filter((p) => (show === "all" || p.kind === show) && (!kw || p.name.toLowerCase().includes(kw)));
  const otherTotal = sumOf(parties.filter((p) => p.kind === "other"));
  const tradeTotal = sumOf(parties.filter((p) => p.kind === "trade"));
  const opening = data?.data?.arOpeningCredits ?? null;
  const openingSen = !cred ? opening?.receivedSen ?? 0 : 0;
  const failed = !!error || data?.success === false;

  // ---- the control checks (the desktop KPI cards, in the prototype's tiles) ----
  const tbBal = (code: string, debit: boolean) => {
    const r = tb?.success ? tb.data?.rows.find((x) => x.accountCode === code) : undefined;
    return r ? (debit ? r.debitSen - r.creditSen : r.creditSen - r.debitSen) : 0;
  };
  const driftTile = (k: string, sen: number): Tile => tile(k, rm(sen), sen === 0 ? { s: "matches ✓", sc: F.pos } : { c: "#85600F", rail: "#C9A24B", tint: "rgba(250,239,203,.9)" });
  const checks: Tile[] = [];
  if (!cred) {
    const c = arCtl?.success ? arCtl.data : undefined;
    const tradeCodes = (c?.controls ?? []).filter((x) => x.code !== OTHER_DEBTOR_CTL);
    const od = c?.controls.find((x) => x.code === OTHER_DEBTOR_CTL);
    if (hist) {
      if (c && tb?.success) {
        const ctlSen = tradeCodes.reduce((t, x) => t + tbBal(x.code, true), 0);
        checks.push(tile("Debtor control", rm(ctlSen), { s: "per ledger" }), driftTile("Drift", ctlSen - (tradeTotal - openingSen)));
      }
      checks.push(tile("Other debtors", rm(otherTotal), tb?.success && c ? { s: `Drift ${rm(tbBal(OTHER_DEBTOR_CTL, true) - otherTotal)}` } : {}), tile("Total outstanding", rm(totals.total)));
    } else {
      if (c) {
        checks.push(
          tile("Debtor control", rm(c.tradeControlSen), { s: "per ledger" }),
          tile("From invoices", rm(c.invoiceOutstandingSen), c.driftControlVsInvoicesSen === 0 ? { s: "matches ✓", sc: F.pos } : { s: `Drift ${rm(c.driftControlVsInvoicesSen)}`, sc: "#85600F" }),
          tile("Customer running counter", rm(c.customerCounterSen), c.driftCounterVsInvoicesSen === 0 ? { s: "matches ✓", sc: F.pos } : { s: `Drift ${rm(c.driftCounterVsInvoicesSen)}`, sc: "#85600F" }),
        );
      }
      checks.push(
        tile("Other debtors", rm(otherTotal), od ? (od.balanceSen - otherTotal === 0 ? { s: "matches ✓", sc: F.pos } : { s: `Drift ${rm(od.balanceSen - otherTotal)}`, sc: "#85600F" }) : {}),
        tile("Total outstanding", rm(totals.total), { span: 2 }),
      );
    }
  } else {
    const c = apCtl?.success ? apCtl.data : undefined;
    const tradeCodes = (c?.controls ?? []).filter((x) => x.code !== OTHER_CREDITOR_CTL);
    const overdue = overdueSen(parties.flatMap((p) => p.docs), asOf);
    if (c) {
      if (hist) {
        if (tb?.success) {
          const ctlSen = tradeCodes.reduce((t, x) => t + tbBal(x.code, false), 0);
          checks.push(tile("Creditor control", rm(ctlSen), { s: "per ledger" }), driftTile("Drift", ctlSen - tradeTotal));
        }
      } else {
        checks.push(tile("Creditor control", rm(c.tradeControlSen), { s: "per ledger" }), driftTile("Drift", c.driftControlVsPiSen));
      }
    }
    checks.push(
      tile("Other creditors", rm(otherTotal)),
      tile("Overdue", rm(overdue), { c: F.neg, rail: F.neg, tint: "rgba(251,231,227,.9)" }),
      tile("Total", rm(totals.total), { span: 2 }),
    );
  }

  const kindLabel = (k: Kind) => (k === "tf" ? "Trade Finance" : k === "other" ? (cred ? "Other creditor" : "Other debtor") : cred ? "Supplier" : "Customer");
  const types: { k: "all" | Kind; l: string }[] = cred
    ? [{ k: "all", l: "All" }, { k: "tf", l: "Trade Finance" }, { k: "trade", l: "Trade" }, { k: "other", l: "Other creditors" }]
    : [{ k: "all", l: "All" }, { k: "trade", l: "Trade" }, { k: "other", l: "Other debtors" }];
  const nTrade = count("trade");
  const nOther = count("other");
  const nTf = count("tf");
  const heroSub = cred
    ? `${nTrade} supplier${nTrade === 1 ? "" : "s"} · ${nOther} other creditor${nOther === 1 ? "" : "s"} · ${nTf} trade finance draw${nTf === 1 ? "" : "s"}`
    : `${nTrade} customer${nTrade === 1 ? "" : "s"} · ${nOther} other debtor${nOther === 1 ? "" : "s"}`;

  const docLines = (p: Party): DocLine[] => {
    const lines: DocLine[] = p.docs.map((d, i) => {
      const invId = !cred && p.kind === "trade" && d.amountSen > 0 ? invoiceIdByNo.get(d.no) : undefined;
      return {
        key: `${d.no}-${i}`,
        l: d.no || "—",
        s: `${dayMon(d.date, true)} · ${AGING_BUCKETS[d.mo]?.label ?? ""}${d.amountSen < 0 ? " · credit" : ""}`,
        v: rm(d.amountSen),
        vc: d.amountSen < 0 ? F.neg : F.ink,
        rail: AGE_COLOURS[d.mo] ?? AGE_COLOURS[0],
        go: !!invId,
        onTap: invId ? () => navigate(`/m/invoices/${encodeURIComponent(invId)}`) : undefined,
      };
    });
    if (p.tf) {
      const d = p.tf.draw;
      lines.push(
        { key: "tf-paid", l: `Paid to ${d.paidSupplier || "—"}`, s: `Drawn ${dayMon(d.drawDate)} · due ${dayMon(d.dueDate)}`, v: rm(d.amountSen), rail: "#C9A24B" },
        { key: "tf-int", l: "Interest", v: rm(d.interestSen), rail: "#C9A24B" },
        { key: "tf-chg", l: "Bank charges", v: rm(d.bankChargeSen), rail: "#C9A24B" },
        ...(d.repaidSen > 0 ? [{ key: "tf-rep", l: "Repaid so far", v: rm(d.repaidSen), rail: "#C9A24B" }] : []),
        ...p.tf.repaid.map((r) => ({ key: `tf-r-${r.drawSourceId}`, l: `Repaid draw ${r.drawSourceId}`, s: `Drawn ${dayMon(r.drawDate)} · ${r.paidSupplier || ""}`.replace(/ · $/, ""), v: rm(r.amountSen), rail: "#C9A24B" })),
      );
    }
    return lines;
  };

  const step = (
    <FinStep
      l={`As at ${monYear(ym)}${hist ? " month end" : ""}`}
      s={hist ? "Historical month end" : "Today"}
      onPrev={mi < months.length - 1 ? () => { setMi(mi + 1); setOpen(null); } : undefined}
      onNext={mi > 0 ? () => { setMi(mi - 1); setOpen(null); } : undefined}
    />
  );
  const search = (
    <FinSearch v={q} on={setQ} ph={cred ? "Search creditors" : "Search customers"}
      sel={{ v: company, on: (v) => { setCompany(v); setOpen(null); }, aria: "Company", opts: companies.map((o) => ({ v: o.value, l: o.value ? o.label : "All companies" })) }} />
  );

  return (
    <FinScreen title={title ?? (cred ? "Creditor Aging" : "Debtor Aging")} onBack={onBack}>
      {nav}
      {search}
      {step}
      {hist ? <FinBanner tone="warn" icon={History} t="Historical date." s="Showing balances as they stood at that month end." /> : null}
      {loading && !data ? (
        <FinSkel n={3} h={140} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the aging." s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : (
        <>
          <FinHero
            k={cred ? "Total we owe" : "Total owed to us"}
            v={rm(totals.total)}
            s={heroSub}
            stack={widths.map((w, i) => ({ w, c: AGE_COLOURS[i] }))}
            tiles={AGING_BUCKETS.map((b, i) => ({ k: b.label, v: rm(totals.buckets[b.key]), dot: AGE_COLOURS[i] }))}
          />
          <FinCard title={cred ? "Creditor checks" : "Debtor checks"} icon={ShieldCheck} sub="Control account vs aging" tiles={checks} test="aging-checks" />
          <FinChips opts={types.map((t) => ({ k: t.k, l: t.l, n: count(t.k) }))} cur={show} set={(k) => { setShow(k); setOpen(null); }} />
          <FinLabel l={`${list.length} ${list.length === 1 ? "PARTY" : "PARTIES"}`} r={`${rm(sumOf(list))} subtotal`} />
          {list.length === 0 ? (
            parties.length === 0 ? (
              <FinState icon={Receipt} bg={F.cream} c={F.gold} t={cred ? "Nothing owed" : "Nothing outstanding"} s={cred ? `No supplier is owed anything ${hist ? "at that month end" : "today"}.` : `No customer owes anything ${hist ? "at that month end" : "today"}.`} />
            ) : (
              <FinState icon={SearchX} bg={F.cream} c={F.gold} t="No parties match" s="Try another name or filter." />
            )
          ) : (
            list.map((p) => {
              const op = open === p.id;
              const lastIdx = p.buckets.reduce((acc, v, i) => (v !== 0 ? i : acc), 0);
              const tone = p.nextDue ? TONE_PILL[dueTone(daysUntil(p.nextDue, asOf))] : null;
              const lines = docLines(p);
              const nDocs = p.docs.length;
              return (
                <FinDoc
                  key={p.id}
                  test="aging-party"
                  code={kindLabel(p.kind)}
                  st={tone?.[0]}
                  stFg={tone?.[1]}
                  stBg={tone?.[2]}
                  rail={tone ? tone[1] : AGE_COLOURS[lastIdx]}
                  date={p.nextDue ? `Next due ${dayMon(p.nextDue)}` : undefined}
                  party={p.kind === "tf" ? `${p.name} · ${p.tf?.draw.drawSourceId ?? ""}` : p.name}
                  aria={p.name}
                  refs={p.buckets.flatMap((v, i): DocRef[] => (v ? [{ k: AGING_BUCKETS[i].label, v: rm(v) }] : []))}
                  stack={p.buckets.map((v) => ({ w: (Math.max(0, v) / Math.max(1, p.total)) * 100, c: "" })).map((x, i) => ({ ...x, c: AGE_COLOURS[i] }))}
                  amts={[docAmt("Outstanding", rm(p.total), { gold: true, c: p.total < 0 ? F.neg : F.ink }), docAmt("Documents", String(nDocs))]}
                  lines={op ? lines : null}
                  toggle={{ l: op ? "Hide documents" : `Show ${nDocs} document${nDocs === 1 ? "" : "s"}`, open: op, onTap: () => setOpen(op ? null : p.id) }}
                  note={!cred && p.docs.some((d) => d.amountSen < 0) ? "Includes credits (an advance or a credit note) shown as negative lines." : undefined}
                  onTap={() => setOpen(op ? null : p.id)}
                />
              );
            })
          )}
          <FinCard
            title="Grand total"
            icon={Sigma}
            val={{ v: rm(totals.total), s: "all parties" }}
            tiles={AGING_BUCKETS.map((b, i) => tile(b.label, rm(totals.buckets[b.key]), { dot: AGE_COLOURS[i] }))}
            note={cred ? undefined : (
              <>
                Aging counts calendar months from the invoice date.
                {openingSen > 0
                  ? ` Not in the columns: ${opening?.items.length ?? 0} receipt${(opening?.items.length ?? 0) === 1 ? "" : "s"} from the opening period not knocked off yet, ${rm(openingSen)} — they pay invoices from before the opening. The ledger still counts them.`
                  : " Opening-period advances are listed in this footnote, not in the buckets."}
              </>
            )}
          />
        </>
      )}
    </FinScreen>
  );
}
