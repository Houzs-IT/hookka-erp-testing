// ---------------------------------------------------------------------------
// The New Customer card's form and what it saves (owner 2026-11-11 「而且我create
// customer 填的资料这么少罢了嘛？」 → 「做」, WORK-TRACKER 138).
//
// The card used to ask for 7 things; SSM No., company address and salesperson
// were only reachable through Edit afterwards, and the TIN / SST Reg. No. /
// e-Invoice ID through the customer's Onboarding / KYC block. Now one card
// takes them all:
//   - SSM No., company address, salesperson → the customer row (POST /api/customers);
//   - TIN / SST Reg. No. / e-Invoice ID → Onboarding / KYC
//     (PUT /api/customer-crm/onboarding), together with the consent tick.
// That PUT overwrites every column it stores, so the ids and the consent tick
// must travel in ONE request — a second PUT would blank what the first wrote.
// ---------------------------------------------------------------------------

export type NewCustomerForm = {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  creditTerms: string;
  creditLimitSen: number;
  ssmNo: string;
  companyAddress: string;
  salespersonUserId: string;
  tinNumber: string;
  sstRegNo: string;
  einvoiceId: string;
};

export const EMPTY_NEW_CUSTOMER: NewCustomerForm = {
  code: "",
  name: "",
  contactName: "",
  phone: "",
  email: "",
  creditTerms: "NET30",
  creditLimitSen: 0,
  ssmNo: "",
  companyAddress: "",
  salespersonUserId: "",
  tinNumber: "",
  sstRegNo: "",
  einvoiceId: "",
};

/** POST /api/customers body — the customer row's own fields; the KYC ids are not part of it. */
export function newCustomerCreateBody(f: NewCustomerForm, potential: boolean) {
  return {
    code: f.code,
    name: f.name,
    contactName: f.contactName,
    phone: f.phone,
    email: f.email,
    creditTerms: f.creditTerms,
    creditLimitSen: f.creditLimitSen,
    ssmNo: f.ssmNo.trim(),
    companyAddress: f.companyAddress.trim(),
    salespersonUserId: f.salespersonUserId,
    customerStage: potential ? "POTENTIAL" : "CONFIRMED",
  };
}

/**
 * The one Onboarding / KYC save after the customer exists, or null when there
 * is nothing to save (no id typed, no signed form uploaded).
 */
export function newCustomerOnboardingBody(
  customerId: string,
  f: Pick<NewCustomerForm, "tinNumber" | "sstRegNo" | "einvoiceId">,
  consentUploaded: boolean,
  today: string,
) {
  const tinNumber = f.tinNumber.trim();
  const sstRegNo = f.sstRegNo.trim();
  const einvoiceId = f.einvoiceId.trim();
  if (!tinNumber && !sstRegNo && !einvoiceId && !consentUploaded) return null;
  return {
    customerId,
    tinNumber,
    sstRegNo,
    einvoiceId,
    consentReceived: consentUploaded,
    consentDate: consentUploaded ? today : null,
  };
}
