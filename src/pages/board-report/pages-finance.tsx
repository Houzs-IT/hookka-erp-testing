// Board Report pages 1–7: cover, income statement, labour, raw materials,
// trend, balance sheet, cash flow. Figures come shaped from
// GET /api/reports/board (src/lib/board-report.ts); nothing is computed here
// beyond picking colours and labels.
import type { BoardReport } from "@/lib/board-report";
import { changePct, pct } from "@/lib/board-report";
import { ComboChart, Donut, Elastic, type Datum } from "./charts";
import { C, PALETTE, pctText, rm } from "./format";
import { BrPage, Delta, Money, Tile } from "./page-kit";
import { withSection } from "./with-section";

type P = { r: BoardReport };

export function CoverPage({ r }: P) {
  return (
    <BrPage title={`Board report — ${r.monthLabel}`} kicker="Page 1 · Cover & highlights" month={r.monthLabel} className="brp-cover">
      {withSection(r.cover, (d) => (
        <>
          <div className="brp-tiles">
            {d.tiles.map((t, i) => (
              <Tile
                key={t.label}
                label={t.label}
                tone={(["navy", "gold", t.value !== null && t.value < 0 ? "red" : "green", "navy"] as const)[i]}
                value={<>RM {rm(t.value)}</>}
                sub={
                  <>
                    {t.prev !== null && <span>vs last month <Delta p={changePct(t.value, t.prev)} /></span>}
                    {t.forecast !== null && <span> · forecast RM {rm(t.forecast)}</span>}
                    {t.note && <span> · {t.note}</span>}
                  </>
                }
              />
            ))}
          </div>
          <h3>Highlights</h3>
          <ul className="brp-bullets">
            {d.highlights.map((h) => <li key={h}>{h}</li>)}
          </ul>
          <h3>Revenue and net profit by month</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart
                w={w}
                h={h}
                data={d.trend.map<Datum>((t) => ({
                  label: t.kind === "mtd" ? `${t.label}*` : t.label,
                  faded: t.kind !== "actual",
                  values: { sales: t.kind === "forecast" ? null : t.sales, net: t.kind === "forecast" ? null : t.net, fc: t.forecastSales },
                }))}
                series={[
                  { key: "sales", label: "Revenue", color: C.navy, type: "bar" },
                  { key: "net", label: "Net profit", color: C.gold, type: "line" },
                  { key: "fc", label: "Revenue forecast", color: C.grey, type: "line", dashed: true },
                ]}
              />
            )}
          </Elastic>
          <p className="brp-small">* month to date. Source: Forecasting › Dashboard (the Monthly P&L engine); cash from the Cash Flow statement.</p>
        </>
      ))}
    </BrPage>
  );
}

export function IncomePage({ r }: P) {
  return (
    <BrPage title="Income statement" kicker="Page 2" month={r.monthLabel}>
      {withSection(r.income, (d) => (
        <>
          <table className="brp-table">
            <thead>
              <tr><th>RM</th><th>Actual</th><th>Forecast</th><th>vs forecast</th><th>Last month</th><th>{d.sinceLabel}</th><th>% of revenue</th></tr>
            </thead>
            <tbody>
              {d.rows.map((x) => (
                <tr key={x.key} className={`${x.strong ? "strong" : ""} depth-${x.depth}`}>
                  <td>{x.label}</td>
                  <td><Money v={x.actual} /></td>
                  <td><Money v={x.forecast} /></td>
                  <td><Delta p={changePct(x.actual, x.forecast)} invert={["cogs", "materials", "labour", "overhead", "expenses", "staffCost", "otherOpex"].includes(x.key)} /></td>
                  <td><Money v={x.prev} /></td>
                  <td><Money v={x.since} /></td>
                  <td>{pctText(x.pctOfSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.estimated > 0 && <p className="brp-small">Includes RM {rm(d.estimated)} of estimates for recurring costs not yet recorded.</p>}
          <div className="brp-grid2 brp-fill">
            <div>
              <h3>Cost structure (% of costs)</h3>
              <Donut items={d.costStructure} size={160} />
            </div>
            <div>
              <h3>Margins</h3>
              <table className="brp-table compact">
                <thead><tr><th /><th>Actual</th><th>Forecast</th><th>Last month</th></tr></thead>
                <tbody>
                  {d.margins.map((m) => (
                    <tr key={m.label}><td>{m.label}</td><td>{pctText(m.actual)}</td><td>{pctText(m.forecast)}</td><td>{pctText(m.prev)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="brp-small">Source: Forecasting › Dashboard income statement (same figures as Finance › Monthly P&L); forecast from Forecasting › Forecast P&L.</p>
        </>
      ))}
    </BrPage>
  );
}

export function LabourPage({ r }: P) {
  return (
    <BrPage title="Labour by department" kicker="Page 3 · Direct labour" month={r.monthLabel}>
      {withSection(r.labour, (d) => (
        <>
          <div className="brp-tiles four">
            <Tile label="Direct labour" value={<>RM {rm(d.total)}</>} sub={<>last month RM {rm(d.prevTotal)} <Delta p={changePct(d.total, d.prevTotal)} invert /></>} />
            <Tile label="Forecast" value={<>RM {rm(d.forecastTotal)}</>} sub={<Delta p={changePct(d.total, d.forecastTotal)} invert />} />
            <Tile label="% of production revenue" value={pctText(pct(d.total, d.productionRevenue))} sub={<>production revenue RM {rm(d.productionRevenue)}</>} />
            <Tile label="Per head" value={<>RM {rm(d.headcount ? Math.round(d.total / d.headcount) : null)}</>} sub={<>{d.headcount ?? "-"} on payroll · {d.units ?? "-"} units completed</>} />
          </div>
          <table className="brp-table">
            <thead>
              <tr><th>Department</th><th>Direct labour</th><th>Share</th><th>% of total prod. revenue</th><th>% of own prod. revenue</th><th>Last month</th><th>Forecast</th><th>vs forecast</th></tr>
            </thead>
            <tbody>
              {d.depts.map((x) => (
                <tr key={x.dept}>
                  <td>{x.dept}</td>
                  <td><Money v={x.cost} /></td>
                  <td>{pctText(x.share)}</td>
                  <td>{pctText(x.pctTotalProdRev)}</td>
                  <td>{pctText(x.pctOwnProdRev)}</td>
                  <td><Money v={x.prev} /></td>
                  <td><Money v={x.forecast} /></td>
                  <td><Delta p={changePct(x.cost, x.forecast)} invert /></td>
                </tr>
              ))}
              <tr className="strong"><td>Total</td><td><Money v={d.total} /></td><td>100.0%</td><td>{pctText(pct(d.total, d.productionRevenue))}</td><td /><td><Money v={d.prevTotal} /></td><td><Money v={d.forecastTotal} /></td><td><Delta p={changePct(d.total, d.forecastTotal)} invert /></td></tr>
            </tbody>
          </table>
          <h3>Production salary by month</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart
                w={w}
                h={h}
                data={d.trend.map((t) => ({ label: t.label, values: t.byDept }))}
                series={d.series.map((s, i) => ({ key: s, label: s, color: PALETTE[i % PALETTE.length], type: "bar" as const, stack: "a" }))}
              />
            )}
          </Elastic>
          <p className="brp-small">Production revenue = value of work completed (Employees › Labor Cost vs Revenue), not sales. Own production revenue = the department&apos;s own completed value (Dashboard › revenue split). Source: Forecasting › Dashboard production salary.</p>
        </>
      ))}
    </BrPage>
  );
}

export function MaterialsPage({ r }: P) {
  return (
    <BrPage title="Raw materials by category" kicker="Page 4" month={r.monthLabel}>
      {withSection(r.materials, (d) => (
        <>
          <div className="brp-tiles three">
            <Tile label="Raw materials used" value={<>RM {rm(d.total)}</>} sub={<>{pctText(pct(d.total, d.sales))} of revenue</>} />
            <Tile label="Purchased" value={<>RM {rm(d.cats.reduce((t, x) => t + x.purchase, 0))}</>} />
            <Tile label="Closing stock" value={<>RM {rm(d.cats.reduce((t, x) => t + x.closing, 0))}</>} />
          </div>
          <table className="brp-table">
            <thead><tr><th>Category</th><th>Used</th><th>% of revenue</th><th>Purchased</th><th>Closing stock</th><th>Last month used</th><th>Forecast</th><th>vs forecast</th></tr></thead>
            <tbody>
              {d.cats.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td><td><Money v={x.spend} /></td><td>{pctText(x.pctOfSales)}</td><td><Money v={x.purchase} /></td><td><Money v={x.closing} /></td>
                  <td><Money v={x.prev} /></td><td><Money v={x.forecast} /></td><td><Delta p={changePct(x.spend, x.forecast)} invert /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Raw materials used by month</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart
                w={w}
                h={h}
                data={d.trend.map((t) => ({ label: t.label, values: { a: t.actual, f: t.forecast } }))}
                series={[{ key: "a", label: "Used", color: C.gold, type: "bar" }, { key: "f", label: "Forecast", color: C.navy, type: "line", dashed: true }]}
              />
            )}
          </Elastic>
          <p className="brp-small">Used = opening + purchases − closing per category (Stock Take basis). Source: Forecasting › Dashboard cost structure.</p>
        </>
      ))}
    </BrPage>
  );
}

export function TrendPage({ r }: P) {
  return (
    <BrPage title="Trend" kicker="Page 5 · Revenue and profit over time" month={r.monthLabel}>
      {withSection(r.trend, (d) => (
        <>
          <table className="brp-table compact">
            <thead><tr><th>RM</th>{d.summary.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
            <tbody>
              <tr><td>Revenue</td>{d.summary.map((s) => <td key={s.label}><Money v={s.sales} /></td>)}</tr>
              <tr><td>Gross profit</td>{d.summary.map((s) => <td key={s.label}><Money v={s.gross} /></td>)}</tr>
              <tr className="strong"><td>Net profit</td>{d.summary.map((s) => <td key={s.label}><Money v={s.net} /></td>)}</tr>
              <tr><td>Gross margin</td>{d.summary.map((s) => <td key={s.label}>{pctText(s.grossPct)}</td>)}</tr>
              <tr><td>Net margin</td>{d.summary.map((s) => <td key={s.label}>{pctText(s.netPct)}</td>)}</tr>
            </tbody>
          </table>
          <h3>Actual vs forecast, last three months</h3>
          <table className="brp-table compact">
            <thead><tr><th>Month</th><th>Revenue</th><th>Forecast</th><th>vs forecast</th><th>Net profit</th><th>Forecast</th><th>vs forecast</th></tr></thead>
            <tbody>
              {d.last3.map((x) => (
                <tr key={x.label}><td>{x.label}</td><td><Money v={x.sales} /></td><td><Money v={x.fcSales} /></td><td><Delta p={changePct(x.sales, x.fcSales)} /></td><td><Money v={x.net} /></td><td><Money v={x.fcNet} /></td><td><Delta p={changePct(x.net, x.fcNet)} /></td></tr>
              ))}
            </tbody>
          </table>
          <div className="brp-charts2">
            <div className="brp-chartcol">
              <h3>Revenue (bars) with forecast</h3>
              <Elastic>
                {(w, h) => (
                  <ComboChart w={w} h={h}
                    data={d.points.map((p) => ({ label: p.kind === "mtd" ? `${p.label}*` : p.label, faded: p.kind !== "actual", values: { s: p.sales, f: p.forecastSales } }))}
                    series={[{ key: "s", label: "Revenue", color: C.navy, type: "bar" }, { key: "f", label: "Forecast", color: C.gold, type: "line", dashed: true }]} />
                )}
              </Elastic>
            </div>
            <div className="brp-chartcol">
              <h3>Net profit</h3>
              <Elastic>
                {(w, h) => (
                  <ComboChart w={w} h={h}
                    data={d.points.map((p) => ({ label: p.kind === "mtd" ? `${p.label}*` : p.label, faded: p.kind !== "actual", values: { n: p.net, f: p.forecastNet } }))}
                    series={[{ key: "n", label: "Net profit", color: C.green, type: "bar" }, { key: "f", label: "Forecast", color: C.gold, type: "line", dashed: true }]} />
                )}
              </Elastic>
            </div>
          </div>
          <p className="brp-small">* month to date. The last column is next month&apos;s Forecast P&L. Source: Forecasting › Dashboard.</p>
        </>
      ))}
    </BrPage>
  );
}

export function BalancePage({ r }: P) {
  return (
    <BrPage title="Balance sheet" kicker="Page 6" month={r.monthLabel}>
      {withSection(r.balance, (d) => (
        <>
          <div className="brp-tiles five">
            {d.ratios.map((x) => (
              <Tile key={x.label} label={x.label} value={x.cur === null ? "-" : x.unit === "x" ? `${x.cur.toFixed(2)}x` : pctText(x.cur)} sub={<>last month {x.prev === null ? "-" : x.unit === "x" ? `${x.prev.toFixed(2)}x` : pctText(x.prev)}</>} />
            ))}
          </div>
          <table className="brp-table">
            <thead><tr><th>RM, month end</th><th>This month</th><th>Last month</th><th>Change</th><th>Three months ago</th></tr></thead>
            <tbody>
              {d.rows.map((x) => (
                <tr key={x.label} className={x.strong ? "strong" : x.label.startsWith("of which") ? "depth-1" : ""}>
                  <td>{x.label}</td><td><Money v={x.cur} /></td><td><Money v={x.prev} /></td><td><Money v={x.change} /></td><td><Money v={x.quarterAgo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Equity movement</h3>
          <table className="brp-table compact">
            <tbody>
              <tr><td>Equity at the start of the month</td><td><Money v={d.equity.opening} /></td></tr>
              <tr><td>Net profit for the month</td><td><Money v={d.equity.net} /></td></tr>
              <tr><td>Other movements (capital, drawings, postings to equity)</td><td><Money v={d.equity.other} /></td></tr>
              <tr className="strong"><td>Equity at the end of the month</td><td><Money v={d.equity.closing} /></td></tr>
            </tbody>
          </table>
          <h3>Assets, liabilities and equity by month</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart w={w} h={h}
                data={d.trend.map((t) => ({ label: t.label, values: { a: t.assets, l: t.liabilities, e: t.equity } }))}
                series={[{ key: "a", label: "Total assets", color: C.navy, type: "bar" }, { key: "l", label: "Total liabilities", color: C.gold, type: "bar" }, { key: "e", label: "Equity", color: C.green, type: "line" }]} />
            )}
          </Elastic>
          <p className="brp-small">Stock is the P&L&apos;s closing stock; equity includes this year&apos;s un-closed earnings. Source: Forecasting › Dashboard balance sheet (Finance › Balance Sheet).</p>
        </>
      ))}
    </BrPage>
  );
}

export function CashFlowPage({ r }: P) {
  return (
    <BrPage title="Cash flow" kicker="Page 7 · Operating, investing, financing" month={r.monthLabel}>
      {withSection(r.cashFlow, (d) => {
        const m = d.months.find((x) => x.ym === r.month) ?? d.months[d.months.length - 1];
        return (
          <>
            <div className="brp-tiles five">
              <Tile label="Operating" value={<Money v={m.operating} />} />
              <Tile label="Investing" value={<Money v={m.investing} />} />
              <Tile label="Financing" value={<Money v={m.financing} />} />
              <Tile label="Net cash flow" value={<Money v={m.net} />} />
              <Tile label="Bank, month end" value={<Money v={d.bankClose} />} />
            </div>
            <table className="brp-table compact">
              <thead><tr><th>RM</th>{d.months.slice(-8).map((x) => <th key={x.ym}>{x.kind === "mtd" ? `${x.label}*` : x.label}</th>)}</tr></thead>
              <tbody>
                {(["operating", "investing", "financing", "net", "fcf"] as const).map((k) => (
                  <tr key={k} className={k === "net" ? "strong" : ""}>
                    <td>{{ operating: "Operating", investing: "Investing", financing: "Financing", net: "Net cash flow", fcf: "Free cash flow" }[k]}</td>
                    {d.months.slice(-8).map((x) => <td key={x.ym}><Money v={x[k]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Cash flow by month</h3>
            <Elastic>
              {(w, h) => (
                <ComboChart w={w} h={h}
                  data={d.months.map((x) => ({ label: x.kind === "mtd" ? `${x.label}*` : x.label, faded: x.kind === "mtd", values: { o: x.operating, i: x.investing, f: x.financing, n: x.net } }))}
                  series={[
                    { key: "o", label: "Operating", color: C.navy, type: "bar" },
                    { key: "i", label: "Investing", color: C.gold, type: "bar" },
                    { key: "f", label: "Financing", color: C.grey, type: "bar" },
                    { key: "n", label: "Net", color: C.green, type: "line" },
                  ]} />
              )}
            </Elastic>
            <p className="brp-small">* month to date. Free cash flow = operating − capex. Source: Forecasting › Dashboard cash flow (Finance › Cash Flow statement).</p>
          </>
        );
      })}
    </BrPage>
  );
}
