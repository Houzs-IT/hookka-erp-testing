// ---------------------------------------------------------------------------
// Cash Flow on the phone (Batch 3 prototype "cfB"). Reads the desktop
// statement (/api/accounting/cashflow-statement), one month at a time — the
// engine's own rows and the figure in that month's column. A month the engine
// did not send a column for says so; another month's figures are never shown.
// As on the desktop CashFlowTab: L1–L3 set which groups start folded (any group
// can still be opened), rows with no amount anywhere stay out, Forecast reads
// GET /cashflow-forecast (Docs and P&L forecasts beside the month), and a line
// opens its payments (GET /cashflow-drill). Read-only: no Edit Layout, no
// capex inputs.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, CalendarX, CloudOff, Info } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { monthOptions, periodLabel } from "@/lib/finance-reports";
import { cfColumnIndex } from "./m-finance-lib";
import { FinBanner, FinCard, FinChips, FinHero, FinScreen, FinSeg, FinSkel, FinState, FinStep, type Row } from "./fin-kit";
import { F, monYear, rm } from "./fin-format";
import { CfDrillSheet } from "./fin-statement";

type CfRow = {
  kind: "section" | "group" | "line" | "subtotal" | "result" | "total" | "bf" | "cf" | "gap";
  label: string;
  depth: number;
  groupId?: string;
  lineKey?: string;
  values: (number | null)[];
};
type CfCol = { key: string; label: string; accum?: boolean; ym?: string; forecast?: boolean; forecastKind?: "docs" | "pnl"; blank?: boolean };
type CfData = { period: string; columns: CfCol[]; rows: CfRow[] };
type CfResp = { success?: boolean; error?: string; data?: CfData };

export function CashFlowScreen() {
  const navigate = useNavigate();
  const today = todayYmdMY();
  const months = useMemo(() => monthOptions(today.slice(0, 7), 18), [today]);
  const [at, setAt] = useState(0);
  const period = months[at];
  const [level, setLevel] = useState(2);
  const [forecast, setForecast] = useState(false);
  const { data, loading, error, refresh } = useCachedJson<CfResp>(`/api/accounting/cashflow-statement?period=${period}`);
  const { data: fcResp, loading: fcLoading } = useCachedJson<CfResp>(forecast ? `/api/accounting/cashflow-forecast?period=${period}` : null);
  const fc = forecast && fcResp?.success ? fcResp.data : undefined;
  const fcFailed = forecast && !fcLoading && !!fcResp && !fcResp.success;
  const actual = data?.success ? data.data : undefined;
  // With the forecast on, the forecast payload is the same statement with the forecast columns beside the actual ones.
  const stmt = fc ?? actual;
  const ci = stmt ? cfColumnIndex(stmt.columns, period) : -1;
  const label = periodLabel(period, today);
  const running = label.includes("so far");
  const failed = !!error || data?.success === false;

  // Rows with no amount anywhere in the window stay out; a group stays while any line under it has one (desktop cleanRows).
  const rowsAll = stmt?.rows ?? [];
  const clean = useMemo(() => {
    const has = (r: CfRow) => r.values.some((v) => !!v);
    const alive = new Set<string>();
    for (const r of rowsAll) if (r.kind === "line" && r.groupId && has(r)) {
      const parts = r.groupId.split(">");
      for (let i = 1; i <= parts.length; i++) alive.add(parts.slice(0, i).join(">"));
    }
    return rowsAll.filter((r) => r.kind !== "gap" && !(r.kind === "line" && !has(r)) && !(r.kind === "group" && !has(r) && !alive.has(r.groupId ?? "")));
  }, [rowsAll]);
  // Level baseline: a group deeper than the level starts folded (desktop cfCollapseForLevel); a tap flips one.
  const [flips, setFlips] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const flipKey = `${period}|${level}|${forecast}`;
  const flipped = flips.key === flipKey ? flips.ids : new Set<string>();
  const isFolded = (id: string) => {
    const base = clean.some((r) => r.kind === "group" && r.groupId === id && r.depth >= level);
    return flipped.has(id) ? !base : base;
  };
  const toggle = (id: string) => {
    const n = new Set(flipped);
    if (n.has(id)) n.delete(id); else n.add(id);
    setFlips({ key: flipKey, ids: n });
  };
  const hidden = (r: CfRow) => {
    if (!r.groupId) return false;
    const parts = r.groupId.split(">");
    for (let i = 1; i <= parts.length; i++) {
      const id = parts.slice(0, i).join(">");
      if (isFolded(id) && !(r.kind === "group" && id === r.groupId)) return true;
    }
    return false;
  };
  const [drill, setDrill] = useState<{ key: string; label: string } | null>(null);

  // The month's forecast columns (Docs, P&L), when on.
  const fcCol = (kind: "docs" | "pnl") => (fc ? fc.columns.findIndex((c) => c.forecast && !c.accum && c.forecastKind === kind && (c.ym ?? "") === period && !c.blank) : -1);
  const docsJ = fcCol("docs");
  const pnlJ = fcCol("pnl");
  const fcText = (r: CfRow) => {
    const parts = [docsJ >= 0 && r.values[docsJ] != null ? `Docs ${rm(r.values[docsJ])}` : "", pnlJ >= 0 && r.values[pnlJ] != null ? `P&L ${rm(r.values[pnlJ])}` : ""].filter(Boolean);
    return parts.length ? `Forecast ${parts.join(" · ")}` : undefined;
  };

  const val = (r: CfRow | undefined) => (r && ci >= 0 ? r.values[ci] ?? null : null);
  const totalRow = clean.find((r) => r.kind === "total");
  const bfRow = clean.find((r) => r.kind === "bf");
  const cfRow = clean.find((r) => r.kind === "cf");
  const net = val(totalRow);

  const rows: Row[] = clean.filter((r) => !hidden(r)).map((r, i) => {
    const v = r.values[ci] ?? null;
    const band = r.kind === "section";
    const strong = r.kind !== "line" && r.kind !== "group";
    const isGroup = r.kind === "group" && !!r.groupId;
    const open = isGroup && !isFolded(r.groupId as string);
    const canDrill = r.kind === "line" && !!r.lineKey;
    return {
      key: `${r.groupId ?? ""}|${r.label}|${i}`,
      l: r.label,
      v: band ? "" : v === null ? "" : v === 0 ? "-" : rm(v),
      vc: (v ?? 0) < 0 ? F.neg : F.ink,
      v2: fc && !band ? fcText(r) : undefined,
      v2c: F.teal,
      fs: strong ? 13.5 : r.depth > 1 ? 12.5 : 13,
      w: band ? 800 : strong ? 800 : isGroup ? 700 : 500,
      lc: band ? F.gold : F.ink,
      vw: strong ? 800 : 700,
      pl: 12 + Math.max(0, r.depth - (band ? 0 : 1)) * 16,
      bg: band ? F.cream : r.kind === "cf" ? F.cream : strong ? F.paper : "transparent",
      chev: isGroup,
      open,
      go: canDrill,
      onTap: isGroup ? () => toggle(r.groupId as string) : canDrill ? () => setDrill({ key: r.lineKey as string, label: r.label }) : undefined,
    };
  });

  return (
    <FinScreen title="Cash Flow" onBack={() => navigate("/m/finance")}>
      <FinStep l={`${monYear(period)}${running ? " *" : ""}`} s={running ? "Running month · so far" : "Closed month"} tone={running ? "run" : "plain"}
        onPrev={at < months.length - 1 ? () => setAt(at + 1) : undefined} onNext={at > 0 ? () => setAt(at - 1) : undefined} />
      <FinSeg opts={[1, 2, 3].map((n) => ({ k: String(n), l: `Level ${n}` }))} cur={String(level)} set={(k) => setLevel(Number(k))} aria="Detail level" h={40} />
      <FinChips opts={[{ k: "fc", l: "Forecast" }]} cur={null} on={() => forecast} set={() => setForecast((f) => !f)} />
      {loading && !data ? (
        <FinSkel n={2} h={150} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the cash flow." s={data?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : !stmt || ci < 0 || stmt.rows.length === 0 ? (
        <FinState icon={CalendarX} bg={F.track} c={F.muted} t="No cash flow for selected month" s={<>No cash flow for {label}. Pick another month.</>} />
      ) : (
        <>
          {fcFailed ? <FinBanner tone="bad" icon={Info} t="Forecast unavailable." s="The forecast could not be loaded; the actual figures are shown." /> : null}
          <FinHero
            k={`Net cash flow · ${monYear(period)}`}
            v={net === null ? "—" : rm(net)}
            vc={(net ?? 0) < 0 ? F.neg : F.ink}
            s={fc && totalRow ? fcText(totalRow) : undefined}
            tiles={[
              { k: "Brought forward", v: rm(val(bfRow)) },
              { k: "Carried forward", v: rm(val(cfRow)) },
            ]}
          />
          <FinCard title="Statement" icon={ArrowLeftRight} sub={`${COMPANY.HOOKKA.name} · sections · groups · lines`} head={{ a: "Line", b: "RM" }} rows={rows}
            note={fc ? "Forecast shows the Docs forecast (open documents) and the P&L forecast for the month." : undefined} test="cf-statement" />
          <CfDrillSheet period={period} lineKey={drill?.key ?? null} label={drill?.label ?? ""} onClose={() => setDrill(null)} />
        </>
      )}
    </FinScreen>
  );
}
