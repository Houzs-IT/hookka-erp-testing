// A credit note raised from a delivery return (owner 2026-10-17, Finance v2:
// "Credit / Debit Notes: create a Credit Note from a Delivery Return"). Pure
// pricing: each returned line is priced at what the invoice that billed its
// delivery order charged per unit — the invoice line's total (after its line
// discount) ÷ its quantity — matched by production order. The note goes on the
// invoice that billed most of the returned lines; a line billed elsewhere or
// never billed carries no price, for the user to fill in. Integer sen.

export type ReturnLine = { productionOrderId: string | null; productCode: string; productName: string; quantity: number };
export type InvoiceOfReturn = { id: string; invoiceNo: string; outstandingSen: number };
export type InvoiceLineOfReturn = { invoiceId: string; productionOrderId: string | null; quantity: number; totalSen: number };

export type ReturnCreditLine = { description: string; quantity: number; unitPriceSen: number | null };
export type ReturnCreditDraft = {
  invoice: InvoiceOfReturn | null;
  lines: ReturnCreditLine[];
  /** Σ quantity × price over the priced lines. */
  valueSen: number;
  unpriced: number;
};

export function priceReturnLines(
  lines: ReturnLine[],
  invoices: InvoiceOfReturn[],
  invoiceLines: InvoiceLineOfReturn[],
): ReturnCreditDraft {
  const known = new Set(invoices.map((i) => i.id));
  const linesByPo = new Map<string, InvoiceLineOfReturn[]>();
  for (const l of invoiceLines) {
    if (!l.productionOrderId || !known.has(l.invoiceId)) continue;
    const list = linesByPo.get(l.productionOrderId) ?? [];
    list.push(l);
    linesByPo.set(l.productionOrderId, list);
  }
  // The invoice that billed most of the returned lines carries the note.
  const hits = new Map<string, number>();
  for (const r of lines) {
    for (const l of (r.productionOrderId ? linesByPo.get(r.productionOrderId) : undefined) ?? []) {
      hits.set(l.invoiceId, (hits.get(l.invoiceId) ?? 0) + 1);
    }
  }
  const best = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const invoice = best ? invoices.find((i) => i.id === best) ?? null : null;
  const out: ReturnCreditLine[] = lines.map((r) => {
    const match = invoice && r.productionOrderId
      ? (linesByPo.get(r.productionOrderId) ?? []).find((l) => l.invoiceId === invoice.id && l.quantity > 0)
      : undefined;
    return {
      description: [r.productCode, r.productName].filter(Boolean).join(" "),
      quantity: r.quantity,
      unitPriceSen: match ? Math.round(match.totalSen / match.quantity) : null,
    };
  });
  return {
    invoice,
    lines: out,
    valueSen: out.reduce((s, l) => s + (l.unitPriceSen ?? 0) * l.quantity, 0),
    unpriced: out.filter((l) => l.unitPriceSen == null).length,
  };
}
