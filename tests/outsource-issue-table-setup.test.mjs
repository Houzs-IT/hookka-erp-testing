import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const libraryUrl = pathToFileURL(resolve(process.cwd(), "src/api/lib/outsource-issue.ts")).href;
let freshImportCount = 0;

async function importFreshLibrary() {
  freshImportCount += 1;
  return import(`${libraryUrl}?fresh=${freshImportCount}`);
}

function makeDdlDb(failures = []) {
  const runCounts = new Map();
  const pendingFailures = [...failures];
  const db = {
    prepare(sql) {
      const statement = {
        async run() {
          const key = sql.trim().split("\n")[0];
          runCounts.set(key, (runCounts.get(key) ?? 0) + 1);
          await Promise.resolve();
          const failureIndex = pendingFailures.findIndex((failure) => sql.includes(failure.whenSqlIncludes));
          if (failureIndex !== -1) {
            const [failure] = pendingFailures.splice(failureIndex, 1);
            throw Object.assign(new Error(failure.message), { code: failure.code });
          }
          return {};
        },
        async all() { return { results: [] }; },
        async first() { return null; },
        bind() { return statement; },
      };
      return statement;
    },
  };
  return { db, runCounts };
}

test("parallel first requests all succeed when one loses the create race", async () => {
  const { ensureOutsourceIssueTable } = await importFreshLibrary();
  const { db } = makeDdlDb([
    { whenSqlIncludes: "CREATE TABLE IF NOT EXISTS outsource_issues", code: "23505", message: 'duplicate key value violates unique constraint "pg_type_typname_nsp_index"' },
    { whenSqlIncludes: "idx_outsource_issues_item", code: "42P07", message: 'relation "idx_outsource_issues_item" already exists' },
  ]);

  const outcomes = await Promise.allSettled([ensureOutsourceIssueTable(db), ensureOutsourceIssueTable(db)]);

  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["fulfilled", "fulfilled"]);
});

test("the setup memo is a boolean, never a shared promise (BUG-CLASSES C9)", async () => {
  const source = (await import("node:fs")).readFileSync("src/api/lib/outsource-issue.ts", "utf8");
  assert.match(source, /let _applied = false;/);
  assert.doesNotMatch(source, /Promise<void> \| null/);
});

test("a concurrent create from another isolate is retried once, not surfaced as a 500", async () => {
  const { ensureOutsourceIssueTable } = await importFreshLibrary();
  const { db, runCounts } = makeDdlDb([
    { whenSqlIncludes: "CREATE TABLE IF NOT EXISTS outsource_issues", code: "23505", message: 'duplicate key value violates unique constraint "pg_type_typname_nsp_index"' },
  ]);

  await ensureOutsourceIssueTable(db);

  assert.equal(runCounts.get("CREATE TABLE IF NOT EXISTS outsource_issues ("), 2);
});

test("any other setup error fails loudly and the next request tries again", async () => {
  const { ensureOutsourceIssueTable } = await importFreshLibrary();
  const { db, runCounts } = makeDdlDb([
    { whenSqlIncludes: "CREATE TABLE IF NOT EXISTS outsource_issues", code: "42501", message: "permission denied for schema public" },
  ]);

  await assert.rejects(ensureOutsourceIssueTable(db), /permission denied/);
  await ensureOutsourceIssueTable(db);

  assert.equal(runCounts.get("CREATE TABLE IF NOT EXISTS outsource_issues ("), 2);
});
