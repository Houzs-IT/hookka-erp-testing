// ---------------------------------------------------------------------------
// e-invoice.ts — the e-Invoice record's shared rules (owner 2026-10-19 「1 做」:
// the design's MyInvois tracking).
//
// Nothing here talks to LHDN. The page builds the XML and keeps the record;
// the owner sends each invoice through MyInvois and keys back what MyInvois
// gave: the Submission ID, then the UUID (Valid) or the reason (Rejected).
// Nothing turns Valid without a UUID (BUG-2026-08-13-014: the old Submit
// button minted one).
// ---------------------------------------------------------------------------

export const E_INVOICE_STATUSES = ["PENDING", "SUBMITTED", "VALID", "INVALID", "REJECTED", "CANCELLED"] as const;
export type EInvoiceStatus = (typeof E_INVOICE_STATUSES)[number];

/** The Status column's name for each status. */
export const E_INVOICE_STATUS_NAME: Record<EInvoiceStatus, string> = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  VALID: "Valid",
  INVALID: "Invalid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** The "Where It Is" column: the status in words. */
export const E_INVOICE_WHERE: Record<EInvoiceStatus, string> = {
  PENDING: "XML ready · not sent",
  SUBMITTED: "Uploaded to MyInvois · waiting for LHDN",
  VALID: "LHDN validated",
  INVALID: "Failed our own check · not sent",
  REJECTED: "Rejected by LHDN",
  CANCELLED: "Cancelled",
};

export function isEInvoiceStatus(v: unknown): v is EInvoiceStatus {
  return (E_INVOICE_STATUSES as readonly string[]).includes(String(v));
}

/** The one step a record can take next: mark it submitted (not sent yet, or
 *  sent again after a fix), record LHDN's result, or cancel a valid one. */
export function eInvoiceNextStep(status: string): "mark" | "record" | "cancel" | null {
  if (status === "PENDING" || status === "INVALID" || status === "REJECTED") return "mark";
  if (status === "SUBMITTED") return "record";
  if (status === "VALID") return "cancel";
  return null;
}

export const MISSING_TIN_ON_GENERATE = "Buyer TIN missing — add it on the customer before you send it";
export const MISSING_TIN_ON_MARK = "Buyer TIN missing — add it on the customer, then mark it submitted";

/** Longest Submission ID / UUID kept, and longest rejection reason. MyInvois's
 *  own IDs are far shorter; anything longer is a paste of more than the ID. */
export const E_INVOICE_ID_MAX = 100;
export const E_INVOICE_REASON_MAX = 500;

/** The month (YYYY-MM, Malaysia time) a timestamp falls in; "" when unparseable. */
export function mytMonth(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  return new Date(t + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** The Dashboard's four cards: uploaded this month (with a MyInvois ID),
 *  validated, waiting (not sent yet + waiting for LHDN), invalid / rejected. */
export function eInvoiceKpis(
  rows: { status: string; submissionId?: string | null; submittedAt?: string | null }[],
  ym: string,
) {
  const n = (s: EInvoiceStatus) => rows.filter((r) => r.status === s).length;
  return {
    uploadedMtd: rows.filter((r) => !!r.submissionId && mytMonth(r.submittedAt) === ym).length,
    validated: n("VALID"),
    notSent: n("PENDING"),
    waitingLhdn: n("SUBMITTED"),
    invalidRejected: n("INVALID") + n("REJECTED"),
  };
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sen → "1234.50", whole-number arithmetic so no float drift. */
export function senToAmount(sen: number): string {
  const n = Math.round(Number(sen) || 0);
  const a = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** The seller block (Hookka's own registration). */
const SELLER = { tin: "C60515534080", brn: "202501060540", name: "HOOKKA INDUSTRIES SDN BHD" };

export type EInvoiceXmlInput = {
  invoiceNo: string;
  issueDate: string;
  buyerName: string;
  buyerTin: string;
  buyerBrn: string;
  subtotalSen: number;
  taxSen: number;
  totalSen: number;
};

/** The e-Invoice's UBL XML, built from the sales invoice as it stands. The
 *  tax is the invoice's own stored SST (category 01 when there is any, 06
 *  "not applicable" when there is none); a missing buyer TIN is written as
 *  missing, never replaced by another number. */
export function buildEInvoiceXml(x: EInvoiceXmlInput): string {
  const e = (s: string) => xmlEscape(String(s ?? ""));
  const amt = (sen: number) => `currencyID="MYR">${senToAmount(sen)}`;
  const pct = x.taxSen > 0 && x.subtotalSen > 0 ? Math.round((x.taxSen / x.subtotalSen) * 10000) / 100 : null;
  const brn = x.buyerBrn.trim();
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    `  <cbc:ID>${e(x.invoiceNo)}</cbc:ID>`,
    `  <cbc:IssueDate>${e(x.issueDate)}</cbc:IssueDate>`,
    `  <cbc:InvoiceTypeCode listVersionID="1.0">01</cbc:InvoiceTypeCode>`,
    `  <cbc:DocumentCurrencyCode>MYR</cbc:DocumentCurrencyCode>`,
    `  <cac:AccountingSupplierParty>`,
    `    <cac:Party>`,
    `      <cac:PartyIdentification><cbc:ID schemeID="TIN">${SELLER.tin}</cbc:ID></cac:PartyIdentification>`,
    `      <cac:PartyIdentification><cbc:ID schemeID="BRN">${SELLER.brn}</cbc:ID></cac:PartyIdentification>`,
    `      <cac:PartyLegalEntity><cbc:RegistrationName>${SELLER.name}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    `    </cac:Party>`,
    `  </cac:AccountingSupplierParty>`,
    `  <cac:AccountingCustomerParty>`,
    `    <cac:Party>`,
    `      <cac:PartyIdentification><cbc:ID schemeID="TIN">${x.buyerTin.trim() ? e(x.buyerTin.trim()) : "— MISSING —"}</cbc:ID></cac:PartyIdentification>`,
    ...(brn ? [`      <cac:PartyIdentification><cbc:ID schemeID="BRN">${e(brn)}</cbc:ID></cac:PartyIdentification>`] : []),
    `      <cac:PartyLegalEntity><cbc:RegistrationName>${e(x.buyerName.toUpperCase())}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    `    </cac:Party>`,
    `  </cac:AccountingCustomerParty>`,
    `  <cac:TaxTotal>`,
    `    <cbc:TaxAmount ${amt(x.taxSen)}</cbc:TaxAmount>`,
    `    <cac:TaxSubtotal>`,
    `      <cbc:TaxableAmount ${amt(x.subtotalSen)}</cbc:TaxableAmount>`,
    `      <cbc:TaxAmount ${amt(x.taxSen)}</cbc:TaxAmount>`,
    `      <cac:TaxCategory><cbc:ID>${x.taxSen > 0 ? "01" : "06"}</cbc:ID>${pct !== null ? `<cbc:Percent>${pct}</cbc:Percent>` : ""}</cac:TaxCategory>`,
    `    </cac:TaxSubtotal>`,
    `  </cac:TaxTotal>`,
    `  <cac:LegalMonetaryTotal>`,
    `    <cbc:TaxExclusiveAmount ${amt(x.subtotalSen)}</cbc:TaxExclusiveAmount>`,
    `    <cbc:TaxInclusiveAmount ${amt(x.totalSen)}</cbc:TaxInclusiveAmount>`,
    `    <cbc:PayableAmount ${amt(x.totalSen)}</cbc:PayableAmount>`,
    `  </cac:LegalMonetaryTotal>`,
    `</Invoice>`,
  ].join("\n");
}
