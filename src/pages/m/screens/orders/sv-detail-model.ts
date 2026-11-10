// Pure derivations for the SV Service Order detail (no React, no "@/" imports).

type Row = Record<string, unknown>;
const s = (r: Row, ...k: string[]): string => { for (const x of k) { const v = r[x]; if (v != null && String(v) !== "") return String(v); } return ""; };
const n = (r: Row, ...k: string[]): number => { for (const x of k) { const v = Number(r[x]); if (r[x] != null && Number.isFinite(v)) return v; } return 0; };

export type PoJobCards = { id: string; jobCards: Row[] };

/** Share of a PO's job cards that are COMPLETED (cancelled cards ignored); null when it has no usable cards. */
export function jcRatio(jobCards: Row[] | undefined): number | null {
  const live = (jobCards ?? []).filter((j) => s(j, "status").toUpperCase() !== "CANCELLED");
  if (!live.length) return null;
  return live.filter((j) => s(j, "status").toUpperCase() === "COMPLETED").length / live.length;
}

export type SvProduction = {
  /** 0-100, quantity-weighted. Never 100 unless `done`. */
  pct: number;
  /** ALL live linked POs are COMPLETED (the only way the UI says "Done"). */
  done: boolean;
  total: number;
  completed: number;
  perPo: Record<string, number>;
};

/**
 * Quantity-weighted production progress. A PO's own fraction is its job-card completion (from
 * /api/production-orders?include=jobCards); when that read has no cards for it, the PO's `progress`
 * (0-100) from the order envelope is used. Cancelled POs are ignored. "Done" is decided by PO status
 * only, so a rounded 99.6% never reads as finished.
 */
export function svProduction(linkedPOs: Row[], jcByPo: Record<string, Row[]>): SvProduction {
  const live = linkedPOs.filter((p) => s(p, "status").toUpperCase() !== "CANCELLED");
  const perPo: Record<string, number> = {};
  let w = 0;
  let acc = 0;
  for (const p of live) {
    const id = s(p, "id");
    const st = s(p, "status").toUpperCase();
    const r = jcRatio(jcByPo[id]);
    const frac = st === "COMPLETED" ? 1 : r != null ? r : Math.max(0, Math.min(100, n(p, "progress"))) / 100;
    perPo[id] = frac;
    const q = Math.max(1, n(p, "quantity"));
    w += q;
    acc += q * frac;
  }
  const completed = live.filter((p) => s(p, "status").toUpperCase() === "COMPLETED").length;
  const done = live.length > 0 && completed === live.length;
  let pct = w > 0 ? Math.round((acc / w) * 100) : 0;
  if (!done && pct >= 100) pct = 99;
  return { pct: done ? 100 : pct, done, total: live.length, completed, perPo };
}

/** Department shown for an open PO: its `currentDepartment` (the production grid's label). */
export function svCurrentDept(linkedPOs: Row[], jcByPo: Record<string, Row[]>): string {
  const open = linkedPOs
    .filter((p) => !["COMPLETED", "CANCELLED"].includes(s(p, "status").toUpperCase()))
    .map((p) => {
      const seqs = (jcByPo[s(p, "id")] ?? [])
        .filter((j) => !["COMPLETED", "CANCELLED"].includes(s(j, "status").toUpperCase()))
        .map((j) => n(j, "sequence"))
        .filter((x) => x > 0);
      return { dept: s(p, "currentDepartment"), rank: seqs.length ? Math.min(...seqs) : 999 };
    })
    .filter((x) => x.dept)
    .sort((a, b) => a.rank - b.rank);
  return open[0]?.dept ?? "";
}

/** Main-path position of an order status (the 7 stages); CONFIRMED sits on the first stage, as the prototype does. */
export const SV_PATH = ["DRAFT", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"] as const;
export type StageInfo = { index: number; off: boolean; pre: string | null; confirmed: boolean };
/** `history` rows are the order envelope's statusHistory (fromStatus/toStatus/timestamp). ON_HOLD / CANCELLED resume the
 *  status they came from; unknown when no event says so (null, never guessed). */
export function svStageInfo(status: string, history: Row[], restoreTarget?: string | null): StageInfo {
  const off = status === "ON_HOLD" || status === "CANCELLED";
  let pre: string | null = null;
  if (restoreTarget !== undefined && off) {
    // The status Resume / Undo will actually request (doc.preHoldStatus / preCancelStatus); history is not consulted.
    pre = restoreTarget ? restoreTarget.toUpperCase() : null;
  } else if (off) {
    const ev = history
      .filter((h) => s(h, "toStatus").toUpperCase() === status)
      .sort((a, b) => s(b, "timestamp").localeCompare(s(a, "timestamp")))[0];
    pre = ev ? s(ev, "fromStatus").toUpperCase() || null : null;
  }
  const at = off ? pre : status;
  const index = at === "CONFIRMED" ? 0 : at ? (SV_PATH as readonly string[]).indexOf(at) : -1;
  return { index, off, pre, confirmed: status === "CONFIRMED" };
}

export type ChainState = "linked" | "current" | "pending";
export type ChainNode = { key: string; label: string; value: string; sub: string; state: ChainState; href?: string };

/** Customer PO -> SV -> Delivery Order(s) -> Invoice(s) -> Payment(s). All five stages always show; a stage with no
 *  document is "pending" with a caption saying what creates it. */
export function svChain(opts: { status: string; customerPO: string; svNo: string; dos: Row[]; invoices: Row[]; payments: Row[]; moneyFmt: (sen: number) => string; titleCase: (x: string) => string }): ChainNode[] {
  const { status: st, titleCase: tc } = opts;
  const out: ChainNode[] = [];
  out.push(opts.customerPO
    ? { key: "po", label: "Customer PO", value: opts.customerPO, sub: "Customer’s reference — no document to open", state: "linked" }
    : { key: "po", label: "Customer PO", value: "Not recorded", sub: "No customer PO on this order", state: "pending" });
  out.push({ key: "sv", label: "Service order", value: opts.svNo, sub: "This order", state: "current" });
  if (opts.dos.length) {
    for (const d of opts.dos) {
      const id = s(d, "id");
      out.push({ key: `do-${id || s(d, "doNo")}`, label: "Delivery order", value: s(d, "doNo", "id"), sub: tc(s(d, "status")), state: "linked", href: id ? `/m/delivery/${encodeURIComponent(id)}` : undefined });
    }
  } else {
    out.push({ key: "do", label: "Delivery order", value: "Not created", sub: st === "READY_TO_SHIP" ? "Ready — create a delivery" : "Created once production is ready to ship", state: "pending" });
  }
  if (opts.invoices.length) {
    for (const v of opts.invoices) {
      const id = s(v, "id");
      // Same guard as SalesOrderDetail: only real invoice ids deep-link.
      out.push({ key: `inv-${id || s(v, "invoiceNo")}`, label: "Invoice", value: s(v, "invoiceNo", "id"), sub: `${tc(s(v, "status"))} · ${opts.moneyFmt(n(v, "totalSen"))}`, state: "linked", href: id.startsWith("inv-") ? `/m/invoices/${encodeURIComponent(id)}` : undefined });
    }
  } else {
    out.push({ key: "inv", label: "Invoice", value: "Not created", sub: st === "DELIVERED" ? "Delivered — generate the invoice" : "Raised after delivery", state: "pending" });
  }
  if (opts.payments.length) {
    for (const p of opts.payments) {
      out.push({ key: `pay-${s(p, "id", "receiptNumber")}`, label: "Payment", value: s(p, "receiptNumber", "id") || "Payment", sub: `${tc(s(p, "status"))} · ${opts.moneyFmt(n(p, "amount", "amountSen"))}`, state: "linked" });
    }
  } else {
    out.push({ key: "pay", label: "Payment", value: "Not recorded", sub: opts.invoices.length ? "Awaiting payment on the invoice" : "Follows the invoice", state: "pending" });
  }
  return out;
}
