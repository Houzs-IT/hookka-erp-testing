// Shared one-page voucher renderer for the three accounting documents that
// print as a physical voucher: Payment Voucher (PV), Official Receipt (OR) and
// Journal Voucher (JV). The three tabs in src/pages/accounting/index.tsx map
// their already-loaded data → a VoucherSpec and call printVoucher(spec); this
// module owns the single inline-HTML + window.print() implementation so the
// layout stays identical across all three.
//
// Mirrors the existing browser-print pattern (printStmt in accounting/index):
//   const w = window.open("", "_blank"); w.document.write(html); w.print();
//
// Pure-ish: building the HTML string is side-effect-free (buildVoucherHtml);
// only printVoucher touches window. Money is integer sen — the caller passes a
// formatMoney(sen) (the app's formatCurrency) so this file never imports the
// money formatter and never does float math.
//
// Layout (owner 2026-10-17, 「1a 但是签名那边我要1b」): the Finance v2 print
// design's option 1a — logo + company on one line, the party with its details
// on the left and the amount boxed on the right, the lines, an optional
// balance strip — with option 1b's boxed signatures and a bottom line carrying
// the document number and the print date. Every block a document has no data
// for is simply not printed.

export type VoucherColumn = {
  label: string;
  /** Cell alignment; amounts are "right". Defaults to "left". */
  align?: "left" | "right";
};

export type VoucherLine = {
  /** One cell per column, already stringified by the caller. */
  cells: string[];
};

/** A labelled value on the voucher ("Paid from" → "310-0010 · Maybank"). */
export type VoucherFact = { label: string; value: string };

/** The logo every voucher prints unless its company block names another one. */
export const VOUCHER_LOGO_SRC = "/hookka-logo.png";

export type VoucherSignature = {
  label: string;
  /** Who signed and when (approval ladder) — printed under the line. */
  name?: string;
  on?: string;
};

export type VoucherSpec = {
  /** Document title, e.g. "PAYMENT VOUCHER". */
  title: string;
  company: {
    name: string;
    addressLines: readonly string[];
    regNo: string;
    tin: string;
    phone: string;
    email: string;
    /** Logo printed beside the company name; defaults to the app's own logo. */
    logoSrc?: string;
  };
  docNo: string;
  date: string;
  /** Party block, e.g. label "Pay To" + name "<payee>". */
  partyLabel: string;
  partyName: string;
  /** Lines under the party name, e.g. "Paid from" / "Payee bank"; an empty value is skipped. */
  partyDetails?: VoucherFact[];
  /** The amount boxed beside the party, e.g. "Amount paid"; the amount in words prints inside it. */
  amountBox?: VoucherFact;
  /** One row of document facts under the party block, e.g. Bill no. / Bill date; an empty value is skipped. */
  facts?: VoucherFact[];
  /** Figures in a strip under the lines, e.g. a supplier's balance before / this payment / after. */
  balanceStrip?: VoucherFact[];
  columns: VoucherColumn[];
  lines: VoucherLine[];
  /** A note printed under the table, e.g. "Paid from: 310-0010 · Maybank". */
  footerNote?: string;
  /** Pre-formatted total cells aligned under `columns`; omit to skip the row. */
  totalCells?: string[];
  /** Amount in words (PV / OR only). */
  amountWords?: string;
  remarks?: string;
  signatures: VoucherSignature[];
  /** ISO date the document is printed on; shown in the footer. */
  printedOn: string;
  /** Diagonal watermark across the sheet ("DRAFT", "NOT YET APPROVED", "CANCELLED"). */
  watermark?: string;
  /** Sub-table printed under the lines, e.g. the bills this payment settled. */
  detail?: { heading: string; columns: VoucherColumn[]; lines: VoucherLine[] };
  /** Multi-line footer text (payment details / terms) — printed above the signatures; empty = not printed. */
  footerText?: string;
  /**
   * Print bundle (Houzs adoption, 2026-09-22): the voucher's attachments,
   * each page an image data-URL, printed AFTER the voucher on their own A4
   * pages with a small caption. The caller composes this from the stored
   * files (images as-is, PDFs rendered page by page) and refuses to print
   * when any attachment fails to load — a bundle never silently omits one.
   */
  appendix?: { title: string; pages: string[] }[];
};

// Minimal HTML-escape for any value interpolated into the voucher. Document
// fields (payee, descriptions, account names) are user-entered, so escape them
// to keep the printed page well-formed and injection-free.
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRow(cells: string[], columns: VoucherColumn[], tag: "td" | "th", extraCls = ""): string {
  return cells
    .map((c, i) => {
      const align = columns[i]?.align === "right" ? "right" : "left";
      const cls = `${extraCls} align-${align}`.trim();
      return `<${tag} class="${cls}">${escapeHtml(c)}</${tag}>`;
    })
    .join("");
}

const VOUCHER_STYLES = `
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12px; color: #1F1D1B; margin: 0; }
  .sheet { position: relative; max-width: 720px; margin: 0 auto; min-height: 266mm; display: flex; flex-direction: column; page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .head { display: flex; align-items: flex-start; gap: 18px; padding-bottom: 14px; border-bottom: 2px solid #1F1D1B; }
  .logo { height: 58px; width: auto; flex-shrink: 0; }
  .co { flex: 1; min-width: 0; padding-top: 4px; }
  .co-name { font-size: 14px; font-weight: 700; letter-spacing: 0.3px; }
  .co-meta { font-size: 10px; color: #6B6B6B; line-height: 1.55; }
  .title { text-align: right; flex-shrink: 0; }
  .title h1 { font-size: 19px; font-weight: 700; margin: 0; letter-spacing: 1.5px; }
  table.doc-meta { width: auto; margin: 6px 0 0 auto; border-collapse: collapse; }
  .doc-meta td { border: none; padding: 1px 0; font-size: 11px; }
  .doc-meta td.k { color: #6B6B6B; padding-right: 10px; text-align: left; }
  .doc-meta td.no { font-weight: 700; font-size: 12.5px; }
  .doc-meta td.v { font-weight: 600; }
  .party-row { display: grid; grid-template-columns: 1fr 260px; gap: 20px; margin-top: 18px; }
  .party-row.solo { grid-template-columns: 1fr; }
  .party-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #6B6B6B; text-transform: uppercase; }
  .party-name { font-size: 19px; font-weight: 700; margin-top: 3px; line-height: 1.25; }
  .party-details { margin-top: 8px; font-size: 11px; color: #6B6B6B; line-height: 1.6; }
  .party-details b, .facts b { color: #1F1D1B; }
  .amount-box { border: 1.5px solid #1F1D1B; border-radius: 6px; padding: 12px 14px; align-self: start; }
  .amount-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #6B6B6B; text-transform: uppercase; }
  .amount-value { font-size: 26px; font-weight: 800; margin-top: 4px; letter-spacing: 0.3px; font-variant-numeric: tabular-nums; }
  .amount-words { font-size: 10.5px; color: #6B6B6B; margin-top: 4px; line-height: 1.4; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 10px; font-size: 11px; color: #6B6B6B; }
  table { border-collapse: collapse; width: 100%; }
  table.lines { margin-top: 16px; }
  th { background: #F7F4EF; border-top: 1px solid #C9C2B8; border-bottom: 1px solid #C9C2B8; padding: 7px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  td { border-bottom: 1px solid #E3DED6; padding: 7px 8px; font-size: 11.5px; vertical-align: top; }
  .align-left { text-align: left; }
  .align-right { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total-row td { border-top: 2px solid #1F1D1B; border-bottom: none; }
  .total-cell { font-weight: 700; font-size: 13px; padding-top: 8px; }
  .footer-note { margin-top: 8px; font-size: 11px; color: #333; }
  .detail-head { margin-top: 14px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6B6B6B; }
  .detail { margin-top: 4px; }
  .detail th { font-size: 9.5px; }
  .detail td { font-size: 11px; padding: 5px 8px; }
  .balance { display: grid; margin-top: 16px; border: 1px solid #E3DED6; border-radius: 6px; overflow: hidden; }
  .bal { padding: 9px 12px; }
  .bal + .bal { border-left: 1px solid #E3DED6; }
  .bal:nth-child(odd) { background: #F7F4EF; }
  .bal-label { font-size: 10px; color: #6B6B6B; }
  .bal-value { font-size: 14px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .words { margin-top: 12px; font-size: 11.5px; padding: 8px 10px; background: #FAF8F5; border: 1px solid #ECE7E0; border-radius: 4px; }
  .words-label, .remarks-label { font-weight: 700; }
  .remarks { margin-top: 14px; font-size: 11px; line-height: 1.5; }
  .footer-text { margin-top: 8px; font-size: 10px; color: #555; white-space: pre-wrap; border-top: 1px dashed #D8D3CE; padding-top: 8px; }
  .sigs { display: grid; gap: 12px; margin-top: 40px; }
  .sig { border: 1px solid #E3DED6; border-radius: 8px; padding: 8px 10px; height: 92px; display: flex; flex-direction: column; }
  .sig-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; color: #6B6B6B; text-transform: uppercase; }
  .sig-name { margin-top: auto; font-size: 11px; font-weight: 600; }
  .sig-on { font-size: 9px; color: #888; }
  .sig-name + .sig-on { margin-top: 0; }
  .sig-label + .sig-on { margin-top: auto; }
  .bottom { margin-top: auto; padding-top: 18px; display: flex; justify-content: space-between; gap: 16px; font-size: 9px; color: #9A9A9A; }
  .wm { position: absolute; left: 0; right: 0; top: 42%; text-align: center; font-size: 76px; font-weight: 800; letter-spacing: 6px; color: rgba(154, 58, 45, 0.12); transform: rotate(-24deg); pointer-events: none; user-select: none; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .sheet.appendix { display: block; min-height: 0; }
  .appendix-title { font-size: 10.5px; color: #555; border-bottom: 1px solid #E6E1DA; padding-bottom: 4px; margin-bottom: 8px; }
  .appendix img { display: block; max-width: 100%; max-height: 240mm; margin: 0 auto; object-fit: contain; }
`;

// "Label <b>value</b>" pieces, skipping facts with nothing to show.
const shown = (facts: VoucherFact[] | undefined): VoucherFact[] => (facts ?? []).filter((f) => f.value && f.value.trim());
const factHtml = (f: VoucherFact) => `${escapeHtml(f.label)} <b>${escapeHtml(f.value)}</b>`;

// One A4 page per attachment page, captioned "Attachment i of n — name (page p/q)".
function buildAppendixSheets(spec: VoucherSpec): string {
  const items = spec.appendix ?? [];
  return items
    .map((att, i) =>
      att.pages
        .map(
          (src, p) =>
            `<div class="sheet appendix"><div class="appendix-title">${escapeHtml(spec.docNo)} · Attachment ${i + 1} of ${items.length} — ${escapeHtml(att.title)}${att.pages.length > 1 ? ` (page ${p + 1}/${att.pages.length})` : ""}</div><img src="${escapeHtml(src)}" alt="${escapeHtml(att.title)}"/></div>`,
        )
        .join(""),
    )
    .join("");
}

/**
 * Build the inner .sheet HTML for a single voucher (no <html>/<head>/<body>
 * wrapper). Pure: no window/DOM access. Used by buildVoucherHtml and
 * buildVouchersDocument.
 */
export function buildVoucherSheet(spec: VoucherSpec): string {
  const co = spec.company;
  const addr = co.addressLines.map((l) => l.trim().replace(/,$/, "")).filter(Boolean).map((l) => escapeHtml(l)).join(", ");

  const headRow = `<tr>${renderRow(spec.columns.map((c) => c.label), spec.columns, "th")}</tr>`;
  const bodyRows = spec.lines
    .map((ln) => `<tr>${renderRow(ln.cells, spec.columns, "td")}</tr>`)
    .join("");
  const totalRow = spec.totalCells
    ? `<tr class="total-row">${renderRow(spec.totalCells, spec.columns, "td", "total-cell")}</tr>`
    : "";

  const footerNote = spec.footerNote
    ? `<div class="footer-note">${escapeHtml(spec.footerNote)}</div>`
    : "";

  // With an amount box the words sit inside it; without one they keep their own line.
  const amountBox = spec.amountBox
    ? `<div class="amount-box"><div class="amount-label">${escapeHtml(spec.amountBox.label)}</div><div class="amount-value">${escapeHtml(spec.amountBox.value)}</div>${spec.amountWords ? `<div class="amount-words">${escapeHtml(spec.amountWords)}</div>` : ""}</div>`
    : "";
  const wordsBlock = spec.amountWords && !spec.amountBox
    ? `<div class="words"><span class="words-label">Amount in words:</span> ${escapeHtml(spec.amountWords)}</div>`
    : "";

  const remarksBlock = spec.remarks
    ? `<div class="remarks"><span class="remarks-label">Remarks:</span> ${escapeHtml(spec.remarks)}</div>`
    : "";

  const partyDetails = shown(spec.partyDetails);
  const detailsBlock = partyDetails.length ? `<div class="party-details">${partyDetails.map(factHtml).join("<br/>")}</div>` : "";
  const facts = shown(spec.facts);
  const factsBlock = facts.length ? `<div class="facts">${facts.map((f) => `<span>${factHtml(f)}</span>`).join("")}</div>` : "";
  const strip = shown(spec.balanceStrip);
  const stripBlock = strip.length
    ? `<div class="balance" style="grid-template-columns:repeat(${strip.length},1fr)">${strip.map((f) => `<div class="bal"><div class="bal-label">${escapeHtml(f.label)}</div><div class="bal-value">${escapeHtml(f.value)}</div></div>`).join("")}</div>`
    : "";

  // Boxed signatures (design 1b): the label on top, who signed and when at the foot.
  const sigCols = spec.signatures
    .map(
      (s) =>
        `<div class="sig"><div class="sig-label">${escapeHtml(s.label)}</div>${s.name ? `<div class="sig-name">${escapeHtml(s.name)}</div>` : ""}${s.on ? `<div class="sig-on">${escapeHtml(s.on)}</div>` : ""}</div>`,
    )
    .join("");

  const detailBlock = spec.detail && spec.detail.lines.length
    ? `<div class="detail-head">${escapeHtml(spec.detail.heading)}</div>
  <table class="detail">
    <thead><tr>${renderRow(spec.detail.columns.map((c) => c.label), spec.detail.columns, "th")}</tr></thead>
    <tbody>${spec.detail.lines.map((ln) => `<tr>${renderRow(ln.cells, spec.detail!.columns, "td")}</tr>`).join("")}</tbody>
  </table>`
    : "";

  const wm = spec.watermark ? `<div class="wm">${escapeHtml(spec.watermark)}</div>` : "";
  const footerText = spec.footerText && spec.footerText.trim() ? `<div class="footer-text">${escapeHtml(spec.footerText.trim())}</div>` : "";
  const logo = co.logoSrc ?? VOUCHER_LOGO_SRC;

  return `<div class="sheet">
  ${wm}
  <div class="head">
    ${logo ? `<img class="logo" src="${escapeHtml(logo)}" alt=""/>` : ""}
    <div class="co">
      <div class="co-name">${escapeHtml(co.name)}</div>
      <div class="co-meta">${addr}<br/>Reg No: ${escapeHtml(co.regNo)} · TIN: ${escapeHtml(co.tin)} · Tel: ${escapeHtml(co.phone)} · ${escapeHtml(co.email)}</div>
    </div>
    <div class="title">
      <h1>${escapeHtml(spec.title)}</h1>
      <table class="doc-meta"><tr><td class="k">No.</td><td class="no">${escapeHtml(spec.docNo)}</td></tr><tr><td class="k">Date</td><td class="v">${escapeHtml(spec.date)}</td></tr></table>
    </div>
  </div>
  <div class="party-row${amountBox ? "" : " solo"}">
    <div>
      <div class="party-label">${escapeHtml(spec.partyLabel)}</div>
      <div class="party-name">${escapeHtml(spec.partyName || "—")}</div>
      ${detailsBlock}
    </div>
    ${amountBox}
  </div>
  ${factsBlock}
  <table class="lines">
    <thead>${headRow}</thead>
    <tbody>${bodyRows}${totalRow}</tbody>
  </table>
  ${footerNote}
  ${detailBlock}
  ${stripBlock}
  ${wordsBlock}
  ${remarksBlock}
  ${footerText}
  <div class="sigs" style="grid-template-columns:repeat(${Math.max(1, spec.signatures.length)},1fr)">${sigCols}</div>
  <div class="bottom"><span>${escapeHtml(spec.docNo)} · computer-generated voucher</span><span>Printed on ${escapeHtml(spec.printedOn)}</span></div>
</div>${buildAppendixSheets(spec)}`;
}

/**
 * Build the full standalone HTML document for a voucher. Pure: no window/DOM
 * access, so it can be unit-tested. printVoucher() wraps this with the
 * window.open/print side effects.
 */
export function buildVoucherHtml(spec: VoucherSpec): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(spec.title)} — ${escapeHtml(spec.docNo)}</title>
<style>${VOUCHER_STYLES}</style></head>
<body>${buildVoucherSheet(spec)}</body></html>`;
}

// One standalone HTML document holding N vouchers, each on its own A4 page.
export function buildVouchersDocument(specs: VoucherSpec[]): string {
  const title = specs.length === 1 ? `${escapeHtml(specs[0].title)} — ${escapeHtml(specs[0].docNo)}` : `Vouchers (${specs.length})`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${title}</title>
<style>${VOUCHER_STYLES}</style></head>
<body>${specs.map(buildVoucherSheet).join("")}</body></html>`;
}

// Open a window with all the vouchers and trigger the print dialog
// (print to paper, or "Save as PDF"). Mirrors printVoucher().
export function printVouchers(specs: VoucherSpec[]): void {
  if (specs.length === 0) return;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(buildVouchersDocument(specs));
  w.document.close();
  w.focus();
  // A bundle carries attachment images — let every one decode before the
  // dialog opens, or a slow page prints blank. No images = print at once.
  const imgs = Array.from(w.document.images);
  const pending = imgs.filter((im) => !im.complete);
  if (pending.length === 0) { w.print(); return; }
  let left = pending.length;
  let fired = false;
  const go = () => { if (!fired) { fired = true; w.print(); } };
  for (const im of pending) {
    const done = () => { left -= 1; if (left <= 0) go(); };
    im.addEventListener("load", done, { once: true });
    im.addEventListener("error", done, { once: true });
  }
  w.setTimeout(go, 8000);
}

/**
 * Open a new window, write the voucher HTML and trigger the browser print
 * dialog — the established pattern in this codebase (see printStmt).
 */
export function printVoucher(spec: VoucherSpec): void { printVouchers([spec]); }
