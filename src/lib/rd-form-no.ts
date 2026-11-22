// R&D Spec Form number (plan D11): RD-<code>-<YYMMDD> - one form per product
// per day, short enough to write and read on paper. Pure; shared by the PDF
// and the costing editor's "came from an R&D form" record.
export function rdFormNo(code: string, ymd: string): string {
  return `RD-${code.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}-${ymd.replace(/-/g, "").slice(2, 8)}`;
}
