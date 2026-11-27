// m-rd-projects.test.mjs — the rules behind the PHONE R&D Projects screens
// (src/pages/m/screens/rd/*, Final Batch 5). Pure rd-lib.ts rules on hand-built
// fixtures, plus source pins for the owner decisions and the 12 mandatory
// corrections (real API codes, blank dates, health.ts, effective labour cost,
// non-draft Reports, lifecycle copy, guarded Advance, stored prototype version,
// per-action permissions, 8 audit actions, money parsing, read-only issuance).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toProject, stageLabels, STAGES, stageIndex, STATUS_TONE, TYPE_LABEL, tabPool, livePool, reportPool, healthChips, milestoneChip, summary, reports,
  costBreakdown, advancePayload, canAdvance, dockAction, moreActions, lifecycleCopy, nextVersion, newPrototypePayload, editPrototypePayload, auditLines,
  auditChip, AUDIT_ACTION, moneyToSen, createErrors, createPayload, sortProjects, baseFilter, milestoneDatePayload, milestonePhotoPayload, thumbOf,
  fmtDate, isHours, toAudit, errorFromBody, FORBIDDEN_ERROR,
} from "../src/pages/m/screens/rd/rd-lib.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const RD = "src/pages/m/screens/rd/";
const SRC = ["RdScreen.tsx", "RdDetailScreen.tsx", "rd-forms.tsx", "rd-actions.tsx", "rd-lib.ts", "rd-perms.ts", "rd-kit.tsx", "rd-style.ts", "rd-toast.tsx"]
  .map((f) => [f, read(RD + f)]);
const ALL = SRC.map(([, s]) => s).join("\n");
const TODAY = "2026-11-27";

const ms = (over = {}) => STAGES.map((stage) => ({ stage, targetDate: "", actualDate: null, approvedBy: null, ...(over[stage] ?? {}) }));
const P = (o = {}) =>
  toProject({
    id: "rd-x", code: "RD-2611-001", name: "Test", description: "", projectType: "DEVELOPMENT", productCategory: "SOFA", currentStage: "CONCEPT",
    targetLaunchDate: "", assignedTeam: [], milestones: ms(), totalBudget: 0, actualCost: 0, prototypes: [], status: "ACTIVE",
    labourCost: { laborCostSen: 0, partTimeFixedCostSen: 0, manualLabourCostSen: null, effectiveLabourCostSen: 0, isManualLabourCost: false, totalLabourHours: 0 },
    ...o,
  });

// ── 1. enum mapping ───────────────────────────────────────────────────────────
test("API codes map to labels; type-specific stage labels match desktop", () => {
  assert.equal(TYPE_LABEL.DEVELOPMENT, "Research");
  assert.equal(stageLabels("IMPROVEMENT").CONCEPT, "Issue Analysis");
  assert.equal(stageLabels("IMPROVEMENT").DESIGN, "Fix Design");
  assert.equal(stageLabels("CLONE").CONCEPT, "Source Analysis");
  assert.equal(stageLabels("CLONE").DESIGN, "Design");
  assert.equal(stageIndex("PRODUCTION_READY"), 5);
  assert.deepEqual(STATUS_TONE, { DRAFT: "neu", ACTIVE: "info", ON_HOLD: "warn", COMPLETED: "ok", CANCELLED: "bad" });
  const desk = read("src/pages/rd/index.tsx");
  assert.match(desk, /CONCEPT: "Issue Analysis",\s*DESIGN: "Fix Design"/);
  assert.match(desk, /CONCEPT: "Source Analysis",\s*\}/);
});

test("toProject reads dual keys and unknown codes fall back safely", () => {
  const p = toProject({ id: "a", code: "C", name: "N", project_type: "CLONE", product_category: "ACCESSORY", current_stage: "TESTING", status: "ON_HOLD", total_budget: 500, actual_cost: 100 });
  assert.equal(p.projectType, "CLONE");
  assert.equal(p.productCategory, "ACCESSORY");
  assert.equal(p.currentStage, "TESTING");
  assert.equal(p.status, "ON_HOLD");
  assert.equal(p.totalBudget, 500);
  assert.equal(toProject({ id: "b", status: "WHATEVER" }).status, "DRAFT");
});

// ── 2. blank dates ────────────────────────────────────────────────────────────
test("blank launch / milestone dates: no chip, not overdue, sorted last", () => {
  const p = P({ targetLaunchDate: "" });
  assert.deepEqual(healthChips(p, TODAY), []);
  assert.equal(milestoneChip({ targetDate: "", actualDate: "", stage: "CONCEPT", approvedBy: "", photos: [] }, TODAY), null);
  const s = summary([p], TODAY);
  assert.equal(s.overdueMilestones.length, 0, "blank milestone targets are never overdue");
  const a = P({ id: "a", code: "A", targetLaunchDate: "" });
  const b = P({ id: "b", code: "B", targetLaunchDate: "2027-01-01" });
  assert.deepEqual(sortProjects([a, b], "target").map((x) => x.id), ["b", "a"]);
  assert.equal(fmtDate(""), "—");
});

// ── 3. health via health.ts (MY today) ─────────────────────────────────────────
test("health chips come from health.ts; on-track and ok are hidden; budget chip for any status", () => {
  assert.deepEqual(healthChips(P({ targetLaunchDate: "2026-11-20" }), TODAY), [{ l: "Overdue", t: "bad" }]);
  assert.deepEqual(healthChips(P({ targetLaunchDate: "2026-12-01" }), TODAY), [{ l: "At Risk", t: "warn" }]);
  assert.deepEqual(healthChips(P({ targetLaunchDate: "2026-12-01", currentStage: "PRODUCTION_READY" }), TODAY), [], "at PR the 7-day rule is off");
  assert.deepEqual(healthChips(P({ targetLaunchDate: "2027-06-01" }), TODAY), [], "on track = no chip");
  assert.deepEqual(healthChips(P({ status: "ON_HOLD", targetLaunchDate: "2026-11-01" }), TODAY), [{ l: "Overdue", t: "bad" }], "On Hold still evaluated");
  assert.deepEqual(healthChips(P({ status: "DRAFT", totalBudget: 100, actualCost: 100 }), TODAY), [{ l: "Over Budget", t: "bad" }]);
  assert.deepEqual(healthChips(P({ totalBudget: 100, actualCost: 85 }), TODAY), [{ l: "Near Budget", t: "warn" }]);
  assert.ok(!/Normal budget|"On Track"/.test(ALL), "no invented chip labels");
  assert.match(read(RD + "rd-lib.ts"), /import \{ getMilestoneHealth, getProjectHealth \} from "\.\.\/\.\.\/\.\.\/rd\/health";/);
  assert.match(read(RD + "RdScreen.tsx"), /todayYmdMY\(\)/);
  assert.match(read(RD + "RdDetailScreen.tsx"), /todayYmdMY\(\)/);
});

test("milestone chips: done early / on time / late, overdue, due today / soon, N days remaining", () => {
  const m = (targetDate, actualDate = "") => ({ stage: "CONCEPT", targetDate, actualDate, approvedBy: "", photos: [] });
  assert.equal(milestoneChip(m("2026-11-20", "2026-11-18"), TODAY).l, "Done early");
  assert.equal(milestoneChip(m("2026-11-20", "2026-11-20"), TODAY).l, "Done on time");
  assert.equal(milestoneChip(m("2026-11-20", "2026-11-22"), TODAY).l, "Done late");
  assert.equal(milestoneChip(m("2026-11-26"), TODAY).l, "Overdue");
  assert.equal(milestoneChip(m(TODAY), TODAY).l, "Due today");
  assert.equal(milestoneChip(m("2026-11-29"), TODAY).l, "Due soon");
  assert.equal(milestoneChip(m("2026-12-27"), TODAY).l, "30 days remaining");
});

// ── 4. budget & cost ──────────────────────────────────────────────────────────
test("labour = effectiveLabourCostSen (manual override flows through, flagged); total = material + labour + PT", () => {
  const p = P({ totalBudget: 100000, actualCost: 60000, labourCost: { laborCostSen: 5000, partTimeFixedCostSen: 60000, manualLabourCostSen: 18500, effectiveLabourCostSen: 18500, isManualLabourCost: true, totalLabourHours: 9 } });
  const c = costBreakdown(p, [{ totalCostSen: 40000 }, { totalCostSen: 20000 }]);
  assert.equal(c.labour, 18500);
  assert.equal(c.manual, true);
  assert.equal(c.pt, 60000);
  assert.equal(c.material, 60000);
  assert.equal(c.total, 60000 + 18500 + 60000);
  assert.equal(c.remaining, 40000);
  assert.ok(!/targetSellingPriceSen|targetMaterialCostSen|Selling price|"Margin/.test(read(RD + "RdDetailScreen.tsx")), "no pricing targets / margin on mobile (R-5)");
});

// ── 5. pools + reports ────────────────────────────────────────────────────────
test("tab pools: Projects incl. Cancelled; Summary/Pipeline Active+On Hold; Reports non-draft", () => {
  const all = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].map((s, i) => P({ id: s, code: `C${i}`, status: s }));
  assert.deepEqual(tabPool(all, "projects").map((p) => p.id), ["ACTIVE", "ON_HOLD", "CANCELLED"]);
  assert.deepEqual(livePool(all).map((p) => p.id), ["ACTIVE", "ON_HOLD"]);
  assert.deepEqual(tabPool(all, "pipeline").map((p) => p.id), ["ACTIVE", "ON_HOLD"]);
  assert.deepEqual(reportPool(all).map((p) => p.id), ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]);
});

test("Reports: totals over non-drafts; Total R&D Spend = Σ actualCost", () => {
  const all = [
    P({ id: "d", status: "DRAFT", totalBudget: 999900, actualCost: 0, productCategory: "SOFA" }),
    P({ id: "a", status: "ACTIVE", totalBudget: 100000, actualCost: 30000, productCategory: "SOFA" }),
    P({ id: "c", status: "COMPLETED", totalBudget: 50000, actualCost: 45000, productCategory: "BEDFRAME", currentStage: "PRODUCTION_READY" }),
  ];
  const r = reports(all);
  assert.equal(r.total, 2);
  assert.equal(r.active, 1);
  assert.equal(r.totalBudget, 150000);
  assert.equal(r.spend, 75000);
  assert.equal(r.byCategory.find((x) => x.c === "SOFA").n, 1);
});

test("Summary: KPIs, attention order (overdue first), overdue milestones by days", () => {
  const a = P({ id: "a", targetLaunchDate: "2026-12-01" });
  const b = P({ id: "b", targetLaunchDate: "2026-11-01" });
  const c = P({ id: "c", targetLaunchDate: "2027-05-01", totalBudget: 100, actualCost: 120, milestones: ms({ DESIGN: { targetDate: "2026-11-01" }, CONCEPT: { targetDate: "2026-11-20" } }) });
  const x = P({ id: "x", status: "CANCELLED", targetLaunchDate: "2026-01-01" });
  const s = summary([a, b, c, x], TODAY);
  assert.equal(s.overdue, 1);
  assert.equal(s.atRisk, 1);
  assert.equal(s.overBudget, 1);
  assert.deepEqual(s.attention.map((r) => r.p.id), ["b", "c", "a"]);
  assert.deepEqual(s.overdueMilestones.map((r) => r.m.stage), ["DESIGN", "CONCEPT"]);
  assert.equal(s.overdueMilestones[0].days, 26);
});

// ── 6. lifecycle copy ─────────────────────────────────────────────────────────
test("lifecycle copy follows server behaviour", () => {
  const draft = P({ status: "DRAFT", currentStage: "DESIGN" });
  assert.match(lifecycleCopy(draft, "start").body, /current stage \(Design\)/);
  assert.doesNotMatch(lifecycleCopy(P(), "hold").body, /pause/i, "Hold does not pause schedule warnings");
  assert.doesNotMatch(lifecycleCopy(P({ currentStage: "PRODUCTION_READY" }), "complete").body, /marked done/i, "Complete does not stamp a milestone");
  assert.equal(lifecycleCopy(P(), "move-to-draft").danger, true);
  assert.equal(dockAction(P({ status: "DRAFT" })), "start");
  assert.equal(dockAction(P({ currentStage: "TESTING" })), "advance");
  assert.equal(dockAction(P({ currentStage: "PRODUCTION_READY" })), "complete");
  assert.equal(dockAction(P({ status: "ON_HOLD" })), "resume");
  assert.equal(dockAction(P({ status: "COMPLETED" })), "reopen");
  assert.equal(dockAction(P({ status: "CANCELLED" })), null);
  assert.deepEqual(moreActions(P()), ["hold", "move-to-draft"]);
  assert.deepEqual(moreActions(P({ status: "ON_HOLD" })), ["move-to-draft"]);
  assert.deepEqual(moreActions(P({ status: "CANCELLED" })), []);
  const actions = read(RD + "rd-actions.tsx");
  assert.match(actions, /lifecycleUrl\(p\.id, k\)/);
  assert.match(actions, /error: s\.error/, "server error text shown verbatim");
});

// ── 7. advance ────────────────────────────────────────────────────────────────
test("advance: ACTIVE below PR only; stamps only the current milestone with the desktop literal; no status", () => {
  assert.equal(canAdvance(P({ status: "ON_HOLD" })), false);
  assert.equal(canAdvance(P({ currentStage: "PRODUCTION_READY" })), false);
  const p = P({ currentStage: "DESIGN", milestones: ms({ CONCEPT: { actualDate: "2026-10-01", approvedBy: "Ahmad" }, DESIGN: { targetDate: "2026-12-01", photos: ["data:x"] } }) });
  const body = advancePayload(p, TODAY);
  assert.equal(body.currentStage, "PROTOTYPE");
  assert.equal(body.status, undefined);
  assert.deepEqual(body.milestones[1], { stage: "DESIGN", targetDate: "2026-12-01", actualDate: TODAY, approvedBy: "Current User", photos: ["data:x"] });
  assert.deepEqual(body.milestones[0], { stage: "CONCEPT", targetDate: "", actualDate: "2026-10-01", approvedBy: "Ahmad" });
  assert.equal(advancePayload(P({ status: "DRAFT" }), TODAY), null);
  assert.match(read("src/pages/rd/detail.tsx"), /approvedBy: "Current User"/, "desktop still writes the literal (R-3)");
  const actions = read(RD + "rd-actions.tsx");
  assert.match(actions, /readFresh\(p\.id\)/);
  assert.match(actions, /verifiedSave/);
  assert.match(actions, /expect: \{ currentStage: body\.currentStage \}/);
});

test("milestone date / photo payloads patch one stage of a fresh array", () => {
  const p = P({ milestones: ms({ TESTING: { targetDate: "2026-12-12" } }) });
  const d = milestoneDatePayload(p, "TESTING", "");
  assert.equal(d.milestones[3].targetDate, "", "blank allowed = cleared");
  assert.equal(d.milestones[2].targetDate, "");
  const ph = milestonePhotoPayload(p, "TESTING", "data:image/jpeg;base64,AAA");
  assert.deepEqual(ph.milestones[3].photos, ["data:image/jpeg;base64,AAA"]);
  assert.equal(ph.milestones.length, 6);
  const detail = read(RD + "RdDetailScreen.tsx");
  assert.match(detail, /compressImage\(file/, "photos compressed on the client (R-2)");
  assert.match(detail, /readFresh\(p\.id\)/);
  assert.ok(thumbOf(P({ milestones: ms({ DESIGN: { photos: ["data:y"] } }) })) === "data:y", "first milestone photo when no cover");
});

// ── 8. prototypes ─────────────────────────────────────────────────────────────
test("prototype add = v{n+1} per type, single-row upsert; edit keeps the stored version", () => {
  const p = P({ prototypes: [{ id: "x1", prototypeType: "FABRIC_SEWING", version: "v1" }, { id: "x2", prototypeType: "FABRIC_SEWING", version: "v3b" }, { id: "y1", prototypeType: "FRAMING", version: "v1" }] });
  assert.equal(nextVersion(p, "FABRIC_SEWING"), "v3");
  assert.equal(nextVersion(p, "FRAMING"), "v2");
  const d = { createdDate: "", description: " Frame ", labourHours: "4.5", improvements: "", defects: "", testResults: "", feedback: "" };
  const add = newPrototypePayload(p, "FRAMING", d, 123, TODAY);
  assert.equal(add.prototypes.length, 1);
  assert.equal(add.prototypes[0].id, "proto-123");
  assert.equal(add.prototypes[0].version, "v2");
  assert.equal(add.prototypes[0].materialsCost, 0);
  assert.equal(add.prototypes[0].createdDate, TODAY);
  assert.equal(add.prototypes[0].description, "Frame");
  const ed = editPrototypePayload(p.prototypes[1], d);
  assert.equal(ed.prototypes[0].version, "v3b");
  assert.equal(ed.prototypes[0].id, "x2");
  assert.ok(isHours("4.5") && isHours("") && !isHours("-1") && !isHours("abc"));
});

// ── 9 + 10. add hours, permissions ─────────────────────────────────────────────
test("add hours: active R&D team list, rd-projects:create, no 12h cap, no rate preview", () => {
  const forms = read(RD + "rd-forms.tsx");
  assert.match(read(RD + "rd-lib.ts"), /TEAM_URL = "\/api\/rd-team-members\?active=true"/);
  assert.match(forms, /teamMemberId: by, workDate: v\.date, hours: v\.h/);
  assert.doesNotMatch(forms, /Math\.min\(12/, "no invented 12 h cap (R-4)");
  assert.doesNotMatch(forms, /hourlyRateSen/, "no hourly rates on mobile (R-4)");
  const perms = read(RD + "rd-perms.ts");
  assert.match(perms, /logHours: ok\("rd-projects", "create"\)/);
  assert.match(perms, /create: ok\("rd-projects", "create"\)/);
  assert.match(perms, /update: ok\("rd-projects", "update"\)/);
  assert.match(perms, /fileUpload: ok\("files", "create"\)/);
  assert.match(perms, /!loading && can\(r, a\)/, "everything hidden while permissions load");
  assert.doesNotMatch(ALL, /canEdit\s*=\s*true|\?\? true/, "no prototype-style single canEdit");
  const detail = read(RD + "RdDetailScreen.tsx");
  assert.match(detail, /perms\.logHours/);
  assert.match(detail, /perms\.fileUpload/);
});

// ── 11. history ───────────────────────────────────────────────────────────────
test("history maps the 8 real audit actions and never renders a data URL", () => {
  for (const a of ["create", "update", "start", "hold", "resume", "complete", "move-to-draft", "reopen"]) assert.ok(AUDIT_ACTION[a], a);
  assert.equal(auditChip("move-to-draft").l, "Moved to Drafts");
  const big = "data:image/jpeg;base64," + "A".repeat(5000);
  const e = toAudit({
    id: "1", action: "update", ts: "2026-11-27T03:00:00Z",
    before: { coverPhotoUrl: null, status: "ACTIVE", targetSellingPriceSen: 1, milestones: ms() },
    after: { coverPhotoUrl: big, status: "ON_HOLD", targetSellingPriceSen: 2, milestones: ms({ CONCEPT: { photos: [big] } }) },
  });
  const lines = auditLines(e, "DEVELOPMENT");
  const text = JSON.stringify(lines);
  assert.ok(!text.includes("base64"), text);
  assert.ok(lines.some((l) => l.v === "Active → On Hold"));
  assert.ok(lines.some((l) => /Cover Photo/.test(l.k) && l.v === "Photo added"));
  assert.ok(lines.some((l) => l.k === "Concept photos"));
  assert.ok(!/Selling/.test(text), "pricing targets hidden");
  const created = auditLines(toAudit({ id: "2", action: "create", after: { name: "Aria", productCategory: "SOFA", totalBudget: 150000 } }), "DEVELOPMENT");
  assert.deepEqual(created.map((l) => l.v), ["Aria", "Sofa", "RM 1,500.00"]);
});

// ── 12. money ─────────────────────────────────────────────────────────────────
test("money input: parseMoneyToSen, unreadable or negative refused, blank = 0", () => {
  assert.equal(moneyToSen("15,000.50"), 1500050);
  assert.equal(moneyToSen(""), 0);
  assert.equal(moneyToSen("abc"), null);
  assert.equal(moneyToSen("-5"), null);
  const d = { name: "", projectType: "CLONE", productCategory: "", serviceId: "", sourceProductName: "", sourceBrand: "", sourcePurchaseRef: "", sourcePrice: "x", sourceNotes: "", description: "", targetLaunchDate: "", budget: "1.2.3", team: [] };
  assert.deepEqual(Object.keys(createErrors(d)).sort(), ["budget", "cat", "name", "price"]);
  const ok = { ...d, name: " Aria ", productCategory: "SOFA", budget: "200", sourcePrice: "89", team: ["Wong Mei Yee"] };
  const body = createPayload(ok);
  assert.equal(body.totalBudget, 20000);
  assert.equal(body.sourcePriceSen, 8900);
  assert.equal(body.name, "Aria");
  assert.equal(body.currentStage, undefined, "server forces CONCEPT");
  assert.equal(body.status, undefined);
  assert.equal(body.targetLaunchDate, undefined, "blank launch date omitted");
  assert.deepEqual(body.assignedTeam, ["Wong Mei Yee"]);
  assert.match(read(RD + "rd-lib.ts"), /parseMoneyToSen\(v\)/);
});

// ── scope + safety pins ───────────────────────────────────────────────────────
test("read-only material issuance; no stock / labour delete / project edit paths on mobile", () => {
  for (const bad of ["issuances/batch", "issue-material", "labour-log", "labour-cost", 'method: "DELETE"', '"DELETE"']) {
    assert.ok(!ALL.includes(bad), `mobile R&D must not reference ${bad}`);
  }
  assert.ok(!/coverPhotoUrl:\s/.test(read(RD + "rd-forms.tsx")), "no cover upload");
});

test("search / filter and errors", () => {
  const all = [P({ id: "a", code: "RD-1", name: "Aria", projectType: "CLONE" }), P({ id: "b", code: "RD-2", name: "Luna" })];
  assert.deepEqual(baseFilter(all, "research", "all").map((p) => p.id), ["b"]);
  assert.deepEqual(baseFilter(all, "", "CLONE").map((p) => p.id), ["a"]);
  assert.equal(errorFromBody(400, JSON.stringify({ error: "Only ACTIVE projects can be put on hold (current: ON_HOLD)" })), "Only ACTIVE projects can be put on hold (current: ON_HOLD)");
  assert.equal(errorFromBody(403, "{}"), FORBIDDEN_ERROR);
});

test("detail separates 404 from other load failures; UTC today never used", () => {
  const detail = read(RD + "RdDetailScreen.tsx");
  assert.match(detail, /projRes\.failure\?\.kind === "notFound"/);
  assert.match(detail, /Couldn't load this project/);
  assert.doesNotMatch(ALL, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/);
});
