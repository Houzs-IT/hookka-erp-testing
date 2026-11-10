// Board Report appendices — the full statements, split into A4 pages:
//   A  Monthly P&L          (GET /api/accounting/pl-monthly?anchor=M)
//   B  Balance sheet        (GET /api/accounting/pl?period=M and M-1)
//   C  Cash flow statement  (GET /api/accounting/cashflow-statement?period=M)
// Each page holds at most ROWS_PER_PAGE rows, so a long statement flows onto
// as many pages as it needs instead of overflowing one.
import type { BoardReport, Section, TableBlock } from "@/lib/board-report";
import { paginate } from "@/lib/board-report";
import { BrPage, Money, Unavailable } from "./page-kit";

const ROWS_PER_PAGE = 46;

function Statement({ letter, title, month, block, note }: { letter: string; title: string; month: string; block: Section<TableBlock & { title?: string }>; note: string }) {
  if (!block.ok) {
    return (
      <BrPage title={title} kicker={`Appendix ${letter}`} month={month} className="brp-appendix">
        <Unavailable error={block.error} />
      </BrPage>
    );
  }
  const pages = paginate(block.data.rows, ROWS_PER_PAGE);
  return (
    <>
      {pages.map((rows, i) => (
        <BrPage
          key={i}
          title={`${title}${block.data.title ? ` — ${block.data.title}` : ""}`}
          kicker={`Appendix ${letter}${pages.length > 1 ? ` · ${i + 1} of ${pages.length}` : ""}`}
          month={month}
          className="brp-appendix"
        >
          <table className="brp-table statement">
            <thead><tr><th>RM</th>{block.data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={`${i}-${j}`} className={r.strong ? "strong" : ""}>
                  <td style={{ paddingLeft: `${4 + r.depth * 10}px` }}>{r.label}</td>
                  {r.values.map((v, k) => <td key={k}>{v === null ? "" : <Money v={v} />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {i === pages.length - 1 && <p className="brp-small">{note}</p>}
        </BrPage>
      ))}
    </>
  );
}

export function Appendices({ r }: { r: BoardReport }) {
  return (
    <>
      <Statement letter="A" title="Monthly P&L" month={r.monthLabel} block={r.appendixPl} note="Source: Finance › Monthly P&L. The last six months to this one, then the financial year to date." />
      <Statement letter="B" title="Balance sheet" month={r.monthLabel} block={r.appendixBs} note="Source: Finance › Balance Sheet, by account, this month end against last month end." />
      <Statement letter="C" title="Cash flow statement" month={r.monthLabel} block={r.appendixCf} note="Source: Finance › Cash Flow (cash basis, bank-true). The last six months to this one, then the financial year to date." />
    </>
  );
}
