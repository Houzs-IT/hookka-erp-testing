import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BED_PO, SOFA_PO, WIP, makeFakeDb } from "./_outsource-issue-fake.mjs";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const Scope = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/sewing-scope.ts")).href);

test("resolveSewingScope: a sofa compartment drops to the whole variant, bedframe keeps wipKey and piece", async () => {
  const { db } = makeFakeDb();
  const sofa = await Scope.resolveSewingScope(db, { productionOrderId: SOFA_PO.id, wipKey: WIP.sofaBase, pieceNo: 1 });
  assert.deepEqual(sofa, { productionOrderId: SOFA_PO.id, wipKey: null, pieceNo: null });
  const divan = await Scope.resolveSewingScope(db, { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 2 });
  assert.deepEqual(divan, { productionOrderId: BED_PO.id, wipKey: WIP.divan, pieceNo: 2 });
  const legacy = await Scope.resolveSewingScope(db, { productionOrderId: BED_PO.id });
  assert.deepEqual(legacy, { productionOrderId: BED_PO.id, wipKey: null, pieceNo: null });
});
