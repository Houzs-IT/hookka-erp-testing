// ---------------------------------------------------------------------------
// Receivable › AR Invoices (Batch 3 prototype "rinvB" / "rdetB od"): sales
// invoices and other-debtor bills in one list — the desktop AR Invoices tab
// (ArInvoicesTab in src/pages/accounting/index.tsx), from the same read:
//   GET /api/accounting/ar-invoices → { rows, totals }
// The server decides each row's status (Open / Paid / Cancelled / Before
// opening) and counts outstanding only while Open; this view only filters.
// A sales invoice opens the existing Invoice detail (/m/invoices/:id); an
// other-debtor bill opens here from /api/accounting/other-party-bills (its
// lines, tax and files — view only). Nothing is received, edited or voided
// from the phone (Batch 3 scope).
// ---------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ListOrdered, Paperclip, Receipt, Sigma } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { FinCard, FinChips, FinDoc, FinHero, FinLabel, FinScreen, FinSearch, FinSeg, FinState, type Row } from "../finance/fin-kit";
import { F, docAmt, rm, tile } from "../finance/fin-format";
import { LoadOr, NotFound } from "./rcv-lib";
import { failedOf, kvRows, listOf, num, str, type Raw } from "./rcv-data";

type ArStatus = "OPEN" | "PAID" | "CANCELLED" | "BEFORE_OPENING";
export type ArInvRow = {
  kind: "INV" | "OD"; id: string; no: string; customer: string; partyId: string; ref: string; date: string; dueDate: string | null;
  description: string; totalSen: number; receivedSen: number; outstandingSen: number; status: ArStatus; opening: boolean;
};
type ArResp = { success?: boolean; error?: string; data?: { rows: ArInvRow[]; totals: { openSen: number; openCount: number; invOpenSen: number; odOpenSen: number } } };

/** Label and colours of a row's status (the prototype's pills). */
const AR_STATUS: Record<ArStatus, { l: string; fg: string; bg: string }> = {
  OPEN: { l: "Open", fg: "#3E6570", bg: "#E0EDF0" },
  PAID: { l: "Paid", fg: "#4F7C3A", bg: "#EEF3E4" },
  CANCELLED: { l: "Cancelled", fg: "#9A3A2D", bg: "#F9E1DA" },
  BEFORE_OPENING: { l: "Before opening", fg: "#6B7280", bg: "#F5F2ED" },
};
const STATUSES: ArStatus[] = ["OPEN", "PAID", "CANCELLED", "BEFORE_OPENING"];

export function ArInvoicesView({ nav, onBack }: { nav: ReactNode; onBack: () => void }) {
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useCachedJson<ArResp>("/api/accounting/ar-invoices");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "INV" | "OD">("all");
  const [st, setSt] = useState<"all" | ArStatus>("all");
  const all = useMemo(() => (data?.success ? data.data?.rows ?? [] : []), [data]);
  const totals = data?.data?.totals;
  const kw = q.trim().toLowerCase();
  const list = all
    .filter((v) => (kind === "all" || v.kind === kind) && (st === "all" || v.status === st) && (!kw || `${v.no} ${v.customer} ${v.ref} ${v.description}`.toLowerCase().includes(kw)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const live = list.filter((v) => v.status !== "CANCELLED");
  const sum = (k: "totalSen" | "receivedSen" | "outstandingSen") => live.reduce((t, v) => t + (Number(v[k]) || 0), 0);

  return (
    <FinScreen title="AR Invoices" onBack={onBack}>
      {nav}
      <LoadOr loading={loading && !data} failed={failedOf(data, error)} retry={refresh} what="the AR invoices">
        <FinHero
          k="Open — all"
          v={rm(totals?.openSen ?? 0)}
          s={`${totals?.openCount ?? 0} open document${totals?.openCount === 1 ? "" : "s"}`}
          tiles={[{ k: "Sales invoices", v: rm(totals?.invOpenSen ?? 0) }, { k: "Other-debtor bills", v: rm(totals?.odOpenSen ?? 0) }]}
        />
        <FinSearch v={q} on={setQ} ph="Number, customer, reference" />
        <FinSeg opts={[{ k: "all", l: "All kinds" }, { k: "INV", l: "Sales invoices" }, { k: "OD", l: "Other-debtor bills" }]} cur={kind} set={setKind} aria="Document kind" h={42} />
        <FinChips
          opts={[{ k: "all" as const, l: "All", n: all.length }, ...STATUSES.map((s) => ({ k: s, l: AR_STATUS[s].l, n: all.filter((v) => v.status === s).length }))]}
          cur={st}
          set={setSt}
        />
        <FinLabel l={`${list.length} DOCUMENT${list.length === 1 ? "" : "S"}`} r="Newest first" />
        {list.length === 0 ? (
          <FinState icon={Receipt} bg={F.cream} c={F.gold} t="No documents" s={all.length ? "Nothing matches your search or filters." : "No sales invoices or other-debtor bills yet."} />
        ) : (
          list.map((v) => {
            const T = AR_STATUS[v.status];
            const mute = v.status === "CANCELLED" || v.status === "BEFORE_OPENING";
            return (
              <FinDoc
                key={`${v.kind}-${v.id}`}
                test="rcv-arinv"
                code={v.no || "—"}
                st={T.l}
                stFg={T.fg}
                stBg={T.bg}
                rail={T.fg}
                date={String(v.date ?? "").slice(0, 10)}
                party={v.customer || "—"}
                op={mute ? 0.6 : 1}
                aria={`${v.no}, ${v.customer}`}
                refs={[
                  { k: v.kind, v: v.opening ? "Opening" : v.kind === "INV" ? "Invoice" : "Bill" },
                  ...(v.ref ? [{ k: v.kind === "INV" ? "DO" : "Ref", v: v.ref }] : []),
                  ...(v.dueDate ? [{ k: "Due", v: String(v.dueDate).slice(0, 10) }] : []),
                ]}
                amts={[
                  docAmt("Total", rm(v.totalSen), { fs: 12 }),
                  docAmt("Received", rm(v.receivedSen), { fs: 12 }),
                  docAmt("Outstanding", rm(v.outstandingSen), { gold: true, fs: 12, c: v.outstandingSen ? F.ink : F.muted }),
                ]}
                onTap={() => (v.kind === "INV"
                  ? navigate(`/m/invoices/${encodeURIComponent(v.id)}`)
                  : navigate(`/m/receivables/rinv/${encodeURIComponent(v.no)}`))}
              />
            );
          })
        )}
        <FinCard
          title="Totals"
          icon={Sigma}
          sub="Excludes cancelled"
          cols={3}
          tiles={[tile("Total", rm(sum("totalSen"))), tile("Received", rm(sum("receivedSen"))), tile("Outstanding", rm(sum("outstandingSen")))]}
        />
      </LoadOr>
    </FinScreen>
  );
}

type Coa = { code: string; name: string };
type Att = { id: string; filename: string; contentType?: string; sizeBytes?: number };

/** An other-debtor bill (the desktop bill detail, read-only). */
export function OdBillDetail({ billNo, onBack }: { billNo: string; onBack: () => void }) {
  const { data, loading, error, refresh } = useCachedJson<unknown>("/api/accounting/other-party-bills?type=DEBTOR");
  const { data: coaResp } = useCachedJson<{ success?: boolean; data?: Coa[] }>("/api/accounting/coa");
  const { data: attResp } = useCachedJson<{ success?: boolean; data?: { rows: Att[] } }>(`/api/accounting/other-party-bills/${encodeURIComponent(billNo)}/attachments`);
  const b = listOf<Raw>(data).find((x) => str(x, "billNo", "bill_no") === billNo);
  const accName = (code: string) => coaResp?.data?.find((a) => a.code === code)?.name;
  const items = (b?.items as Raw[] | undefined) ?? [];
  const taxSen = num(b, "taxSen", "tax_sen");
  const totalSen = num(b, "totalSen", "total_sen");
  const voided = !!b && ((str(b, "lifecycleState") || "ACTIVE") !== "ACTIVE" || str(b, "status") === "VOID");
  const atts = attResp?.success ? attResp.data?.rows ?? [] : [];
  const lineRows: Row[] = [
    ...items.map((it, i): Row => {
      const code = str(it, "counterAccount", "counter_account");
      const nm = accName(code);
      return { key: `l${i}`, l: nm ? `${code} · ${nm}` : code || "—", s: str(it, "description") || undefined, c: "", v: rm(num(it, "amountSen", "amount_sen")) };
    }),
    ...(taxSen ? [{ key: "tax", l: "Tax / SST", c: "", v: rm(taxSen) } as Row] : []),
    { key: "tot", l: "Total", w: 800, v: rm(totalSen), vw: 800, bg: F.cream },
  ];
  return (
    <FinScreen title="Other-debtor bill" onBack={onBack}>
      <LoadOr loading={loading && !data} failed={failedOf(data, error) && !b} retry={refresh} what="the bill">
        {!b ? (
          <NotFound what="This bill" />
        ) : (
          <>
            <FinHero
              k={`Other-debtor bill${b.isOpening || b.is_opening ? " · Opening" : ""}`}
              tag={voided ? "Void" : num(b, "outstandingSen", "outstanding_sen") > 0 ? "Open" : "Paid"}
              v={rm(num(b, "outstandingSen", "outstanding_sen"))}
              s={`${billNo} · ${str(b, "partyName", "party_name") || "—"}`}
              tiles={[{ k: "Total", v: rm(totalSen) }, { k: "Received", v: rm(num(b, "paidAmountSen", "paid_amount_sen")) }]}
            />
            <FinCard
              title="Details"
              icon={FileText}
              rows={kvRows([
                ["Debtor", str(b, "partyName", "party_name")],
                ["Bill date", str(b, "billDate", "bill_date").slice(0, 10)],
                ["Reference", str(b, "referenceNo", "reference_no")],
                ["Description", str(b, "description")],
              ])}
            />
            <FinCard title="Account lines" icon={ListOrdered} head={{ a: "Line", b: "Amount" }} rows={lineRows} />
            <FinCard
              title="Attachments"
              icon={Paperclip}
              sub={atts.length ? `${atts.length} file${atts.length === 1 ? "" : "s"} · view only` : undefined}
              rows={atts.length ? atts.map((a, i): Row => ({
                key: a.id || String(i),
                l: a.filename,
                s: "View only",
                go: true,
                onTap: () => { window.open(`/api/files/${encodeURIComponent(a.id)}/download?inline=1`, "_blank", "noopener"); },
              })) : undefined}
              empty={atts.length ? undefined : "No files attached."}
            />
          </>
        )}
      </LoadOr>
    </FinScreen>
  );
}
