// The BOM page activates drafted BOMs in bulk: tick drafts in the product list,
// then one POST /api/bom/templates/bulk-activate flips them ACTIVE in one batch.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type stripping handles the .ts import.
}

const { pickDisplayTemplates } = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/bom-display-template.ts")).href
);

function makeDatabase(templates) {
  const state = { templates: templates.map((row) => ({ ...row })), batchCalls: 0 };
  const isDraft = (row) => (row.versionStatus ?? "DRAFT").toUpperCase() === "DRAFT";

  function prepare(sqlText) {
    let boundValues = [];
    const statement = {
      sqlText,
      bind(...values) {
        boundValues = values;
        return statement;
      },
      get boundValues() {
        return boundValues;
      },
      async all() {
        if (/SELECT id FROM bom_templates WHERE UPPER\(COALESCE\(versionStatus, 'DRAFT'\)\) = 'DRAFT'/.test(sqlText)) {
          return { results: state.templates.filter(isDraft).map((row) => ({ id: row.id })) };
        }
        return { results: [] };
      },
      async first() {
        return null;
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
    return statement;
  }

  async function batch(statements) {
    state.batchCalls += 1;
    for (const statement of statements) {
      if (/^UPDATE bom_templates SET versionStatus = 'ACTIVE' WHERE id = \?/.test(statement.sqlText)) {
        const row = state.templates.find((template) => template.id === statement.boundValues[0]);
        if (row && isDraft(row)) row.versionStatus = "ACTIVE";
      }
    }
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }

  return { state, database: { prepare, batch, exec: async () => ({}) } };
}

async function mountBomApp(database, role = "SUPER_ADMIN") {
  const { default: bomApp } = await import(
    pathToFileURL(resolve(process.cwd(), "src/api/routes/bom.ts")).href
  );
  const parent = new Hono();
  parent.use("*", async (context, next) => {
    context.set("DB", database);
    if (role) context.set("userRole", role);
    context.set("userId", "user-test");
    await next();
  });
  parent.route("/", bomApp);
  return parent;
}

function postBulkActivate(app, body) {
  return app.request("/templates/bulk-activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("pickDisplayTemplatesPrefersNewestActiveThenNewestDraft", () => {
  const picked = pickDisplayTemplates([
    { id: "a-old", productCode: "A", versionStatus: "ACTIVE", effectiveFrom: "2026-01-01" },
    { id: "a-draft", productCode: "A", versionStatus: "DRAFT", effectiveFrom: "2026-09-01" },
    { id: "a-new", productCode: "A", versionStatus: "ACTIVE", effectiveFrom: "2026-05-01" },
    { id: "b-old", productCode: "B", versionStatus: "DRAFT", effectiveFrom: "2026-01-01" },
    { id: "b-new", productCode: "B", versionStatus: "DRAFT", effectiveFrom: "2026-02-01" },
  ]);

  assert.equal(picked.get("A").id, "a-new");
  assert.equal(picked.get("B").id, "b-new");
});

test("bulkActivateFlipsOnlyDraftTemplatesInOneBatch", async () => {
  const { state, database } = makeDatabase([
    { id: "t1", productCode: "5567-1S", versionStatus: "DRAFT" },
    { id: "t2", productCode: "5567-2S", versionStatus: "DRAFT" },
    { id: "t3", productCode: "5567-1NA", versionStatus: "ACTIVE" },
    { id: "t4", productCode: "5567-CNR", versionStatus: "DRAFT" },
  ]);
  const app = await mountBomApp(database);

  const response = await postBulkActivate(app, { ids: ["t1", "t2", "t3", "missing", "t1"] });
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(json.activatedIds, ["t1", "t2"]);
  assert.deepEqual(json.skippedIds, ["t3", "missing"]);
  assert.equal(state.batchCalls, 1);
  assert.deepEqual(
    state.templates.map((row) => [row.id, row.versionStatus]),
    [["t1", "ACTIVE"], ["t2", "ACTIVE"], ["t3", "ACTIVE"], ["t4", "DRAFT"]],
  );
});

test("bulkActivateRejectsEmptyIds", async () => {
  const { state, database } = makeDatabase([{ id: "t1", productCode: "X", versionStatus: "DRAFT" }]);
  const app = await mountBomApp(database);

  const response = await postBulkActivate(app, { ids: [] });

  assert.equal(response.status, 400);
  assert.equal(state.batchCalls, 0);
});

test("bulkActivateRequiresSignedInRole", async () => {
  const { state, database } = makeDatabase([{ id: "t1", productCode: "X", versionStatus: "DRAFT" }]);
  const app = await mountBomApp(database, null);

  const response = await postBulkActivate(app, { ids: ["t1"] });

  assert.equal(response.status, 401);
  assert.equal(state.templates[0].versionStatus, "DRAFT");
});
