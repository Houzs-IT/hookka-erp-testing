// ---------------------------------------------------------------------------
// outsource-piece-scan.test.mjs — HK-0161/0162/0163: scanned FAB_SEW orders
// become outsource piece records, paid in full even with an in-house co-PIC
// (Violet 2026-11-18: the piece price is already divided), never touching imports
// or an approved month. The fake database applies the same period / finished /
// worker-scope rules the SQL does, so those rules are tested, not assumed.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const P = await import(pathToFileURL(resolve(process.cwd(), "src/lib/outsource-piece.ts")).href);
const L = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-piece.ts")).href);

const PERIOD = "2026-11";

test("amount: a half share rounds to whole sen, a full share is unchanged", () => {
  assert.equal(P.pieceAmountSen(3, 2407), 7221);
  assert.equal(P.pieceAmountSen(1, 2407, 5000), 1204);
  assert.equal(P.pieceAmountSen(2, 1000, 8333), 1667);
});

test("share: a co-PIC on the base still pays the outsource worker in full (SO-2609-324-01)", () => {
  const cards = [
    { pic1Id: "osc", pic2Id: "inhouse" },
    { pic1Id: "osc" },
    { pic1Id: "osc" },
  ];
  assert.equal(P.workerShareBp(cards, "osc"), 10000);
  assert.equal(P.workerShareBp(cards, "nobody"), 0);
});

test("share: scanned pieces decide who is on a card, the card's PICs only when it has none", () => {
  const withPieces = [{ pic1Id: "card-only", pieces: [{ pic1Id: "a" }, { pic1Id: "b", pic2Id: "osc" }] }];
  assert.equal(P.workerShareBp(withPieces, "osc"), 10000);
  assert.equal(P.workerShareBp(withPieces, "card-only"), 0);
  assert.equal(P.workerShareBp([], "osc"), 0);
});

test("share: piece slots with no PIC are ignored, and fall back to the card's PICs", () => {
  const slots = [{ pic1Id: null, pic2Id: null }, { pic1Id: null }];
  assert.equal(P.workerShareBp([{ pic1Id: "osc", pieces: slots }], "osc"), 10000);
  const mixed = [{ pic1Id: "osc", pieces: [{ pic1Id: "osc" }, { pic1Id: null }, { pic1Id: "a" }] }];
  assert.equal(P.workerShareBp(mixed, "osc"), 10000);
});

function makeDb({ cards = [], pieces = [], records = [], rates = [], locked = false, quantity = 2 }) {
  const state = { records: records.map((r) => ({ ...r })), writes: 0 };
  const allWorkers = [
    { id: "osc", empNo: "OSC-002", name: "Outsource A", status: "ACTIVE", isOutsource: true },
    { id: "osc2", empNo: "OSC-003", name: "Outsource B", status: "ACTIVE", isOutsource: true },
    { id: "inhouse", empNo: "E-1", name: "In house", status: "ACTIVE", isOutsource: false },
    { id: "oscR", empNo: "OSC-004", name: "Resigned now", status: "RESIGNED", resignedAt: "2026-11-20", isOutsource: true },
    { id: "oscOld", empNo: "OSC-005", name: "Resigned long ago", status: "RESIGNED", resignedAt: "2026-08-01", isOutsource: true },
  ];
  const orderIds = [...new Set(cards.map((c) => c.production_order_id))];
  const orders = orderIds.map((id) => ({
    id, po_no: `PO-${id}`, sales_order_no: "SO-1", customer_po_id: "C-1",
    product_code: "5530-1A(LHF)", quantity, org_id: "hookka",
  }));
  const inList = (rows, key, args) => rows.filter((r) => args.includes(r[key]));
  function exec(sql, args) {
    if (/^(CREATE|ALTER)/i.test(sql)) return [];
    if (/FROM workers/i.test(sql)) {
      return allWorkers.filter((w) => w.status === "ACTIVE" || (w.status === "RESIGNED" && String(w.resignedAt).startsWith(args[0].replace("%", ""))));
    }
    if (/SELECT DISTINCT production_order_id FROM job_cards/i.test(sql)) {
      const ids = cards
        .filter((c) => ["COMPLETED", "TRANSFERRED"].includes(c.status) && String(c.completed_date).startsWith(args[0]))
        .map((c) => ({ production_order_id: c.production_order_id }));
      return [...new Map(ids.map((r) => [r.production_order_id, r])).values()];
    }
    if (/FROM job_cards/i.test(sql)) return inList(cards, "production_order_id", args);
    if (/FROM piece_pics/i.test(sql)) return inList(pieces, "job_card_id", args);
    if (/FROM production_orders/i.test(sql)) return inList(orders, "id", args);
    if (/FROM outsource_piece_rates/i.test(sql)) return inList(rates, "worker_id", args);
    if (/SELECT DISTINCT period FROM payslips/i.test(sql)) return locked ? [{ period: PERIOD }] : [];
    if (/SELECT id FROM outsource_piece_records WHERE id/i.test(sql)) return state.records.filter((r) => r.id === args[0]);
    if (/^\s*SELECT[\s\S]*FROM outsource_piece_records/i.test(sql)) return state.records;
    if (/^DELETE FROM outsource_piece_records/i.test(sql)) {
      state.writes++;
      state.records = state.records.filter((r) => r.id !== args[0]);
      return [];
    }
    if (/^UPDATE outsource_piece_records/i.test(sql)) {
      state.writes++;
      const row = state.records.find((r) => r.id === args[3]);
      [row.quantity, row.share_bp, row.amount_sen] = args;
      return [];
    }
    if (/^INSERT INTO outsource_piece_records/i.test(sql)) {
      state.writes++;
      const [id, worker_id, , , production_order_id, , , , , item_code, qty, rate_sen, amount_sen, payroll_period, , share_bp, completed_date] = args;
      if (!state.records.some((r) => r.production_order_id === production_order_id)) {
        state.records.push({ id, worker_id, production_order_id, item_code, quantity: qty, rate_sen, amount_sen, payroll_period, share_bp, completed_date, source: "SCAN" });
      }
      return [];
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
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

const card = (order, id, pic1, pic2, extra = {}) => ({
  id, production_order_id: order, status: "COMPLETED", pic1_id: pic1, pic2_id: pic2 ?? null,
  wip_label: "5530-1A(LHF) -Base", completed_date: "2026-11-10", ...extra,
});
const rate = { worker_id: "osc", item_code: "5530-1A", rate_sen: 2407 };
const scanRecord = (extra = {}) => ({
  id: "opc-1", production_order_id: "o1", worker_id: "osc", source: "SCAN", payroll_period: PERIOD,
  share_bp: 10000, rate_sen: 2407, amount_sen: 4814, quantity: 2, ...extra,
});

test("sync: a finished order sewn by one outsource worker becomes a SCAN record", async () => {
  const { db, state } = makeDb({ cards: [card("o1", "c1", "osc")], rates: [rate] });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([result.added, result.removed, result.pending.length], [1, 0, 0]);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].amount_sen, 4814);
  assert.equal(state.records[0].share_bp, 10000);
  assert.equal(state.records[0].completed_date, "2026-11-10");
  assert.deepEqual(await L.syncScannedPieceRecords(db, PERIOD), { added: 0, removed: 0, pending: [] });
});

test("sync: an order with one unfinished FAB_SEW card is not paid", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc"), card("o1", "c2", "osc", null, { status: "IN_PROGRESS", completed_date: null })],
    rates: [rate],
  });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([state.records.length, result.pending.length], [0, 0]);
});

test("sync: an order whose last FAB_SEW completion was in October is not paid in November", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc", null, { completed_date: "2026-10-05" }), card("o1", "c2", "osc", null, { completed_date: "2026-10-20" })],
    rates: [rate],
  });
  await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records.length, 0);
  await L.syncScannedPieceRecords(db, "2026-10");
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].payroll_period, "2026-10");
});

test("sync: the pay month is the month of the LAST FAB_SEW completion", async () => {
  const cards = [card("o1", "c1", "osc", null, { completed_date: "2026-10-28" }), card("o1", "c2", "osc", null, { completed_date: "2026-11-03" })];
  const { db, state } = makeDb({ cards, rates: [rate] });
  await L.syncScannedPieceRecords(db, "2026-10");
  assert.equal(state.records.length, 0);
  await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].completed_date, "2026-11-03");
});

test("sync: an in-house co-PIC does not cut the outsource wage, and gets no record", async () => {
  const { db, state } = makeDb({ cards: [card("o1", "c1", "osc", "inhouse")], rates: [rate] });
  await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].worker_id, "osc");
  assert.equal(state.records[0].share_bp, 10000);
  assert.equal(state.records[0].amount_sen, 4814);
});

test("sync: a worker who resigned this month is still paid; one who left earlier is not", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "oscR"), card("o2", "c2", "oscOld")],
    rates: [{ ...rate, worker_id: "oscR" }, { ...rate, worker_id: "oscOld" }],
  });
  await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual(state.records.map((r) => r.worker_id), ["oscR"]);
});

test("sync: a record of a worker who has since resigned is kept", async () => {
  const { db, state } = makeDb({ cards: [card("o1", "c1", "oscOld")], rates: [], records: [scanRecord({ worker_id: "oscOld" })] });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([result.removed, state.records.length], [0, 1]);
});

test("sync: an order already imported is never recorded again", async () => {
  const imported = { id: "opc-1", production_order_id: "o1", worker_id: "osc2", source: "IMPORT", payroll_period: "2026-10", share_bp: 10000, rate_sen: 100 };
  const { db, state } = makeDb({ cards: [card("o1", "c1", "osc")], rates: [rate], records: [imported] });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([result.added, result.removed, result.pending.length, state.records.length], [0, 0, 0, 1]);
});

test("sync: no rate means no record, reported as pending with the missing item", async () => {
  const { db, state } = makeDb({ cards: [card("o1", "c1", "osc")], rates: [] });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records.length, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].kind, "NO_RATE");
  assert.deepEqual(result.pending[0].missing, ["5530-1A"]);
  assert.deepEqual(result.pending[0].workerIds, ["osc"]);
});

test("sync: a rate deleted later does not remove or reprice the record already made", async () => {
  const { db, state } = makeDb({ cards: [card("o1", "c1", "osc")], rates: [], records: [scanRecord()] });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([result.removed, result.pending.length, state.records.length, state.records[0].amount_sen], [0, 0, 1, 4814]);
});

test("sync: two outsource workers on one order is pending, not paid", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc"), card("o1", "c2", "osc2")],
    rates: [rate, { ...rate, worker_id: "osc2" }],
  });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records.length, 0);
  assert.equal(result.pending[0].kind, "TWO_OUTSOURCE");
  assert.equal(result.pending[0].workerIds.length, 2);
});

test("sync: an order with no outsource PIC is ignored", async () => {
  const { db, state } = makeDb({ cards: [card("o1", "c1", "inhouse")], rates: [rate] });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([state.records.length, result.pending.length], [0, 0]);
});

test("sync: piece slots with no PIC fall back to the card's PICs", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc")],
    pieces: [{ job_card_id: "c1", pic1_id: null, pic2_id: null }, { job_card_id: "c1", pic1_id: null, pic2_id: null }],
    rates: [rate],
  });
  await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].share_bp, 10000);
});

test("sync: a worker with a share of 0 is not on the order and creates nothing", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc")],
    pieces: [{ job_card_id: "c1", pic1_id: "inhouse", pic2_id: null }],
    rates: [rate],
  });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.deepEqual([state.records.length, result.pending.length], [0, 0]);
});

test("sync: a reopened card removes the SCAN record; a worker no longer a PIC loses theirs", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc2"), card("o3", "c3", "osc", null, { status: "IN_PROGRESS", completed_date: null })],
    rates: [{ ...rate, worker_id: "osc2" }],
    records: [
      scanRecord({ id: "opc-old", production_order_id: "gone" }),
      scanRecord({ id: "opc-o1", production_order_id: "o1" }),
      scanRecord({ id: "opc-o3", production_order_id: "o3" }),
    ],
  });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(result.removed, 3);
  assert.deepEqual(state.records.map((r) => r.worker_id), ["osc2"]);
});

test("sync: the quantity follows the order, the rate stays frozen", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc", "inhouse")],
    rates: [{ ...rate, rate_sen: 9999 }],
    quantity: 3,
    records: [scanRecord({ quantity: 2 })],
  });
  await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.records[0].quantity, 3);
  assert.equal(state.records[0].share_bp, 10000);
  assert.equal(state.records[0].rate_sen, 2407);
  assert.equal(state.records[0].amount_sen, 7221);
});

test("sync: an approved month is read, never written", async () => {
  const { db, state } = makeDb({
    cards: [card("o1", "c1", "osc"), card("o2", "c2", "osc")],
    rates: [{ ...rate, item_code: "OTHER" }],
    records: [scanRecord({ id: "opc-old", production_order_id: "gone" })],
    locked: true,
  });
  const result = await L.syncScannedPieceRecords(db, PERIOD);
  assert.equal(state.writes, 0);
  assert.equal(state.records.length, 1);
  assert.equal(result.pending.length, 2);
});

test("approve syncs scanned pieces before it checks piece drift", () => {
  const source = readFileSync(resolve(process.cwd(), "src/api/routes/payslips.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(source.includes("await syncScannedPieceRecords(c.var.DB, period);\n      const pieceDrift"));
});
