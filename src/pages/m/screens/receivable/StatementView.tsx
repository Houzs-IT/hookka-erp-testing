// ---------------------------------------------------------------------------
// Receivable › Customer Statement (Batch 3 prototype "rstmtB", with the
// approved correction 8): the desktop statement (CustomerStatementCard in
// src/pages/accounting/index.tsx) from the same read —
//   GET /api/accounting/customer-statement?customerId=&from=&to=
//   → { customer, openingSen, closingSen, rows[{ date, ref, type, debitSen, creditSen, runningSen }] }
// The server builds every line and the running balance (void / deleted
// receipts left out; a bounced receipt adds its reversal; CN APPROVED/POSTED,
// DN POSTED); the phone only lays them out. The customer is chosen from a
// search box over a select (a chip row cannot hold every customer), and the
// From / To tiles are date inputs. Read-only: no print on the phone.
// ---------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { ListOrdered, ScrollText, UserSearch } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { FinCard, FinHero, FinScreen, FinSearch, FinSelect, FinSkel, FinState, type Row } from "../finance/fin-kit";
import { F, rm } from "../finance/fin-format";
import { failedOf, listOf, str, type Raw } from "./rcv-data";

type Stmt = {
  customer: { id: string; name: string; code: string };
  openingSen: number;
  closingSen: number;
  rows: { date: string; ref: string; type: string; debitSen: number; creditSen: number; runningSen: number }[];
};

/** The prototype's tag per line type (label, colour, tint). */
const TYPE_TAG: Record<string, [string, string, string]> = {
  INVOICE: ["Invoice", "#2B5797", "#E3EAF5"],
  RECEIPT: ["Receipt", "#4F7C3A", "#EEF3E4"],
  BOUNCED: ["Bounced reversal", "#9A3A2D", "#FBE7E3"],
  CREDIT_NOTE: ["Credit note", "#6B4A6D", "#F1E9F0"],
  DEBIT_NOTE: ["Debit note", "#85600F", "#FAEFCB"],
};

/** A From / To tile that is a date input (the prototype's tile look). */
function DateTile({ k, v, on }: { k: string; v: string; on: (v: string) => void }) {
  return (
    <label style={{ display: "block", minWidth: 0, padding: "9px 10px 9px 12px", borderRadius: 13, background: "linear-gradient(150deg,#FFFFFF 45%,rgba(244,239,230,.9))", boxShadow: "inset 3px 0 0 #A08C5B,inset 0 0 0 1px rgba(31,29,27,.06)", cursor: "pointer" }}>
      <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".3px", color: F.gold, textTransform: "uppercase", lineHeight: 1.2 }}>{k}</span>
      <input type="date" value={v} onChange={(e) => on(e.target.value)} aria-label={k}
        style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, border: "none", background: "transparent", padding: 0, fontFamily: "inherit", fontSize: 13.5, fontWeight: 800, color: v ? F.ink : F.faint, outline: "none", fontVariantNumeric: "tabular-nums" }} />
    </label>
  );
}

export function StatementView({ nav, onBack }: { nav: ReactNode; onBack: () => void }) {
  const cust = useCachedJson<unknown>("/api/customers");
  const customers = useMemo(
    () => listOf<Raw>(cust.data).map((c) => ({ id: str(c, "id"), name: str(c, "name"), code: str(c, "code") })).filter((c) => c.id).sort((a, b) => a.name.localeCompare(b.name)),
    [cust.data],
  );
  const [q, setQ] = useState("");
  const [cid, setCid] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const kw = q.trim().toLowerCase();
  const shown = customers.filter((c) => !kw || `${c.name} ${c.code}`.toLowerCase().includes(kw) || c.id === cid);
  const p = new URLSearchParams({ customerId: cid });
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const { data, loading, error, refresh } = useCachedJson<{ success?: boolean; error?: string; data?: Stmt }>(cid ? `/api/accounting/customer-statement?${p.toString()}` : null);
  const stmt = data?.success ? data.data ?? null : null;
  const failed = failedOf(data, error);

  const rows: Row[] = stmt
    ? [
        { key: "open", l: "Opening balance", w: 800, v: rm(stmt.openingSen), bg: F.paper },
        ...stmt.rows.map((r, i): Row => {
          const [tl, fg, bg] = TYPE_TAG[r.type] ?? [r.type.replace(/_/g, " ").toLowerCase(), F.muted, F.track];
          const amt = (r.debitSen || 0) - (r.creditSen || 0);
          return {
            key: `${r.ref}-${i}`,
            l: r.ref || "—",
            s: r.date,
            tag: tl,
            tagFg: fg,
            tagBg: bg,
            v: `${amt < 0 ? "−" : "+"}${rm(Math.abs(amt))}`,
            vc: amt < 0 ? F.pos : F.ink,
            v2: `Bal ${rm(r.runningSen)}`,
            v2c: F.body,
          };
        }),
        { key: "close", l: "Closing balance", w: 800, v: rm(stmt.closingSen), bg: F.cream },
      ]
    : [];

  return (
    <FinScreen title="Customer Statement" onBack={onBack}>
      {nav}
      <FinCard title="Statement for" icon={ScrollText} cols={2}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FinSearch v={q} on={setQ} ph="Search customer name or code" />
          <FinSelect
            flex
            sel={{
              v: cid,
              on: setCid,
              aria: "Customer",
              opts: [{ v: "", l: cust.loading && !cust.data ? "Loading customers…" : `Pick a customer (${shown.length})` }, ...shown.map((c) => ({ v: c.id, l: c.code ? `${c.name} · ${c.code}` : c.name }))],
            }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, marginTop: 10 }}>
          <DateTile k="From" v={from} on={setFrom} />
          <DateTile k="To" v={to} on={setTo} />
        </div>
      </FinCard>
      {!cid ? (
        <FinState icon={UserSearch} bg={F.cream} c={F.gold} t="Pick a customer" s="Choose a customer above to see their statement. Leave From and To empty for the whole history." />
      ) : loading && !data ? (
        <FinSkel n={2} h={140} />
      ) : failed || !stmt ? (
        <FinState icon={UserSearch} bg="#FBE7E3" c={F.neg} t="Couldn't load the statement" s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: refresh }} />
      ) : (
        <>
          <FinHero
            k={stmt.customer.name}
            v={rm(stmt.closingSen)}
            s={`Closing balance${to ? ` at ${to}` : ""}`}
            tiles={[{ k: "Opening balance", v: rm(stmt.openingSen) }, { k: "Lines", v: String(stmt.rows.length) }]}
          />
          <FinCard
            title="Transactions"
            icon={ListOrdered}
            sub="In date order · running balance from the server"
            head={{ a: "Date · reference", b: "Amount · balance" }}
            rows={rows}
            empty={stmt.rows.length ? undefined : "No transactions in this range."}
            note="Void and deleted receipts aren't listed. A bounced receipt shows with its reversal."
          />
        </>
      )}
    </FinScreen>
  );
}
