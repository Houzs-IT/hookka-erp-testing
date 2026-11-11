// m-so-production-summary.test.mjs — HK-0125 Phase 1: the inline, read-only
// production summary on the phone Sales Order detail: per linked PO, the full
// reference, Target completion, and an expandable Stage progress timeline
// (src/pages/m/lib/so-detail.ts poStages, rendered with the shared
// components/StageTimeline.tsx by screens/SalesOrderDetail.tsx in the Production
// section's status-tile list ONLY; "Show document details" stays compact; fed by
// the linkedPOs additions in GET /api/sales-orders/:id).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poStages, fmtDate } from "../src/pages/m/lib/so-detail.ts";
import { filterPayload } from "../src/api/lib/customer-scope.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const jc = (departmentCode, status, dueDate = "", completedDate = null) => ({ departmentCode, status, dueDate, completedDate });
const po = (over) => ({
  id: "po1", poNo: "SO-2611-001-01", salesOrderId: "so-1", companySOId: "SO-2611-001",
  itemCategory: "BEDFRAME", productCode: "BF-100", fabricCode: "F1", status: "IN_PROGRESS",
  currentDepartment: "", targetEndDate: "2026-11-24", jobCards: [], ...over,
});
const stages = (p, all) => poStages(p, all ?? [p], fmtDate);
const row = (s, code) => s.rows.find((r) => r.code === code);

// ── The ticket's example: an order at Webbing ──────────────────────────────
test("order at Webbing: earlier stages done, Webbing in progress, later stages pending, target visible", () => {
  const p = po({
    currentDepartment: "WEBBING",
    jobCards: [
      jc("FAB_CUT", "COMPLETED", "2026-11-04", "2026-11-03"),
      jc("FAB_SEW", "COMPLETED", "2026-11-06", "2026-11-05"),
      jc("WOOD_CUT", "COMPLETED", "2026-11-07", "2026-11-07"),
      jc("FRAMING", "COMPLETED", "2026-11-10", "2026-11-09"),
      jc("WEBBING", "IN_PROGRESS", "2999-01-01"),
      jc("UPHOLSTERY", "PENDING", "2999-01-02"),
      jc("PACKING", "PENDING", "2999-01-03"),
    ],
  });
  const s = stages(p);
  assert.equal(s.canExpand, true);
  assert.equal(s.target, "24 Nov 2026");
  assert.equal(s.applicable, 7);
  assert.equal(s.done, 4);
  // Department order is the desktop DEPARTMENTS order, N/A departments kept in place.
  assert.deepEqual(s.rows.map((r) => r.code), [
    "FAB_CUT", "FAB_SEW", "FOAM_CUTTING", "FOAM", "FIBRE", "WOOD_CUT", "FRAMING", "WEBBING", "UPHOLSTERY", "PACKING",
  ]);
  assert.equal(row(s, "FAB_CUT").kind, "done");
  assert.equal(row(s, "FAB_CUT").meta, "Completed 3 Nov");
  assert.equal(row(s, "FOAM").kind, "skipped");
  assert.equal(row(s, "WEBBING").kind, "pending", "no job card of Webbing is complete yet");
  assert.equal(row(s, "WEBBING").current, true);
  assert.equal(row(s, "UPHOLSTERY").kind, "pending");
  assert.equal(row(s, "UPHOLSTERY").meta, "Due 2 Jan");
  assert.equal(row(s, "PACKING").kind, "pending");
});

test("a department with some cards done is In progress (x/y), same rule as the Production timeline", () => {
  const p = po({ jobCards: [jc("WEBBING", "COMPLETED", "2999-01-01", "2026-11-09"), jc("WEBBING", "PENDING", "2999-01-01")] });
  const w = row(stages(p), "WEBBING");
  assert.equal(w.kind, "inProgress");
  assert.equal(w.doneCards, 1);
  assert.equal(w.totalCards, 2);
});

test("a department past its due date is Overdue", () => {
  const p = po({ jobCards: [jc("WEBBING", "PENDING", "2020-01-01")] });
  assert.equal(row(stages(p), "WEBBING").kind, "overdue");
});

test("PIC names are never part of the SO timeline", () => {
  const p = po({ jobCards: [{ ...jc("FAB_CUT", "COMPLETED", "", "2026-11-03"), pic1Name: "SECRET NAME", pic2Name: "OTHER" }] });
  const s = stages(p);
  assert.doesNotMatch(JSON.stringify(s), /SECRET NAME|OTHER/);
  assert.equal(row(s, "FAB_CUT").meta, "Completed 3 Nov");
});

// ── Missing target, completed, cancelled, no cards ─────────────────────────
test("missing target stays empty and is never filled from a delivery date", () => {
  const p = po({
    targetEndDate: "", customerDeliveryDate: "2026-12-01", hookkaExpectedDD: "2026-11-30",
    jobCards: [jc("PACKING", "PENDING", "")],
  });
  assert.equal(stages(p).target, "");
});

test("a completed order can still expand to its stage history, with no target line", () => {
  const p = po({ status: "COMPLETED", jobCards: [jc("PACKING", "COMPLETED", "2026-11-08", "2026-11-05")] });
  const s = stages(p);
  assert.equal(s.canExpand, true);
  assert.equal(s.open, false);
  assert.equal(s.target, "");
  assert.equal(row(s, "PACKING").kind, "done");
  assert.equal(row(s, "PACKING").meta, "Completed 5 Nov");
  assert.equal(s.done, 1);
});

test("a cancelled order has no stage control", () => {
  assert.equal(stages(po({ status: "CANCELLED", jobCards: [jc("PACKING", "PENDING")] })).canExpand, false);
});

test("an order with no job cards (and no shared cut) is not scheduled: no control", () => {
  const s = stages(po({ status: "PENDING", jobCards: [] }));
  assert.equal(s.scheduled, false);
  assert.equal(s.canExpand, false);
  assert.equal(s.open, true);
  assert.equal(s.target, "24 Nov 2026");
});

test("multiple linked orders each get their own stages", () => {
  const a = po({ id: "a", jobCards: [jc("WEBBING", "PENDING", "2999-01-01")] });
  const b = po({ id: "b", targetEndDate: "", jobCards: [jc("UPHOLSTERY", "PENDING", "2999-01-01")] });
  const all = [a, b];
  assert.equal(row(stages(a, all), "WEBBING").kind, "pending");
  assert.equal(row(stages(a, all), "UPHOLSTERY").kind, "skipped");
  assert.equal(row(stages(b, all), "UPHOLSTERY").kind, "pending");
  assert.equal(stages(a, all).target, "24 Nov 2026");
  assert.equal(stages(b, all).target, "");
});

// ── Shared SOFA Fabric Cut ──────────────────────────────────────────────────
// One merged FAB_CUT job card lives on the group's anchor PO; its siblings have
// none of their own. cellFor finds it through the same-SO siblings.
const sofa = (id, over) => po({ id, itemCategory: "SOFA", productCode: "SF-200-1S", fabricCode: "FAB-A", ...over });

test("SOFA sibling with NO cards of its own still shows the shared Fabric Cut from the anchor PO", () => {
  const anchor = sofa("anchor", { jobCards: [jc("FAB_CUT", "PENDING", "2999-01-01"), jc("PACKING", "PENDING", "2999-01-01")] });
  const sibling = sofa("sib", { productCode: "SF-200-2S", jobCards: [] });
  const s = stages(sibling, [anchor, sibling]);
  assert.equal(row(s, "FAB_CUT").kind, "pending");
  assert.equal(row(s, "FAB_CUT").meta, "Due 1 Jan");
  assert.equal(s.scheduled, true, "the shared cut makes the sibling schedulable");
  assert.equal(s.canExpand, true);
  // Without the sibling set the shared cut would be invisible and the control gone.
  assert.equal(stages(sibling, [sibling]).canExpand, false);
});

test("a non-SOFA order with no cards does NOT borrow a sibling's Fabric Cut (only SOFA shares it)", () => {
  const anchor = sofa("anchor", { jobCards: [jc("FAB_CUT", "PENDING", "2999-01-01")] });
  const bed = po({ id: "bed", itemCategory: "BEDFRAME", jobCards: [] });
  const s = stages(bed, [anchor, bed]);
  assert.equal(row(s, "FAB_CUT").kind, "skipped");
  assert.equal(s.scheduled, false);
  assert.equal(s.canExpand, false);
});

test("a SOFA order never takes its Fabric Cut from a non-SOFA sibling", () => {
  const bed = po({ id: "bed", productCode: "SF-200-1S", fabricCode: "FAB-A", jobCards: [jc("FAB_CUT", "PENDING", "2999-01-01")] });
  const sib = sofa("sib", { jobCards: [] });
  assert.equal(stages(sib, [bed, sib]).scheduled, false);
});

test("a finished shared Fabric Cut reads Done on the sibling", () => {
  const anchor = sofa("anchor", { jobCards: [jc("FAB_CUT", "COMPLETED", "", "2026-11-01")] });
  const sibling = sofa("sib", { jobCards: [jc("PACKING", "PENDING", "2999-01-01")] });
  const s = stages(sibling, [anchor, sibling]);
  assert.equal(row(s, "FAB_CUT").kind, "done");
  assert.equal(row(s, "FAB_CUT").meta, "Completed 1 Nov");
});

test("a different fabric or base model is not treated as the same cut", () => {
  const anchor = sofa("anchor", { fabricCode: "FAB-B", jobCards: [jc("FAB_CUT", "PENDING", "2999-01-01")] });
  const sibling = sofa("sib", { jobCards: [jc("PACKING", "PENDING", "2999-01-01")] });
  assert.equal(row(stages(sibling, [anchor, sibling]), "FAB_CUT").kind, "skipped");
});

// ── Fallback wording only when the API actually sent the field ──────────────
// An older API (no targetEndDate / jobCards on linkedPOs) must not read as
// "not set" / "not scheduled yet": those messages claim a fact about the order.
const without = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

test("fields MISSING from the response: no 'not set', no 'not scheduled yet', no control", () => {
  const old = without(po({ status: "PENDING" }), "targetEndDate", "jobCards");
  const s = stages(old);
  assert.equal(s.targetSent, false);
  assert.equal(s.stagesSent, false);
  assert.equal(s.target, "");
  assert.equal(s.scheduled, false);
  assert.equal(s.canExpand, false);
});

test("fields present but EMPTY: the API said so, so both fallbacks are allowed", () => {
  const s = stages(po({ status: "PENDING", targetEndDate: "", jobCards: [] }));
  assert.equal(s.targetSent, true);
  assert.equal(s.stagesSent, true);
  assert.equal(s.target, "");
  assert.equal(s.scheduled, false);
});

test("a null target counts as sent (the API answered) and stays empty", () => {
  const s = stages(po({ targetEndDate: null, jobCards: [] }));
  assert.equal(s.targetSent, true);
  assert.equal(s.target, "");
});

test("each field is judged on its own: target sent but job cards missing, and the reverse", () => {
  const onlyTarget = stages(without(po({}), "jobCards"));
  assert.equal(onlyTarget.targetSent, true);
  assert.equal(onlyTarget.target, "24 Nov 2026");
  assert.equal(onlyTarget.stagesSent, false);
  const onlyCards = stages(without(po({ jobCards: [jc("PACKING", "PENDING", "2999-01-01")] }), "targetEndDate"));
  assert.equal(onlyCards.targetSent, false);
  assert.equal(onlyCards.stagesSent, true);
  assert.equal(onlyCards.scheduled, true);
  assert.equal(onlyCards.canExpand, true);
});

test("real stage data: both flags set, target shown, control available", () => {
  const s = stages(po({ jobCards: [jc("WEBBING", "PENDING", "2999-01-01")] }));
  assert.equal(s.targetSent, true);
  assert.equal(s.stagesSent, true);
  assert.equal(s.target, "24 Nov 2026");
  assert.equal(s.canExpand, true);
});

test("shared Fabric Cut: a sibling with an EMPTY card list is scheduled, so no 'not scheduled yet' either", () => {
  const anchor = sofa("anchor", { jobCards: [jc("FAB_CUT", "PENDING", "2999-01-01")] });
  const sibling = sofa("sib", { jobCards: [] });
  const s = stages(sibling, [anchor, sibling]);
  assert.equal(s.stagesSent, true);
  assert.equal(s.scheduled, true);
});

test("the UI shows each fallback only when the API sent its field", () => {
  assert.match(PHONE, /stg\.open && \(stg\.target \|\| stg\.targetSent\)/);
  assert.match(PHONE, /stg\.open && stg\.stagesSent && !stg\.scheduled/);
});

// ── Source wiring: response additions, scope, both layouts, shared component ─
const SO_ROUTE = read("src/api/routes/sales-orders.ts");
const getBlock = SO_ROUTE.slice(SO_ROUTE.indexOf('app.get("/:id"'), SO_ROUTE.indexOf('app.put("/:id"'));
const PHONE = read("src/pages/m/screens/SalesOrderDetail.tsx");
const PROD = read("src/pages/m/screens/ProductionDetailScreen.tsx");
const TIMELINE = read("src/pages/m/components/StageTimeline.tsx");

test("SO response carries the grouping fields cellFor needs, the target and the job cards", () => {
  assert.match(getBlock, /salesOrderId, companySOId, fabricCode, targetEndDate/);
  for (const k of ["salesOrderId:", "companySOId:", "fabricCode:", "targetEndDate:", "jobCards:"]) {
    assert.ok(getBlock.includes(k), `linkedPOs should carry ${k}`);
  }
});

test("the job-card read is narrowed to THIS sales order, read-only, and carries no worker names", () => {
  const q = getBlock.slice(getBlock.indexOf("jc.productionOrderId, jc.departmentCode"));
  const query = q.slice(0, q.indexOf("`,"));
  assert.match(query, /WHERE po\.salesOrderId = \?/);
  assert.doesNotMatch(query, /pic1Name|pic2Name/);
  assert.doesNotMatch(getBlock, /INSERT INTO job_cards|UPDATE job_cards|DELETE FROM job_cards/);
});

test("main's `stages` response is kept and `jobCards` is built from the SAME query (no second job_cards read)", () => {
  assert.equal((getBlock.match(/SELECT jc\.productionOrderId, jc\.departmentCode/g) ?? []).length, 1, "one stage/job-card query");
  assert.match(getBlock, /stages: \[\.\.\.\(stagesByPo\.get\(p\.id\)\?\.values\(\) \?\? \[\]\)\]/, "main's stages key is intact");
  assert.match(getBlock, /jobCards: jobCardsByPo\.get\(p\.id\) \?\? \[\]/);
  // Both structures are filled inside the one loop over that query's rows.
  const loop = getBlock.slice(getBlock.indexOf("for (const jc of stagesRes.results"));
  assert.ok(loop.indexOf("jobCardsByPo.set(") > 0 && loop.indexOf("jobCardsByPo.set(") < loop.indexOf("stagesByPo"), "jobCards pushed in the same loop, before the stage reducer");
  assert.doesNotMatch(getBlock, /jobCardsRes/, "no separate job-card result set");
});

test("CANCELLED job cards stay excluded by the SO query (main's rule)", () => {
  assert.match(getBlock, /AND jc\.status <> 'CANCELLED'/);
});

test("a department whose only cards are CANCELLED: absent from the SO response, so it reads N/A (documented difference from Production Detail)", () => {
  // What GET /api/sales-orders/:id sends: the cancelled Webbing card is filtered out in SQL.
  const fromSoApi = po({ currentDepartment: "PACKING", jobCards: [jc("PACKING", "PENDING", "2999-01-01")] });
  const so = stages(fromSoApi);
  assert.equal(row(so, "WEBBING").kind, "skipped", "N/A on the SO");
  assert.equal(so.applicable, 1);
  // What Production Detail's data would give for the same order (cancelled cards included):
  // cellFor counts a cancelled card as not done, so Webbing reads Pending there.
  const fromProduction = po({ currentDepartment: "PACKING", jobCards: [jc("WEBBING", "CANCELLED", "2999-01-01"), jc("PACKING", "PENDING", "2999-01-01")] });
  assert.equal(row(stages(fromProduction), "WEBBING").kind, "pending", "Pending on Production Detail's data");
});

test("a department with a cancelled card AND a live one is judged on the live card only", () => {
  // SQL has already dropped the cancelled card; the remaining one decides.
  const p = po({ jobCards: [jc("WEBBING", "COMPLETED", "2026-11-05", "2026-11-05")] });
  const w = row(stages(p), "WEBBING");
  assert.equal(w.kind, "done");
  assert.equal(w.totalCards, 1);
});

test("customer scope: another salesperson's SO is a 404 for the whole response, new fields included", () => {
  const scope = { forbidden: new Set(["c9"]), forbiddenNames: new Set(), denyAll: false };
  const r = filterPayload({ id: "so-9", customerId: "c9" }, scope, false);
  assert.equal(r.denied, true);
  assert.equal(r.value, null);
});

test("only the Production section's status-tile list renders the stage block; it shows the FULL reference and does not link out", () => {
  assert.equal((PHONE.match(/poStageBlock\(p\)/g) ?? []).length, 1, "exactly one use: the tile list");
  const tileList = PHONE.slice(PHONE.indexOf("prodList.map"), PHONE.indexOf("prodList.map") + 2600);
  assert.match(tileList, /poStageBlock\(p\)/);
  assert.match(tileList, /str\(p, "poNo"\)/);
  assert.doesNotMatch(PHONE, /displaySoId\(/, "both lists show the full poNo, not the SOFA-stripped one");
  assert.doesNotMatch(PHONE, /navigate\(`\/m\/production/);
});

test("Show document details stays compact: full reference + status chip + the existing summary line, no stage UI", () => {
  const docs = PHONE.slice(PHONE.indexOf("poRowsShown.map"), PHONE.indexOf("poRowsShown.map") + 900);
  assert.match(docs, /str\(p, "poNo"\) \|\| "—"/);
  assert.match(docs, /StatusChip/);
  assert.match(docs, /productionLabel\(p, fmtDate\)/);
  assert.doesNotMatch(docs, /poStageBlock|Target completion|View stages|StageTimeline/);
  assert.doesNotMatch(PHONE, /extra\?: ReactNode/, "the row helper no longer takes extra stage content");
});

test("poStageBlock is declared before either list renders it (a TDZ crash tsc does not catch)", () => {
  const decl = PHONE.indexOf("const poStageBlock");
  const firstUse = PHONE.indexOf("poStageBlock(p)");
  assert.ok(decl > 0 && firstUse > decl, "declare poStageBlock above its first use");
});

test("the control is an accessible, 44px expand toggle that says View / Hide stages", () => {
  assert.match(PHONE, /aria-expanded=\{open\}/);
  assert.match(PHONE, /"Hide stages" : "View stages"/);
  assert.match(PHONE, /minHeight: 44/);
});

test("the timeline is ONE shared component; Production Detail still renders it with its PIC names", () => {
  assert.match(TIMELINE, /export function StageTimeline/);
  assert.match(PHONE, /<StageTimeline rows=\{stg\.rows\} \/>/);
  assert.match(PROD, /<StageTimeline/);
  assert.match(PROD, /pic1Name/);
  assert.match(PROD, /pic2Name/);
  // The timeline markup moved out of the Production screen entirely.
  assert.doesNotMatch(PROD, /STAGE_LOOK|NODE_BG/);
  assert.match(PROD, /departments done/);
  assert.match(PROD, /label: "Expected DD"/, "Production Detail labels are unchanged");
});
