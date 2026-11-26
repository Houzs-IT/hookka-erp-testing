// ---------------------------------------------------------------------------
// Balance Sheet on the phone (Batch 3 prototype "bsB"). Reads the desktop
// sheet (/api/accounting/pl `balanceSheet`) as at a month end, in the desktop
// arrangement (owner 2026-10-17): Fixed Assets; Current Assets less Current
// Liabilities = Net Current Assets; Financed By — with the check comparing the
// two sides (bsSides, the desktop's sums). Accounts that share a Chart of
// Accounts parent sit under it (groupBsEntries, as on the desktop). A section
// folds to its total; an account opens its b/f, the month's lines and c/f
// (GET /bs-drill). Monthly lists the recent month-ends, each its own /pl read
// (as monthly-balance-sheet.tsx reads them). The company chips list only the
// companies useCompanyOptions can name truthfully (today: the group), and the
// By company card shows only when a real company exists (GroupByCompanyCard).
// Read-only: no Edit Layout, no export.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, CalendarRange, CircleCheck, CloudOff, Scale, TriangleAlert } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { checkLabel, monthOptions, periodLabel } from "@/lib/finance-reports";
import { groupBsEntries } from "@/lib/bs-groups";
import { orgIdParam, useCompanyOptions } from "@/pages/accounting/shared";
import type { BalanceSheetEntry } from "@/types";
import { bsSides } from "./m-finance-lib";
import { FinBanner, FinCard, FinChips, FinRow, FinScreen, FinSeg, FinSkel, FinState, FinStep, type Row } from "./fin-kit";
import { F, monYear, rm } from "./fin-format";
import { BsDrillSheet } from "./fin-statement";

type BsResp = {
  success?: boolean; error?: string;
  data?: { balanceSheet?: BalanceSheetEntry[]; sheetStock?: { month: string; totalSen: number } | null; sheetStockError?: string | null };
};
type Cat = BalanceSheetEntry["category"];

export function BalanceSheetScreen() {
  const navigate = useNavigate();
  const today = todayYmdMY();
  const months = useMemo(() => monthOptions(today.slice(0, 7), 18), [today]);
  const [at, setAt] = useState(0);
  const period = months[at];
  const [view, setView] = useState<"stmt" | "monthly">("stmt");
  const companies = useCompanyOptions();
  const [company, setCompany] = useState("");
  const bsUrl = company ? `/api/accounting/pl?period=${period}${orgIdParam(company)}` : `/api/accounting/pl?period=${period}`;
  const { data, loading, error, refresh } = useCachedJson<BsResp>(bsUrl);
  const entries = data?.success ? data.data?.balanceSheet ?? [] : [];
  const sides = bsSides(entries);
  const label = periodLabel(period, today);
  const running = label.includes("so far");
  const failed = !!error || data?.success === false;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const flip = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [drill, setDrill] = useState<{ code: string; label: string } | null>(null);
  const stock = data?.success ? data.data?.sheetStock ?? null : null;
  const stockErr = data?.success ? data.data?.sheetStockError ?? null : null;

  // ---- the statement tree --------------------------------------------------------
  const rows: Row[] = [];
  const push = (r: Row) => rows.push({ ...r, key: `${rows.length}` });
  const money = (v: number) => ({ v: rm(v), vc: v < 0 ? F.neg : F.ink });
  const section = (key: string, title: string, cat: Cat, total: number) => {
    const list = entries.filter((e) => e.category === cat);
    const op = !!open[key];
    push({ l: title, ...money(total), w: 700, chev: true, open: op, onTap: () => flip(key) });
    if (!op) return;
    for (const item of groupBsEntries(list)) {
      if (item.kind === "line") {
        const e = item.entry;
        push({ l: e.accountName, s: e.accountCode, ...money(e.balance), fs: 12.5, w: 500, pl: 28, go: true, onTap: () => setDrill({ code: e.accountCode, label: `${e.accountCode} · ${e.accountName}` }) });
      } else {
        const gk = `${key}:${item.code}`;
        const gop = !!open[gk];
        push({ l: item.name, s: item.code, ...money(item.totalSen), fs: 12.5, w: 600, pl: 28, chev: true, open: gop, onTap: () => flip(gk) });
        if (gop) for (const e of item.members) {
          push({ l: e.accountName, s: e.accountCode, ...money(e.balance), fs: 12.5, w: 500, pl: 44, go: true, onTap: () => setDrill({ code: e.accountCode, label: `${e.accountCode} · ${e.accountName}` }) });
        }
      }
    }
  };
  const band = (text: string) => push({ l: text, fs: 11, w: 800, lc: F.gold, bg: F.cream, mh: 34 });
  const result = (text: string, v: number, final?: boolean) => push({ l: text, ...money(v), fs: 12.5, w: 800, vw: 800, bg: final ? F.cream : F.paper });

  section("FA", "Fixed Assets (Net)", "FIXED_ASSET", sides.fixed);
  band("CURRENT ASSETS LESS CURRENT LIABILITIES");
  section("CA", "Current Assets", "CURRENT_ASSET", sides.current);
  section("CL", "Less: Current Liabilities", "CURRENT_LIABILITY", sides.currentLiab);
  result("Net Current Assets", sides.netCurrent);
  result("FIXED ASSETS + CURRENT ASSETS − CURRENT LIABILITIES", sides.left);
  band("FINANCED BY");
  section("EQ", "Equity", "EQUITY", sides.equity);
  section("LL", "Non-Current Liabilities", "LONG_TERM_LIABILITY", sides.longLiab);
  result("TOTAL EQUITY + NON-CURRENT LIABILITIES", sides.right, true);

  const realCompanies = companies.filter((o) => o.value !== "");
  const stockNote = stock
    ? `Stock lines show the P&L's closing stock for ${monYear(stock.month)} (the Stock Summary figure), read live — nothing is posted to the ledger. Current Year Earnings carries the difference from the ledger.`
    : stockErr
      ? `The stock could not be read (${stockErr}) — the stock lines show the ledger's own balance.`
      : undefined;

  return (
    <FinScreen title="Balance Sheet" onBack={() => navigate("/m/finance")}>
      <FinStep l={`As at ${monYear(period)}${running ? " *" : ""}`} s={running ? "Running month · as at today" : "Month end"} tone={running ? "run" : "plain"}
        onPrev={at < months.length - 1 ? () => setAt(at + 1) : undefined} onNext={at > 0 ? () => setAt(at - 1) : undefined} />
      <FinSeg opts={[{ k: "stmt", l: "Statement" }, { k: "monthly", l: "Monthly" }]} cur={view} set={setView} aria="View" h={40} />
      <FinChips opts={companies.map((o) => ({ k: o.value, l: o.value ? o.label : "Consolidated" }))} cur={company} set={(k) => { setCompany(k); setOpen({}); }} />
      {view === "monthly" ? (
        <MonthlyCard months={months.slice(at, at + 6)} company={company} today={today} />
      ) : loading && !data ? (
        <FinSkel n={2} h={160} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the balance sheet." s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : entries.length === 0 ? (
        <FinState icon={Scale} bg={F.cream} c={F.gold} t="No balance sheet" s={`No balance sheet for ${label}.`} />
      ) : (
        <>
          <FinBanner
            tone={sides.diff === 0 ? "ok" : "bad"}
            icon={sides.diff === 0 ? CircleCheck : TriangleAlert}
            t={sides.diff === 0 ? "Balanced ✓" : checkLabel(sides.diff)}
            s={sides.diff === 0 ? "Assets equal equity and liabilities." : `Fixed + current − current liabilities ${rm(sides.left)} · equity + non-current liabilities ${rm(sides.right)}.`}
          />
          {company === "" && realCompanies.length > 0 ? <ByCompanyCard period={period} companies={realCompanies} onPick={(v) => { setCompany(v); setOpen({}); }} /> : null}
          <FinCard title="Statement" icon={Scale} sub={`${COMPANY.HOOKKA.name} · tap a section · collapsed sections show totals`} head={{ a: "Item", b: "RM" }} rows={rows} note={stockNote} test="bs-statement" />
          <BsDrillSheet period={period} account={drill?.code ?? null} orgParam={orgIdParam(company)} label={drill?.label ?? ""} onClose={() => setDrill(null)} />
        </>
      )}
    </FinScreen>
  );
}

/** Recent month-ends, each its own /pl read: net assets (fixed + net current) and total assets. */
function MonthlyCard({ months, company, today }: { months: string[]; company: string; today: string }) {
  return (
    <FinCard title="Monthly Balance Sheet" icon={CalendarRange} sub="Net assets at each month end">
      <div style={{ marginTop: 10, borderRadius: 14, background: "#FFFFFF", boxShadow: `inset 0 0 0 1px ${F.line}`, overflow: "hidden" }}>
        {months.map((ym, i) => <MonthRow key={ym} ym={ym} company={company} first={i === 0} today={today} />)}
      </div>
    </FinCard>
  );
}

function MonthRow({ ym, company, first, today }: { ym: string; company: string; first: boolean; today: string }) {
  const url = company ? `/api/accounting/pl?period=${ym}${orgIdParam(company)}` : `/api/accounting/pl?period=${ym}`;
  const { data, error } = useCachedJson<BsResp>(url);
  const entries = data?.success ? data.data?.balanceSheet ?? null : null;
  const s = entries ? bsSides(entries) : null;
  const run = ym === today.slice(0, 7);
  const failed = !!error || data?.success === false;
  return (
    <FinRow first={first} r={{
      l: `As at ${monYear(ym)}${run ? " *" : ""}`,
      s: s ? `Total assets ${rm(s.fixed + s.current)}` : failed ? "Could not be read" : "Loading…",
      sc: failed ? F.neg : undefined,
      v: s ? rm(s.left) : "—",
      vc: s && s.left < 0 ? F.neg : F.ink,
    }} />
  );
}

/** Net assets by company (consolidated view only) — the desktop GroupByCompanyCard's read. */
function ByCompanyCard({ period, companies, onPick }: { period: string; companies: { value: string; label: string }[]; onPick: (v: string) => void }) {
  const [rows, setRows] = useState<{ value: string; label: string; equitySen: number }[] | null>(null);
  const key = companies.map((c) => c.value).join(",");
  useEffect(() => {
    let stale = false;
    Promise.all(companies.map(async (co) => {
      try {
        const r = await fetch(`/api/accounting/pl?period=${period}${orgIdParam(co.value)}`);
        const j = (await r.json()) as { data?: { balanceSheet?: { category: string; balance: number }[] } };
        return { value: co.value, label: co.label, equitySen: (j?.data?.balanceSheet ?? []).filter((e) => e.category === "EQUITY").reduce((s, e) => s + (e.balance || 0), 0) };
      } catch {
        return { value: co.value, label: co.label, equitySen: 0 };
      }
    })).then((res) => { if (!stale) setRows(res); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable identity of companies
  }, [period, key]);
  return (
    <FinCard title="By company" icon={Building2} sub="Consolidated view only"
      rows={(rows ?? []).map((r) => ({ key: r.value, l: r.label, s: "Equity", v: rm(r.equitySen), vc: r.equitySen < 0 ? F.neg : F.ink, go: true, onTap: () => onPick(r.value) }))}
      empty={rows ? undefined : "Loading…"} />
  );
}
