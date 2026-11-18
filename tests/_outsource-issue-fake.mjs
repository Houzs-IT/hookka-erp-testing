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

export function defaultWorkers() {
  return [
    { id: "osc", empNo: "OSC-1", name: "Ali", status: "ACTIVE", isOutsource: true },
    { id: "osc2", empNo: "OSC-2", name: "Bala", status: "ACTIVE", isOutsource: true },
    { id: "inhouse", empNo: "E-1", name: "Siti", status: "ACTIVE", isOutsource: false },
    { id: "oscGone", empNo: "OSC-3", name: "Gone", status: "RESIGNED", isOutsource: true },
  ];
}

export function makeFakeDb({ cards = defaultCards(), slots = [], workers = defaultWorkers(), kv = {} } = {}) {
  const orders = [SOFA_PO, BED_PO];
  const state = { issues: [], kv: { ...kv }, cards, slots, creates: 0 };

  function exec(sql, args) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (/^CREATE/i.test(text)) {
      state.creates += 1;
      return [];
    }
    if (/FROM production_orders WHERE poNo = \? OR id = \?/i.test(text)) {
      return orders.filter((o) => o.poNo === args[0] || o.id === args[1]);
    }
    if (/FROM production_orders po JOIN job_cards jc/i.test(text)) {
      const found = state.cards.find((c) => c.id === args[0]);
      const order = found && orders.find((o) => o.id === found.productionOrderId);
      return found && order ? [{ ...order, wipLabel: found.wipLabel }] : [];
    }
    if (/^SELECT productCode FROM production_orders/i.test(text)) {
      return orders.filter((o) => o.id === args[0]).map((o) => ({ productCode: o.productCode }));
    }
    if (/^SELECT wipType FROM job_cards/i.test(text)) {
      return state.cards.filter((c) => c.productionOrderId === args[0] && c.wipKey === args[1]);
    }
    if (/^SELECT id, wipKey, wipLabel, status FROM job_cards/i.test(text)) {
      return state.cards.filter((c) => c.productionOrderId === args[0] && c.departmentCode === "FAB_SEW");
    }
    if (/^SELECT id, productionOrderId, wipKey, status FROM job_cards/i.test(text)) {
      return state.cards.filter((c) => c.departmentCode === "FAB_SEW" && args.includes(c.productionOrderId));
    }
    if (/FROM piece_pics WHERE jobCardId IN/i.test(text)) {
      const piece = /AND pieceNo = \?/i.test(text) ? args[args.length - 1] : null;
      const ids = piece === null ? args : args.slice(0, -1);
      return state.slots.filter((s) => ids.includes(s.jobCardId) && (piece === null || s.pieceNo === piece));
    }
    if (/FROM workers WHERE id = \?/i.test(text)) return workers.filter((w) => w.id === args[0]);
    if (/FROM workers/i.test(text)) return workers;
    if (/FROM kv_config WHERE key = \?/i.test(text)) {
      return args[0] in state.kv ? [{ value: JSON.stringify(state.kv[args[0]]) }] : [];
    }
    if (/^INSERT INTO outsource_issues/i.test(text)) {
      const [id, org_id, worker_id, emp_no, worker_name, item_key, qr_raw, production_order_id, wip_key, piece_no, total_pieces, po_no, product_code, product_name, item_label, issued_by] = args;
      if (state.issues.some((i) => i.org_id === org_id && i.item_key === item_key)) return [];
      const row = {
        id, org_id, worker_id, emp_no, worker_name, item_key, qr_raw, production_order_id, wip_key, piece_no,
        total_pieces, po_no, product_code, product_name, item_label, status: "INCOMPLETE",
        issued_at: new Date("2026-11-18T01:00:00Z"), issued_by, completed_at: null,
      };
      state.issues.push(row);
      return [row];
    }
    if (/^SELECT \* FROM outsource_issues WHERE org_id = \? AND item_key = \?/i.test(text)) {
      return state.issues.filter((i) => i.org_id === args[0] && i.item_key === args[1]);
    }
    if (/^SELECT \* FROM outsource_issues WHERE org_id = \? AND production_order_id = \?/i.test(text)) {
      return state.issues.filter((i) => i.org_id === args[0] && i.production_order_id === args[1]);
    }
    if (/^SELECT \* FROM outsource_issues WHERE id = \? AND org_id = \?/i.test(text)) {
      return state.issues.filter((i) => i.id === args[0] && i.org_id === args[1]);
    }
    if (/^DELETE FROM outsource_issues/i.test(text)) {
      const hit = state.issues.find((i) => i.id === args[0] && i.org_id === args[1] && i.status === "INCOMPLETE");
      if (!hit) return [];
      state.issues = state.issues.filter((i) => i !== hit);
      return [hit];
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
      });
      return stmt([]);
    },
  };
  return { db, state };
}

export const stickerUrl = (query, origin = "https://erp.hookka.com") => `${origin}/worker/scan?${query}`;
