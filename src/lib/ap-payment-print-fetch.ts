// Loads an AP payment's print detail (GET /api/accounting/ap-payment-print) for
// the voucher print — the bills with their dates and balances before, and the
// party's balance before (owner 2026-10-17, print design 1a). null when it
// cannot be loaded: the voucher then prints without it, never not at all.
import type { ApPrintDetail } from "@/lib/ap-payment-print";

export async function fetchApPrintDetail(paymentNo: string): Promise<ApPrintDetail | null> {
  try {
    const res = await fetch(`/api/accounting/ap-payment-print?paymentNo=${encodeURIComponent(paymentNo)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { success?: boolean; data?: ApPrintDetail };
    return j?.success && j.data ? j.data : null;
  } catch {
    return null;
  }
}
