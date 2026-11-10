// Board Report pages 8–13: cash flow forecast, customers, new models,
// operations, outlook, notes & items to confirm.
import { useState } from "react";
import type { BoardReport } from "@/lib/board-report";
import { changePct, pct, NOTES_MAX } from "@/lib/board-report";
import { ComboChart, Donut, Elastic, ShareBars } from "./charts";
import { C, pctText, rm } from "./format";
import { BrPage, Delta, Money, Tile, Unavailable } from "./page-kit";
import { withSection } from "./with-section";

type P = { r: BoardReport };

export function CashForecastPage({ r }: P) {
  return (
    <BrPage title="Cash flow forecast" kicker="Page 8 · Bank balance at month end" month={r.monthLabel}>
      {withSection(r.cashForecast, (d) => (
        <>
          <p className="brp-lead">
            Two forecasts of the month-end bank balance: <strong>Docs</strong> — from open invoices, bills and planned payments by their terms;
            <strong> P&amp;L</strong> — the Forecast P&amp;L turned into cash. Actual is the bank balance carried forward.
          </p>
          <table className="brp-table">
            <thead><tr><th>Month end, RM</th><th>Actual</th><th>Forecast (Docs)</th><th>Forecast (P&amp;L)</th><th>Docs vs P&amp;L</th></tr></thead>
            <tbody>
              {d.months.map((m) => (
                <tr key={m.ym}><td>{m.label}</td><td><Money v={m.actual} /></td><td><Money v={m.docs} /></td><td><Money v={m.pnl} /></td><td><Money v={m.docs !== null && m.pnl !== null ? m.docs - m.pnl : null} /></td></tr>
              ))}
            </tbody>
          </table>
          <h3>Month-end bank balance</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart w={w} h={h}
                data={d.months.map((m) => ({ label: m.label, values: { a: m.actual, d: m.docs, p: m.pnl } }))}
                series={[
                  { key: "a", label: "Actual", color: C.navy, type: "bar" },
                  { key: "d", label: "Forecast (Docs)", color: C.gold, type: "line" },
                  { key: "p", label: "Forecast (P&L)", color: C.green, type: "line", dashed: true },
                ]} />
            )}
          </Elastic>
          <p className="brp-small">{d.asOf ? `Forecast as at ${d.asOf}. ` : ""}Source: Finance › Cash Flow with Forecast on.</p>
        </>
      ))}
    </BrPage>
  );
}

export function CustomersPage({ r }: P) {
  return (
    <BrPage title="Customers" kicker="Page 9 · Share, concentration, order value" month={r.monthLabel}>
      {withSection(r.customers, (d) => (
        <>
          <div className="brp-tiles four">
            <Tile label="Largest customer" value={pctText(d.concentration?.largestPct ?? null)} sub={d.concentration?.largestName ?? "-"} />
            <Tile label="Top ten customers" value={pctText(d.concentration?.top10Pct ?? null)} sub={`of ${d.concentration?.customerCount ?? "-"} customers`} />
            <Tile label="Bedframe, average per unit" value={<>RM {rm(d.company?.bedframeAvg ?? null)}</>} sub={`${d.company?.bedframeUnits ?? 0} units`} />
            <Tile label="Sofa, average per set" value={<>RM {rm(d.company?.sofaAvg ?? null)}</>} sub={`${d.company?.sofaSets ?? 0} sets`} />
          </div>
          <table className="brp-table">
            <thead><tr><th>Customer</th><th>Confirmed orders, RM</th><th>Share</th><th>Bedframe avg / unit</th><th>Units</th><th>Sofa avg / set</th><th>Sets</th></tr></thead>
            <tbody>
              {d.rows.map((x) => (
                <tr key={x.name}><td>{x.name}</td><td><Money v={x.total} /></td><td>{pctText(x.share)}</td><td><Money v={x.bedframeAvg} /></td><td>{x.bedframeUnits || "-"}</td><td><Money v={x.sofaAvg} /></td><td>{x.sofaSets || "-"}</td></tr>
              ))}
              <tr className="strong"><td>All customers</td><td><Money v={d.concentration?.totalSen ?? d.company?.total ?? null} /></td><td>100.0%</td><td /><td /><td /><td /></tr>
            </tbody>
          </table>
          <h3>Share of confirmed orders</h3>
          {/* Owner review 2026-11-10: half the page was empty — a donut next to the bars. */}
          <div className="brp-grid2 brp-fill">
            <Donut items={d.rows.slice(0, 6).map((x) => ({ label: x.name, value: x.total ?? 0 }))} centre={pctText(d.concentration?.largestPct ?? null)} />
            <ShareBars rows={d.rows.map((x) => ({ label: x.name, value: x.total, pct: x.share }))} />
          </div>
          <p className="brp-small">Confirmed sales orders in the month (the Dashboard&apos;s sales figure), not invoices. Source: Dashboard › Sales (AOV by customer, concentration).</p>
        </>
      ))}
    </BrPage>
  );
}

export function NewModelsPage({ r }: P) {
  return (
    <BrPage title="New models" kicker="Page 10 · Added in the last three months" month={r.monthLabel}>
      {withSection(r.newModels, (d) => (
        <>
          <p className="brp-lead">Models whose first product was created between {d.from} and {d.to}, one card per family.</p>
          {d.models.length === 0 ? (
            <p className="brp-lead">No new models in this period.</p>
          ) : (
            <div className="brp-models">
              {d.models.map((m) => (
                <div key={m.code} className="brp-model">
                  <div className="ph">{m.photo ? <img src={m.photo} alt={m.name} /> : <span>No photo</span>}</div>
                  <div className="nm">{m.name}</div>
                  <div className="cd">{m.code} · {m.category} · added {m.added}</div>
                  <div className="sz">{m.sizes}</div>
                  <div className="pr">{m.price}</div>
                  {m.price2 && <div className="pr2">{m.price2}</div>}
                </div>
              ))}
            </div>
          )}
          {d.more.length > 0 && <p className="brp-small">Other ({d.more.length} more): {d.more.join(", ")}</p>}
          <p className="brp-small">{d.priceNote}{d.undated ? ` ${d.undated} older products have no created date and are never counted as new.` : ""} Source: Products › Catalog (new models).</p>
        </>
      ))}
    </BrPage>
  );
}

export function OperationsPage({ r }: P) {
  return (
    <BrPage title="Operations" kicker="Page 11 · Production, people, quality" month={r.monthLabel}>
      {withSection(r.operations, (d) => {
        const perHead = d.headcount && d.units ? Math.round((d.units / d.headcount) * 10) / 10 : null;
        const prevPerHead = d.prevHeadcount && d.prevUnits ? Math.round((d.prevUnits / d.prevHeadcount) * 10) / 10 : null;
        const defTotal = d.defects ? d.defects.reduce((t, x) => t + x.cases, 0) : null;
        const defUnits = d.defects ? d.defects.filter((x) => x.category !== "UNSPECIFIED").reduce((t, x) => t + x.units, 0) : null;
        return (
          <>
            <div className="brp-tiles four">
              <Tile label="Production revenue" value={<>RM {rm(d.prodTotal)}</>} sub="value of work completed" />
              <Tile label="Units completed" value={d.units ?? "-"} sub={<>last month {d.prevUnits ?? "-"} <Delta p={changePct(d.units, d.prevUnits)} /></>} />
              <Tile label="Headcount (production payroll)" value={d.headcount ?? "-"} sub={<>units per head {perHead ?? "-"} (last month {prevPerHead ?? "-"})</>} />
              <Tile label="Defect rate" value={pctText(defUnits ? pct(defTotal, defUnits) : null)} sub={d.defects ? `${defTotal} cases / ${defUnits} units shipped` : d.defectsError ?? ""} />
            </div>
            <div className="brp-grid2">
              <div>
                <h3>Production value by department</h3>
                <table className="brp-table compact">
                  <thead><tr><th>Department</th><th>RM</th><th>Last month</th><th>Change</th></tr></thead>
                  <tbody>
                    {d.prodMix.map((x) => <tr key={x.code + x.label}><td>{x.label}</td><td><Money v={x.total} /></td><td><Money v={x.prev} /></td><td><Delta p={x.change} /></td></tr>)}
                  </tbody>
                </table>
              </div>
              <div>
                <h3>Production value mix</h3>
                {d.categoryMix.length ? <Donut items={d.categoryMix} size={130} /> : <p className="brp-small">No completed work recorded.</p>}
                <h3>Defects by category</h3>
                {d.defects ? (
                  <table className="brp-table compact">
                    <thead><tr><th>Category</th><th>Cases</th><th>Units shipped</th><th>Rate</th></tr></thead>
                    <tbody>{d.defects.map((x) => <tr key={x.category}><td>{x.category === "UNSPECIFIED" ? "No product on case" : x.category[0] + x.category.slice(1).toLowerCase()}</td><td>{x.cases}</td><td>{x.units}</td><td>{pctText(x.rate)}</td></tr>)}</tbody>
                  </table>
                ) : <Unavailable error={d.defectsError ?? "Defect rates not available"} />}
              </div>
            </div>
            {d.workforce ? (
              <>
                <div className="brp-grid2">
                  <div>
                    <h3>Highest efficiency</h3>
                    <ol className="brp-rank">{d.workforce.topEfficiency.slice(0, 5).map((x) => <li key={x.name}><span>{x.name}</span><b>{x.pct}%</b></li>)}</ol>
                  </div>
                  <div>
                    <h3>Lowest efficiency</h3>
                    <ol className="brp-rank low">{d.workforce.bottomEfficiency.slice(0, 5).map((x) => <li key={x.name}><span>{x.name}</span><b>{x.pct}%</b></li>)}</ol>
                  </div>
                </div>
                <h3>Workers by efficiency band</h3>
                {d.workforce.bands ? (
                  <p className="brp-small">
                    Below {d.workforce.bands.low}%: <b>{d.workforce.bands.below}</b> · {d.workforce.bands.low}–{d.workforce.bands.high}%: <b>{d.workforce.bands.within}</b> · Above {d.workforce.bands.high}%: <b>{d.workforce.bands.above}</b> · of {d.workforce.bands.ranked} workers with at least an hour clocked (same figure and bands as the Employees insights page)
                  </p>
                ) : (
                  <p className="brp-small">Efficiency bands left out: {d.workforce.bandsError ?? "not available"}</p>
                )}
              </>
            ) : (
              <p className="brp-small">Worker efficiency left out: {d.workforceNote}</p>
            )}
            <h3>Production value by month</h3>
            <Elastic>
              {(w, h) => (
                <ComboChart w={w} h={h}
                  data={d.trend.map((t) => ({ label: t.label, values: { b: t.bedframe, s: t.sofa, a: t.accessory } }))}
                  series={[
                    { key: "b", label: "Bedframe", color: C.navy, type: "bar", stack: "p" },
                    { key: "s", label: "Sofa", color: C.gold, type: "bar", stack: "p" },
                    { key: "a", label: "Accessory", color: C.green, type: "bar", stack: "p" },
                  ]} />
              )}
            </Elastic>
            <p className="brp-small">Defect rate = service cases logged ÷ units delivered (our defects: transport and customer causes left out). Highest / lowest efficiency = standard minutes earned ÷ clocked minutes (Operations Report); bands = each worker's production ÷ working minutes for the month (Employees insights). Units completed run high (known duplicate completions).</p>
          </>
        );
      })}
    </BrPage>
  );
}

export function OutlookPage({ r }: P) {
  return (
    <BrPage title="Outlook" kicker="Page 12 · Forecast P&L for the coming months" month={r.monthLabel}>
      {withSection(r.outlook, (d) => (
        <>
          <table className="brp-table">
            <thead><tr><th>Forecast, RM</th>{d.months.map((m) => <th key={m.ym}>{m.label}</th>)}</tr></thead>
            <tbody>
              {([["sales", "Revenue"], ["cogs", "Cost of goods sold"], ["gross", "Gross profit"], ["expenses", "Operating expenses"], ["net", "Net profit"]] as const).map(([k, label]) => (
                <tr key={k} className={k === "gross" || k === "net" ? "strong" : ""}><td>{label}</td>{d.months.map((m) => <td key={m.ym}><Money v={m.forecast?.[k] ?? null} /></td>)}</tr>
              ))}
              <tr><td>Net margin</td>{d.months.map((m) => <td key={m.ym}>{pctText(m.forecast ? pct(m.forecast.net, m.forecast.sales) : null)}</td>)}</tr>
              <tr className="muted"><td>Revenue to date (running month)</td>{d.months.map((m) => <td key={m.ym}><Money v={m.mtd?.sales ?? null} /></td>)}</tr>
            </tbody>
          </table>
          {d.quarter && (
            <>
              <h3>Quarter outlook — {d.quarter.label}</h3>
              <table className="brp-table compact">
                <thead><tr><th>Month</th><th>Revenue</th><th>Net profit</th></tr></thead>
                <tbody>
                  {d.quarter.rows.map((x) => <tr key={x.label}><td>{x.label}</td><td><Money v={x.sales} /></td><td><Money v={x.net} /></td></tr>)}
                  <tr className="strong"><td>Quarter</td><td><Money v={d.quarter.sales} /></td><td><Money v={d.quarter.net} /></td></tr>
                </tbody>
              </table>
            </>
          )}
          <h3>Forecast revenue and net profit</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart w={w} h={h}
                data={d.months.map((m) => ({ label: m.label, values: { s: m.forecast?.sales ?? null, m: m.mtd?.sales ?? null, n: m.forecast?.net ?? null } }))}
                series={[
                  { key: "s", label: "Revenue forecast", color: C.navy, type: "bar" },
                  { key: "m", label: "Revenue to date", color: C.light, type: "bar" },
                  { key: "n", label: "Net profit forecast", color: C.gold, type: "line" },
                ]} />
            )}
          </Elastic>
          <p className="brp-small">Source: Forecasting › Forecast P&amp;L as keyed by Finance; a month with no forecast keyed is left out.</p>
        </>
      ))}
    </BrPage>
  );
}

/** Finance's edit box for page 13 — beside the page, never printed (accounting:update only). */
export function NotesEditor({ r, onSave }: P & { onSave: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(r.notes.text);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== r.notes.text;
  return (
    <div className="brp-notes-edit print:hidden">
      <label htmlFor="brp-notes-input">Finance notes for {r.monthLabel} — shown on page 13</label>
      <textarea id="brp-notes-input" value={draft} maxLength={NOTES_MAX} rows={8} onChange={(e) => setDraft(e.target.value)} />
      <div className="row">
        <span className="brp-small">{draft.length} / {NOTES_MAX}</span>
        <button
          type="button"
          className="brp-btn"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save notes"}
        </button>
      </div>
    </div>
  );
}

export function NotesPage({ r }: P) {
  return (
    <BrPage title="Notes & items to confirm" kicker="Page 13" month={r.monthLabel}>
      <h3>Automatic checks</h3>
      {r.notes.flags.length === 0 ? (
        <p className="brp-lead">No automatic flags for this month.</p>
      ) : (
        <ul className="brp-flags">
          {r.notes.flags.slice(0, 14).map((f) => (
            <li key={f.text} className={`lvl-${f.level}`}><span className="tag">{f.level === "alert" ? "Check now" : f.level === "check" ? "To confirm" : "Note"}</span>{f.text}</li>
          ))}
          {r.notes.flags.length > 14 && <li className="lvl-info"><span className="tag">Note</span>Other ({r.notes.flags.length - 14} more) — see the source pages.</li>}
        </ul>
      )}
      <h3>Finance notes</h3>
      <div className="brp-notes brp-fill">
        <div className="brp-notes-text">{r.notes.text ? r.notes.text : <span className="brp-muted">No notes written for {r.monthLabel} yet.</span>}</div>
        {r.notes.updatedAt && <p className="brp-small">Last edited {r.notes.updatedAt.slice(0, 16).replace("T", " ")} UTC{r.notes.updatedBy ? ` by ${r.notes.updatedBy}` : ""}.</p>}
      </div>
    </BrPage>
  );
}
