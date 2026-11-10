// ---------------------------------------------------------------------------
// batch-confirm-and-return-guard.test.mjs — owner-approved 2026-11-10.
//
//   G11  GRN / PI lists: "Confirm selected" sends only drafts, one at a time,
//        through the per-document confirm PUT, and collects every refusal with
//        the server's reason (no rollback of the successes).
//   O1   Delivery-return status changes are compare-and-set: the client names
//        the status it saw, the UPDATE carries the from-status, and a return
//        that moved meanwhile answers 409 with what it is now — a late write
//        cannot re-open a cancelled return.
//
// Pure helpers are exercised directly; the real delivery-returns handlers run
// against a small fake D1 that moves the row between the read and the write;
// UI wiring is pinned by source pattern (house style).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import {
  batchProgressLabel,
  batchSummary,
  batchTotalSen,
  eligibleForConfirm,
  putStatusConfirmed,
  runSequentialBatch,
} from "../src/lib/batch-confirm.ts";
import {
  isStaleStatus,
  readExpectedStatus,
  staleReturnStatusMessage,
} from "../src/lib/delivery-return-status.ts";

const read = (p) => readFileSync(p, "utf8");

// ── G11: pure helpers ─────────────────────────────────────────────────────
test("G11: only rows whose status allows confirm are sent; total is integer sen", () => {
  const rows = [
    { no: "A", status: "DRAFT", amt: 1050 },
    { no: "B", status: "CONFIRMED", amt: 999 },
    { no: "C", status: "DRAFT", amt: 2000 },
    { no: "D", status: "CANCELLED", amt: 5 },
  ];
  const sent = eligibleForConfirm(rows, (r) => r.status === "DRAFT");
  assert.deepEqual(sent.map((r) => r.no), ["A", "C"]);
  assert.equal(batchTotalSen(sent, (r) => r.amt), 3050);
  assert.equal(batchTotalSen([{ amt: null }, { amt: 12.6 }], (r) => r.amt), 13);
});

test("G11: progress reads 'Confirming 3 of 12'", () => {
  assert.equal(batchProgressLabel(0, 12), "Confirming 1 of 12");
  assert.equal(batchProgressLabel(2, 12), "Confirming 3 of 12");
  assert.equal(batchProgressLabel(12, 12), "Confirming 12 of 12");
});

test("G11: the batch runs strictly one at a time and stops at nothing", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const order = [];
  const progress = [];
  const result = await runSequentialBatch(
    ["GRN-1", "GRN-2", "GRN-3", "GRN-4"],
    (x) => x,
    async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(x);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      if (x === "GRN-2") return "Arrival not recorded";
      if (x === "GRN-3") throw new Error("Network down");
      return null;
    },
    (done, total) => progress.push(`${done}/${total}`),
  );
  assert.equal(maxInFlight, 1, "never two confirms in flight");
  assert.deepEqual(order, ["GRN-1", "GRN-2", "GRN-3", "GRN-4"]);
  assert.deepEqual(result.succeeded, ["GRN-1", "GRN-4"]);
  assert.deepEqual(result.failed, [
    { label: "GRN-2", reason: "Arrival not recorded" },
    { label: "GRN-3", reason: "Network down" },
  ]);
  assert.deepEqual(progress, ["0/4", "1/4", "2/4", "3/4", "4/4"]);
  assert.equal(batchSummary(result, "GRN"), "Confirmed 2 GRNs; 2 refused.");
  assert.equal(batchSummary({ succeeded: ["a"], failed: [] }, "invoice"), "Confirmed 1 invoice.");
});

test("G11: putStatusConfirmed is the detail page's PUT and returns the server's reason", async () => {
  const calls = [];
  const fake = (body, status) => async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  assert.equal(await putStatusConfirmed("/api/grn/g1", fake({ success: true }, 200)), null);
  assert.equal(calls[0].url, "/api/grn/g1");
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), { status: "CONFIRMED" });
  assert.equal(
    await putStatusConfirmed("/api/purchase-invoices/p1", fake({ success: false, error: "Supplier invoice no. already used" }, 409)),
    "Supplier invoice no. already used",
  );
  assert.equal(await putStatusConfirmed("/x", fake("<html>bad gateway</html>", 502)), "Confirm failed (HTTP 502)");
  // a 200 without success:true is NOT a success (same rule as the detail page)
  assert.equal(await putStatusConfirmed("/x", fake({}, 200)), "Confirm failed (HTTP 200)");
});

// ── G11: wiring ───────────────────────────────────────────────────────────
test("G11: the GRN and PI lists use the shared sequential batch, drafts only, no parallel PUTs", () => {
  const comp = read("src/components/batch-confirm.tsx");
  assert.match(comp, /runSequentialBatch\(/);
  assert.match(comp, /putStatusConfirmed\(url\(row\)\)/);
  assert.match(comp, /eligibleForConfirm\(rows, canConfirm\)/);
  assert.match(comp, /totalling \$\{formatCurrency\(batchTotalSen\(targets, amountSen\)\)\}/);
  assert.match(comp, /result\.failed\.map\(/);

  const grn = read("src/pages/procurement/grn.tsx");
  assert.match(grn, /useBatchConfirm<GoodsReceiptNote>\(\{[\s\S]*?canConfirm: \(g\) => g\.status === "DRAFT",[\s\S]*?url: \(g\) => `\/api\/grn\/\$\{g\.id\}`/);
  assert.match(grn, /onClick=\{\(\) => batchConfirm\.run\(selectedGrns\)\}/);
  assert.match(grn, /batchConfirm\.progress \?\? `Confirm selected/);
  assert.match(grn, /\{batchConfirm\.resultDialog\}/);

  const pi = read("src/pages/procurement/pi.tsx");
  assert.match(pi, /useBatchConfirm<PurchaseInvoice>\(\{[\s\S]*?canConfirm: \(r\) => r\.status === "DRAFT",[\s\S]*?url: \(r\) => `\/api\/purchase-invoices\/\$\{r\.id\}`/);
  assert.match(pi, /onClick=\{\(\) => batchConfirm\.run\(selectedRows\)\}/);
  assert.match(pi, /\{batchConfirm\.resultDialog\}/);

  // The old parallel bulk confirm is gone from both lists.
  for (const src of [grn, pi]) {
    assert.doesNotMatch(src, /bulkConvertDrafts/);
    assert.doesNotMatch(src, /Promise\.all\(\s*\w+\.map\(async \(\w+\) => \{\s*try \{\s*const res = await fetch\(`\/api\/(grn|purchase-invoices)\/\$\{\w+\.id\}`/);
  }
});

// ── O1: pure helpers ──────────────────────────────────────────────────────
test("O1: expectedStatus is read from the body and compared", () => {
  assert.equal(readExpectedStatus({ expectedStatus: "OPEN" }), "OPEN");
  assert.equal(readExpectedStatus({ expectedStatus: "  " }), null);
  assert.equal(readExpectedStatus({}), null);
  assert.equal(readExpectedStatus(null), null);
  assert.equal(isStaleStatus(null, "CANCELLED"), false, "an old client that sends nothing is not refused");
  assert.equal(isStaleStatus("OPEN", "OPEN"), false);
  assert.equal(isStaleStatus("OPEN", "RETURNED_TO_STOCK"), true);
  assert.equal(
    staleReturnStatusMessage("CANCELLED", "SERVICE_SPAWNED"),
    "This return was changed by someone else just now (it is now Cancelled, it was Service in progress when you started). Nothing was saved. Refresh and check before trying again.",
  );
});

// ── O1: the real handlers against a fake D1 ───────────────────────────────
// The fake keeps one delivery_returns row, applies the guarded UPDATEs the way
// SQL would (only when the from-status matches), raises "division by zero" for
// the trailing flip check when the UPDATE matched nothing, and rolls the batch
// back on a raise. `afterRead` moves the row right after the handler's read —
// the race window.
function fakeDb(state, afterRead) {
  let reads = 0;
  const exec = (sql, args) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^UPDATE delivery_returns SET status='(\w+)', updated_at=\? WHERE id=\? AND status=(\?|'\w+')$/.test(s)) {
      const [, to, fromTok] = s.match(/SET status='(\w+)'.*AND status=(\?|'\w+')$/);
      const from = fromTok === "?" ? args[2] : fromTok.slice(1, -1);
      if (state.status === from) {
        state.status = to;
        state.updatedAt = args[0];
      }
      return;
    }
    if (/AS "flipped"$/.test(s)) {
      const [, to, now] = args;
      if (!(state.status === to && state.updatedAt === now)) throw new Error("division by zero");
      return;
    }
    throw new Error(`fake db: unexpected batch statement ${s.slice(0, 80)}`);
  };
  return {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...a) {
          stmt.args = a;
          return stmt;
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
        async first() {
          if (/FROM delivery_returns WHERE id = \?$/.test(sql.trim())) {
            const row = { doId: null, status: state.status };
            reads++;
            if (reads === 1 && afterRead) afterRead(state);
            return row;
          }
          return null;
        },
      };
      return stmt;
    },
    async batch(stmts) {
      const snapshot = { ...state };
      try {
        for (const st of stmts) exec(st.sql, st.args);
      } catch (e) {
        Object.assign(state, snapshot);
        throw e;
      }
      return stmts.map(() => ({ results: [] }));
    },
  };
}

async function mount(db) {
  const { default: drApp } = await import("../src/api/routes/delivery-returns.ts");
  const root = new Hono();
  root.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "test-user");
    c.set("orgId", "org-test");
    await next();
  });
  root.route("/", drApp);
  return root;
}
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

test("O1 race: a cancel landing between read and write — mark-redelivered gets 409 and the return stays CANCELLED", async () => {
  const state = { status: "SERVICE_SPAWNED", updatedAt: "t0" };
  const app = await mount(fakeDb(state, (s) => { s.status = "CANCELLED"; s.updatedAt = "t1"; }));
  const res = await app.request("/dr-1/mark-redelivered", post({ expectedStatus: "SERVICE_SPAWNED" }));
  assert.equal(res.status, 409);
  const j = await res.json();
  assert.equal(j.success, false);
  assert.equal(j.code, "status_changed");
  assert.equal(j.currentStatus, "CANCELLED");
  assert.match(j.error, /it is now Cancelled, it was Service in progress when you started/);
  assert.equal(state.status, "CANCELLED", "the late write did not re-open the cancelled return");
});

test("O1 race: two cancels at once — the second is refused, the first stands", async () => {
  const state = { status: "SERVICE_SPAWNED", updatedAt: "t0" };
  const app = await mount(fakeDb(state, (s) => { s.status = "CANCELLED"; s.updatedAt = "t1"; }));
  const res = await app.request("/dr-1/cancel", post({ expectedStatus: "SERVICE_SPAWNED" }));
  assert.equal(res.status, 409);
  assert.equal(state.status, "CANCELLED");
  assert.equal(state.updatedAt, "t1", "nothing written over the first cancel");
});

test("O1: a cancel pressed on an OPEN page is refused once the return was restocked — no undo runs", async () => {
  const state = { status: "RETURNED_TO_STOCK", updatedAt: "t0" };
  const app = await mount(fakeDb(state));
  const res = await app.request("/dr-1/cancel", post({ expectedStatus: "OPEN" }));
  assert.equal(res.status, 409);
  const j = await res.json();
  assert.equal(j.currentStatus, "RETURNED_TO_STOCK");
  assert.match(j.error, /it is now Returned to stock, it was Open when you started/);
  assert.equal(state.status, "RETURNED_TO_STOCK");
});

test("O1: return-to-stock / set-outcome refuse a stale expectedStatus before touching stock", async () => {
  for (const path of ["/dr-1/return-to-stock", "/dr-1/set-outcome"]) {
    const state = { status: "CANCELLED", updatedAt: "t0" };
    const app = await mount(fakeDb(state));
    const res = await app.request(path, post({ expectedStatus: "OPEN", returnType: "PURE_RETURN" }));
    assert.equal(res.status, 409, path);
    assert.equal((await res.json()).currentStatus, "CANCELLED", path);
    assert.equal(state.status, "CANCELLED", path);
  }
});

test("O1: the happy path still works — OPEN cancel with a matching expectedStatus", async () => {
  const state = { status: "OPEN", updatedAt: "t0" };
  const app = await mount(fakeDb(state));
  const res = await app.request("/dr-1/cancel", post({ expectedStatus: "OPEN" }));
  assert.equal(res.status, 200);
  assert.equal(state.status, "CANCELLED");
});

// ── O1: every status-changing handler carries the guard ───────────────────
test("O1: every status handler checks expectedStatus, guards the UPDATE by from-status, and the page sends it", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  const handlers = [
    'app.post("/:id/return-to-stock"',
    'app.post("/:id/set-outcome"',
    'app.post("/:id/mark-redelivered"',
    'app.post("/:id/cancel"',
  ];
  for (let i = 0; i < handlers.length; i++) {
    const start = api.indexOf(handlers[i]);
    assert.ok(start > 0, handlers[i]);
    const end = i + 1 < handlers.length ? api.indexOf(handlers[i + 1]) : api.length;
    const body = api.slice(start, end);
    assert.match(body, /if \(isStaleStatus\(expected, (header|h)\.status\)\) return staleStatusResponse\(c, id, expected\);/, handlers[i]);
    assert.match(body, /UPDATE delivery_returns[\s\S]*?WHERE id=\? AND status=(\?|'\w+')/, handlers[i]);
    assert.match(body, /runFlip\([\s\S]*?id,\s*(header|h)\.status,?\s*\)/, handlers[i]);
  }
  assert.match(api, /code: "status_changed",\s+currentStatus: current/);

  const page = read("src/pages/delivery-returns/detail.tsx");
  assert.match(page, /expectedStatus: dr\?\.status/);
  assert.match(page, /serviceCaseId: caseId, expectedStatus: dr\.status/);
  assert.match(page, /if \(res\.status === 409\) refresh\(\);/);
  // a refused change does not carry on to the credit-note screen
  assert.match(page, /if \(!\(await call\("\/set-outcome", \{ returnType: "PURE_RETURN" \}\)\)\) return;/);
});
