// ---------------------------------------------------------------------------
// Receivable › Receipts (Batch 3 prototype "rrcptB" / "rdetB rc"): every
// payment in, one list — the desktop Receipts hub (ReceiptsHubTab in
// src/pages/accounting/index.tsx) merged from the same three reads:
//   customer      GET /api/payments            (only with payments:read)
//   other debtor  GET /api/accounting/other-party-payments?type=DEBTOR
//   official      GET /api/accounting/official-receipts
// Status pill = receiptStatus (src/lib/finance-daily.ts); "on account" =
// unallocatedSen (src/lib/customer-receipt.ts). Approved correction 7: the
// Cancelled chip is "lifecycle not ACTIVE", as on the desktop — a bounced
// receipt is still a live receipt and stays in its own kind. Read-only: new
// receipts, edits, voids and duplicates stay on the desktop.
// ---------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Banknote, FileText, Link2, ListOrdered, Receipt, Sigma } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { PaymentRecord } from "@/types";
import { receiptStatus } from "@/lib/finance-daily";
import { hasUnallocated, unallocatedSen } from "@/lib/customer-receipt";
import { FinCard, FinChips, FinDoc, FinHero, FinScreen, FinSearch, FinState, type Row } from "../finance/fin-kit";
import { F, docAmt, rm } from "../finance/fin-format";
import { LoadOr, NotFound } from "./rcv-lib";
import { failedOf, kvRows, listOf, words } from "./rcv-data";

type Kind = "customer" | "other" | "official";
type OdPay = { paymentNo: string; partyName: string; date: string; bankAccount: string; totalSen: number; lifecycleState?: string; reference?: string; lines: { billId: string; billNo: string; amountSen: number }[] };
type OrRow = { id: string; orNo: string; date: string; receivedFrom: string | null; description: string | null; payTo: string; totalSen: number; status: string; lifecycleState?: string; lines: { accountCode: string; description: string | null; amountSen: number }[] };
type Coa = { code: string; name: string };
type Hub = {
  kind: Kind; id: string; no: string; date: string; from: string; via: string; totalSen: number; state: string; note: string;
  pill: { label: string; fg: string; bg: string }; onAccountSen: number;
  cust?: PaymentRecord; od?: OdPay; or?: OrRow;
};

const KIND_L: Record<Kind, string> = { customer: "Customer", other: "Other debtor", official: "Official" };
const KIND_HERO: Record<Kind, string> = { customer: "Customer receipt", other: "Other-debtor receipt", official: "Official receipt" };

/** The prototype's pill colours for the desktop rule's label. */
function pillOf(label: string): { label: string; fg: string; bg: string } {
  if (label === "Posted · unallocated") return { label, fg: "#9C6F1E", bg: "#FAEFCB" };
  if (label.startsWith("Posted")) return { label, fg: "#4F7C3A", bg: "#EEF3E4" };
  if (label === "Bounced") return { label, fg: "#9A3A2D", bg: "#F9E1DA" };
  return { label: words(label), fg: "#6B7280", bg: "#F5F2ED" };
}

function useReceipts() {
  const { hasPermission } = usePermissions();
  const canCust = hasPermission("payments", "read");
  const cust = useCachedJson<unknown>(canCust ? "/api/payments" : null);
  const od = useCachedJson<{ success?: boolean; data?: OdPay[] }>("/api/accounting/other-party-payments?type=DEBTOR");
  const ors = useCachedJson<{ success?: boolean; data?: OrRow[] }>("/api/accounting/official-receipts");
  const coa = useCachedJson<{ success?: boolean; data?: Coa[] }>("/api/accounting/coa");
  const bankName = (code: string) => {
    const nm = coa.data?.data?.find((a) => a.code === code)?.name;
    return nm ? `${code} · ${nm}` : code;
  };
  const rows = useMemo<Hub[]>(() => {
    const out: Hub[] = [];
    for (const p of listOf<PaymentRecord>(cust.data)) {
      const state = p.lifecycleState ?? "ACTIVE";
      const un = hasUnallocated(p);
      out.push({
        kind: "customer", id: p.id, no: p.receiptNumber, date: String(p.date ?? "").slice(0, 10), from: p.customerName ?? "",
        via: words(String(p.method ?? "")), totalSen: Number(p.amount) || 0, state,
        note: p.reference ?? "", pill: pillOf(receiptStatus({ state, custStatus: p.status, unallocated: un }).label),
        onAccountSen: un ? unallocatedSen(p) : 0, cust: p,
      });
    }
    for (const g of od.data?.success ? od.data.data ?? [] : []) {
      const state = g.lifecycleState ?? "ACTIVE";
      out.push({
        kind: "other", id: g.paymentNo, no: g.paymentNo, date: String(g.date ?? "").slice(0, 10), from: g.partyName,
        via: bankName(g.bankAccount ?? ""), totalSen: g.totalSen, state, note: g.reference ?? "",
        pill: pillOf(receiptStatus({ state }).label), onAccountSen: 0, od: g,
      });
    }
    for (const r of ors.data?.success ? ors.data.data ?? [] : []) {
      const state = r.status === "VOID" ? "VOID" : r.lifecycleState ?? "ACTIVE";
      out.push({
        kind: "official", id: r.id, no: r.orNo, date: String(r.date ?? "").slice(0, 10), from: r.receivedFrom ?? "",
        via: bankName(r.payTo ?? ""), totalSen: r.totalSen, state, note: r.description ?? "",
        pill: pillOf(receiptStatus({ state }).label), onAccountSen: 0, or: r,
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bankName reads coa
  }, [cust.data, od.data, ors.data, coa.data]);
  const loading = (canCust && !cust.data && cust.loading) || (!od.data && od.loading) || (!ors.data && ors.loading);
  const failed = (canCust && failedOf(cust.data, cust.error)) || failedOf(od.data, od.error) || failedOf(ors.data, ors.error);
  const retry = () => { if (canCust) cust.refresh(); od.refresh(); ors.refresh(); };
  return { rows, loading, failed, retry, canCust, bankName };
}

export function ReceiptsView({ nav, onBack }: { nav: ReactNode; onBack: () => void }) {
  const navigate = useNavigate();
  const { rows, loading, failed, retry } = useReceipts();
  const [cat, setCat] = useState<"all" | Kind | "cancelled">("all");
  const [q, setQ] = useState("");
  const match = (r: Hub, c: typeof cat) => (c === "all" ? true : c === "cancelled" ? r.state !== "ACTIVE" : r.kind === c);
  const kw = q.trim().toLowerCase();
  const list = rows.filter((r) => match(r, cat) && (!kw || `${r.no} ${r.from} ${r.note} ${r.via}`.toLowerCase().includes(kw)));
  const live = list.filter((r) => r.state === "ACTIVE");
  const liveSum = live.reduce((t, r) => t + r.totalSen, 0);
  const cats: { k: typeof cat; l: string }[] = [{ k: "all", l: "All" }, { k: "customer", l: "Customer" }, { k: "other", l: "Other debtor" }, { k: "official", l: "Official" }, { k: "cancelled", l: "Cancelled" }];

  return (
    <FinScreen title="Receipts" onBack={onBack}>
      {nav}
      <LoadOr loading={loading} failed={failed} retry={retry} what="the receipts">
        <FinSearch v={q} on={setQ} ph="Receipt no., from, note, bank" />
        <FinChips opts={cats.map((c) => ({ k: c.k, l: c.l, n: rows.filter((r) => match(r, c.k)).length }))} cur={cat} set={setCat} />
        {list.length === 0 ? (
          <FinState icon={Banknote} bg={F.cream} c={F.gold} t="No receipts" s={rows.length ? "Nothing matches your search or filter." : "Money received appears here."} />
        ) : (
          list.map((r) => (
            <FinDoc
              key={`${r.kind}-${r.id}`}
              test="rcv-receipt"
              code={r.no || "—"}
              st={r.pill.label}
              stFg={r.pill.fg}
              stBg={r.pill.bg}
              rail={r.pill.fg}
              date={r.date}
              party={r.from || "—"}
              op={r.state === "ACTIVE" ? 1 : 0.6}
              aria={`${r.no}, ${r.from}`}
              refs={[{ k: KIND_L[r.kind], v: "receipt" }, ...(r.via ? [{ k: "Via", v: r.via }] : [])]}
              amts={[docAmt("Amount", rm(r.totalSen), { gold: true }), ...(r.onAccountSen ? [docAmt("On account", rm(r.onAccountSen), { c: "#85600F" })] : [])]}
              onTap={() => navigate(`/m/receivables/rcpt/${encodeURIComponent(`${r.kind}:${r.id}`)}`)}
            />
          ))
        )}
        <FinCard title="Totals" icon={Sigma} sub="Active receipts only" val={{ v: rm(liveSum), s: `${live.length} receipt${live.length === 1 ? "" : "s"}` }} />
      </LoadOr>
    </FinScreen>
  );
}

/** One receipt, laid out for its kind (the prototype's three details). */
export function ReceiptDetail({ ref_, onBack }: { ref_: string; onBack: () => void }) {
  const { rows, loading, failed, retry, bankName } = useReceipts();
  const i = ref_.indexOf(":");
  const kind = ref_.slice(0, i) as Kind;
  const id = ref_.slice(i + 1);
  const r = rows.find((x) => x.kind === kind && x.id === id);
  let body: ReactNode = null;
  if (r) {
    const hero = <FinHero k={KIND_HERO[r.kind]} tag={r.pill.label} v={rm(r.totalSen)} s={`${r.no} · ${r.date}`} />;
    if (r.kind === "customer" && r.cust) {
      const allocs: Row[] = (r.cust.allocations ?? []).map((a, n) => ({ key: `${a.invoiceId}-${n}`, l: a.invoiceNumber || "—", v: rm(Number(a.amount) || 0) }));
      body = (
        <>
          {hero}
          <FinCard title="Details" icon={Receipt} rows={kvRows([["Customer", r.from], ["Date", r.date], ["Payment method", r.via], ["Reference", r.cust.reference ?? ""]])} />
          <FinCard
            title="Applied to invoices"
            icon={Link2}
            head={{ a: "Invoice", b: "Allocated" }}
            rows={[...allocs, { key: "left", l: "Left on account", w: 800, v: rm(unallocatedSen(r.cust)), bg: F.cream }]}
          />
        </>
      );
    } else if (r.kind === "other" && r.od) {
      body = (
        <>
          {hero}
          <FinCard title="Details" icon={Receipt} rows={kvRows([["Debtor", r.from], ["Bank", r.via], ["Date", r.date], ["Reference", r.od.reference ?? ""]])} />
          <FinCard title="Bills paid" icon={FileText} rows={r.od.lines.map((l, n): Row => ({ key: `${l.billNo}-${n}`, l: l.billNo || "—", v: rm(l.amountSen) }))} empty={r.od.lines.length ? undefined : "No bills on this receipt."} />
        </>
      );
    } else if (r.or) {
      body = (
        <>
          {hero}
          <FinCard title="Details" icon={Receipt} rows={kvRows([["Received from", r.from], ["Bank", r.via], ["Description", r.note]])} />
          <FinCard
            title="Account lines"
            icon={ListOrdered}
            rows={r.or.lines.map((l, n): Row => ({ key: `${l.accountCode}-${n}`, l: bankName(l.accountCode), s: l.description || undefined, v: rm(l.amountSen) }))}
            empty={r.or.lines.length ? undefined : "No lines on this receipt."}
          />
        </>
      );
    }
  }
  return (
    <FinScreen title="Receipt" onBack={onBack}>
      <LoadOr loading={loading && !r} failed={failed && !r} retry={retry} what="the receipt">
        {r ? body : <NotFound what="This receipt" />}
      </LoadOr>
    </FinScreen>
  );
}
