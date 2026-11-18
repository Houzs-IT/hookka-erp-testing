// Board Report pages 1–7: cover, income statement, labour, raw materials,
// trend, balance sheet, cash flow. Figures come shaped from
// GET /api/reports/board (src/lib/board-report.ts); nothing is computed here
// beyond picking colours and labels.
import type { BoardReport } from "@/lib/board-report";
import { BOARD_DATA_FROM, changePct, pct, shortMonth } from "@/lib/board-report";
import { ComboChart, Donut, Elastic, type Datum } from "./charts";
import { C, CAT, FC, deptName, pctText, rm } from "./format";
import { BrPage, Delta, Money, Tile } from "./page-kit";
import { withSection } from "./with-section";

type P = { r: BoardReport };

export function CoverPage({ r }: P) {
  return (
    <BrPage title={`Board report — ${r.monthLabel}`} kicker="Page 1 · Cover & highlights" month={r.monthLabel} className="brp-cover">
      {/* Letterhead (owner review 2026-11-10: the cover had none). */}
      <div className="brp-letterhead">
        <img src="/hookka-logo.png" alt="Hookka" />
        <div>
          <div className="co">Hookka Industries Sdn Bhd</div>
          <div className="sub">Monthly report to the Board of Directors · {r.monthLabel} · Confidential</div>
        </div>
      </div>
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
                // Owner review 2026-11-15: a month after this one (the running
                // month, next month) is drawn from its Forecast P&L, faded.
                data={d.trend.map<Datum>((t) => ({
                  label: t.kind === "actual" ? t.label : `${t.label} F`,
                  faded: t.kind !== "actual",
                  values: { sales: t.kind === "actual" ? t.sales : t.forecastSales, net: t.kind === "actual" ? t.net : t.forecastNet, fc: t.forecastSales },
                }))}
                series={[
                  { key: "sales", label: "Revenue", color: CAT[0], type: "bar" },
                  { key: "net", label: "Net profit", color: CAT[1], type: "line" },
                  { key: "fc", label: "Revenue forecast", color: FC, type: "line", dashed: true },
                ]}
              />
            )}
          </Elastic>
          <p className="brp-small">F = forecast (Forecasting › Forecast P&amp;L), drawn hatched. From {shortMonth(BOARD_DATA_FROM)}; earlier months are incomplete. Source: Forecasting › Dashboard (the Monthly P&amp;L engine); cash from the Cash Flow statement.</p>
        </>
      ))}
    </BrPage>
  );
}

export function IncomePage({ r }: P) {
  const incomeTrend = r.trend.ok ? r.trend.data.points.filter((p) => p.kind !== "forecast" && p.ym <= r.month) : [];
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
            {/* Owner review 2026-11-15 「not from costs; COGS & NP, GP missing」:
                where each ringgit of revenue went, with GP and NP stated. */}
            <div>
              <h3>Where revenue went</h3>
              {(() => {
                const sales = d.rows.find((x) => x.key === "sales")?.actual ?? null;
                const gp = d.rows.find((x) => x.key === "gross")?.actual ?? null;
                const np = d.rows.find((x) => x.key === "net")?.actual ?? null;
                const oi = d.rows.find((x) => x.key === "otherIncome")?.actual ?? 0;
                return (
                  <div className="brp-split">
                    <Donut items={d.revenueSplit ?? []} size={140} />
                    <div className="brp-split-facts">
                      <div><span>Gross profit</span><b><Money v={gp} /></b><em>{pctText(pct(gp, sales))} margin</em></div>
                      <div><span>{np !== null && np < 0 ? "Net loss" : "Net profit"}</span><b><Money v={np} /></b><em>{pctText(pct(np, sales))} margin</em></div>
                      {np !== null && np < 0 ? <p className="brp-small">Costs exceeded revenue, so the donut has no profit slice.</p> : oi ? <p className="brp-small">Shares are of revenue plus RM {rm(oi)} other income.</p> : null}
                    </div>
                  </div>
                );
              })()}
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
          {/* Owner review 2026-11-10: the lower half of the page was empty —
              the month-by-month picture fills it (elastic, like the other pages). */}
          {incomeTrend.length > 0 && (
            <>
              <h3>Revenue, gross profit and net profit by month</h3>
              <Elastic>
                {(w, h) => (
                  <ComboChart
                    w={w}
                    h={h}
                    data={incomeTrend
                      .map<Datum>((p) => ({ label: p.label, faded: p.kind !== "actual", values: { s: p.sales, g: p.gross, n: p.net, f: p.forecastSales } }))}
                    series={[
                      { key: "s", label: "Revenue", color: CAT[0], type: "bar" },
                      { key: "f", label: "Revenue forecast", color: FC, type: "line", dashed: true },
                      { key: "g", label: "Gross profit", color: CAT[2], type: "line" },
                      { key: "n", label: "Net profit", color: CAT[1], type: "line" },
                    ]}
                  />
                )}
              </Elastic>
            </>
          )}
          <p className="brp-small">Source: Forecasting › Dashboard income statement (same figures as Finance › Monthly P&L); forecast from Forecasting › Forecast P&L.</p>
        </>
      ))}
    </BrPage>
  );
}

export function LabourPage({ r }: P) {
  return (
    <BrPage title="Labour by department" kicker="Page 3 · Direct labour" month={r.monthLabel}>
      {withSection(r.labour, (d) => {
        // Owner 2026-11-13: payroll is filed under each worker's HOME (production)
        // department; the time production staff spent in non-production
        // departments is split OUT of direct labour and shown on its own rows
        // (「确保nonproduction也有分出来」), every column filled (「根据column去填入」).
        const np = d.nonProd ?? [];
        const npTotal = d.nonProdTotal ?? 0;
        const npPrevs = np.map((x) => x.prev).filter((x): x is number => x !== null);
        const npPrev = npPrevs.length ? npPrevs.reduce((a, b) => a + b, 0) : 0;
        const npFcs = np.map((x) => x.forecast).filter((x): x is number => x !== null);
        const npFc = npFcs.length ? npFcs.reduce((a, b) => a + b, 0) : null;
        const payroll = d.total;
        const direct = payroll - npTotal;
        const directPrev = d.prevTotal !== null ? d.prevTotal - npPrev : null;
        const fcAll = d.forecastTotal === null && npFc === null ? null : (d.forecastTotal ?? 0) + (npFc ?? 0);
        return (
        <>
          {/* Owner 2026-11-17 「prod和non prod 分别的数字…两个都tally calculation
              一样」: production and non-production each get the same tile —
              actual, forecast and last month — and the third adds them up, so
              Direct labour + Non-production = All labour on every figure. */}
          <div className="brp-tiles five">
            <Tile label="Direct labour (production)" value={<>RM {rm(direct)}</>} sub={<>forecast RM {rm(d.forecastTotal)} <Delta p={changePct(direct, d.forecastTotal)} invert /> · last month RM {rm(directPrev)} <Delta p={changePct(direct, directPrev)} invert /></>} />
            <Tile label="Non-production" value={<>RM {rm(npTotal)}</>} sub={<>forecast RM {rm(npFc)} <Delta p={changePct(npTotal, npFc)} invert /> · last month RM {rm(npPrev || null)} <Delta p={changePct(npTotal, npPrev || null)} invert /></>} />
            <Tile label="All labour (payroll)" value={<>RM {rm(payroll)}</>} sub={<>forecast RM {rm(fcAll)} <Delta p={changePct(payroll, fcAll)} invert /> · last month RM {rm(d.prevTotal)} <Delta p={changePct(payroll, d.prevTotal)} invert /></>} />
            <Tile label="% of production revenue" value={pctText(pct(direct, d.productionRevenue))} sub={<>direct labour ÷ production revenue RM {rm(d.productionRevenue)}</>} />
            <Tile label="Payroll per head" value={<>RM {rm(d.headcount ? Math.round(payroll / d.headcount) : null)}</>} sub={<>{d.headcount ?? "-"} production workers paid · {d.units ?? "-"} units completed</>} />
          </div>
          <table className="brp-table">
            <thead>
              <tr><th>Department</th><th>Labour</th><th>Share of payroll</th><th>% of total prod. revenue</th><th>% of own prod. revenue</th><th>Last month</th><th>Forecast</th><th>vs forecast</th></tr>
            </thead>
            <tbody>
              {d.depts.map((x) => (
                <tr key={x.dept}>
                  <td>{deptName(x.dept)}</td>
                  <td><Money v={x.cost} /></td>
                  <td>{pctText(pct(x.cost, payroll))}</td>
                  <td>{pctText(x.pctTotalProdRev)}</td>
                  <td>{pctText(x.pctOwnProdRev)}</td>
                  <td><Money v={x.prev} /></td>
                  <td><Money v={x.forecast} /></td>
                  <td><Delta p={changePct(x.cost, x.forecast)} invert /></td>
                </tr>
              ))}
              <tr><td>Payroll in production departments</td><td><Money v={payroll} /></td><td>100.0%</td><td>{pctText(pct(payroll, d.productionRevenue))}</td><td /><td><Money v={d.prevTotal} /></td><td /><td /></tr>
              <tr><td>Less: time in non-production departments</td><td><Money v={-npTotal} /></td><td>{pctText(pct(-npTotal, payroll))}</td><td>{pctText(pct(-npTotal, d.productionRevenue))}</td><td /><td><Money v={npPrev ? -npPrev : null} /></td><td><Money v={npFc !== null ? -npFc : null} /></td><td /></tr>
              <tr className="strong"><td>Direct labour (production)</td><td><Money v={direct} /></td><td>{pctText(pct(direct, payroll))}</td><td>{pctText(pct(direct, d.productionRevenue))}</td><td /><td><Money v={directPrev} /></td><td><Money v={d.forecastTotal} /></td><td><Delta p={changePct(direct, d.forecastTotal)} invert /></td></tr>
              <tr className="brp-subhead"><td colSpan={8}>Non-production · production staff&apos;s time in these departments (split out of the payroll above)</td></tr>
              {np.length === 0 ? (
                <tr><td colSpan={8} className="brp-muted">No non-production time recorded this month.</td></tr>
              ) : (
                np.map((x) => (
                  <tr key={x.dept}>
                    <td>{deptName(x.dept)}</td>
                    <td><Money v={x.cost} /></td>
                    <td>{pctText(pct(x.cost, payroll))}</td>
                    <td>{pctText(pct(x.cost, d.productionRevenue))}</td>
                    <td>-</td>
                    <td><Money v={x.prev} /></td>
                    <td><Money v={x.forecast} /></td>
                    <td><Delta p={changePct(x.cost, x.forecast)} invert /></td>
                  </tr>
                ))
              )}
              <tr className="strong"><td>Non-production total</td><td><Money v={npTotal} /></td><td>{pctText(pct(npTotal, payroll))}</td><td>{pctText(pct(npTotal, d.productionRevenue))}</td><td>-</td><td><Money v={npPrev || null} /></td><td><Money v={npFc} /></td><td><Delta p={changePct(npTotal, npFc)} invert /></td></tr>
              <tr className="strong"><td>All labour (payroll)</td><td><Money v={payroll} /></td><td>100.0%</td><td>{pctText(pct(payroll, d.productionRevenue))}</td><td /><td><Money v={d.prevTotal} /></td><td><Money v={fcAll} /></td><td><Delta p={changePct(payroll, fcAll)} invert /></td></tr>
            </tbody>
          </table>
          <h3>Production salary by month</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart
                w={w}
                h={h}
                data={d.trend.map((t) => ({ label: t.label, values: { ...t.byDept, __fc: t.forecast ?? null } }))}
                series={[
                  ...d.series.map((s, i) => ({ key: s, label: deptName(s), color: s === "Other" ? C.grey : CAT[i % CAT.length], type: "bar" as const, stack: "a" })),
                  // Owner 2026-11-17: every chart carries its forecast — the
                  // month's All labour forecast (production + non-production).
                  { key: "__fc", label: "Forecast (all labour)", color: FC, type: "line" as const, dashed: true },
                ]}
              />
            )}
          </Elastic>
          <p className="brp-small">Production revenue = value of work completed (Employees › Labor Cost vs Revenue), not sales. Own production revenue = the department&apos;s own completed value (Dashboard › revenue split). Source: Forecasting › Dashboard production salary.</p>
        </>
        );
      })}
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
              {/* Owner review 2026-11-15: the tile (the P&L materials line) and
                  the table total disagreed — the P&L line also carries carriage
                  inwards and SST charges, which are not split by category. They
                  get their own row, so the total equals the tile. */}
              {(d.unsplit ?? 0) !== 0 && (
                <tr>
                  <td>Carriage inwards &amp; SST (not by category)</td><td><Money v={d.unsplit ?? 0} /></td><td>{pctText(pct(d.unsplit ?? 0, d.sales))}</td>
                  <td /><td /><td /><td /><td />
                </tr>
              )}
              {/* Total row (owner review 2026-11-10). */}
              {(() => {
                const tot = (k: "spend" | "purchase" | "closing" | "prev" | "forecast") => {
                  const v = d.cats.map((x) => x[k]).filter((x): x is number => typeof x === "number");
                  return v.length ? v.reduce((a, b) => a + b, 0) : null;
                };
                const catSpend = tot("spend"), fc = tot("forecast");
                const spend = catSpend === null ? null : catSpend + (d.unsplit ?? 0);
                return (
                  <tr className="strong">
                    <td>Total</td><td><Money v={spend} /></td><td>{pctText(pct(spend, d.sales))}</td>
                    <td><Money v={tot("purchase")} /></td><td><Money v={tot("closing")} /></td><td><Money v={tot("prev")} /></td>
                    <td><Money v={fc} /></td><td><Delta p={changePct(catSpend, fc)} invert /></td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
          <h3>Raw materials used by month</h3>
          <Elastic>
            {(w, h) => (
              <ComboChart
                w={w}
                h={h}
                data={d.trend.map((t) => ({ label: t.label, values: { a: t.actual, f: t.forecast } }))}
                series={[{ key: "a", label: "Used", color: CAT[0], type: "bar" }, { key: "f", label: "Forecast", color: FC, type: "line", dashed: true }]}
              />
            )}
          </Elastic>
          <p className="brp-small">Used = opening stock + purchases − closing stock per category (Stock Take basis) — the closing stock is deducted. The P&amp;L raw-materials line adds carriage inwards (700-1015) and SST charges (706-0000), shown on their own row. Source: Forecasting › Dashboard cost structure.</p>
        </>
      ))}
    </BrPage>
  );
}

export function TrendPage({ r }: P) {
  return (
    <BrPage title="Trend" kicker="Page 5 · Revenue and profit over time" month={r.monthLabel}>
      {withSection(r.trend, (d) => {
        // Owner 2026-11-10: the best revenue month in bold, with a star.
        const best = Math.max(...d.summary.filter((s) => s.kind === "actual" && s.sales !== null).map((s) => s.sales as number));
        return (
        <>
          <table className="brp-table compact">
            <thead><tr><th>RM</th>{d.summary.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
            <tbody>
              <tr><td>Revenue</td>{d.summary.map((s) => <td key={s.label}>{s.kind === "actual" && s.sales === best ? <b>★ <Money v={s.sales} strong /></b> : <Money v={s.sales} />}</td>)}</tr>
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
                    data={d.points.map((p) => ({ label: p.kind === "actual" ? p.label : `${p.label} F`, faded: p.kind !== "actual", values: { s: p.kind === "actual" ? p.sales : p.forecastSales, f: p.forecastSales } }))}
                    series={[{ key: "s", label: "Revenue", color: CAT[0], type: "bar" }, { key: "f", label: "Forecast", color: FC, type: "line", dashed: true }]} />
                )}
              </Elastic>
            </div>
            <div className="brp-chartcol">
              <h3>Net profit</h3>
              <Elastic>
                {(w, h) => (
                  <ComboChart w={w} h={h}
                    data={d.points.map((p) => ({ label: p.kind === "actual" ? p.label : `${p.label} F`, faded: p.kind !== "actual", values: { n: p.kind === "actual" ? p.net : p.forecastNet, f: p.forecastNet } }))}
                    series={[{ key: "n", label: "Net profit", color: CAT[0], type: "bar" }, { key: "f", label: "Forecast", color: FC, type: "line", dashed: true }]} />
                )}
              </Elastic>
            </div>
          </div>
          <p className="brp-small">F / (forecast) = Forecasting › Forecast P&amp;L for the months after this one — the month still running included (owner review 2026-11-15), drawn hatched. Source: Forecasting › Dashboard.</p>
        </>
        );
      })}
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
                data={d.trend.filter((t) => t.assets !== 0 || t.liabilities !== 0 || t.equity !== 0).map((t) => ({ label: t.label, values: { a: t.assets, l: t.liabilities, e: t.equity } }))}
                series={[{ key: "a", label: "Total assets", color: CAT[0], type: "bar" }, { key: "l", label: "Total liabilities", color: CAT[1], type: "bar" }, { key: "e", label: "Equity", color: C.ink, type: "line" }]} />
            )}
          </Elastic>
          <p className="brp-small">Stock is the P&L&apos;s closing stock; equity includes this year&apos;s un-closed earnings. Months before the books opened (no balance sheet) are left off the chart. No balance-sheet forecast is kept in the ERP, so none is drawn. Source: Forecasting › Dashboard balance sheet (Finance › Balance Sheet).</p>
        </>
      ))}
    </BrPage>
  );
}

export function CashFlowPage({ r }: P) {
  return (
    <BrPage title="Cash flow" kicker="Page 7 · Operating, investing, financing" month={r.monthLabel}>
      {withSection(r.cashFlow, (d) => {
        // Owner review 2026-11-10: a September report showed October and
        // November, and empty months before the books opened.
        // Owner review 2026-11-15: months before BOARD_DATA_FROM (May 26) are
        // crossed out, and the months after this one follow as forecast.
        const upTo = d.months.filter((x) => x.ym <= r.month && x.ym >= BOARD_DATA_FROM);
        const firstLive = upTo.findIndex((x) => x.operating || x.investing || x.financing || x.net);
        const shown = firstLive === -1 ? upTo : upTo.slice(firstLive);
        const m = shown.find((x) => x.ym === r.month) ?? shown[shown.length - 1] ?? d.months[d.months.length - 1];
        const fc = d.forecast ?? [];
        const cols = [...shown.slice(-6), ...fc];
        const head = (x: (typeof cols)[number]) => (x.kind === "forecast" ? `${x.label} F` : x.kind === "mtd" ? `${x.label}*` : x.label);
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
              <thead><tr><th>RM</th>{cols.map((x) => <th key={x.ym} className={x.kind === "forecast" ? "brp-fc" : undefined}>{head(x)}</th>)}</tr></thead>
              <tbody>
                {(["operating", "investing", "financing", "net", "fcf"] as const).map((k) => (
                  <tr key={k} className={k === "net" ? "strong" : ""}>
                    <td>{{ operating: "Operating", investing: "Investing", financing: "Financing", net: "Net cash flow", fcf: "Free cash flow" }[k]}</td>
                    {cols.map((x) => <td key={x.ym} className={x.kind === "forecast" ? "brp-fc" : undefined}><Money v={x[k]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Cash flow by month</h3>
            <Elastic>
              {(w, h) => (
                <ComboChart w={w} h={h}
                  data={[...shown, ...fc].map((x) => ({ label: head(x), faded: x.kind !== "actual", values: { o: x.operating, i: x.investing, f: x.financing, n: x.net } }))}
                  series={[
                    { key: "o", label: "Operating", color: CAT[0], type: "bar" },
                    { key: "i", label: "Investing", color: CAT[1], type: "bar" },
                    { key: "f", label: "Financing", color: CAT[2], type: "bar" },
                    { key: "n", label: "Net", color: C.ink, type: "line" },
                  ]} />
              )}
            </Elastic>
            <p className="brp-small">
              F = forecast, from Finance › Cash Flow with Forecast on: {fc.length === 0 ? "no forecast months are available after this one." : fc.map((x) => `${x.label} ${x.basis === "pnl" ? "P&L forecast" : "Docs forecast"}`).join(", ") + " (the P&L forecast where the month has one, else the Docs forecast)."}
              {" "}Free cash flow = operating − capex. Source: Forecasting › Dashboard cash flow (Finance › Cash Flow statement).
            </p>
          </>
        );
      })}
    </BrPage>
  );
}
