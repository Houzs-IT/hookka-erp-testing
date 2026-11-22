// bom-copy.test.mjs — plan D7: copy WIP processes / WIP time / raw materials
// from another model, each part on its own, deep copies with new ids.
import test from "node:test";
import assert from "node:assert/strict";
import { copyBomParts } from "../src/lib/bom-copy.ts";

const source = {
  l1Processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 10 }],
  l1Materials: [{ code: "CARTON", qty: 1, unit: "PCS" }],
  wipComponents: [
    { id: "s1", wipType: "DIVAN", wipCode: "SRC Divan", quantity: 2,
      processes: [{ dept: "Upholstery", deptCode: "UPHOLSTERY", minutes: 15 }, { dept: "Packing", deptCode: "PACKING", minutes: 18 }],
      materials: [{ code: "PLY", qty: 0.5, unit: "PCS", scaling: [{ dim: "DIVAN_HEIGHT", baseValue: 8, perUnit: 0.1 }] }],
      children: [{ id: "s1a", wipType: "FOAM", quantity: 2, processes: [{ dept: "Foam", deptCode: "FOAM", minutes: 4 }], materials: [{ autoDetect: "FABRIC", qty: 3, unit: "M" }] }] },
    { id: "s2", wipType: "HEADBOARD", quantity: 1, processes: [{ dept: "Upholstery", deptCode: "UPHOLSTERY", minutes: 40 }] },
  ],
};
const target = {
  l1Processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 99 }],
  l1Materials: [],
  wipComponents: [
    { id: "t1", wipType: "DIVAN", wipCode: "TGT Divan", quantity: 2,
      processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 1 }, { dept: "Upholstery", deptCode: "UPHOLSTERY", minutes: 2 }],
      materials: [{ code: "OLD", qty: 9, unit: "PCS" }],
      children: [{ id: "t1a", wipType: "FOAM", quantity: 2, processes: [{ dept: "Foam", deptCode: "FOAM", minutes: 3 }] }] },
  ],
};

test("time only: minutes matched by WIP + department, tree and materials untouched", () => {
  const r = copyBomParts(target, source, { processes: false, time: true, materials: false });
  const d = r.bom.wipComponents[0];
  assert.equal(d.wipCode, "TGT Divan");
  assert.deepEqual(d.processes.map((p) => [p.deptCode, p.minutes]), [["PACKING", 18], ["UPHOLSTERY", 15]]);
  assert.equal(d.children[0].processes[0].minutes, 4);
  assert.deepEqual(d.materials, [{ code: "OLD", qty: 9, unit: "PCS" }]);
  assert.equal(r.bom.l1Processes[0].minutes, 10);
  assert.equal(r.matchedNodes, 2);
});

test("materials only: each matching WIP takes the source's materials incl. scaling + from order", () => {
  const r = copyBomParts(target, source, { processes: false, time: false, materials: true });
  const d = r.bom.wipComponents[0];
  assert.deepEqual(d.materials[0].scaling, [{ dim: "DIVAN_HEIGHT", baseValue: 8, perUnit: 0.1 }]);
  assert.equal(d.children[0].materials[0].autoDetect, "FABRIC");
  assert.equal(d.processes[0].minutes, 1, "minutes untouched");
  assert.deepEqual(r.bom.l1Materials, [{ code: "CARTON", qty: 1, unit: "PCS" }]);
});

test("processes only: source tree shape, minutes kept from matching WIPs here, else blank", () => {
  const r = copyBomParts(target, source, { processes: true, time: false, materials: false });
  const [divan, hb] = r.bom.wipComponents;
  assert.deepEqual(divan.processes.map((p) => [p.deptCode, p.minutes]), [["UPHOLSTERY", 2], ["PACKING", 1]]);
  assert.deepEqual(divan.materials, [{ code: "OLD", qty: 9, unit: "PCS" }], "materials of the matching WIP stay");
  assert.equal(hb.processes[0].minutes, 0, "a new WIP starts with blank minutes");
  assert.deepEqual(hb.materials, []);
  assert.equal(r.unmatchedNodes, 1);
});

test("all three = a full copy; deep copies with new ids, source never mutated", () => {
  const before = JSON.stringify(source);
  const r = copyBomParts(target, source, { processes: true, time: true, materials: true });
  const [divan] = r.bom.wipComponents;
  assert.notEqual(divan.id, "s1");
  assert.notEqual(divan.children[0].id, "s1a");
  assert.equal(divan.processes[1].minutes, 18);
  divan.materials[0].qty = 123;
  divan.children[0].processes[0].minutes = 77;
  assert.equal(JSON.stringify(source), before);
});

test("repeated WIP types match by position among their own type", () => {
  const two = (a, b) => ({ wipComponents: [
    { wipType: "DIVAN", processes: [{ deptCode: "FOAM", minutes: a }] },
    { wipType: "DIVAN", processes: [{ deptCode: "FOAM", minutes: b }] },
  ] });
  const r = copyBomParts(two(0, 0), two(5, 7), { processes: false, time: true, materials: false });
  assert.deepEqual(r.bom.wipComponents.map((n) => n.processes[0].minutes), [5, 7]);
});
