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

/**
 * The price-list items one production order is paid by. A sofa is priced per
 * module, so its product code is the item. A bedframe is priced per sewn WIP:
 * the list has "1013-(Q) -HB" and "Divan- 5FT", and no row for "1013-(Q)".
 */
export function pieceItemsForOrder(productCode: string, sewWipLabels: readonly string[]): string[] {
  const code = pieceItemCode(productCode);
  const items = new Set<string>();
  for (const label of sewWipLabels) {
    if (/ -HB\b/.test(label)) items.add(`${code}-HB`);
    const divan = /Divan-\s*(\S+)/.exec(label);
    if (divan) items.add(pieceItemCode(`Divan-${divan[1]}`));
  }
  return items.size > 0 ? [...items] : [code];
}

/** One unit's rate: every item must be priced, or the order has no rate. */
export function orderRate(
  items: readonly string[],
  rates: ReadonlyMap<string, number>,
): { rateSen: number | null; missing: string[] } {
  const missing = items.filter((item) => !rates.has(item));
  if (missing.length > 0) return { rateSen: null, missing };
  return { rateSen: items.reduce((sum, item) => sum + (rates.get(item) as number), 0), missing };
}

/** Both integers, so no rounding can happen here. */
export function pieceAmountSen(quantity: number, rateSen: number): number {
  return quantity * rateSen;
}

/**
 * An uploaded price list as text for the rate box, so it is read and checked
 * like a paste. Item is the first column, price the last number on the row:
 * Violet's sheet carries minutes and working columns before the price. The
 * price rounds like Excel shows it (13.5375 -> 13.54); toFixed alone gives 13.53.
 */
export function priceListText(rows: readonly (readonly unknown[])[]): string {
  const lines: string[] = [];
  rows.forEach((row, i) => {
    if (i === 0 && typeof row[1] !== "number") return;
    const item = String(row[0] ?? "").trim();
    const numbers = row.slice(1).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!item || numbers.length === 0) return;
    const sen = Math.round(Number((numbers[numbers.length - 1] * 100).toFixed(6)));
    lines.push(`${item}\t${(sen / 100).toFixed(2)}`);
  });
  return lines.join("\n");
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
