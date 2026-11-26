// ---------------------------------------------------------------------------
// Statement helpers for the phone's P&L, Cash Flow and Balance Sheet (Batch 3
// prototype: the statement rows, the "Ledger lines by month" sheet). The rows
// are the server's; nothing is added up here except where the desktop page
// adds up the same rows itself (noted at each helper).
//  · PlDrillSheet  — GET /api/accounting/pl-drill   (desktop PlDrillPanel)
//  · CfDrillSheet  — GET /api/accounting/cashflow-drill (desktop CfMonthlyDrillRows)
//  · BsDrillSheet  — GET /api/accounting/bs-drill   (desktop BsDrillPanel)
//  · csSection / csAllocateShared — the desktop CostStructureTab's own line split
// ---------------------------------------------------------------------------
import { useCachedJson } from "@/lib/cached-fetch";
import { FinSheet, type SheetRow } from "./fin-kit";
import { F, dayMon, rm } from "./fin-format";

const LEDGER_NOTE = "Read-only. Open the General Ledger on desktop for more.";

type DrillLine = { id: string; date: string; description: string; ref1: string; ref2: string | null; debitSen: number; creditSen: number; sourceType: string; sourceId: string };

const lineRow = (l: DrillLine, sen: number, i: number): SheetRow => ({
  key: l.id || `${l.sourceType}:${l.sourceId}:${i}`,
  l: l.description || l.ref1 || "—",
  s: [dayMon(l.date, true), l.ref1, l.ref2].filter(Boolean).join(" · "),
  v: rm(sen),
  vc: sen < 0 ? F.neg : F.ink,
  w: 600,
});

function Loading({ err }: { err: string | null }) {
  return <div style={{ padding: "18px 8px", textAlign: "center", fontSize: 12.5, color: err ? F.neg : F.muted }}>{err ?? "Loading the ledger lines…"}</div>;
}

// ---- P&L ---------------------------------------------------------------------
type PlDrillData = {
  account?: { code: string; name: string; type: string | null };
  lines: DrillLine[];
  extra: { kind: "payroll" | "opening_slice" | "estimate"; ym: string; sen: number; fromYm?: string }[];
  tied?: boolean;
};
const EXTRA_LABEL = { payroll: "Payroll from payslips (not yet posted)", opening_slice: "The opening month's share", estimate: "Running-month estimate" } as const;

/** One P&L line's ledger lines for the statement's period (the desktop drill). */
export function PlDrillSheet({ period, account, label, onClose }: { period: string; account: string | null; label: string; onClose: () => void }) {
  const url = account ? `/api/accounting/pl-drill?period=${encodeURIComponent(period)}&account=${encodeURIComponent(account)}` : null;
  const { data, error } = useCachedJson<{ success?: boolean; error?: string; data?: PlDrillData }>(url);
  const d = data?.success ? data.data : undefined;
  // Income accounts read credit as positive, everything else debit (desktop rule).
  const creditNormal = d?.account?.type === "REVENUE";
  const signed = (dr: number, cr: number) => (creditNormal ? cr - dr : dr - cr);
  const rows: SheetRow[] = d
    ? [
        ...d.lines.map((l, i) => lineRow(l, signed(l.debitSen, l.creditSen), i)),
        ...d.extra.map((e, i) => {
          const sen = creditNormal ? -e.sen : e.sen;
          return { key: `x${i}`, l: EXTRA_LABEL[e.kind], s: e.ym, v: rm(sen), vc: sen < 0 ? F.neg : F.ink, w: 600 };
        }),
      ]
    : [];
  const total = d ? d.lines.reduce((s, l) => s + signed(l.debitSen, l.creditSen), 0) + d.extra.reduce((s, e) => s + (creditNormal ? -e.sen : e.sen), 0) : 0;
  if (d) rows.push({ key: "total", l: "Total", v: rm(total), vc: total < 0 ? F.neg : F.ink, w: 800 });
  const failed = !!error || data?.success === false;
  return (
    <FinSheet open={!!account} onClose={onClose} title={label} sub="Ledger lines by month" rows={d ? rows : null}
      note={d ? (d.tied === false ? `These lines do not add up to the statement line. ${LEDGER_NOTE}` : LEDGER_NOTE) : undefined}>
      {!d ? <Loading err={failed ? data?.error || "Could not load the ledger lines" : null} /> : d.lines.length + d.extra.length === 0 ? <Loading err={null} /> : null}
    </FinSheet>
  );
}

// ---- Cash Flow ---------------------------------------------------------------
type CfDrillData = {
  found: boolean; tied: boolean;
  items: { key: string; ym: string; date: string; description: string; ref1: string; ref2: string | null; sen: number }[];
};

/** One Cash Flow line's payments in the statement's month (the desktop drill). */
export function CfDrillSheet({ period, lineKey, label, onClose }: { period: string; lineKey: string | null; label: string; onClose: () => void }) {
  const url = lineKey ? `/api/accounting/cashflow-drill?period=${encodeURIComponent(period)}&key=${encodeURIComponent(lineKey)}` : null;
  const { data, error } = useCachedJson<{ success?: boolean; error?: string; data?: CfDrillData }>(url);
  const d = data?.success ? data.data : undefined;
  const items = d?.found ? d.items.filter((it) => it.ym === period) : [];
  const total = items.reduce((s, it) => s + it.sen, 0);
  const rows: SheetRow[] = items.map((it) => ({
    key: it.key, l: it.description || it.ref1 || "—", s: [dayMon(it.date, true), it.ref1, it.ref2].filter(Boolean).join(" · "), v: rm(it.sen), vc: it.sen < 0 ? F.neg : F.ink, w: 600,
  }));
  if (items.length) rows.push({ key: "total", l: "Total", v: rm(total), vc: total < 0 ? F.neg : F.ink, w: 800 });
  const failed = !!error || data?.success === false;
  return (
    <FinSheet open={!!lineKey} onClose={onClose} title={label} sub="Payments and receipts in the month" rows={rows.length ? rows : null}
      note={d ? (d.found ? LEDGER_NOTE : "This line is not on the statement any more — reopen the page.") : undefined}>
      {!d ? <Loading err={failed ? data?.error || "Could not load the payments" : null} /> : d.found && !items.length ? <div style={{ padding: "18px 8px", textAlign: "center", fontSize: 12.5, color: F.muted }}>Nothing went through this line in the month.</div> : null}
    </FinSheet>
  );
}

// ---- Balance Sheet -----------------------------------------------------------
type BsDrillData = { assetSide: boolean; bfSen: number; cfSen: number; lines: DrillLine[]; tied?: boolean; fromStockTake?: boolean };

/** One account's b/f, the month's lines and its c/f (the desktop drill). */
export function BsDrillSheet({ period, account, orgParam, label, onClose }: { period: string; account: string | null; orgParam: string; label: string; onClose: () => void }) {
  const url = account ? `/api/accounting/bs-drill?period=${encodeURIComponent(period)}&account=${encodeURIComponent(account)}${orgParam}` : null;
  const { data, error } = useCachedJson<{ success?: boolean; error?: string; data?: BsDrillData }>(url);
  const d = data?.success ? data.data : undefined;
  const signed = (dr: number, cr: number) => (d?.assetSide ? dr - cr : cr - dr);
  const rows: SheetRow[] = d
    ? [
        { key: "bf", l: "Balance b/f", v: rm(d.bfSen), vc: d.bfSen < 0 ? F.neg : F.ink, w: 700 },
        ...d.lines.map((l, i) => lineRow(l, signed(l.debitSen, l.creditSen), i)),
        { key: "cf", l: "Balance c/f", v: rm(d.cfSen), vc: d.cfSen < 0 ? F.neg : F.ink, w: 800 },
      ]
    : [];
  const failed = !!error || data?.success === false;
  return (
    <FinSheet open={!!account} onClose={onClose} title={label} sub={d?.fromStockTake ? "Stock movement in the month" : "Ledger lines in the month"} rows={d ? rows : null}
      note={d ? (d.tied === false ? `b/f and the lines do not add up to c/f. ${LEDGER_NOTE}` : LEDGER_NOTE) : undefined}>
      {!d ? <Loading err={failed ? data?.error || "Could not load the ledger lines" : null} /> : null}
    </FinSheet>
  );
}

// ---- Cost Structure (the desktop CostStructureTab's own rules) ----------------
