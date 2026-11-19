import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BED_PO, SOFA_PO, WIP, defaultCards, defaultWorkers, extraDepartmentCards, makeFakeDb, stickerUrl } from "./_outsource-issue-fake.mjs";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Targets = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-targets.ts")).href);
const Issue = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href);

const ORG = "hookka";
const ALI = { id: "osc", empNo: "OSC-1", name: "Ali", departmentCodes: ["FAB_SEW"] };
const BALA = { id: "osc2", empNo: "OSC-2", name: "Bala", departmentCodes: ["FAB_SEW"] };
const WOODY = { id: "oscWood", empNo: "OSC-4", name: "Woody", departmentCodes: ["WOOD_CUT"] };
const divanQr = (piece) => stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=${piece}&t=2`);
const divan = (pieceNo) => ({ cardIds: ["jc-divan"], pieceNo });
const sofaTarget = { cardIds: ["jc-sofa-base", "jc-sofa-cushion"], pieceNo: null };
const context = { productionOrderId: BED_PO.id, workerId: "osc" };

async function issue(db, worker, qr) {
  const lookup = await Targets.resolveIssueTarget(db, { qr, departmentCodes: worker.departmentCodes });
  assert.equal(lookup.kind, "found");
  return Issue.issueItem(db, { orgId: ORG, worker, lookup, qrRaw: qr, issuedBy: "Office" });
}

const signPiece = (state, jobCardId, pieceNo) => state.slots.push({ jobCardId, pieceNo, pic1Id: "osc" });
const finishCard = (state, id) => { state.cards.find((c) => c.id === id).status = "COMPLETED"; };
const OUTSOURCED = new Set(["osc", "osc2", "oscWood"]);
const check = (db, workerId, target) =>
  Issue.checkIssueHandover(db, { orgId: ORG, workerId, target, scannerIsOutsource: OUTSOURCED.has(workerId) });

test("issue: first scan issues as INCOMPLETE with snapshots, the second says already issued", async () => {
  const { db, state } = makeFakeDb();
  const first = await issue(db, ALI, divanQr(1));
  assert.equal(first.kind, "issued");
  assert.equal(first.issue.status, "INCOMPLETE");
  assert.equal(first.issue.workerName, "Ali");
  assert.equal(first.issue.departmentCode, "FAB_SEW");
  assert.equal(first.issue.departmentName, "Fabric Sewing");
  assert.equal(first.issue.productCode, "1013");
  assert.equal(first.issue.poNo, "PO-BED");
  assert.equal(first.issue.pieceNo, 1);
  assert.equal(first.issue.totalPieces, 2);

  const again = await issue(db, ALI, divanQr(1));
  assert.equal(again.kind, "already-issued");
  assert.equal(again.issue.id, first.issue.id);
  const toOther = await issue(db, BALA, divanQr(1));
  assert.equal(toOther.kind, "already-issued");
  assert.equal(toOther.issue.workerName, "Ali");
  assert.equal(state.issues.length, 1);
  assert.deepEqual(state.issueCards.map((c) => [c.job_card_id, c.piece_no]), [["jc-divan", 1]]);

  const secondPiece = await issue(db, ALI, divanQr(2));
  assert.equal(secondPiece.kind, "issued");
  assert.equal(state.issues.length, 2);
});

test("issue: an item whose department work is already done is refused", async () => {
  const { db, state } = makeFakeDb();
  finishCard(state, "jc-headboard");
  const outcome = await issue(db, ALI, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`));
  assert.equal(outcome.kind, "already-done");
  assert.equal(state.issues.length, 0);
});

test("issue: two offices racing on one piece end with one issue and one already issued", async () => {
  const { db, state } = makeFakeDb();
  const [a, b] = await Promise.all([issue(db, ALI, divanQr(1)), issue(db, BALA, divanQr(1))]);
  assert.deepEqual([a.kind, b.kind].sort(), ["already-issued", "issued"]);
  assert.equal(state.issues.length, 1);
  assert.equal(state.issueCards.length, 1);
});

test("handover, enforce on: an outsourced worker with no issue is refused", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  const result = await check(db, "osc", divan(1));
  assert.equal(result.kind, "refused");
  assert.equal(result.code, "NOT_ISSUED_TO_YOU");
});

test("handover, enforce on: an in-house worker on an issued item is refused", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  await issue(db, ALI, divanQr(1));
  const inHouse = await check(db, "inhouse", divan(1));
  assert.equal(inHouse.kind, "refused");
  assert.equal(inHouse.code, "ISSUED_TO_OTHER");
  assert.equal((await check(db, "osc2", divan(1))).code, "ISSUED_TO_OTHER");
  assert.equal((await check(db, "inhouse", divan(2))).kind, "none");
});

test("handover, enforce on: an in-house worker on a never-issued item is untouched", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  assert.equal((await check(db, "inhouse", sofaTarget)).kind, "none");
});

test("handover, enforce on: an in-house scan of a non-sewing card issued to an outsourced worker is refused", async () => {
  const workers = [...defaultWorkers(), { id: "oscWood", empNo: "OSC-4", name: "Woody", status: "ACTIVE", isOutsource: true, departmentCode: "WOOD_CUT", departmentCodes: null }];
  const { db } = makeFakeDb({ cards: [...defaultCards(), ...extraDepartmentCards()], workers, kv: { "outsource_issue.enforce": true } });
  const issued = await issue(db, WOODY, stickerUrl(`op=jc-divan-cut&dept=FAB_CUT&po=${BED_PO.poNo}&p=1&t=2`));
  assert.equal(issued.kind, "issued");
  const target = { cardIds: ["jc-divan-wood"], pieceNo: 1 };
  const refused = await check(db, "inhouse", target);
  assert.equal(refused.code, "ISSUED_TO_OTHER");
  assert.match(refused.message, /Woody/);
  assert.equal((await check(db, "oscWood", target)).kind, "holder");
  assert.equal((await check(db, "inhouse", { cardIds: ["jc-divan-wood"], pieceNo: 2 })).kind, "none");
});

test("handover: the holder completes, the issue closes once with a time, a second scan closes nothing", async () => {
  const { db, state } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  const issued = await issue(db, ALI, divanQr(1));

  const holder = await check(db, "osc", divan(1));
  assert.equal(holder.kind, "holder");
  assert.deepEqual(holder.issueIds, [issued.issue.id]);

  await Issue.finishIssueHandover(db, holder, context);
  assert.equal(state.issues[0].status, "INCOMPLETE");

  signPiece(state, "jc-divan", 1);
  await Issue.finishIssueHandover(db, holder, context);
  const row = state.issues[0];
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.completed_at instanceof Date);

  const closedAt = row.completed_at;
  await Issue.finishIssueHandover(db, holder, context);
  assert.equal(row.completed_at, closedAt);
  const rescan = await check(db, "osc", divan(1));
  assert.equal(rescan.kind, "none");
});

test("handover: a sofa issue stays open until every card of the variant is done, a Divan piece closes alone", async () => {
  const { db, state } = makeFakeDb();
  const sofa = await issue(db, ALI, stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_BASE`));
  const piece1 = await issue(db, ALI, divanQr(1));
  await issue(db, ALI, divanQr(2));
  assert.deepEqual(state.issueCards.filter((c) => c.issue_id === sofa.issue.id).map((c) => c.job_card_id), sofaTarget.cardIds);

  const sofaHandover = await check(db, "osc", { cardIds: ["jc-sofa-base"], pieceNo: null });
  assert.deepEqual(sofaHandover.issueIds, [sofa.issue.id]);
  finishCard(state, "jc-sofa-base");
  await Issue.finishIssueHandover(db, sofaHandover, context);
  assert.equal(state.issues[0].status, "INCOMPLETE");

  finishCard(state, "jc-sofa-cushion");
  await Issue.finishIssueHandover(db, sofaHandover, context);
  assert.equal(state.issues[0].status, "COMPLETED");

  const pieceHandover = await check(db, "osc", divan(1));
  assert.deepEqual(pieceHandover.issueIds, [piece1.issue.id]);
  signPiece(state, "jc-divan", 1);
  await Issue.finishIssueHandover(db, pieceHandover, context);
  assert.deepEqual(state.issues.map((i) => i.status), ["COMPLETED", "COMPLETED", "INCOMPLETE"]);
});

test("close: a fan-out scan completing more than the issue covers closes it", async () => {
  const { db, state } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  await issue(db, ALI, divanQr(1));
  const fanOut = { cardIds: ["jc-divan", "jc-headboard"], pieceNo: null };
  const holder = await check(db, "osc", fanOut);
  assert.equal(holder.kind, "holder");
  finishCard(state, "jc-divan");
  finishCard(state, "jc-headboard");
  await Issue.finishIssueHandover(db, holder, context);
  assert.equal(state.issues[0].status, "COMPLETED");
});

test("handover, enforce off: no issue means the work completes as it does today, an issue still closes", async () => {
  const { db } = makeFakeDb();
  assert.equal((await check(db, "osc", divan(1))).kind, "none");
  assert.equal((await check(db, "inhouse", divan(1))).kind, "none");
  await issue(db, ALI, divanQr(1));
  assert.equal((await check(db, "inhouse", divan(1))).kind, "none");
  assert.equal((await check(db, "osc", divan(1))).kind, "holder");
});

test("undo: removes an INCOMPLETE issue and its cards, refuses after complete, reports a missing id", async () => {
  const { db, state } = makeFakeDb();
  const first = await issue(db, ALI, divanQr(1));
  const second = await issue(db, ALI, divanQr(2));
  const undone = await Issue.undoIssue(db, { orgId: ORG, id: first.issue.id });
  assert.equal(undone.kind, "undone");
  assert.equal(state.issues.length, 1);
  assert.deepEqual(state.issueCards.map((c) => c.issue_id), [second.issue.id]);
  assert.equal((await issue(db, BALA, divanQr(1))).kind, "issued");

  signPiece(state, "jc-divan", 2);
  await Issue.finishIssueHandover(db, await check(db, "osc", divan(2)), context);
  const refused = await Issue.undoIssue(db, { orgId: ORG, id: second.issue.id });
  assert.equal(refused.kind, "already-completed");
  assert.equal(state.issues.length, 2);

  assert.equal((await Issue.undoIssue(db, { orgId: ORG, id: "missing" })).kind, "not-found");
});

test("no re-issue after COMPLETED: the same item reports already issued", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  signPiece(state, "jc-divan", 1);
  await Issue.finishIssueHandover(db, await check(db, "osc", divan(1)), context);
  const again = await issue(db, BALA, divanQr(1));
  assert.equal(again.kind, "already-issued");
  assert.equal(again.issue.status, "COMPLETED");
});

test("lists: tracking rows carry the live work status, the worker list splits Incomplete from Done", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  await issue(db, ALI, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`));
  finishCard(state, "jc-headboard");

  const rows = await Issue.listIssues(db, { orgId: ORG, filter: {} });
  const byLabel = Object.fromEntries(rows.map((r) => [r.itemLabel, r.workDone]));
  assert.equal(byLabel.Headboard, true);
  assert.equal(byLabel['8" Divan'], false);
  assert.ok(rows.every((r) => r.departmentName === "Fabric Sewing"));

  signPiece(state, "jc-divan", 1);
  await Issue.finishIssueHandover(db, await check(db, "osc", divan(1)), context);
  const lists = await Issue.listWorkerIssues(db, { orgId: ORG, workerId: "osc" });
  assert.equal(lists.incomplete.length, 1);
  assert.equal(lists.completedRecent.length, 1);
  assert.equal(lists.completedRecent[0].status, "COMPLETED");
  assert.equal(lists.completedRecent[0].departmentName, "Fabric Sewing");

  const workers = await Issue.listOutsourceWorkers(db, ORG);
  assert.deepEqual(workers.map((w) => [w.name, w.incompleteCount, w.departmentNames]), [["Ali", 1, ["Fabric Sewing"]], ["Bala", 0, ["Fabric Sewing"]]]);
});

test("every handler that completes cards for a worker checks before the first write and closes after", () => {
  const source = readFileSync("src/api/routes/production-orders.ts", "utf8");
  for (const route of ["scan-complete", "scan-complete-dept", "scan-complete-shared"]) {
    const start = source.indexOf(`app.post("/:id/${route}"`);
    assert.ok(start > 0, route);
    const next = source.indexOf("\napp.", start + 10);
    const body = source.slice(start, next === -1 ? undefined : next);
    assert.match(body, /checkIssueHandover\(/, `${route} checks`);
    assert.match(body, /finishIssueHandover\(/, `${route} closes`);
    assert.ok(body.indexOf("checkIssueHandover(") < body.indexOf("finishIssueHandover("), route);
    assert.doesNotMatch(body, /departmentCode === "FAB_SEW"\)\s*\{\s*(cardSewingScope|sewingHandover)/, route);
    const check = body.indexOf("checkIssueHandover(");
    const firstWrite = route === "scan-complete" ? body.indexOf("// Fill the piece slot(s).") : body.search(/UPDATE piece_pics SET (pic1Id|pic2Id)/);
    assert.ok(check < firstWrite, `${route} checks before the first piece write`);
    if (route !== "scan-complete") {
      assert.ok(check > body.indexOf("gateFanOutSequence("), `${route} checks after the sequence lock`);
    }
  }
});

test("handover, enforce on: a whole-card scan by one holder is refused while another worker holds a piece", async () => {
  const { db, state } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  await issue(db, ALI, divanQr(1));
  await issue(db, BALA, divanQr(2));
  const refused = await check(db, "osc", divan(null));
  assert.equal(refused.kind, "refused");
  assert.equal(refused.code, "ISSUED_TO_OTHER");
  assert.match(refused.message, /Bala/);
  assert.deepEqual(state.issues.map((i) => i.status), ["INCOMPLETE", "INCOMPLETE"]);
});

test("issue: an overlapping card and piece is refused whatever the status", async () => {
  const { db, state } = makeFakeDb();
  const piece1 = await issue(db, ALI, divanQr(1));
  await issue(db, ALI, divanQr(2));
  const sentinel = await issue(db, BALA, stickerUrl(`op=FG-FAB_SEW&po=${BED_PO.poNo}`));
  assert.equal(sentinel.kind, "already-issued");
  const wholeDivan = await issue(db, BALA, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN`));
  assert.equal(wholeDivan.kind, "already-issued");
  assert.equal(state.issues.length, 2);
  const headboard = await issue(db, BALA, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`));
  assert.equal(headboard.kind, "issued");
  state.issues[0].status = "COMPLETED";
  assert.equal((await issue(db, BALA, divanQr(1))).issue.id, piece1.issue.id);
});

test("handover, enforce off: a failing issue lookup logs and never blocks the scan", async () => {
  const { db } = makeFakeDb();
  const broken = {
    prepare(sql) {
      if (/outsource_issue/i.test(sql)) throw new Error("table unavailable");
      return db.prepare(sql);
    },
  };
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const result = await check(broken, "osc", divan(1));
    assert.equal(result.kind, "none");
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
});

test("handover, enforce on: a failing issue lookup propagates", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  const broken = {
    prepare(sql) {
      if (/outsource_issue/i.test(sql)) throw new Error("table unavailable");
      return db.prepare(sql);
    },
  };
  await assert.rejects(() => check(broken, "osc", divan(1)), /table unavailable/);
});

test("finish: a failing done check is logged, never thrown, and the issue stays open", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  const holder = await check(db, "osc", divan(1));
  signPiece(state, "jc-divan", 1);
  const broken = {
    prepare(sql) {
      if (/FROM job_cards WHERE id IN/i.test(sql)) throw new Error("read failed");
      return db.prepare(sql);
    },
    batch: (statements) => db.batch(statements),
  };
  const original = console.error;
  console.error = () => {};
  try {
    await Issue.finishIssueHandover(broken, holder, context);
  } finally {
    console.error = original;
  }
  assert.equal(state.issues[0].status, "INCOMPLETE");
  await Issue.finishIssueHandover(db, holder, context);
  assert.equal(state.issues[0].status, "COMPLETED");
});

test("already-done work: the holder's scan still closes the issue, someone else's scan does not", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  signPiece(state, "jc-divan", 1);
  const loadTarget = async () => divan(1);
  await Issue.closeHeldIssuesWhenDone(db, { orgId: ORG, workerId: "osc2", loadTarget });
  assert.equal(state.issues[0].status, "INCOMPLETE");
  await Issue.closeHeldIssuesWhenDone(db, { orgId: ORG, workerId: "osc", loadTarget });
  assert.equal(state.issues[0].status, "COMPLETED");
  assert.ok(state.issues[0].completed_at instanceof Date);
});

test("table setup: legacy issues without cards get their Fabric Sewing cards once, idempotently", async () => {
  const library = pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href;
  const fresh = await import(`${library}?backfill=1`);
  const { db, state } = makeFakeDb();
  state.issues.push(
    { id: "oi-legacy", org_id: ORG, worker_id: "osc", production_order_id: BED_PO.id, wip_key: WIP.divan, piece_no: 1, status: "INCOMPLETE" },
    { id: "oi-sofa", org_id: ORG, worker_id: "osc", production_order_id: SOFA_PO.id, wip_key: null, piece_no: null, status: "INCOMPLETE" },
  );
  await fresh.ensureOutsourceIssueTable(db);
  const cards = () => state.issueCards.map((c) => [c.issue_id, c.job_card_id, c.piece_no]);
  assert.deepEqual(cards(), [
    ["oi-legacy", "jc-divan", 1],
    ["oi-sofa", "jc-sofa-base", null],
    ["oi-sofa", "jc-sofa-cushion", null],
  ]);
  const before = cards();
  const again = await import(`${library}?backfill=2`);
  await again.ensureOutsourceIssueTable(db);
  assert.deepEqual(cards(), before);
});

const spyOn = (db, log) => ({
  prepare(sql) {
    log.push(sql);
    return db.prepare(sql);
  },
  batch: (statements) => db.batch(statements),
});

test("hot path: an in-house scan with enforce off and no issue on the cards reads once and never touches kv", async () => {
  const { db } = makeFakeDb();
  const log = [];
  const result = await check(spyOn(db, log), "inhouse", divan(1));
  assert.equal(result.kind, "none");
  assert.equal(log.filter((sql) => /kv_config/i.test(sql)).length, 0);
  assert.equal(log.length, 1);
});

test("hot path: an in-house scan on an issued card reads kv, enforce on refuses, off lets it through", async () => {
  const on = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  await issue(on.db, ALI, divanQr(1));
  assert.equal((await check(on.db, "inhouse", divan(1))).code, "ISSUED_TO_OTHER");
  const off = makeFakeDb();
  await issue(off.db, ALI, divanQr(1));
  assert.equal((await check(off.db, "inhouse", divan(1))).kind, "none");
});

test("hot path: an outsourced scanner holding the issue does not need the enforce switch", async () => {
  const { db } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  const log = [];
  assert.equal((await check(spyOn(db, log), "osc", divan(1))).kind, "holder");
  assert.equal(log.filter((sql) => /kv_config/i.test(sql)).length, 0);
});

test("hot path: the table setup only runs when the table is missing", async () => {
  const library = pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href;
  const fresh = await import(`${library}?hot=1`);
  const { db, state } = makeFakeDb();
  const request = { orgId: ORG, workerId: "inhouse", target: divan(1), scannerIsOutsource: false };
  assert.equal((await fresh.checkIssueHandover(db, request)).kind, "none");
  assert.equal(state.creates, 0);

  let failed = false;
  const missing = {
    prepare(sql) {
      if (!failed && /FROM outsource_issue_cards/i.test(sql)) {
        failed = true;
        throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      }
      return db.prepare(sql);
    },
    batch: (statements) => db.batch(statements),
  };
  assert.equal((await fresh.checkIssueHandover(missing, request)).kind, "none");
  assert.ok(state.creates > 0);
});

test("already-done lookup failing is logged and never thrown", async () => {
  const { db } = makeFakeDb();
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await Issue.closeHeldIssuesWhenDone(db, {
      orgId: ORG,
      workerId: "osc",
      loadTarget: async () => { throw new Error("select failed"); },
    });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
});

test("undo: a completed issue keeps its issue and its cards", async () => {
  const { db, state } = makeFakeDb();
  const kept = await issue(db, ALI, divanQr(1));
  signPiece(state, "jc-divan", 1);
  await Issue.finishIssueHandover(db, await check(db, "osc", divan(1)), context);
  assert.equal((await Issue.undoIssue(db, { orgId: ORG, id: kept.issue.id })).kind, "already-completed");
  assert.equal(state.issueCards.length, 1);
  assert.equal(state.issues.length, 1);
});

test("the runtime setup SQL translates to snake_case columns and the migration quotes no camelCase", async () => {
  const { translateSql } = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/supabase-compat.ts")).href);
  const translated = Issue.OUTSOURCE_ISSUE_DDL.map((statement) => translateSql(statement));
  for (const sql of translated) assert.doesNotMatch(sql, /[a-z][A-Z]/, sql);
  const backfill = translated.find((sql) => /^INSERT INTO outsource_issue_cards/i.test(sql.trim()));
  assert.match(backfill, /jc\.production_order_id/);
  assert.match(backfill, /jc\.department_code/);
  assert.match(backfill, /jc\.wip_key/);

  const migration = readFileSync("migrations-postgres/0258_outsource_issue_cards.sql", "utf8");
  assert.doesNotMatch(migration, /"[a-z]+[A-Z][A-Za-z]*"/);
  assert.match(migration, /jc\.production_order_id/);
  assert.match(migration, /jc\.department_code/);
  assert.match(migration, /jc\.wip_key/);
});
