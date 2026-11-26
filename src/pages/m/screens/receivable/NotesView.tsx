// ---------------------------------------------------------------------------
// Receivable › Credit & Debit Notes (Batch 3 prototype "rnoteB" / "rdetB
// note"): the desktop Credit Notes and Debit Notes pages' lists, read-only —
//   GET /api/credit-notes   (credit-notes:read)
//   GET /api/debit-notes    (debit-notes:read)
// Summary tiles use the desktop pages' own counts (total of totalAmount,
// Draft, Posted). A switch side the role cannot read is not offered. Notes
// are created, posted and returned to draft on the desktop (Batch 3 scope).
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FileMinus2, FilePlus2, FileText, ListOrdered } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { CreditNote, DebitNote } from "@/types";
import { FinCard, FinDoc, FinHero, FinScreen, FinSeg, FinState, type Row } from "../finance/fin-kit";
import { F, docAmt, rm, tile } from "../finance/fin-format";
import { LoadOr, NotFound } from "./rcv-lib";
import { failedOf, kvRows, listOf, words } from "./rcv-data";

type Note = CreditNote | DebitNote;
type Side = "cn" | "dn";

const ST: Record<string, { l: string; fg: string; bg: string }> = {
  DRAFT: { l: "Draft", fg: "#6B7280", bg: "#F5F2ED" },
  APPROVED: { l: "Approved", fg: "#3E6570", bg: "#E0EDF0" },
  POSTED: { l: "Posted", fg: "#4F7C3A", bg: "#EEF3E4" },
};
const stOf = (s: string) => ST[s] ?? { l: words(s), fg: "#6B7280", bg: "#F5F2ED" };
/** An item's money, the server's promoted names first (BUG-2026-08-13-034). */
const unitSen = (it: Note["items"][number]) => Number(it.unitPriceSen ?? it.unitPrice) || 0;
const lineSen = (it: Note["items"][number]) => Number(it.totalSen ?? it.total ?? unitSen(it) * (Number(it.quantity) || 0)) || 0;

function useNotes(side: Side) {
  const { hasPermission } = usePermissions();
  const canCn = hasPermission("credit-notes", "read");
  const canDn = hasPermission("debit-notes", "read");
  const cn = useCachedJson<unknown>(canCn && side === "cn" ? "/api/credit-notes" : null);
  const dn = useCachedJson<unknown>(canDn && side === "dn" ? "/api/debit-notes" : null);
  const r = side === "cn" ? cn : dn;
  return { canCn, canDn, notes: listOf<Note>(r.data), loading: !r.data && r.loading, failed: failedOf(r.data, r.error), retry: r.refresh };
}

export function NotesView({ nav, onBack }: { nav: ReactNode; onBack: () => void }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canCn = hasPermission("credit-notes", "read");
  const [pick, setPick] = useState<Side>(canCn ? "cn" : "dn");
  const side: Side = pick === "cn" && !canCn ? "dn" : pick;
  const { canDn, notes, loading, failed, retry } = useNotes(side);
  const dn = side === "dn";
  const opts = [...(canCn ? [{ k: "cn" as const, l: "Credit notes" }] : []), ...(canDn ? [{ k: "dn" as const, l: "Debit notes" }] : [])];
  const total = notes.reduce((t, n) => t + (Number(n.totalAmount) || 0), 0);

  return (
    <FinScreen title="Credit & Debit Notes" onBack={onBack}>
      {nav}
      {opts.length > 1 ? <FinSeg opts={opts} cur={side} set={setPick} aria="Note type" /> : null}
      <LoadOr loading={loading} failed={failed} retry={retry} what={dn ? "the debit notes" : "the credit notes"}>
        <FinCard
          title={dn ? "Debit notes" : "Credit notes"}
          icon={dn ? FilePlus2 : FileMinus2}
          tiles={[
            tile("Total value", rm(total), { span: 2, s: `${notes.length} note${notes.length === 1 ? "" : "s"}` }),
            tile("Draft", String(notes.filter((n) => n.status === "DRAFT").length)),
            tile("Posted", String(notes.filter((n) => n.status === "POSTED").length)),
          ]}
          note={dn ? "Debit notes count in aging only when Posted." : "Approved credit notes count as issued."}
        />
        {notes.length === 0 ? (
          <FinState icon={dn ? FilePlus2 : FileMinus2} bg={F.cream} c={F.gold} t={dn ? "No debit notes" : "No credit notes"} s="Notes are raised against invoices on the desktop." />
        ) : (
          [...notes].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))).map((n) => {
            const T = stOf(n.status);
            return (
              <FinDoc
                key={n.id}
                test="rcv-note"
                code={n.noteNumber || "—"}
                st={T.l}
                stFg={T.fg}
                stBg={T.bg}
                rail={T.fg}
                date={String(n.date ?? "").slice(0, 10) || undefined}
                party={n.customerName || "—"}
                aria={n.noteNumber}
                refs={[...(n.invoiceNumber ? [{ k: "Invoice", v: n.invoiceNumber }] : []), { k: "Reason", v: words(String(n.reason ?? "")) }]}
                amts={[docAmt("Amount", rm(Number(n.totalAmount) || 0), { gold: true })]}
                onTap={() => navigate(`/m/receivables/rnote/${encodeURIComponent(`${side}:${n.id}`)}`)}
              />
            );
          })
        )}
      </LoadOr>
    </FinScreen>
  );
}

/** One credit or debit note (read-only). */
export function NoteDetail({ ref_, onBack }: { ref_: string; onBack: () => void }) {
  const i = ref_.indexOf(":");
  const side: Side = ref_.slice(0, i) === "dn" ? "dn" : "cn";
  const id = ref_.slice(i + 1);
  const { canCn, canDn, notes, loading, failed, retry } = useNotes(side);
  const allowed = side === "cn" ? canCn : canDn;
  const n = notes.find((x) => x.id === id);
  const items: Row[] = n
    ? [
        ...n.items.map((it, k): Row => ({ key: `i${k}`, l: it.description || "—", s: `${Number(it.quantity) || 0} × ${rm(unitSen(it))}`, v: rm(lineSen(it)) })),
        { key: "tot", l: "Total", w: 800, v: rm(Number(n.totalAmount) || 0), bg: F.cream },
      ]
    : [];
  return (
    <FinScreen title="Note" onBack={onBack}>
      {!allowed ? (
        <NotFound what="This note" />
      ) : (
        <LoadOr loading={loading && !n} failed={failed && !n} retry={retry} what="the note">
          {!n ? (
            <NotFound what="This note" />
          ) : (
            <>
              <FinHero k={`${side === "dn" ? "Debit" : "Credit"} note`} tag={stOf(n.status).l} v={rm(Number(n.totalAmount) || 0)} s={`${n.noteNumber} · ${String(n.date ?? "").slice(0, 10)}`} />
              <FinCard
                title="Details"
                icon={FileText}
                rows={kvRows([
                  ["Customer", n.customerName],
                  ["Invoice", n.invoiceNumber],
                  ["Reason", words(String(n.reason ?? ""))],
                  ...(n.reasonDetail ? [["Detail", n.reasonDetail] as [string, string]] : []),
                  ["Status", stOf(n.status).l],
                ])}
              />
              <FinCard title="Items" icon={ListOrdered} head={{ a: "Item · qty × price", b: "Amount" }} rows={items} />
            </>
          )}
        </LoadOr>
      )}
    </FinScreen>
  );
}
