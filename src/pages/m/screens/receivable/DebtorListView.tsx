// ---------------------------------------------------------------------------
// Receivable › Debtor List (Batch 3 prototype "rlistB" / "rdetB deb"): every
// trade customer and other debtor with what is outstanding — the desktop
// Debtor List's rows (PartyListTab side DEBTOR, src/lib/party-list.ts), read
// from the same four endpoints:
//   /api/customers · /api/accounting/other-parties?type=DEBTOR
//   /api/accounting/aging (trade outstanding = the aging row's five buckets)
//   /api/accounting/other-party-aging?type=DEBTOR (other = its open bills)
// A trade customer opens the existing Customer detail; an other debtor opens
// its record here. Read-only: parties are added and changed on the desktop.
// ---------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BookUser, CircleUser, Users } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { agingTotalSen, customerRows, otherPartyRows, overLimit, type PartyListRow } from "@/lib/party-list";
import { termsLabel } from "../customers/customer-lib";
import { FinCard, FinChips, FinDoc, FinHero, FinScreen, FinSearch, FinState } from "../finance/fin-kit";
import { F, docAmt, rm, tile } from "../finance/fin-format";
import { LoadOr, NotFound } from "./rcv-lib";
import { failedOf, kvRows, listOf, str, type Raw } from "./rcv-data";

type AgingRow = { customerId?: string; currentSen: number; days30Sen: number; days60Sen: number; days90Sen: number; over90Sen: number };
type AgingResp = { success?: boolean; data?: { ar?: AgingRow[] } };
type OtherAgingResp = { success?: boolean; data?: { bills?: { partyId: string; outstandingSen: number }[] } };

const ORANGE = "#B8601A";

/** The Debtor List's rows, exactly as the desktop builds them. */
function useDebtorRows() {
  const cust = useCachedJson<unknown>("/api/customers");
  const others = useCachedJson<unknown>("/api/accounting/other-parties?type=DEBTOR");
  const aging = useCachedJson<AgingResp>("/api/accounting/aging");
  const otherAging = useCachedJson<OtherAgingResp>("/api/accounting/other-party-aging?type=DEBTOR");
  const rows = useMemo<PartyListRow[]>(() => {
    const owed = new Map<string, number>();
    for (const r of aging.data?.data?.ar ?? []) owed.set(String(r.customerId ?? ""), agingTotalSen(r));
    const byName = (a: PartyListRow, b: PartyListRow) => a.name.localeCompare(b.name);
    return [
      ...customerRows(listOf<Raw>(cust.data), owed).sort(byName),
      ...otherPartyRows(listOf<Raw>(others.data), otherAging.data?.data?.bills ?? []).sort(byName),
    ];
  }, [cust.data, others.data, aging.data, otherAging.data]);
  const loading = (!cust.data && cust.loading) || (!others.data && others.loading) || (!aging.data && aging.loading);
  const failed = failedOf(cust.data, cust.error) || failedOf(others.data, others.error) || failedOf(aging.data, aging.error);
  const retry = () => { cust.refresh(); others.refresh(); aging.refresh(); otherAging.refresh(); };
  return { rows, loading, failed, retry, others: listOf<Raw>(others.data), othersLoading: !others.data && others.loading };
}

export function DebtorListView({ nav, onBack }: { nav: ReactNode; onBack: () => void }) {
  const navigate = useNavigate();
  const { rows, loading, failed, retry } = useDebtorRows();
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | "trade" | "other">("all");
  const kw = q.trim().toLowerCase();
  const list = rows.filter((d) => (f === "all" || d.kind === f) && (!kw || `${d.code} ${d.name} ${d.contact}`.toLowerCase().includes(kw)));
  const trade = rows.filter((d) => d.kind === "trade");
  const other = rows.filter((d) => d.kind === "other");
  const total = rows.reduce((t, d) => t + d.outstandingSen, 0);

  return (
    <FinScreen title="Debtor List" onBack={onBack}>
      {nav}
      <LoadOr loading={loading} failed={failed} retry={retry} what="the debtor list">
        <FinCard
          title="Debtor directory"
          icon={BookUser}
          test="rcv-directory"
          tiles={[
            tile("Active customers", String(trade.filter((d) => d.active).length)),
            tile("Over credit limit", String(trade.filter(overLimit).length), { c: ORANGE, rail: ORANGE, tint: "rgba(251,228,206,.9)" }),
            tile("Active other debtors", String(other.filter((d) => d.active).length)),
            tile("Other with balance", String(other.filter((d) => d.outstandingSen !== 0).length)),
            tile("Total outstanding", rm(total), { span: 2, s: "as on Debtor Aging" }),
          ]}
        />
        <FinSearch v={q} on={setQ} ph="Search code, name or person" />
        <FinChips
          opts={[{ k: "all", l: "All", n: rows.length }, { k: "trade", l: "Trade", n: trade.length }, { k: "other", l: "Other debtors", n: other.length }]}
          cur={f}
          set={setF}
        />
        {list.length === 0 ? (
          <FinState icon={Users} bg={F.cream} c={F.gold} t={rows.length ? "No debtors match" : "No debtors yet"} s={rows.length ? "Try another name or filter." : "Customers and other debtors appear here."} />
        ) : (
          list.map((d) => {
            const over = overLimit(d);
            const isTrade = d.kind === "trade";
            return (
              <FinDoc
                key={d.key}
                test="rcv-debtor"
                code={d.code || (isTrade ? "—" : "Other debtor")}
                st={d.active ? "Active" : "Inactive"}
                stBg={d.active ? "#EEF3E4" : "#F5F2ED"}
                stFg={d.active ? "#4F7C3A" : "#6B7280"}
                rail={over ? ORANGE : d.active ? "#A08C5B" : "#CDBE98"}
                party={d.name}
                op={d.active ? 1 : 0.6}
                aria={d.name}
                refs={[
                  ...(d.contact ? [{ k: "PIC", v: d.contact }] : []),
                  ...(d.termsOrNote ? [{ k: isTrade ? "Terms" : "Purpose", v: isTrade ? termsLabel(d.termsOrNote) : d.termsOrNote }] : []),
                  ...(d.phone ? [{ k: "Tel", v: d.phone }] : []),
                ]}
                amts={[
                  docAmt("Outstanding", rm(d.outstandingSen), { gold: true, c: over ? ORANGE : d.outstandingSen < 0 ? F.neg : F.ink }),
                  isTrade
                    ? docAmt("Credit limit", d.limitSen ? rm(d.limitSen) : "—")
                    : docAmt("Email", d.email || "—", { fs: 11.5 }),
                ]}
                note={over ? "Over credit limit" : d.outstandingSen < 0 ? "Credit balance" : undefined}
                onTap={() => (isTrade ? navigate(`/m/customers/${encodeURIComponent(d.id)}`) : navigate(`/m/receivables/rlist/${encodeURIComponent(d.id)}`))}
              />
            );
          })
        )}
      </LoadOr>
    </FinScreen>
  );
}

/** An other debtor's record (the desktop popup's fields, read-only). */
export function OtherDebtorDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { rows, loading, failed, retry, others } = useDebtorRows();
  const p = others.find((x) => str(x, "id") === id);
  const row = rows.find((r) => r.kind === "other" && r.id === id);
  return (
    <FinScreen title="Other debtor" onBack={onBack}>
      <LoadOr loading={loading && !p} failed={failed && !p} retry={retry} what="the debtor">
        {!p ? (
          <NotFound what="This debtor" />
        ) : (
          <>
            <FinHero k={`Other debtor${str(p, "code") ? ` · ${str(p, "code")}` : ""}`} tag={row && !row.active ? "Inactive" : undefined} v={rm(row?.outstandingSen ?? 0)} s={str(p, "name")} />
            <FinCard
              title="Details"
              icon={CircleUser}
              rows={kvRows([
                ["Name", str(p, "name")],
                ["Contact", str(p, "contactPerson", "contact_person")],
                ["Phone", str(p, "phone")],
                ["Email", str(p, "email")],
                ["SSM no.", str(p, "registrationNo", "registration_no")],
                ["Address", str(p, "address")],
                ["TIN", str(p, "tin")],
                ["SST no.", str(p, "sstRegNo", "sst_reg_no")],
                ["Currency", str(p, "currency") || "MYR"],
                ["Bank account", str(p, "bankAccount", "bank_account")],
                ["Notes", str(p, "notes")],
              ])}
            />
          </>
        )}
      </LoadOr>
    </FinScreen>
  );
}
