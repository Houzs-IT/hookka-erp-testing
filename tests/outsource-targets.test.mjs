import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BED_PO, SOFA_PO, WIP, defaultCards, extraDepartmentCards, makeFakeDb, stickerUrl } from "./_outsource-issue-fake.mjs";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Targets = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-targets.ts")).href);
const { deriveBarcodeToken } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/job-card-id.ts")).href);

const allCards = () => [...defaultCards(), ...extraDepartmentCards()];
const resolveFor = (db, qr, ...departmentCodes) => Targets.resolveIssueTarget(db, { qr, departmentCodes });

test("FAB_SEW: a Divan piece sticker targets that card and piece", async () => {
  const { db } = makeFakeDb();
  const result = await resolveFor(db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=1&t=2`), "FAB_SEW");
  assert.equal(result.kind, "found");
  assert.equal(result.departmentCode, "FAB_SEW");
  assert.deepEqual(result.target, { cardIds: ["jc-divan"], pieceNo: 1 });
  assert.equal(result.totalPieces, 2);
  assert.equal(result.itemLabel, '8" Divan');
  assert.equal(result.isDone, false);
});

test("FAB_SEW: a sofa compartment targets the whole variant, c= and wk= agree, hosts agree", async () => {
  const { db } = makeFakeDb();
  const sofa = await resolveFor(db, stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_BASE&p=1&t=2`), "FAB_SEW");
  assert.deepEqual(sofa.target, { cardIds: ["jc-sofa-base", "jc-sofa-cushion"], pieceNo: null });
  const short = await resolveFor(db, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`), "FAB_SEW");
  const legacy = await resolveFor(db, stickerUrl(`po=${BED_PO.poNo}&wk=${encodeURIComponent(WIP.headboard)}`), "FAB_SEW");
  assert.deepEqual(short.target, legacy.target);
  const query = `po=${BED_PO.poNo}&c=DIVAN&p=2&t=2`;
  const onProd = await resolveFor(db, stickerUrl(query, "https://erp.hookka.com"), "FAB_SEW");
  const onPages = await resolveFor(db, stickerUrl(query, "https://hookka-erp.pages.dev"), "FAB_SEW");
  assert.deepEqual(onProd.target, onPages.target);
});

test("FAB_SEW: the FG sentinel targets every card of the department, jc= targets that one card", async () => {
  const { db } = makeFakeDb();
  const sentinel = await resolveFor(db, stickerUrl(`op=FG-FAB_SEW&po=${BED_PO.poNo}`), "FAB_SEW");
  assert.deepEqual(sentinel.target, { cardIds: ["jc-divan", "jc-headboard"], pieceNo: null });
  const byCard = await resolveFor(db, stickerUrl(`op=FG-FAB_SEW&po=WRONG-PO&jc=jc-headboard`), "FAB_SEW");
  assert.equal(byCard.kind, "found");
  assert.deepEqual(byCard.target.cardIds, ["jc-headboard"]);
});

test("not a sticker, unknown order and unknown compartment are told apart", async () => {
  const { db } = makeFakeDb();
  for (const raw of ["HKRACK:rack-1", "HKITEM:Pillow", "hello", "", stickerUrl("c=DIVAN")]) {
    assert.equal((await resolveFor(db, raw, "FAB_SEW")).kind, "not-a-sticker", raw);
  }
  assert.equal((await resolveFor(db, stickerUrl("po=NOPE&c=DIVAN"), "FAB_SEW")).kind, "order-not-found");
  const none = await resolveFor(db, stickerUrl(`po=${BED_PO.poNo}&c=ARMREST`), "FAB_SEW");
  assert.deepEqual(none, { kind: "no-card-for-department", departmentCodes: ["FAB_SEW"] });
  assert.equal((await resolveFor(db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN`))).kind, "no-worker-department");
});

test("a finished card, or a piece slot already scanned, reads as done", async () => {
  const finished = makeFakeDb();
  finished.state.cards.find((c) => c.id === "jc-divan").status = "COMPLETED";
  assert.equal((await resolveFor(finished.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=1&t=2`), "FAB_SEW")).isDone, true);

  const pieces = makeFakeDb({ slots: [{ jobCardId: "jc-divan", pieceNo: 1, pic1Id: "osc" }, { jobCardId: "jc-divan", pieceNo: 2, pic1Id: null }] });
  assert.equal((await resolveFor(pieces.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=1&t=2`), "FAB_SEW")).isDone, true);
  assert.equal((await resolveFor(pieces.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=2&t=2`), "FAB_SEW")).isDone, false);
  assert.equal((await resolveFor(pieces.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN`), "FAB_SEW")).isDone, false);
});

test("UPHOLSTERY: a sofa compartment sticker targets the upholstery cards, not the sewing ones", async () => {
  const { db } = makeFakeDb({ cards: allCards() });
  const result = await resolveFor(db, stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_BASE`), "UPHOLSTERY");
  assert.equal(result.departmentCode, "UPHOLSTERY");
  assert.deepEqual(result.target, { cardIds: ["jc-sofa-base-uph", "jc-sofa-cushion-uph"], pieceNo: null });
});

test("WOOD_CUT: a per-card sticker of a FAB_CUT card targets the wood card of the same compartment", async () => {
  const { db } = makeFakeDb({ cards: allCards() });
  const result = await resolveFor(db, stickerUrl(`op=jc-divan-cut&dept=FAB_CUT&po=${BED_PO.poNo}&p=1&t=2`), "WOOD_CUT");
  assert.equal(result.kind, "found");
  assert.deepEqual(result.target, { cardIds: ["jc-divan-wood"], pieceNo: 1 });
});

test("FAB_CUT: the FG-FAB_CUT sentinel targets every cutting card of the order", async () => {
  const { db } = makeFakeDb({ cards: allCards() });
  const result = await resolveFor(db, stickerUrl(`op=FG-FAB_CUT&po=${BED_PO.poNo}`), "FAB_CUT");
  assert.deepEqual(result.target, { cardIds: ["jc-divan-cut", "jc-headboard-cut"], pieceNo: null });
});

test("PACKING: an FG-PACKING sticker with jc= targets that packing card and piece, a schedule token the whole card", async () => {
  const { db } = makeFakeDb();
  const piece = await resolveFor(db, stickerUrl(`op=FG-PACKING&po=${BED_PO.poNo}&jc=jc-divan-pack&p=1&t=2`), "PACKING");
  assert.deepEqual(piece.target, { cardIds: ["jc-divan-pack"], pieceNo: 1 });
  const token = deriveBarcodeToken("jc-divan-pack", "PACKING");
  const whole = await resolveFor(db, token, "PACKING");
  assert.equal(whole.kind, "found");
  assert.deepEqual(whole.target, { cardIds: ["jc-divan-pack"], pieceNo: null });
});

test("a worker in two departments: both open is ambiguous, one open picks that one", async () => {
  const { db, state } = makeFakeDb({ cards: allCards() });
  const qr = stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_BASE`);
  const both = await resolveFor(db, qr, "FAB_SEW", "UPHOLSTERY");
  assert.deepEqual(both, { kind: "ambiguous-department", departments: ["FAB_SEW", "UPHOLSTERY"] });

  for (const id of ["jc-sofa-base", "jc-sofa-cushion"]) state.cards.find((c) => c.id === id).status = "COMPLETED";
  const one = await resolveFor(db, qr, "FAB_SEW", "UPHOLSTERY");
  assert.equal(one.kind, "found");
  assert.equal(one.departmentCode, "UPHOLSTERY");

  for (const id of ["jc-sofa-base-uph", "jc-sofa-cushion-uph"]) state.cards.find((c) => c.id === id).status = "COMPLETED";
  const none = await resolveFor(db, qr, "FAB_SEW", "UPHOLSTERY");
  assert.equal(none.kind, "found");
  assert.equal(none.isDone, true);
});


const packingToken = (id) => (id === "jc-divan-pack" ? "a" : "b").repeat(64);
const withPackingTokens = () => {
  const made = makeFakeDb({ cards: allCards() });
  for (const id of ["jc-divan-pack", "jc-headboard-pack"]) made.state.cards.find((c) => c.id === id).qr_token = packingToken(id);
  return made;
};

test("PACKING: FG-PACKING with pn= narrows a Divan + Headboard order to exactly one packing card", async () => {
  const { db } = withPackingTokens();
  const divan = await resolveFor(db, stickerUrl(`op=FG-PACKING&po=${BED_PO.poNo}&pn=${encodeURIComponent('8" Divan')}`), "PACKING");
  assert.deepEqual(divan.target.cardIds, ["jc-divan-pack"]);
  assert.equal(divan.itemLabel, '8" Divan');
  const unnarrowed = await resolveFor(db, stickerUrl(`op=FG-PACKING&po=${BED_PO.poNo}&pn=NOPE`), "PACKING");
  assert.deepEqual(unnarrowed.target.cardIds, ["jc-divan-pack", "jc-headboard-pack"]);
  assert.equal(unnarrowed.itemLabel, "Bedframe King");
});

test("PACKING: a /p/<token>?p=N sticker resolves to that packing card and piece", async () => {
  const { db } = withPackingTokens();
  const url = `https://erp.hookka.com/p/${packingToken("jc-headboard-pack")}?p=1`;
  const result = await resolveFor(db, url, "PACKING");
  assert.equal(result.kind, "found");
  assert.deepEqual(result.target, { cardIds: ["jc-headboard-pack"], pieceNo: 1 });
  const bare = await resolveFor(db, `https://erp.hookka.com/p/${packingToken("jc-divan-pack")}`, "PACKING");
  assert.deepEqual(bare.target, { cardIds: ["jc-divan-pack"], pieceNo: null });
  const unknown = await resolveFor(db, `https://erp.hookka.com/p/${"c".repeat(64)}`, "PACKING");
  assert.equal(unknown.kind, "order-not-found");
});

test("item label: one compartment uses its card label, a spread of compartments uses the order description", async () => {
  const { db } = makeFakeDb({ cards: allCards() });
  const piece = await resolveFor(db, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`), "FAB_SEW");
  assert.equal(piece.itemLabel, "Headboard");
  const spread = await resolveFor(db, stickerUrl(`op=FG-FAB_SEW&po=${BED_PO.poNo}`), "FAB_SEW");
  assert.equal(spread.itemLabel, "Bedframe King");
  const sofa = await resolveFor(db, stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_CUSHION`), "FAB_SEW");
  assert.equal(sofa.itemLabel, "5530-1A Cushion");
  const sofaByCard = await resolveFor(db, stickerUrl(`op=jc-sofa-base-uph&dept=UPHOLSTERY&po=${SOFA_PO.poNo}`), "UPHOLSTERY");
  assert.equal(sofaByCard.itemLabel, "5530-1A Base");
});

test("the sofa whole-variant rule comes from the shared predicate, for any department", async () => {
  const Scope = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/sewing-scope.ts")).href);
  assert.equal(Scope.isSofaWipType("SOFA_BASE"), true);
  assert.equal(Scope.isSofaWipType("DIVAN"), false);
  assert.equal(Scope.isSofaWipType(null), false);
  const source = (await import("node:fs")).readFileSync("src/api/lib/outsource-targets.ts", "utf8");
  assert.doesNotMatch(source, /SOFA_DEPARTMENTS|function isSofaCard/);
});

test("target builders: single card keeps its piece, a fan-out lists every card it was given", () => {
  assert.deepEqual(Targets.singleCardTarget("jc-1", 2), { cardIds: ["jc-1"], pieceNo: 2 });
  assert.deepEqual(Targets.singleCardTarget("jc-1", null), { cardIds: ["jc-1"], pieceNo: null });
  assert.deepEqual(Targets.fanOutTarget([{ id: "a" }, { id: "b" }], null), { cardIds: ["a", "b"], pieceNo: null });
  assert.deepEqual(Targets.fanOutTarget([{ id: "a" }], 3), { cardIds: ["a"], pieceNo: 3 });
});

test("worker departments come from departmentCodes first, then departmentCode", async () => {
  const { workerDepartmentCodes } = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href);
  assert.deepEqual(workerDepartmentCodes({ departmentCode: "FAB_SEW", departmentCodes: '["UPHOLSTERY","PACKING"]' }), ["UPHOLSTERY", "PACKING"]);
  assert.deepEqual(workerDepartmentCodes({ departmentCode: "FAB_SEW", departmentCodes: "[]" }), ["FAB_SEW"]);
  assert.deepEqual(workerDepartmentCodes({ departmentCode: null, departmentCodes: null }), []);
  const source = (await import("node:fs")).readFileSync("src/api/lib/outsource-targets.ts", "utf8");
  assert.doesNotMatch(source, /workerDepartments/);
});

test("each completion handler builds its target from the cards it writes", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/api/routes/production-orders.ts", "utf8");
  const bodyOf = (route) => {
    const start = source.indexOf(`app.post("/:id/${route}"`);
    const next = source.indexOf("\napp.", start + 10);
    return source.slice(start, next === -1 ? undefined : next);
  };
  assert.match(bodyOf("scan-complete"), /target: singleCardTarget\(target\.jc\.id, wholeCard \? null : target\.slot\.pieceNo\)/);
  assert.match(bodyOf("scan-complete-dept"), /target: fanOutTarget\(cards, null\)/);
  const shared = bodyOf("scan-complete-shared");
  assert.match(shared, /target: fanOutTarget\(cards, pieceNo \?\? null\)/);
  assert.match(shared, /loadTarget: async \(\) =>/);
  for (const route of ["scan-complete", "scan-complete-dept", "scan-complete-shared"]) {
    assert.match(bodyOf(route), /scannerIsOutsource: isTruthyFlag\(worker\.isOutsource\)/, route);
  }
});
