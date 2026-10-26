// HK-0113 — what the PO "Email to Supplier" button pre-fills into the Mail
// Center composer. Pure (no React, no jspdf) so the test can pin it; the
// caller builds the PDF and hands over its raw base64.
import { parseAddressList } from "../api/lib/mail-threading";
import { decodedBase64Bytes } from "../api/lib/mail-attachments";

export type PoEmailDraft = {
  to: string[];
  subject: string;
  body: string;
  attachments: { name: string; type: string; size: number; contentBase64: string }[];
};

export function buildPoEmailDraft(args: {
  poNo: string;
  supplierName: string;
  supplierEmail: string | null | undefined;
  // The letterhead the PDF prints under (HOOKKA / OHANA / sister co), so an
  // OHANA PO is not announced as coming "from Hookka".
  companyName: string;
  pdfBase64: string;
}): PoEmailDraft | null {
  const to = parseAddressList(args.supplierEmail ?? "");
  if (to.length === 0) return null;
  const subject = `Purchase Order ${args.poNo} from ${args.companyName}`;
  const body = [
    `Dear ${args.supplierName || "Sir/Madam"},`,
    "",
    `Please find attached Purchase Order ${args.poNo} for your processing.`,
    "Kindly confirm receipt and let us know your expected ship date.",
    "",
    "Thank you.",
    "",
    args.companyName,
  ].join("\n");
  return {
    to,
    subject,
    body,
    attachments: [
      {
        name: `${args.poNo}.pdf`,
        type: "application/pdf",
        size: decodedBase64Bytes(args.pdfBase64),
        contentBase64: args.pdfBase64,
      },
    ],
  };
}
