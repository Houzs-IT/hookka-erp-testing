import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BED_PO, SOFA_PO, WIP, makeFakeDb, stickerUrl } from "./_outsource-issue-fake.mjs";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Scope = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/sewing-scope.ts")).href);
const Issue = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href);

test("resolveSewingScope: a sofa compartment drops to the whole variant, bedframe keeps wipKey and piece", async () => {
  const { db } = makeFakeDb();
  const sofa = await Scope.resolveSewingScope(db, { productionOrderId: SOFA_PO.id, wipKey: WIP.sofaBase, pieceNo: 1 });
  assert.deepEqual(sofa, { productionOrderId: SOFA_PO.id, wipKey: null, pieceNo: null });
  const divan = await Scope.resolveSewingScope(db, { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 2 });
  assert.deepEqual(divan, { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 2 });
  const legacy = await Scope.resolveSewingScope(db, { productionOrderId: BED_PO.id });
  assert.deepEqual(legacy, { productionOrderId: BED_PO.id, wipKey: null, pieceNo: null });
});

test("sticker: sofa compartment sticker scopes the whole variant", async () => {
  const { db } = makeFakeDb();
  const result = await Scope.sewingScopeFromSticker(db, stickerUrl(`po=${SOFA_PO.poNo}&c=SOFA_BASE`));
  assert.equal(result.kind, "found");
  assert.deepEqual(result.scope, { productionOrderId: SOFA_PO.id, wipKey: null, pieceNo: null });
  assert.equal(result.isSewn, false);
});

test("sticker: Divan p=1&t=2 scopes that one piece", async () => {
  const { db } = makeFakeDb();
  const result = await Scope.sewingScopeFromSticker(db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=1&t=2`));
  assert.equal(result.kind, "found");
  assert.deepEqual(result.scope, { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 1 });
  assert.equal(result.totalPieces, 2);
  assert.equal(result.itemLabel, '8" Divan');
});

test("sticker: c= and legacy wk= give the same scope", async () => {
  const { db } = makeFakeDb();
  const short = await Scope.sewingScopeFromSticker(db, stickerUrl(`po=${BED_PO.poNo}&c=HEADBOARD`));
  const legacy = await Scope.sewingScopeFromSticker(db, stickerUrl(`po=${BED_PO.poNo}&wk=${encodeURIComponent(WIP.headboard)}`));
  assert.deepEqual(short.scope, legacy.scope);
  assert.equal(short.scope.wipKey, WIP.headboard);
});

test("sticker: pages.dev and erp.hookka.com stickers are the same item key", async () => {
  const { db } = makeFakeDb();
  const query = `po=${BED_PO.poNo}&c=DIVAN&p=2&t=2`;
  const onProd = await Scope.sewingScopeFromSticker(db, stickerUrl(query, "https://erp.hookka.com"));
  const onPages = await Scope.sewingScopeFromSticker(db, stickerUrl(query, "https://hookka-erp.pages.dev"));
  assert.equal(Issue.itemKeyOf(onProd.scope), Issue.itemKeyOf(onPages.scope));
  assert.equal(Issue.itemKeyOf(onProd.scope), `${BED_PO.id}|${WIP.divan}|2`);
});

test("sticker: FG-FAB_SEW sentinel scopes the whole order", async () => {
  const { db } = makeFakeDb();
  const result = await Scope.sewingScopeFromSticker(db, stickerUrl(`op=FG-FAB_SEW&po=${BED_PO.poNo}`));
  assert.equal(result.kind, "found");
  assert.deepEqual(result.scope, { productionOrderId: BED_PO.id, wipKey: null, pieceNo: null });
});

test("sticker: jc= resolves the order before po=", async () => {
  const { db } = makeFakeDb();
  const result = await Scope.sewingScopeFromSticker(db, stickerUrl(`op=FG-FAB_SEW&po=WRONG-PO&jc=jc-headboard`));
  assert.equal(result.kind, "found");
  assert.equal(result.scope.productionOrderId, BED_PO.id);
});

test("sticker: rack, item, schedule, packing and junk codes are refused", async () => {
  const { db } = makeFakeDb();
  for (const raw of [
    "HKRACK:rack-1",
    "HKITEM:Pillow",
    "b0212345678",
    "hello",
    "",
    stickerUrl(`op=FG-PACKING&po=${BED_PO.poNo}`),
    stickerUrl("c=DIVAN"),
  ]) {
    const result = await Scope.sewingScopeFromSticker(db, raw);
    assert.equal(result.kind, "not-a-sewing-sticker", raw);
  }
});

test("sticker: unknown order and unknown compartment are told apart", async () => {
  const { db } = makeFakeDb();
  assert.equal((await Scope.sewingScopeFromSticker(db, stickerUrl("po=NOPE&c=DIVAN"))).kind, "order-not-found");
  assert.equal((await Scope.sewingScopeFromSticker(db, stickerUrl(`po=${BED_PO.poNo}&c=ARMREST`))).kind, "compartment-not-found");
});

test("isSewn: a finished card, or a piece slot already scanned, reads as sewn", async () => {
  const finished = makeFakeDb();
  finished.state.cards.find((c) => c.id === "jc-divan").status = "COMPLETED";
  const done = await Scope.sewingScopeFromSticker(finished.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=1&t=2`));
  assert.equal(done.isSewn, true);

  const pieces = makeFakeDb({ slots: [{ jobCardId: "jc-divan", pieceNo: 1, pic1Id: "osc" }, { jobCardId: "jc-divan", pieceNo: 2, pic1Id: null }] });
  const first = await Scope.sewingScopeFromSticker(pieces.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=1&t=2`));
  const second = await Scope.sewingScopeFromSticker(pieces.db, stickerUrl(`po=${BED_PO.poNo}&c=DIVAN&p=2&t=2`));
  assert.equal(first.isSewn, true);
  assert.equal(second.isSewn, false);
});
