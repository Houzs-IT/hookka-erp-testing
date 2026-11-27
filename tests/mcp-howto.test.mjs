// AI Connector process help (owner 2026-11-27): how_to guides, flows,
// module_overview, glossary, explain_error, onboarding.
// Honesty first: every page path exists in the router, every double-quoted UI
// label exists in src/, and canDo follows the ERP permissions exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GUIDES,
  FLOWS,
  ONBOARDING,
  MODULES,
  GLOSSARY,
  ERRORS,
  howTo,
  moduleOverview,
  glossary,
  explainError,
  onboarding,
  guideCanDo,
  pageLink,
  scrubQuestion,
  NO_PERMISSION_NOTE,
} from "../src/api/lib/mcp-howto.ts";
import { PROMPTS, PROMPT_TOOLS, promptText } from "../src/api/lib/mcp-quick.ts";
import { checkGuides, labelExists, pathExists } from "./_howto-check.mjs";

const ORIGIN = "https://erp.example";
const yes = async () => true;
const no = async () => false;

test("guides: every page is in the router and every quoted label is in src/", () => {
  const bad = checkGuides(GUIDES);
  assert.deepEqual(bad, [], bad.map((b) => `${b.id}: ${b.problem}`).join("\n"));
});

test("guides: 20+ guides, unique ids, related ids resolve, every guide has a company tag", () => {
  assert.ok(GUIDES.length >= 20, `only ${GUIDES.length} guides`);
  const ids = GUIDES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guide id");
  const known = new Set([...ids, ...FLOWS.map((f) => f.id)]);
  for (const g of GUIDES) {
    assert.ok(Array.isArray(g.companies) && g.companies.length, `${g.id} has no company tag`);
    for (const r of g.related) assert.ok(known.has(r), `${g.id} relates to unknown ${r}`);
    for (const p of [...g.permission, ...(g.permissionAny ?? [])]) assert.match(p, /^[a-z0-9-]+:[a-z]+$/, `${g.id} permission ${p}`);
  }
});

test("guides: 100% English (no CJK outside keywords)", () => {
  for (const g of GUIDES) {
    const { keywords, ...rest } = g;
    assert.doesNotMatch(JSON.stringify(rest), /[㐀-鿿]/, `${g.id} has non-English text`);
  }
});

test("flows and onboarding: every guide / flow id exists", () => {
  const ids = new Set(GUIDES.map((g) => g.id));
  for (const f of FLOWS) for (const s of f.steps) assert.ok(ids.has(s.guide), `${f.id} → ${s.guide}`);
  const all = new Set([...ids, ...FLOWS.map((f) => f.id)]);
  for (const [role, o] of Object.entries(ONBOARDING)) for (const id of o.path) assert.ok(all.has(id), `${role} → ${id}`);
  for (const r of ["sales", "purchasing", "production", "warehouse", "finance", "after-sales"]) assert.ok(ONBOARDING[r], r);
  for (const id of ["flow-order-to-cash", "flow-procure-to-pay", "flow-product-setup", "flow-after-sales", "flow-payroll-inputs"]) assert.ok(FLOWS.some((f) => f.id === id), id);
});

test("module_overview: sections and page names come from the real sidebar; paths exist", () => {
  const sidebar = readFileSync(new URL("../src/components/layout/sidebar.tsx", import.meta.url), "utf8");
  for (const m of MODULES) {
    assert.ok(sidebar.includes(`label: "${m.section}"`), `section ${m.section} not in sidebar`);
    for (const p of m.pages) {
      assert.ok(sidebar.includes(`name: "${p.name}"`), `${m.id}: sidebar has no "${p.name}"`);
      assert.ok(pathExists(p.path), `${m.id}: ${p.path} not in router`);
    }
  }
  // Every sidebar section is covered.
  for (const sec of sidebar.matchAll(/^\s{4}label: "([^"]+)",/gm)) assert.ok(MODULES.some((m) => m.section === sec[1]), `sidebar section ${sec[1]} has no overview`);
});

test("glossary: required terms, UI labels exist, pages exist", () => {
  const terms = GLOSSARY.map((e) => e.term.toLowerCase());
  for (const t of ["so", "po", "grn", "do", "job card", "wip", "fg", "bom", "variant", "fabric tier", "mrp", "qc", "service case", "delivery return", "credit note", "ar aging", "ap aging", "sen vs rm", "floor live", "efficiency %"]) assert.ok(terms.includes(t), `glossary misses ${t}`);
  for (const e of GLOSSARY) {
    for (const l of e.labels) assert.ok(labelExists(l), `${e.term}: label "${l}" not in src/`);
    if (e.page) assert.ok(pathExists(e.page), `${e.term}: ${e.page}`);
    assert.doesNotMatch(e.definition, /[㐀-鿿]/);
  }
});

test("explain_error: every message fragment is real (appears in src/)", () => {
  assert.ok(ERRORS.length >= 30);
  for (const e of ERRORS) assert.ok(labelExists(e.match), `${e.id}: "${e.match}" not in src/`);
  const r = explainError({ text: `Error: ${ERRORS[0].match}` });
  assert.equal(r.matched, true);
  assert.equal(r.value.errors[0].message, ERRORS[0].match);
  assert.equal(explainError({ text: "zzqq totally unknown wording" }).matched, false);
});

test("how_to ranking: service case, 开PO, terima barang", async () => {
  const top = async (q) => {
    const r = await howTo({ question: q }, ORIGIN, yes);
    return r.value.guides?.[0]?.id ?? r.value.flow?.id;
  };
  assert.equal(await top("how to open service case"), "open-service-case");
  assert.equal(await top("开PO"), "create-purchase-order");
  assert.equal(await top("terima barang"), "receive-goods-grn");
  assert.equal(await top("how do I create a sales order"), "create-sales-order");
  assert.equal(await top("order to cash whole process"), "flow-order-to-cash");
});

test("how_to: steps carry ?highlight= links; topic id returns that guide", async () => {
  const r = await howTo({ topic: "create-purchase-order" }, ORIGIN, yes);
  const g = r.value.guides[0];
  assert.equal(g.id, "create-purchase-order");
  assert.ok(g.erpLink.startsWith(`${ORIGIN}/procurement`));
  assert.ok(g.steps.some((s) => s.link && s.link.includes("?highlight=")), "no highlight link");
  assert.equal(pageLink(ORIGIN, "/sales", "New Sales Order"), `${ORIGIN}/sales?highlight=New%20Sales%20Order`);
  assert.equal(pageLink(ORIGIN, "/accounting?tab=receipts", "New Customer Receipt"), `${ORIGIN}/accounting?tab=receipts&highlight=New%20Customer%20Receipt`);
  assert.equal(pageLink(ORIGIN, "/sales/:id"), null);
});

test("how_to canDo follows the ERP permissions", async () => {
  const denied = await howTo({ topic: "create-purchase-order" }, ORIGIN, no);
  assert.equal(denied.value.guides[0].canDo, false);
  assert.equal(denied.value.guides[0].note, NO_PERMISSION_NOTE);
  const allowed = await howTo({ topic: "create-purchase-order" }, ORIGIN, yes);
  assert.equal(allowed.value.guides[0].canDo, true);
  assert.equal(allowed.value.guides[0].note, undefined);
  // Exactly the guide's own permission decides: grant only what it lists.
  const po = GUIDES.find((g) => g.id === "create-purchase-order");
  const only = new Set(po.permission);
  assert.equal(await guideCanDo(po, async (r, a) => only.has(`${r}:${a}`)), true);
  // OR-gate: product costing for Finance (cost-ledger:read) without product-costing:read.
  const pc = GUIDES.find((g) => g.id === "product-costing");
  if (pc.permissionAny?.length) {
    const finance = new Set([...pc.permission, "cost-ledger:read"]);
    assert.equal(await guideCanDo(pc, async (r, a) => finance.has(`${r}:${a}`)), true);
    assert.equal(await guideCanDo(pc, async (r, a) => pc.permission.includes(`${r}:${a}`)), false);
  }
});

test("how_to: no match lists the guide titles and is logged as a gap", async () => {
  const r = await howTo({ question: "zzqq xyzzy" }, ORIGIN, yes);
  assert.equal(r.matched, false);
  assert.ok(r.value.guides.length >= 20);
  assert.equal(scrubQuestion("email ali@x.com about SO-2611-376 call 012-345 6789"), "email [email] about [doc] call [number]");
});

test("module_overview, glossary, onboarding answer", async () => {
  const all = await moduleOverview({}, ORIGIN, yes);
  assert.equal(all.value.modules.length, MODULES.length);
  const proc = await moduleOverview({ module: "procurement" }, ORIGIN, no);
  assert.equal(proc.value.id, "procurement");
  assert.ok(proc.value.pages.every((p) => p.canOpen === false));
  assert.equal(glossary({ term: "GRN" }, ORIGIN).value.terms[0].term, "GRN");
  assert.equal(glossary({ term: "盘点" }, ORIGIN).value.terms[0].term, "Stock take");
  const ob = await onboarding({ role: "finance" }, ORIGIN, yes);
  assert.equal(ob.value.role, "finance");
  assert.ok(ob.value.path.length >= 5);
});

test("prompts: how_do_i and the help prompts are offered with their tools", () => {
  for (const [p, t] of [["how_do_i", "how_to"], ["explain_module", "module_overview"], ["what_does_it_mean", "glossary"], ["explain_this_error", "explain_error"], ["my_first_week", "onboarding"]]) {
    assert.ok(PROMPTS.some((x) => x.name === p), p);
    assert.deepEqual(PROMPT_TOOLS[p], [t]);
  }
  assert.match(promptText("how_do_i", { task: "create a PO" }), /how_to/);
});
