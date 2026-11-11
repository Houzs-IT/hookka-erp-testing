// ---------------------------------------------------------------------------
// ConsentFormDownloads — the two blank consent-form downloads (owner
// 2026-11-11 「下载pdf, word 按钮明显一点可以吗？」). Solid brand buttons that name
// the file type; the small bordered links before were easy to miss. Shared by
// the New Customer card (src/pages/customers.tsx) and the customer's
// Onboarding / KYC panel (KycPanel.tsx).
// ---------------------------------------------------------------------------
import { FileDown } from "lucide-react";
import { CONSENT_FORM_DOCX, CONSENT_FORM_PDF } from "@/lib/customer-consent";

const BUTTON =
  "inline-flex items-center gap-2 rounded-md bg-[#6B5C32] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#4D4224] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32] focus-visible:ring-offset-2";

export function ConsentFormDownloads() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={CONSENT_FORM_PDF} download className={BUTTON}>
        <FileDown className="h-4 w-4" /> Download PDF
      </a>
      <a href={CONSENT_FORM_DOCX} download className={BUTTON}>
        <FileDown className="h-4 w-4" /> Download Word
      </a>
    </div>
  );
}
