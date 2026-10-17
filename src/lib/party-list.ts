// ---------------------------------------------------------------------------
// party-list.ts — the rows of Finance › Debtor List / Creditor List (owner
// 2026-10-17, Finance v2 「要」): everyone who owes us (trade customers and
// other debtors) or whom we owe (suppliers and other creditors) in one list,
// each with what is outstanding — the same figure its aging row shows. Pure;
// rows read dual-keyed, money in integer sen.
// ---------------------------------------------------------------------------

export type PartyKind = "trade" | "other";

export type PartyListRow = {
  key: string;
  id: string;
  kind: PartyKind;
  code: string;
  name: string;
  /** Contact person. */
  contact: string;
  /** Credit / payment terms for a trade party; what the account is for, for an other party. */
  termsOrNote: string;
  /** 0 = no credit limit set. */
  limitSen: number;
  outstandingSen: number;
  phone: string;
  email: string;
  active: boolean;
};

type Row = Record<string, unknown>;
const s = (r: Row, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return "";
};
const n = (r: Row, ...keys: string[]) => {
  for (const k of keys) {
    const v = Number(r[k]);
    if (Number.isFinite(v) && r[k] !== null && r[k] !== undefined && r[k] !== "") return Math.round(v);
  }
  return 0;
};

/** An aging row's total: its five buckets added (the Total column). */
export function agingTotalSen(r: { currentSen: number; days30Sen: number; days60Sen: number; days90Sen: number; over90Sen: number }): number {
  return r.currentSen + r.days30Sen + r.days60Sen + r.days90Sen + r.over90Sen;
}

/** Trade customers, outstanding from their Debtor Aging rows. */
export function customerRows(customers: Row[], owedById: Map<string, number>): PartyListRow[] {
  return customers.map((c) => {
    const id = s(c, "id");
    const active = c.isActive ?? c.is_active;
    return {
      key: `t:${id}`, id, kind: "trade" as const,
      code: s(c, "code"), name: s(c, "name"), contact: s(c, "contactName", "contact_name"),
      termsOrNote: s(c, "creditTerms", "credit_terms"), limitSen: n(c, "creditLimitSen", "credit_limit_sen"),
      outstandingSen: owedById.get(id) ?? 0,
      phone: s(c, "phone"), email: s(c, "email"),
      active: active === undefined || active === null ? true : active === true || Number(active) === 1,
    };
  });
}

/** Suppliers, outstanding from their Creditor Aging rows. A blacklisted or
 *  inactive supplier reads Inactive. */
export function supplierRows(suppliers: Row[], owedById: Map<string, number>): PartyListRow[] {
  return suppliers.map((p) => {
    const id = s(p, "id");
    const status = s(p, "status") || "ACTIVE";
    return {
      key: `s:${id}`, id, kind: "trade" as const,
      code: s(p, "code"), name: s(p, "name"), contact: s(p, "contactPerson", "contact_person"),
      termsOrNote: s(p, "paymentTerms", "payment_terms"), limitSen: 0,
      outstandingSen: owedById.get(id) ?? 0,
      phone: s(p, "phone"), email: s(p, "email"),
      active: status === "ACTIVE",
    };
  });
}

/** Other debtors / creditors, outstanding = their open bills. Their register
 *  has no code. */
export function otherPartyRows(parties: Row[], bills: { partyId: string; outstandingSen: number }[]): PartyListRow[] {
  const owed = new Map<string, number>();
  for (const b of bills) owed.set(b.partyId, (owed.get(b.partyId) ?? 0) + (Math.round(Number(b.outstandingSen) || 0)));
  return parties.map((p) => {
    const id = s(p, "id");
    const active = p.isActive ?? p.is_active;
    return {
      key: `o:${id}`, id, kind: "other" as const,
      code: "", name: s(p, "name"), contact: s(p, "contactPerson", "contact_person"),
      termsOrNote: s(p, "notes"), limitSen: 0,
      outstandingSen: owed.get(id) ?? 0,
      phone: s(p, "phone"), email: s(p, "email"),
      active: active === undefined || active === null ? true : active === true || Number(active) === 1,
    };
  });
}

/** Owing more than the credit limit (a limit of 0 = none set). */
export function overLimit(r: PartyListRow): boolean {
  return r.limitSen > 0 && r.outstandingSen > r.limitSen;
}
