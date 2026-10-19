// ---------------------------------------------------------------------------
// assistant-schedule-decide.test.mjs — structural pins for the chat-write
// phase 1 (owner ruling 2026-07-27 「聊天全部可以更改的」) and for
// BUG-2026-07-27-003 (the SYSTEM_PROMPT predated the v1.9 agent tools, so
// the model refused every scheduling/teaching request although the tools
// existed).
//
// Pins:
//   1. The prompt no longer contains the absolute read-only doctrine and
//      documents the agent/scheduling exception + the consent flow.
//   2. Both new tools are registered; decide enforces SUPER_ADMIN + the
//      confirmed:true consent contract and reuses the shared lib core.
//   3. The Planning route delegates to the same shared core (no divergent
//      inline write path left behind).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prompt = readFileSync(
  new URL("../src/api/routes/assistant.ts", import.meta.url),
  "utf8",
);
const tools = readFileSync(
  new URL("../src/api/lib/assistant-tools.ts", import.meta.url),
  "utf8",
);
const lib = readFileSync(
  new URL("../src/api/lib/schedule-proposals.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/api/routes/schedule-proposals.ts", import.meta.url),
  "utf8",
);

test("prompt: absolute read-only doctrine replaced by the agent exception", () => {
  assert.doesNotMatch(
    prompt,
    /STRICTLY READ-ONLY/,
    "the blanket refusal clause must stay gone (BUG-2026-07-27-003)",
  );
  assert.match(prompt, /THE ONE EXCEPTION — the AI agent workforce/);
  assert.match(prompt, /list_schedule_proposals/);
  assert.match(prompt, /decide_schedule_proposals/);
  assert.match(prompt, /teach_agent/, "teaching must be documented to the model");
  assert.match(
    prompt,
    /confirmed:true/,
    "the consent contract must be spelled out in the prompt",
  );
});

test("tools: both proposal tools registered; decide enforces consent + role", () => {
  assert.match(tools, /name: "list_schedule_proposals"/);
  assert.match(tools, /name: "decide_schedule_proposals"/);
  assert.match(
    tools,
    /listScheduleProposalsTool,\s*\n\s*decideScheduleProposalsTool,\s*\n\];/,
    "both tools must be in the TOOLS registry",
  );
  assert.match(
    tools,
    /args\.confirmed !== true/,
    "decide must hard-require confirmed:true",
  );
  // The consent check + role check live inside the decide executor.
  const decideIdx = tools.indexOf('name: "decide_schedule_proposals"');
  const decideSlice = tools.slice(decideIdx, decideIdx + 4000);
  // HK-0033: SUPER_ADMIN, or whoever holds the permission the Planning
  // route's approve/reject buttons require.
  assert.match(
    decideSlice,
    /!isSuperAdmin\(c\) && !\(await hasPermission\(c, "production-orders", "update"\)\)/,
    "decide must be gated like POST /api/planning/proposals/approve",
  );
  assert.match(
    decideSlice,
    /decideProposals\(db, \{ action, ids, decidedBy: userId \}\)/,
    "decide must reuse the shared lib core",
  );
});

test("shared core: lib exports decideProposals; route delegates to it", () => {
  assert.match(lib, /export async function decideProposals\(/);
  assert.match(lib, /kind: "PROPOSALS_APPLIED"/, "batch snapshot stays rollbackable");
  assert.match(route, /decideProposals\(c\.var\.DB, \{\s*\n\s*action: "approve"/);
  assert.match(route, /decideProposals\(c\.var\.DB, \{\s*\n\s*action: "reject"/);
  assert.doesNotMatch(
    route,
    /UPDATE job_cards SET dueDate/,
    "the route must not keep a divergent inline write path",
  );
});

test("HK-0033: staff can reach list/decide, and each tool enforces its own permission", () => {
  assert.match(
    prompt,
    /"list_schedule_proposals",\s*\n\s*"decide_schedule_proposals",/,
    "both proposal tools must be in STAFF_TOOL_NAMES",
  );
  const listIdx = tools.indexOf('name: "list_schedule_proposals"');
  assert.match(
    tools.slice(listIdx, listIdx + 3000),
    /hasPermission\(c, "production-orders", "read"\)/,
    "list must enforce production-orders:read for non-super-admins",
  );
});

// ---- HK-0033 behavioural gate: drives the real runTool against a fake DB ----
const { runTool } = await import(
  new URL("../src/api/lib/assistant-tools.ts", import.meta.url).href
);

function gateCtx(role, grants, writes) {
  const stmt = (sql) => ({
    bind: () => stmt(sql),
    async first() { return null; },
    async all() {
      if (/role_permissions/.test(sql)) {
        return { results: grants.map((g) => ({ resource: g.split(":")[0], action: g.split(":")[1] })) };
      }
      return { results: [] };
    },
    async run() {
      writes.push(sql);
      return { success: true, meta: { changes: 1 } };
    },
  });
  const DB = {
    prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()),
    async exec() { return { count: 0 }; },
    async batch(s) { return s.map(() => ({ success: true, meta: { changes: 1 } })); },
  };
  const vars = { DB, orgId: "org-1", userRole: role, userId: "u-1" };
  return { var: vars, env: {}, get: (k) => vars[k], set: (k, v) => { vars[k] = v; } };
}
const decideArgs = { action: "reject", ids: ["p-1"], confirmed: true };
const rejected = (w) => w.some((s) => /UPDATE schedule_proposals/.test(s));

test("HK-0033 gate: decide is denied without production-orders:update, nothing written", async () => {
  const writes = [];
  const c = gateCtx("PIC_NO_UPDATE", ["production-orders:read"], writes);
  const r = await runTool(c, "decide_schedule_proposals", decideArgs);
  assert.equal(r.ok, true, "runTool wraps the executor's own refusal");
  assert.equal(r.result.ok, false);
  assert.match(r.result.error, /production-orders update permission/);
  assert.equal(rejected(writes), false);
});

test("HK-0033 gate: decide is allowed with production-orders:update", async () => {
  const writes = [];
  const c = gateCtx("PIC_WITH_UPDATE", ["production-orders:update"], writes);
  const r = await runTool(c, "decide_schedule_proposals", decideArgs);
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  assert.equal(rejected(writes), true);
});

test("HK-0033 gate: list is denied without production-orders:read, allowed with it", async () => {
  const denied = await runTool(gateCtx("PIC_NO_READ", ["sales-orders:read"], []), "list_schedule_proposals", {});
  assert.equal(denied.result.ok, false);
  assert.match(denied.result.error, /permission/);
  const allowed = await runTool(gateCtx("PIC_WITH_READ", ["production-orders:read"], []), "list_schedule_proposals", {});
  assert.notEqual(allowed.result.ok, false, JSON.stringify(allowed.result));
});

test("HK-0033 prompt: no SUPER_ADMIN-only wording left for list/decide proposals", () => {
  for (const name of ["list_schedule_proposals", "decide_schedule_proposals"]) {
    for (const m of prompt.matchAll(new RegExp(`${name}[^\\n]{0,400}`, "g"))) {
      assert.doesNotMatch(m[0], /SUPER_ADMIN/, `prompt line for ${name} must not say SUPER_ADMIN`);
    }
  }
});
