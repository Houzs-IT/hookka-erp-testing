// ============================================================
// Order notifications (HK-0025) — the "Send Notification" button on the
// Production Overview. An order notice is an ANNOUNCEMENT (same table, same
// targeting, same worker-phone feed, same read-receipts) that also carries a
// priority and the order it is about. Shared by the Overview dialog (FE) and
// POST /api/announcements (BE) so the two cannot disagree on the values.
// ============================================================

export const ORDER_PRIORITIES = ["URGENT", "OVERDUE", "PRIORITY"] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const ORDER_PRIORITY_LABEL: Record<OrderPriority, string> = {
  URGENT: "Urgent - needs immediate attention",
  OVERDUE: "Overdue - past the required completion date",
  PRIORITY: "Normal / Priority - finish ahead of other orders",
};

/** Unknown / missing -> null (an ordinary announcement). */
export function readOrderPriority(v: unknown): OrderPriority | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (ORDER_PRIORITIES as readonly string[]).includes(s)
    ? (s as OrderPriority)
    : null;
}

/**
 * URGENT / OVERDUE ride the existing WARNING category, which the worker
 * phone already renders as a red highlighted card + must-ack popup.
 */
export function orderNoticeCategory(p: OrderPriority): "WARNING" | "GENERAL" {
  return p === "PRIORITY" ? "GENERAL" : "WARNING";
}

const ASK: Record<OrderPriority, string> = {
  URGENT: "Please prioritise this order first.",
  OVERDUE: "Please prioritise this order first.",
  PRIORITY: "Please complete this order ahead of other orders.",
};

function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "-";
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Start of today in Malaysia (UTC+8, no DST) as a UTC ISO instant - the
 * "already sent today" cutoff. A UTC date would split 07:00 / 09:00 MYT into
 * two days and merge 23:30 with the next 07:00.
 */
export function mytDayStartIso(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 8 * 3_600_000);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 8 * 3_600_000).toISOString();
}

/** Hard cap per notice - enforced by POST /api/announcements, mirrored in the dialog. */
export const MAX_NOTICE_ORDERS = 10;

export type NoticeOrder = {
  poNo: string;
  model: string;
  requiredDate: string;
  status: string;
};

/** One notice for one OR several orders (HK-0025 review: one push per batch). */
export function buildOrderNotice(o: {
  priority: OrderPriority;
  orders: NoticeOrder[];
  note?: string;
}): { title: string; body: string } {
  const note = (o.note ?? "").trim();
  const one = (x: NoticeOrder) => [
    `Order No.: ${x.poNo}`,
    `Model: ${x.model || "-"}`,
    `Required Date: ${ddmmyyyy(x.requiredDate)}`,
    `Current Status: ${titleCase(x.status) || "-"}`,
  ];
  const blocks = o.orders.map((x) => one(x).join("\n"));
  const lines = [
    blocks.join("\n\n"),
    `Priority: ${o.priority}`,
    "",
    ...(note ? [note, ""] : []),
    ASK[o.priority],
  ];
  const n = o.orders.length;
  return {
    title:
      n === 1
        ? `${o.priority} ORDER - ${o.orders[0].poNo}`
        : `${o.priority} ORDERS - ${n} orders`,
    body: lines.join("\n"),
  };
}
