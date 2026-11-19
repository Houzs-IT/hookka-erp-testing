import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BED_PO, SOFA_PO, WIP, makeFakeDb, stickerUrl } from "./_outsource-issue-fake.mjs";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Scope = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/sewing-scope.ts")).href);
const Issue = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href);

const ORG = "hookka";
const ALI = { id: "osc", empNo: "OSC-1", name: "Ali" };
const BALA = { id: "osc2", empNo: "OSC-2", name: "Bala" };
const divanQr = (piece) => stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=${piece}&t=2`);

async function issue(db, worker, qr) {
  const lookup = await Scope.sewingScopeFromSticker(db, qr);
  assert.equal(lookup.kind, "found");
  return Issue.issueItem(db, { orgId: ORG, worker, lookup, qrRaw: qr, issuedBy: "Office" });
}

test("issue: first scan issues as INCOMPLETE with snapshots, the second says already issued", async () => {
  const { db, state } = makeFakeDb();
  const first = await issue(db, ALI, divanQr(1));
  assert.equal(first.kind, "issued");
  assert.equal(first.issue.status, "INCOMPLETE");
  assert.equal(first.issue.workerName, "Ali");
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

  const secondPiece = await issue(db, ALI, divanQr(2));
  assert.equal(secondPiece.kind, "issued");
  assert.equal(state.issues.length, 2);
});

test("issue: an item whose Fabric Sewing is already done is refused", async () => {
  const { db, state } = makeFakeDb();
  state.cards.find((c) => c.id === "jc-headboard").status = "COMPLETED";
  const outcome = await issue(db, ALI, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`));
  assert.equal(outcome.kind, "already-sewn");
  assert.equal(state.issues.length, 0);
});

test("handover, enforce on: an outsourced worker with no issue is refused", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  const result = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope });
  assert.equal(result.kind, "refused");
  assert.equal(result.code, "NOT_ISSUED_TO_YOU");
});

test("handover, enforce on: an in-house worker on an issued item is refused", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  await issue(db, ALI, divanQr(1));
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  const inHouse = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "inhouse", scope });
  assert.equal(inHouse.kind, "refused");
  assert.equal(inHouse.code, "ISSUED_TO_OTHER");
  const otherOutsourced = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc2", scope });
  assert.equal(otherOutsourced.code, "ISSUED_TO_OTHER");
  const stillFree = await Issue.checkSewingHandover(db, {
    orgId: ORG, workerId: "inhouse", scope: { ...scope, pieceNo: 2 },
  });
  assert.equal(stillFree.kind, "none");
});

test("handover, enforce on: an in-house worker on a never-issued item is untouched", async () => {
  const { db } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  const scope = { productionOrderId: SOFA_PO.id, wipKey: null, pieceNo: null };
  const result = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "inhouse", scope });
  assert.equal(result.kind, "none");
});

test("handover: the holder completes, the issue closes once with a time, a second scan closes nothing", async () => {
  const { db, state } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  const issued = await issue(db, ALI, divanQr(1));
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };

  const holder = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope });
  assert.equal(holder.kind, "holder");
  assert.deepEqual(holder.issueIds, [issued.issue.id]);

  assert.equal(await Issue.closeSewingHandover(db, holder), 1);
  const row = state.issues[0];
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.completed_at instanceof Date);

  assert.equal(await Issue.closeSewingHandover(db, holder), 0);
  const rescan = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope });
  assert.equal(rescan.kind, "none");
  assert.equal(await Issue.closeSewingHandover(db, rescan), 0);
});

test("handover: a sofa scan closes the sofa issue, a Divan piece scan closes only that piece", async () => {
  const { db, state } = makeFakeDb();
  const sofa = await issue(db, ALI, stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_BASE`));
  const piece1 = await issue(db, ALI, divanQr(1));
  await issue(db, ALI, divanQr(2));

  const sofaScope = { productionOrderId: SOFA_PO.id, wipKey: null, pieceNo: null };
  const sofaHandover = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope: sofaScope });
  assert.deepEqual(sofaHandover.issueIds, [sofa.issue.id]);

  const pieceScope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  const pieceHandover = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope: pieceScope });
  assert.deepEqual(pieceHandover.issueIds, [piece1.issue.id]);
  await Issue.closeSewingHandover(db, pieceHandover);
  assert.deepEqual(state.issues.map((i) => i.status), ["INCOMPLETE", "COMPLETED", "INCOMPLETE"]);
});

test("handover, enforce off: no issue means sewing completes as it does today, an issue still closes", async () => {
  const { db } = makeFakeDb();
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  assert.equal((await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope })).kind, "none");
  assert.equal((await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "inhouse", scope })).kind, "none");
  await issue(db, ALI, divanQr(1));
  assert.equal((await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "inhouse", scope })).kind, "none");
  assert.equal((await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope })).kind, "holder");
});

test("undo: removes an INCOMPLETE issue, refuses after complete, reports a missing id", async () => {
  const { db, state } = makeFakeDb();
  const first = await issue(db, ALI, divanQr(1));
  const second = await issue(db, ALI, divanQr(2));
  const undone = await Issue.undoIssue(db, { orgId: ORG, id: first.issue.id });
  assert.equal(undone.kind, "undone");
  assert.equal(state.issues.length, 1);

  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 2 };
  await Issue.closeSewingHandover(db, await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope }));
  const refused = await Issue.undoIssue(db, { orgId: ORG, id: second.issue.id });
  assert.equal(refused.kind, "already-completed");
  assert.equal(state.issues.length, 1);

  assert.equal((await Issue.undoIssue(db, { orgId: ORG, id: "missing" })).kind, "not-found");
});

test("no re-issue after COMPLETED: the same item reports already issued", async () => {
  const { db } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  await Issue.closeSewingHandover(db, await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope }));
  const again = await issue(db, BALA, divanQr(1));
  assert.equal(again.kind, "already-issued");
  assert.equal(again.issue.status, "COMPLETED");
});

test("lists: tracking rows carry the live sewing status, the worker list splits Incomplete from Done", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  await issue(db, ALI, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`));
  state.cards.find((c) => c.id === "jc-headboard").status = "COMPLETED";

  const rows = await Issue.listIssues(db, { orgId: ORG, filter: {} });
  const byLabel = Object.fromEntries(rows.map((r) => [r.itemLabel, r.sewingDone]));
  assert.equal(byLabel.Headboard, true);
  assert.equal(byLabel['8" Divan'], false);

  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  await Issue.closeSewingHandover(db, await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope }));
  const lists = await Issue.listWorkerIssues(db, { orgId: ORG, workerId: "osc" });
  assert.equal(lists.incomplete.length, 1);
  assert.equal(lists.completedRecent.length, 1);
  assert.equal(lists.completedRecent[0].status, "COMPLETED");

  const workers = await Issue.listOutsourceWorkers(db, ORG);
  assert.deepEqual(workers.map((w) => [w.name, w.incompleteCount]), [["Ali", 1], ["Bala", 0]]);
});

test("every handler that can complete a FAB_SEW card for a worker checks before writing and closes after", () => {
  const source = readFileSync("src/api/routes/production-orders.ts", "utf8");
  for (const route of ["scan-complete", "scan-complete-dept", "scan-complete-shared"]) {
    const start = source.indexOf(`app.post("/:id/${route}"`);
    assert.ok(start > 0, route);
    const next = source.indexOf("\napp.", start + 10);
    const body = source.slice(start, next === -1 ? undefined : next);
    assert.match(body, /checkSewingHandover\(/, `${route} checks`);
    assert.match(body, /finishSewingHandover\(/, `${route} closes`);
    assert.ok(body.indexOf("checkSewingHandover(") < body.indexOf("finishSewingHandover("), route);
  }
});

test("handover, enforce on: a whole-card scan by one holder is refused while another worker holds a piece", async () => {
  const { db, state } = makeFakeDb({ kv: { "outsource_issue.enforce": true } });
  await issue(db, ALI, divanQr(1));
  await issue(db, BALA, divanQr(2));
  const wholeCard = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: null };
  const refused = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope: wholeCard });
  assert.equal(refused.kind, "refused");
  assert.equal(refused.code, "ISSUED_TO_OTHER");
  assert.match(refused.message, /Bala/);
  assert.deepEqual(state.issues.map((i) => i.status), ["INCOMPLETE", "INCOMPLETE"]);
});

test("issue: an overlapping scope on the same order is refused whatever the status", async () => {
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
      if (/outsource_issues/i.test(sql)) throw new Error("table unavailable");
      return db.prepare(sql);
    },
  };
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const result = await Issue.checkSewingHandover(broken, { orgId: ORG, workerId: "osc", scope });
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
      if (/outsource_issues/i.test(sql)) throw new Error("table unavailable");
      return db.prepare(sql);
    },
  };
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  await assert.rejects(() => Issue.checkSewingHandover(broken, { orgId: ORG, workerId: "osc", scope }), /table unavailable/);
});

test("finish: a failing sewn check is logged, never thrown", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  const holder = await Issue.checkSewingHandover(db, { orgId: ORG, workerId: "osc", scope });
  const original = console.error;
  console.error = () => {};
  try {
    await Issue.finishSewingHandover(db, holder, { productionOrderId: BED_PO.id, workerId: "osc" }, async () => {
      throw new Error("read failed");
    });
  } finally {
    console.error = original;
  }
  assert.equal(state.issues[0].status, "INCOMPLETE");
  await Issue.finishSewingHandover(db, holder, { productionOrderId: BED_PO.id, workerId: "osc" }, async () => true);
  assert.equal(state.issues[0].status, "COMPLETED");
});

test("already-done sewing: the holder's scan still closes the issue, someone else's scan does not", async () => {
  const { db, state } = makeFakeDb();
  await issue(db, ALI, divanQr(1));
  const scope = { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 };
  await Issue.closeIssuesHeldOnFinishedSewing(db, { orgId: ORG, workerId: "osc2", scope });
  assert.equal(state.issues[0].status, "INCOMPLETE");
  await Issue.closeIssuesHeldOnFinishedSewing(db, { orgId: ORG, workerId: "osc", scope });
  assert.equal(state.issues[0].status, "COMPLETED");
  assert.ok(state.issues[0].completed_at instanceof Date);
});
