// ---------------------------------------------------------------------------
// Customer consent form (owner 2026-11-11, WORK-TRACKER 134: 「加新的customer
// 时可以下载consent form 给顾客填，填了后upload 会上去」). The blank form is the
// owner's sample — the CTOS / CCRIS "Consent Authorisation" letter to Hookka
// and CTOS — shipped as PDF (for print) and Word under public/forms/. The
// signed copy is a file on the customer (resourceType CUSTOMER_CONSENT), gated
// like the customer in src/lib/flow-files.ts because it carries IC and phone
// numbers. Shown in the customer's Onboarding / KYC panel and offered when a
// customer is created.
// ---------------------------------------------------------------------------
import { uploadFileAsset, type UploadResult } from "./upload-file";

export const CUSTOMER_CONSENT_TYPE = "CUSTOMER_CONSENT";
export const CONSENT_FORM_PDF = "/forms/hookka-ctos-consent-form.pdf";
export const CONSENT_FORM_DOCX = "/forms/hookka-ctos-consent-form.docx";

/** Attach a signed consent form to a customer (POST /api/files, size-checked and read back). */
export function uploadConsentForm(customerId: string, file: File): Promise<UploadResult> {
  return uploadFileAsset({ file, resourceType: CUSTOMER_CONSENT_TYPE, resourceId: customerId });
}
