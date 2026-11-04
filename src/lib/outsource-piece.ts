// ---------------------------------------------------------------------------
// outsource-piece.ts — the pure half of outsource piece-rate pay (HK-0130).
// Shared by the API and the Employees tab, so the code a rate is saved under
// and the code an order looks it up by can never drift apart.
// ---------------------------------------------------------------------------

/**
 * The rate key for a product code. Violet's price list has no side: "5530-2A"
 * prices both 5530-2A(LHF) and 5530-2A(RHF).
 */
export function pieceItemCode(productCode: string): string {
  return (productCode ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\((LHF|RHF|L|R)\)$/, "");
}

/** Both integers, so no rounding can happen here. */
export function pieceAmountSen(quantity: number, rateSen: number): number {
  return quantity * rateSen;
}

export type ParsedRate = { itemCode: string; rateSen: number };

/**
 * Rate list pasted from Excel, one "5530-1A  24.07" per line. A bad line is
 * reported, never skipped: a silently missing rate is an order nobody can
 * import, and a silently wrong one is a wrong wage.
 */
export function parseRateLines(text: string): { rates: ParsedRate[]; errors: string[] } {
  const byCode = new Map<string, number>();
  const errors: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)[\s,]+(?:RM\s*)?(\d+(?:\.\d{1,2})?)$/i.exec(line);
    const itemCode = m ? pieceItemCode(m[1]) : "";
    const rateSen = m ? Math.round(Number(m[2]) * 100) : 0;
    if (!itemCode || rateSen <= 0) {
      errors.push(`Cannot read: ${line}`);
      continue;
    }
    const seen = byCode.get(itemCode);
    if (seen !== undefined && seen !== rateSen) {
      errors.push(`${itemCode} is listed twice with different rates`);
      continue;
    }
    byCode.set(itemCode, rateSen);
  }
  return { rates: [...byCode].map(([itemCode, rateSen]) => ({ itemCode, rateSen })), errors };
}
