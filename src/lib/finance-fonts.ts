// ---------------------------------------------------------------------------
// finance-fonts.ts — the finance pages' type (owner 2026-10-14, palette E):
// Inter for text and figures, Montserrat for titles and small capital labels
// (finance-ui.css). Added the first time a finance page opens, so the rest of
// the app — the worker portal on the factory wifi among it — never fetches
// them; the browser downloads a face only once a page uses it. Loaded the
// way index.html loads JetBrains Mono (Google Fonts). Display only.
// ---------------------------------------------------------------------------

export const FINANCE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700&display=swap";

export function ensureFinanceFonts(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc || doc.getElementById("fin-fonts")) return;
  const link = doc.createElement("link");
  link.id = "fin-fonts";
  link.rel = "stylesheet";
  link.href = FINANCE_FONTS_HREF;
  doc.head.appendChild(link);
}
