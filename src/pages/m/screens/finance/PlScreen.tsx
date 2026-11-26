// ---------------------------------------------------------------------------
// P&L on the phone (Batch 3 prototype "plB"): three views, as the desktop P&L
// entry has (PlHubTab) —
//  · Statement      GET /api/accounting/pl-statement?period=&line= — months, the
//                   desktop's FY quarters and financial years (useFiscalYears),
//                   L1–L4, FY YTD under each figure, an account opens its ledger
//                   lines (GET /pl-drill). Headline figures are the statement's
//                   own result rows (plHeadline); the table folds like the
//                   desktop one (an open group closes on its own total line).
//  · Monthly        GET /api/accounting/pl-monthly?line=&anchor=[&forecast=1] —
//                   each month's Net Profit, Revenue and GP %, Forecast beside it
//                   (Overall only, as on the desktop), past months' forecasts
//                   hidden on request.
//  · Cost structure GET /api/accounting/cost-structure[?fy=] — the FY's material
//                   groups, split by line with the desktop table's own rule.
// Figures are never recomputed: rows, totals and % are the server's.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarRange, CloudOff, FileSpreadsheet, PieChart } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { foldStatementRows, fmtPctOfSales, monthOptions, periodLabel } from "@/lib/finance-reports";
import { fyKey, fyqKey, fyQuarters } from "@/lib/fiscal-year";
import { CS_COLOURS } from "@/lib/finance-chart-look";
import { useFiscalYears } from "@/pages/accounting/use-fiscal-years";
import { plHeadline } from "./m-finance-lib";
import { FinCard, FinChips, FinHero, FinScreen, FinSeg, FinSheet, FinSkel, FinState, FinStep, type Row, type SheetRow } from "./fin-kit";
import { F, monYear, pctOf, rm } from "./fin-format";
import { useFinToast } from "./fin-toast";
import { PlDrillSheet } from "./fin-statement";
import { csGroupsFor, type CsData } from "./fin-cs";

type Line = "all" | "sofa" | "bedframe";
type StmtRow = {
  kind: "group" | "line" | "total" | "grandtotal" | "gap";
  depth: number;
  label: string;
  periodSen?: number;
  ytdSen?: number;
  groupId?: string;
  totalLabel?: string;
  accountCode?: string;
  drillCode?: string;
  estSen?: number;
};
type StmtResp = {
  success?: boolean; error?: string;
  data?: { rows: StmtRow[]; netSalesSen: number; ytdNetSalesSen?: number; fyLabel?: string; materialWarnings?: { negatives: unknown[]; unresolved: unknown[] } };
};
type MonthlyCol = { key: string; label: string; accum: boolean; forecast?: boolean; future?: boolean; ym?: string };
type MonthlyRow = { kind: string; depth: number; label: string; values: number[]; pctValues: number[] };
type MonthlyResp = { success?: boolean; error?: string; data?: { fyLabel: string; columns: MonthlyCol[]; rows: MonthlyRow[] } };

const LINES: { k: Line; l: string }[] = [{ k: "all", l: "Overall" }, { k: "sofa", l: "Sofa" }, { k: "bedframe", l: "Bedframe" }];
const VIEWS = [{ k: "stmt", l: "Statement" }, { k: "monthly", l: "Monthly" }, { k: "cost", l: "Cost structure" }] as const;
type View = (typeof VIEWS)[number]["k"];
type PerKind = "m" | "q" | "fy" | "fyp";

const isYm = (k: string) => /^\d{4}-\d{2}$/.test(k);

export function PlScreen() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("stmt");
  const [line, setLine] = useState<Line>("all");
  return (
    <FinScreen title="P&L" onBack={() => navigate("/m/finance")}>
      <FinSeg opts={VIEWS.map((v) => ({ k: v.k, l: v.l }))} cur={view} set={setView} aria="P&L view" />
      {view === "stmt" ? <StatementView line={line} setLine={setLine} /> : view === "monthly" ? <MonthlyView line={line} setLine={setLine} /> : <CostView />}
    </FinScreen>
  );
}

// ---- Statement -----------------------------------------------------------------
function StatementView({ line, setLine }: { line: Line; setLine: (l: Line) => void }) {
  const today = todayYmdMY();
  const ym = today.slice(0, 7);
  const months = monthOptions(ym, 18);
  const fiscal = useFiscalYears();
  // The desktop's financial years: this one and the one before, their quarters so far.
  const recent = (fiscal?.years ?? []).filter((y) => y.startYm <= ym).slice(-2);
  const quarters = [...recent].reverse().flatMap((y) => fyQuarters(y).filter((q) => q.startYm <= ym).reverse().map((q) => fyqKey(y, q.q)));
  const thisFy = recent[recent.length - 1];
  const lastFy = recent.length > 1 ? recent[0] : undefined;
  const [per, setPer] = useState<PerKind>("m");
  const [mi, setMi] = useState(0);
  const [qi, setQi] = useState(0);
  const period = per === "m" ? months[mi] : per === "q" ? quarters[qi] ?? months[0] : per === "fy" && thisFy ? fyKey(thisFy) : per === "fyp" && lastFy ? fyKey(lastFy) : months[0];
  const { data, loading, error, refresh } = useCachedJson<StmtResp>(`/api/accounting/pl-statement?period=${period}&line=${line}`);
  const rows = data?.success ? data.data?.rows ?? [] : [];
  const net = data?.success ? data.data?.netSalesSen ?? 0 : 0;
  const ytdNet = data?.success ? data.data?.ytdNetSalesSen ?? 0 : 0;
  const head = plHeadline(rows, net);
  const label = periodLabel(period, today);
  const running = label.includes("so far");
  const failed = !!error || data?.success === false;

  // L1–L4: every group at depth >= L-1 starts folded (the desktop's collapseForLevel); a tap opens or folds one.
  const [level, setLevel] = useState(2);
  const [toggled, setToggled] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const viewKey = `${period}|${line}|${level}`;
  const baseline = useMemo(() => new Set(rows.filter((r) => r.kind === "group" && r.groupId && r.depth >= level - 1).map((r) => r.groupId as string)), [rows, level]);
  const flips = toggled.key === viewKey ? toggled.ids : new Set<string>();
  const folded = new Set([...baseline].filter((id) => !flips.has(id)).concat([...flips].filter((id) => !baseline.has(id))));
  const toggle = (id: string) => {
    const n = new Set(flips);
    if (n.has(id)) n.delete(id); else n.add(id);
    setToggled({ key: viewKey, ids: n });
  };
  const [drill, setDrill] = useState<{ code: string; label: string } | null>(null);
  const shown = foldStatementRows(rows, folded);
  const lastGrand = [...rows].reverse().find((r) => r.kind === "grandtotal");
  const ytdPct = (v: number | undefined) => fmtPctOfSales(v, ytdNet);

  const stmtRows: Row[] = shown.filter(({ row }) => row.kind !== "gap").map(({ row, close }, i) => {
    const isGroup = row.kind === "group" && !close;
    const open = isGroup && !!row.groupId && !folded.has(row.groupId);
    const strong = close || row.kind === "total" || row.kind === "grandtotal";
    const grand = row.kind === "grandtotal";
    const value = isGroup && open ? undefined : row.periodSen;
    const ytd = isGroup && open ? undefined : row.ytdSen;
    const code = !isGroup && !close ? row.drillCode ?? row.accountCode : undefined;
    const lbl = close ? row.totalLabel ?? `TOTAL ${row.label}` : row.label;
    return {
      key: `${row.groupId ?? row.label}-${close ? "t" : ""}${i}`,
      l: lbl,
      tag: row.estSen && !isGroup ? "Estimate" : undefined,
      tagBg: "#FAEFCB",
      tagFg: "#85600F",
      c: value === undefined ? "" : fmtPctOfSales(value, net),
      v: value === undefined ? "" : value === 0 ? "-" : rm(value),
      vc: (value ?? 0) < 0 ? F.neg : F.ink,
      v2: ytd === undefined ? undefined : `YTD ${rm(ytd)}${ytdPct(ytd) ? ` · ${ytdPct(ytd)}` : ""}`,
      fs: strong ? 13.5 : row.depth ? 12.5 : 13,
      w: strong ? 800 : isGroup || row.depth === 0 ? 700 : 500,
      vw: strong ? 800 : 700,
      pl: 12 + row.depth * 16,
      bg: grand ? (row === lastGrand ? F.cream : F.paper) : strong ? F.paper : "transparent",
      chev: isGroup && !!row.groupId,
      open,
      go: !!code,
      onTap: isGroup && row.groupId ? () => toggle(row.groupId as string) : code ? () => setDrill({ code, label: lbl }) : undefined,
    };
  });

  const warn = data?.data?.materialWarnings;
  const neg = warn?.negatives.length ?? 0;
  const unres = warn?.unresolved.length ?? 0;
  const hasEst = rows.some((r) => !!r.estSen);
  const notes = [
    hasEst ? "Estimate rows are running-month estimates and will change when the month closes." : "",
    neg || unres ? `FIFO check: ${neg} material${neg === 1 ? "" : "s"} went negative${unres ? ` and ${unres} item code${unres === 1 ? "" : "s"} could not be matched` : ""} — material cost may be off. Details are on the desktop P&L.` : "",
  ].filter(Boolean).join(" ");

  const perChips: { k: PerKind; l: string }[] = [
    { k: "m", l: "Month" },
    ...(quarters.length ? [{ k: "q" as const, l: "Quarter" }] : []),
    ...(thisFy ? [{ k: "fy" as const, l: "This FY" }] : []),
    ...(lastFy ? [{ k: "fyp" as const, l: "Last FY" }] : []),
  ];
  const stepper = per === "m"
    ? <FinStep l={monYear(period) + (running ? " *" : "")} s={running ? "Running month · so far" : "Closed month"} tone={running ? "run" : "plain"}
        onPrev={mi < months.length - 1 ? () => setMi(mi + 1) : undefined} onNext={mi > 0 ? () => setMi(mi - 1) : undefined} />
    : per === "q"
      ? <FinStep l={label.replace(" · so far", "")} s={running ? "Fiscal quarter · so far" : "Fiscal quarter"} tone={running ? "run" : "plain"}
          onPrev={qi < quarters.length - 1 ? () => setQi(qi + 1) : undefined} onNext={qi > 0 ? () => setQi(qi - 1) : undefined} />
      : <FinStep l={label.replace(" · so far", "")} s={running ? "Fiscal period · so far" : "Fiscal period"} tone={running ? "run" : "plain"} />;

  return (
    <>
      {stepper}
      <FinChips opts={perChips} cur={per} set={setPer} />
      <FinSeg opts={LINES} cur={line} set={setLine} aria="Product line" h={40} />
      {loading && !data ? (
        <FinSkel n={2} h={150} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the statement." s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : rows.length === 0 ? (
        <FinState icon={FileSpreadsheet} bg={F.cream} c={F.gold} t="No figures" s={`No figures for ${label}.`} />
      ) : (
        <>
          <FinHero
            k={`Net profit · ${label.replace(" · so far", "")}`}
            tag={running ? "So far" : undefined}
            v={head.net ? rm(head.net.sen) : "—"}
            vc={(head.net?.sen ?? 0) < 0 ? F.neg : F.ink}
            s={head.net?.pct != null ? `${head.net.pct.toFixed(1)}% of sales` : undefined}
            tiles={[
              { k: "Revenue", v: rm(net) },
              { k: "Gross profit", v: head.gross ? rm(head.gross.sen) : "—", s: head.gross?.pct != null ? `${head.gross.pct.toFixed(1)}%` : undefined },
            ]}
          />
          <FinCard
            title="Statement"
            icon={FileSpreadsheet}
            sub={`${COMPANY.HOOKKA.name} · tap a group to open it · tap an account for its ledger`}
            seg={{ opts: [1, 2, 3, 4].map((n) => ({ k: String(n), l: `L${n}` })), cur: String(level), set: (k) => setLevel(Number(k)) }}
            head={{ a: "Item", c: "% sales", b: "RM · FY YTD" }}
            rows={stmtRows}
            note={notes || undefined}
            test="pl-statement"
          />
          <PlDrillSheet period={period} account={drill?.code ?? null} label={drill?.label ?? ""} onClose={() => setDrill(null)} />
        </>
      )}
    </>
  );
}

// ---- Monthly -------------------------------------------------------------------
function MonthlyView({ line, setLine }: { line: Line; setLine: (l: Line) => void }) {
  const today = todayYmdMY();
  const thisMonth = today.slice(0, 7);
  const anchors = useMemo(() => monthOptions(thisMonth, 18), [thisMonth]);
  const [ai, setAi] = useState(0);
  const anchor = anchors[ai];
  // Forecast beside the Actual: off on load, Overall only (desktop MonthlyPlTab).
  const [forecast, setForecast] = useState(false);
  const fcOn = forecast && line === "all";
  const [hidePast, setHidePast] = useState(false);
  const toast = useFinToast();
  const { data, loading, error, refresh } = useCachedJson<MonthlyResp>(`/api/accounting/pl-monthly?line=${line}&anchor=${anchor}${fcOn ? "&forecast=1" : ""}`);
  const d = data?.success ? data.data : undefined;
  const failed = !!error || data?.success === false;
  const cols = d?.columns ?? [];
  const find = (re: RegExp, kinds: string[]) => d?.rows.find((r) => kinds.includes(r.kind) && re.test(r.label));
  const netRow = find(/NET PROFIT/i, ["grandtotal"]);
  const gpRow = find(/GROSS PROFIT/i, ["grandtotal"]);
  const salesRow = find(/^SALES$/i, ["group"]);
  // The months with an Actual column, newest first (Accumulated and forecast-only months left out).
  const monthsShown = cols
    .map((c, j) => ({ c, j }))
    .filter(({ c }) => !c.accum && !c.forecast && !c.future && isYm(c.ym ?? c.key))
    .reverse();
  const fcIndex = (ymKey: string) => cols.findIndex((c) => c.forecast && !c.accum && (c.ym ?? "") === ymKey);
  const rows: Row[] = monthsShown.map(({ c, j }, i) => {
    const ymKey = c.ym ?? c.key;
    const run = ymKey === thisMonth;
    const v = netRow?.values[j] ?? null;
    const fj = fcOn ? fcIndex(ymKey) : -1;
    const showFc = fj >= 0 && !(hidePast && ymKey < thisMonth);
    const gp = gpRow?.pctValues[j];
    return {
      key: ymKey,
      l: `${monYear(ymKey)}${run ? " *" : ""}`,
      s: [salesRow ? `Revenue ${rm(salesRow.values[j] ?? 0)}` : "", gp != null ? `GP ${gp.toFixed(1)}%` : ""].filter(Boolean).join(" · ") || undefined,
      v: v == null ? "—" : rm(v),
      vc: (v ?? 0) < 0 ? F.neg : F.ink,
      v2: showFc && netRow ? `Forecast ${rm(netRow.values[fj] ?? 0)}` : undefined,
      v2c: F.teal,
      bt: i ? undefined : "none",
    };
  });
  return (
    <>
      <FinStep l={`Anchor ${monYear(anchor)}`} s={d?.fyLabel ?? (anchor === thisMonth ? "Running month" : "Closed month")}
        onPrev={ai < anchors.length - 1 ? () => setAi(ai + 1) : undefined} onNext={ai > 0 ? () => setAi(ai - 1) : undefined} />
      <FinSeg opts={LINES} cur={line} set={(l) => { setLine(l); if (l !== "all") setHidePast(false); }} aria="Product line" h={40} />
      {loading && !data ? (
        <FinSkel n={1} h={260} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the monthly P&L." s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : rows.length === 0 || !netRow ? (
        <FinState icon={CalendarRange} bg={F.cream} c={F.gold} t="No months to show" s={`No monthly figures up to ${monYear(anchor)}.`} />
      ) : (
        <FinCard
          title="Monthly P&L"
          icon={CalendarRange}
          sub="Net profit by month"
          seg={{
            opts: [{ k: "on", l: "Forecast on" }, { k: "off", l: "Forecast off" }],
            cur: fcOn ? "on" : "off",
            set: (k) => {
              if (line !== "all") { toast.show("Forecast is for Overall only"); return; }
              setForecast(k === "on");
              setHidePast(false);
            },
          }}
          chips={{
            opts: [{ k: "show", l: "Show past months" }, { k: "hide", l: "Hide past months" }],
            cur: hidePast ? "hide" : "show",
            set: (k) => { if (!fcOn && k === "hide") { toast.show("Hide past months hides past forecasts — turn Forecast on first"); return; } setHidePast(k === "hide"); },
          }}
          rows={rows}
          note="Forecast applies to Overall only. Hide past months hides the forecasts of months already past; their actuals stay."
        />
      )}
      {toast.node}
    </>
  );
}

// ---- Cost structure ------------------------------------------------------------
type Meas = "spend" | "purchase" | "closing";
function CostView() {
  const today = todayYmdMY();
  const thisMonth = today.slice(0, 7);
  const fiscal = useFiscalYears();
  const recent = useMemo(() => (fiscal?.years ?? []).filter((y) => y.startYm <= thisMonth).slice(-2), [fiscal, thisMonth]);
  // ?fy=YYYY = the financial year starting in that year; none = the one holding today (server's pick).
  const fyOpts = [
    { k: "", l: recent[recent.length - 1]?.name ?? "This FY" },
    ...(recent.length > 1 ? [{ k: recent[0].startYm.slice(0, 4), l: recent[0].name }] : []),
  ];
  const [fy, setFy] = useState("");
  const [meas, setMeas] = useState<Meas>("spend");
  const [line, setLine] = useState<Line>("all");
  const [trend, setTrend] = useState<string | null>(null);
  const { data, loading, error, refresh } = useCachedJson<{ success?: boolean; error?: string; data?: CsData }>(`/api/accounting/cost-structure${fy ? `?fy=${fy}` : ""}`);
  const d = data?.success ? data.data : undefined;
  const failed = !!error || data?.success === false;
  // The months to date (the desktop table's Total row covers these).
  const toDate = d ? d.cols.map((m, i) => (m <= thisMonth ? i : -1)).filter((i) => i >= 0) : [];
  const last = toDate[toDate.length - 1];
  const groups = d ? csGroupsFor(d, line) : [];
  const amountOf = (g: (typeof groups)[number], i: number) => (meas === "closing" ? g.months[i].closing : meas === "purchase" ? g.months[i].purchase : g.months[i].spend);
  const totalOf = (g: (typeof groups)[number]) => (meas === "closing" ? (last === undefined ? 0 : g.months[last].closing) : toDate.reduce((s, i) => s + amountOf(g, i), 0));
  const items = groups.map((g, i) => ({ g, v: totalOf(g), c: CS_COLOURS[i % CS_COLOURS.length] })).filter((x) => x.v !== 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((s, x) => s + x.v, 0);
  const pos = items.reduce((s, x) => s + Math.max(0, x.v), 0);
  const trendGroup = groups.find((g) => g.group === trend);
  const trendRows: SheetRow[] = trendGroup ? toDate.slice(-6).map((i) => ({ key: d!.cols[i], l: `${monYear(d!.cols[i])}${d!.cols[i] === thisMonth ? " *" : ""}`, v: rm(amountOf(trendGroup, i)), w: 600 })) : [];
  const measWord = { spend: "spent on materials", purchase: "purchased", closing: last !== undefined && d ? `closing stock at ${monYear(d.cols[last])}` : "closing stock" }[meas];
  return (
    <>
      <FinSeg opts={fyOpts} cur={fy} set={setFy} aria="Financial year" h={40} />
      {loading && !data ? (
        <FinSkel n={1} h={280} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the cost structure." s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : (
        <FinCard
          title="Cost Structure"
          icon={PieChart}
          sub={d?.fyLabel ?? ""}
          seg={{ opts: [{ k: "spend", l: "Spend" }, { k: "purchase", l: "Purchase" }, { k: "closing", l: "Closing stock" }], cur: meas, set: (k) => setMeas(k as Meas) }}
          chips={{ opts: [{ k: "all", l: "All" }, { k: "bedframe", l: "Bedframe" }, { k: "sofa", l: "Sofa" }], cur: line, set: (k) => setLine(k as Line) }}
          val={{ v: rm(total), s: meas === "closing" ? measWord : `${measWord} · FY to date` }}
          stack={pos > 0 ? items.map((x) => ({ w: (Math.max(0, x.v) / pos) * 100, c: x.c })) : undefined}
          rows={items.map((x) => ({ key: x.g.group, l: x.g.description || x.g.group, s: `${pctOf(x.v, total)} of total`, v: rm(x.v), rail: x.c, go: true, onTap: () => setTrend(x.g.group) }))}
          empty={items.length ? undefined : "No material cost in this financial year yet."}
          note={line !== "all" ? "Shared materials are split into Sofa and Bedframe by each month's sales, as on the desktop." : undefined}
        />
      )}
      <FinSheet open={!!trendGroup} onClose={() => setTrend(null)} title={`${trendGroup?.description || trendGroup?.group || ""} · trend`} sub="Last 6 months" rows={trendRows} />
    </>
  );
}
