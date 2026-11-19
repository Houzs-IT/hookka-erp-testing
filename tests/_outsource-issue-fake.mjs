export const SOFA_PO = { id: "po-sofa", poNo: "PO-SOFA", productName: "Sofa 1A", productCode: "5530-1A", sizeLabel: "", salesOrderNo: "SO-1" };
export const BED_PO = { id: "po-bed", poNo: "PO-BED", productName: "Bedframe", productCode: "1013", sizeLabel: "King", salesOrderNo: "SO-2" };

export const WIP = {
  sofaBase: "so::1::SOFA_BASE",
  sofaCushion: "so::1::SOFA_CUSHION",
  divan: "bed::1::DIVAN",
  headboard: "bed::1::HEADBOARD",
};

export function defaultCards() {
  const card = (id, productionOrderId, wipKey, wipType, wipLabel, status = "IN_PROGRESS", departmentCode = "FAB_SEW") => ({
    id, productionOrderId, wipKey, wipType, wipLabel, status, departmentCode,
  });
  return [
    card("jc-sofa-base", SOFA_PO.id, WIP.sofaBase, "SOFA_BASE", "5530-1A Base"),
    card("jc-sofa-cushion", SOFA_PO.id, WIP.sofaCushion, "SOFA_CUSHION", "5530-1A Cushion"),
    card("jc-divan", BED_PO.id, WIP.divan, "DIVAN", '8" Divan'),
    card("jc-headboard", BED_PO.id, WIP.headboard, "HEADBOARD", "Headboard"),
    card("jc-divan-pack", BED_PO.id, WIP.divan, "DIVAN", '8" Divan', "WAITING", "PACKING"),
  ];
}

export function extraDepartmentCards() {
  const card = (id, productionOrderId, wipKey, wipType, wipLabel, departmentCode, status = "IN_PROGRESS") => ({
    id, productionOrderId, wipKey, wipType, wipLabel, status, departmentCode,
  });
  return [
    card("jc-sofa-base-uph", SOFA_PO.id, WIP.sofaBase, "SOFA_BASE", "5530-1A Base", "UPHOLSTERY"),
    card("jc-sofa-cushion-uph", SOFA_PO.id, WIP.sofaCushion, "SOFA_CUSHION", "5530-1A Cushion", "UPHOLSTERY"),
    card("jc-divan-cut", BED_PO.id, WIP.divan, "DIVAN", '8" Divan', "FAB_CUT"),
    card("jc-headboard-cut", BED_PO.id, WIP.headboard, "HEADBOARD", "Headboard", "FAB_CUT"),
    card("jc-divan-wood", BED_PO.id, WIP.divan, "DIVAN", '8" Divan', "WOOD_CUT"),
    card("jc-headboard-wood", BED_PO.id, WIP.headboard, "HEADBOARD", "Headboard", "WOOD_CUT"),
  ];
}

export function defaultWorkers() {
  const worker = (id, empNo, name, status, isOutsource, departmentCode = "FAB_SEW", departmentCodes = null) => ({
    id, empNo, name, status, isOutsource, departmentCode, departmentCodes,
  });
  return [
    worker("osc", "OSC-1", "Ali", "ACTIVE", true),
    worker("osc2", "OSC-2", "Bala", "ACTIVE", true),
    worker("inhouse", "E-1", "Siti", "ACTIVE", false),
    worker("oscGone", "OSC-3", "Gone", "RESIGNED", true),
  ];
}

export const DEPARTMENTS = [
  { code: "FAB_CUT", name: "Fabric Cutting" },
  { code: "FAB_SEW", name: "Fabric Sewing" },
  { code: "UPHOLSTERY", name: "Upholstery" },
  { code: "WOOD_CUT", name: "Wood Cutting" },
  { code: "PACKING", name: "Packing" },
];

export function makeFakeDb({ cards = defaultCards(), slots = [], workers = defaultWorkers(), kv = {} } = {}) {
  const orders = [SOFA_PO, BED_PO];
  const state = { issues: [], issueCards: [], kv: { ...kv }, cards, slots, creates: 0 };
  const slotOf = (row) => `${row.job_card_id}|${row.piece_no ?? 0}`;
  const duplicate = (message) => Object.assign(new Error(message), { code: "23505" });

  function exec(sql, args) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (/^CREATE/i.test(text)) {
      state.creates += 1;
      return [];
    }
    if (/^ALTER TABLE/i.test(text)) return [];
    if (/^INSERT INTO outsource_issue_cards .* SELECT oi\.id/i.test(text)) {
      for (const issue of state.issues) {
        if (state.issueCards.some((c) => c.issue_id === issue.id)) continue;
        const matching = state.cards.filter(
          (c) => c.productionOrderId === issue.production_order_id && c.departmentCode === "FAB_SEW" && (!issue.wip_key || c.wipKey === issue.wip_key),
        );
        for (const card of matching) {
          const row = { issue_id: issue.id, job_card_id: card.id, piece_no: issue.piece_no, org_id: issue.org_id };
          if (!state.issueCards.some((c) => slotOf(c) === slotOf(row))) state.issueCards.push(row);
        }
      }
      return [];
    }
    if (/^SELECT code, name FROM departments/i.test(text)) return DEPARTMENTS;
    if (/FROM production_orders WHERE poNo = \? OR id = \?/i.test(text)) {
      return orders.filter((o) => o.poNo === args[0] || o.id === args[1]);
    }
    if (/FROM production_orders po JOIN job_cards jc/i.test(text)) {
      const found = state.cards.find((c) => c.id === args[0]);
      const order = found && orders.find((o) => o.id === found.productionOrderId);
      return found && order ? [{ ...order, wipLabel: found.wipLabel }] : [];
    }
    if (/^SELECT id, poNo, productName, productCode, sizeLabel, salesOrderNo FROM production_orders WHERE id = \? LIMIT 1/i.test(text)) {
      return orders.filter((o) => o.id === args[0]);
    }
    if (/^SELECT id, productionOrderId, departmentCode, wipLabel FROM job_cards WHERE departmentCode = \?/i.test(text)) {
      return state.cards.filter((c) => c.departmentCode === args[0]);
    }
    if (/^SELECT productCode FROM production_orders/i.test(text)) {
      return orders.filter((o) => o.id === args[0]).map((o) => ({ productCode: o.productCode }));
    }
    if (/^SELECT wipType FROM job_cards/i.test(text)) {
      return state.cards.filter((c) => c.productionOrderId === args[0] && c.wipKey === args[1]);
    }
    if (/^SELECT id, departmentCode, wipKey, wipLabel, wipType, status FROM job_cards WHERE productionOrderId = \?/i.test(text)) {
      return state.cards.filter((c) => c.productionOrderId === args[0]);
    }
    if (/^SELECT id, status FROM job_cards WHERE id IN/i.test(text)) {
      return state.cards.filter((c) => args.includes(c.id));
    }
    if (/FROM piece_pics WHERE jobCardId IN/i.test(text)) {
      return state.slots.filter((s) => args.includes(s.jobCardId));
    }
    if (/FROM workers WHERE id = \?/i.test(text)) return workers.filter((w) => w.id === args[0]);
    if (/FROM workers/i.test(text)) return workers;
    if (/FROM kv_config WHERE key = \?/i.test(text)) {
      return args[0] in state.kv ? [{ value: JSON.stringify(state.kv[args[0]]) }] : [];
    }
    if (/^INSERT INTO outsource_issue_cards/i.test(text)) {
      const [issue_id, job_card_id, piece_no, org_id] = args;
      const row = { issue_id, job_card_id, piece_no, org_id };
      if (state.issueCards.some((c) => slotOf(c) === slotOf(row))) throw duplicate("duplicate key idx_outsource_issue_cards_slot");
      state.issueCards.push(row);
      return [];
    }
    if (/^SELECT issue_id, job_card_id, piece_no FROM outsource_issue_cards WHERE org_id = \? AND job_card_id IN/i.test(text)) {
      return state.issueCards.filter((c) => c.org_id === args[0] && args.slice(1).includes(c.job_card_id));
    }
    if (/^SELECT issue_id, job_card_id, piece_no FROM outsource_issue_cards WHERE issue_id IN/i.test(text)) {
      return state.issueCards.filter((c) => args.includes(c.issue_id));
    }
    if (/^DELETE FROM outsource_issue_cards/i.test(text)) {
      const hit = state.issues.find((i) => i.id === args[0] && i.org_id === args[1] && i.status === "INCOMPLETE");
      if (hit) state.issueCards = state.issueCards.filter((c) => c.issue_id !== hit.id);
      return [];
    }
    if (/^INSERT INTO outsource_issues/i.test(text)) {
      const [id, org_id, worker_id, emp_no, worker_name, department_code, item_key, qr_raw, production_order_id, piece_no, total_pieces, po_no, product_code, product_name, item_label, issued_by] = args;
      if (state.issues.some((i) => i.org_id === org_id && i.item_key === item_key)) throw duplicate("duplicate key idx_outsource_issues_item");
      const row = {
        id, org_id, worker_id, emp_no, worker_name, department_code, item_key, qr_raw, production_order_id, wip_key: null, piece_no,
        total_pieces, po_no, product_code, product_name, item_label, status: "INCOMPLETE",
        issued_at: new Date("2026-11-18T01:00:00Z"), issued_by, completed_at: null,
      };
      state.issues.push(row);
      return [row];
    }
    if (/^SELECT \* FROM outsource_issues WHERE org_id = \? AND id IN/i.test(text)) {
      return state.issues.filter((i) => i.org_id === args[0] && args.slice(1).includes(i.id));
    }
    if (/^SELECT \* FROM outsource_issues WHERE id = \? AND org_id = \?/i.test(text)) {
      return state.issues.filter((i) => i.id === args[0] && i.org_id === args[1]);
    }
    if (/^DELETE FROM outsource_issues/i.test(text)) {
      const hit = state.issues.find((i) => i.id === args[0] && i.org_id === args[1] && i.status === "INCOMPLETE");
      if (hit) state.issues = state.issues.filter((i) => i !== hit);
      return [];
    }
    if (/^UPDATE outsource_issues SET status = 'COMPLETED'/i.test(text)) {
      const hit = state.issues.find((i) => i.id === args[0] && i.status === "INCOMPLETE");
      if (!hit) return [];
      hit.status = "COMPLETED";
      hit.completed_at = new Date("2026-11-19T02:00:00Z");
      return [{ id: hit.id }];
    }
    if (/^SELECT \* FROM outsource_issues WHERE org_id = \? AND worker_id = \? AND status = 'INCOMPLETE'/i.test(text)) {
      return state.issues.filter((i) => i.org_id === args[0] && i.worker_id === args[1] && i.status === "INCOMPLETE");
    }
    if (/^SELECT \* FROM outsource_issues WHERE org_id = \? AND worker_id = \? AND status = 'COMPLETED'/i.test(text)) {
      return state.issues.filter((i) => i.org_id === args[0] && i.worker_id === args[1] && i.status === "COMPLETED");
    }
    if (/^SELECT \* FROM outsource_issues WHERE/i.test(text)) {
      return state.issues.filter((i) => i.org_id === args[0]);
    }
    if (/FROM outsource_issues WHERE org_id = \? AND status = 'INCOMPLETE' GROUP BY worker_id/i.test(text)) {
      const counts = new Map();
      for (const i of state.issues) if (i.status === "INCOMPLETE") counts.set(i.worker_id, (counts.get(i.worker_id) ?? 0) + 1);
      return [...counts].map(([worker_id, n]) => ({ worker_id, n }));
    }
    throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
  }

  const db = {
    prepare(sql) {
      const stmt = (args) => ({
        bind: (...bound) => stmt(bound),
        run: async () => { exec(sql, args); return {}; },
        all: async () => ({ results: exec(sql, args) }),
        first: async () => exec(sql, args)[0] ?? null,
        runSync: () => exec(sql, args),
      });
      return stmt([]);
    },
    async batch(statements) {
      const snapshot = { issues: [...state.issues], issueCards: [...state.issueCards] };
      try {
        return statements.map((statement) => ({ results: statement.runSync() }));
      } catch (error) {
        state.issues = snapshot.issues;
        state.issueCards = snapshot.issueCards;
        throw error;
      }
    },
  };
  return { db, state };
}

export const stickerUrl = (query, origin = "https://erp.hookka.com") => `${origin}/worker/scan?${query}`;
