// ===========================================================================
// DO writes for the phone Delivery screens — the SAME calls desktop makes:
//   • single status change   → PUT /api/delivery-orders/:id {status} + a
//     no-store read-back (verifiedSave), as detail.tsx advanceStatus;
//   • proof of delivery      → PUT {proofOfDelivery[, status:"DELIVERED"]},
//     as detail.tsx handleSubmitPOD;
//   • paperwork complete     → POST /:id/resolve-incomplete, as detail.tsx;
//   • lorry                  → PUT {lorryId}, as detail.tsx assignLorry;
//   • bulk dispatch/deliver  → one PUT per DO, SEQUENTIALLY, with the credit
//     override retry, as index.tsx runBulkDoTransition;
//   • customer notice        → src/lib/delivery-customer-notice.ts, after a
//     successful move to LOADED / DELIVERED, as index.tsx does.
// Nothing here decides a business rule; lib/do-mobile.ts says which action is
// offered, the server decides whether it is allowed.
// ===========================================================================
import { verifiedSave, formatMismatchError } from "@/lib/verified-save";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { isCreditBlock, type CreditBlockBody } from "@/pages/delivery/credit-override";
import { sendCustomerNotice, type NoticeRow } from "@/lib/delivery-customer-notice";
import type { ProofOfDelivery } from "@/types";
import { acceptedAfter, rows, s, type BulkTarget, type DOStatus, type RawRow } from "../../lib/do-mobile";

export type AskCredit = (body: CreditBlockBody) => Promise<string | null>;
export type WriteResult = { ok: true; data: RawRow | null; warning?: string } | { ok: false; error: string };

/** Drop every cache the DO cascade touches (DO lists, invoices, SOs, POs, PLs). */
export function refreshDeliveryCaches(): void {
  for (const p of ["/api/delivery-orders", "/api/invoices", "/api/sales-orders", "/api/production-orders", "/api/packing-lists"]) {
    invalidateCachePrefix(p);
  }
}

async function readDo(id: string): Promise<RawRow | null> {
  const r = await fetch(`/api/delivery-orders/${encodeURIComponent(id)}?_v=${Date.now()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: RawRow } | RawRow;
  return ((j as { data?: RawRow }).data ?? (j as RawRow)) || null;
}

function errorFromBody(body: string, fallback: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* keep raw */
  }
  return body || fallback;
}

/** PUT + read-back, retried once with creditOverride when the server asks. */
async function verifiedPut(
  id: string,
  body: Record<string, unknown>,
  expect: Record<string, unknown>,
  askCredit: AskCredit,
  failLabel: string,
): Promise<WriteResult> {
  const run = (b: Record<string, unknown>) =>
    verifiedSave<RawRow>({
      endpoint: `/api/delivery-orders/${encodeURIComponent(id)}`,
      method: "PUT",
      body: b,
      readback: () => readDo(id),
      expect,
    });
  let result = await run(body);
  if (!result.ok && result.reason === "http" && (result.status === 409 || result.status === 403)) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }
    if (isCreditBlock(parsed)) {
      const reason = await askCredit(parsed);
      if (!reason) return { ok: false, error: "" };
      result = await run({ ...body, creditOverride: { reason } });
    }
  }
  if (result.ok) return { ok: true, data: result.data };
  if (result.reason === "unverified") return { ok: true, data: null, warning: result.details };
  if (result.reason === "mismatch") return { ok: false, error: formatMismatchError(result.diffs) };
  if (result.reason === "http") return { ok: false, error: errorFromBody(result.body, `${failLabel} (HTTP ${result.status})`) };
  return { ok: false, error: `Save failed: ${result.details}` };
}

export function putStatus(id: string, target: DOStatus, askCredit: AskCredit): Promise<WriteResult> {
  return verifiedPut(id, { status: target }, { status: acceptedAfter(target) }, askCredit, "Failed to update the status");
}

export function putPod(id: string, pod: ProofOfDelivery, alreadyDelivered: boolean, askCredit: AskCredit): Promise<WriteResult> {
  // Same body + accepted states as desktop handleSubmitPOD (detail.tsx).
  const body: Record<string, unknown> = { proofOfDelivery: pod };
  if (!alreadyDelivered) body.status = "DELIVERED";
  return verifiedPut(id, body, { status: ["DELIVERED", "INVOICED"] }, askCredit, "Failed to save the proof of delivery");
}

export function putLorry(id: string, lorryId: string, askCredit: AskCredit): Promise<WriteResult> {
  return verifiedPut(id, { lorryId }, { lorryId }, askCredit, "Failed to assign the lorry");
}

export async function resolveIncomplete(id: string): Promise<WriteResult> {
  try {
    const r = await fetch(`/api/delivery-orders/${encodeURIComponent(id)}/resolve-incomplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || j.success === false) return { ok: false, error: j.error || `Failed (HTTP ${r.status})` };
    const after = await readDo(id).catch(() => null);
    if (after && after.deliveryIncomplete === true) {
      return { ok: false, error: "The server did not clear the incomplete flag. Refresh and try again." };
    }
    return { ok: true, data: after };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Customer notices for DOs that just moved (fire-and-forget on the caller's
 *  side). Resolves to how many were actually queued — never claimed sent
 *  unless the server queued it. */
export async function notifyCustomers(dos: RawRow[], kind: "DISPATCHED" | "DELIVERED"): Promise<number> {
  let queued = 0;
  for (const d of dos) {
    const row: NoticeRow = {
      id: s(d, "id"),
      doNo: s(d, "doNo"),
      customerId: s(d, "customerId"),
      customerPOId: s(d, "customerPOId"),
      items: rows(d.items).map((i) => ({ ...i, id: s(i, "id"), quantity: Number(i.quantity) || 0 })),
    };
    // renderUnifiedDoBase64 reads the whole DO row (hub, address, items…).
    const full = { ...d, ...row } as unknown as NoticeRow;
    try {
      if ((await sendCustomerNotice(full, kind)) === "queued") queued++;
    } catch {
      /* never blocks the delivery flow */
    }
  }
  return queued;
}

export function noticeToast(queued: number, kind: "DISPATCHED" | "DELIVERED"): string | null {
  if (queued <= 0) return null;
  return kind === "DISPATCHED" ? `Dispatch notice emailed for ${queued} DO(s)` : `Invoice notice emailed for ${queued} DO(s)`;
}

/** Desktop runBulkDoTransition: sequential PUTs (parallel ones deadlock the
 *  shared SO rows and collide invoice numbers), per-DO credit retry. */
export async function runBulk(
  dos: RawRow[],
  target: BulkTarget,
  askCredit: AskCredit,
): Promise<{ succeeded: RawRow[]; failures: string[] }> {
  const succeeded: RawRow[] = [];
  const failures: string[] = [];
  for (const d of dos) {
    const id = s(d, "id");
    try {
      const put = (extra: Record<string, unknown> = {}) =>
        fetch(`/api/delivery-orders/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: target, ...extra }),
        });
      let r = await put();
      if (r.status === 409 || r.status === 403) {
        const eb: unknown = await r.clone().json().catch(() => null);
        if (isCreditBlock(eb)) {
          const reason = await askCredit(eb);
          if (reason) r = await put({ creditOverride: { reason } });
        }
      }
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        failures.push(`${s(d, "doNo")}: ${body?.error || `HTTP ${r.status}`}`);
      } else {
        succeeded.push(d);
      }
    } catch (e) {
      failures.push(`${s(d, "doNo")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refreshDeliveryCaches();
  return { succeeded, failures };
}
