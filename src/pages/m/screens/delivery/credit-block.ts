// Shape of the credit-control block a delivery-order API call can answer with, plus the guard
// that recognises it. Local to mobile on purpose: the desktop override dialog and the server
// enforcement (src/pages/delivery/credit-override.tsx) are not on main yet, so on main this
// guard never matches and the mobile credit-override paths stay dormant. When that feature
// lands, re-point the imports in this folder at "@/pages/delivery/credit-override".
type OverdueRow = { invoiceNo: string; dueDate: string; balanceSen: number };

export type CreditBlockBody = {
  code?: string;
  error?: string;
  overrideAllowed?: boolean;
  details?: {
    overdue?: OverdueRow[];
    overdueSen?: number;
    limit?: number;
    outstanding?: number;
    pendingDo?: number;
    doTotal?: number;
    projected?: number;
  };
};

export function isCreditBlock(body: unknown): body is CreditBlockBody {
  const code = (body as CreditBlockBody | null)?.code;
  return code === "CREDIT_LIMIT_EXCEEDED" || code === "PAYMENT_OVERDUE";
}
