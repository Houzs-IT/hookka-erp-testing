// Cross-system review pass 2, batch A1 — documents / PDF / proof of delivery
// (docs/plans/2026-11-10-cross-system-review-pass2.md). Pure helpers are
// exercised directly; the wiring is pinned by source pattern (house style,
// see tests/fe-quality-batch-a.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { docPageLabel } from "../src/lib/pdf-page-label.ts";

const read = (p) => readFileSync(p, "utf8");

// ── H3-9: every jsPDF document is compressed ──────────────────────────────
test("H3-9: every `new jsPDF(` in src/lib passes compress: true", () => {
  const files = readdirSync("src/lib").filter((f) => f.endsWith(".ts"));
  let seen = 0;
  for (const f of files) {
    const src = read(`src/lib/${f}`);
    const re = /new jsPDF\(\{([^}]*)\}\)/g;
    let m;
    while ((m = re.exec(src))) {
      seen++;
      assert.match(m[1], /compress:\s*true/, `${f}: new jsPDF({${m[1].trim()}}) is not compressed`);
    }
  }
  assert.ok(seen >= 19, `expected at least 19 jsPDF constructors, saw ${seen}`);
});

// ── H3-10: a batch print numbers pages per document ───────────────────────
test("H3-10: docPageLabel restarts at Page 1 for each document in the file", () => {
  // Cover (page 1), DO A (pages 2-3), DO B (page 4).
  const starts = [1, 2, 4];
  assert.deepEqual(
    [1, 2, 3, 4].map((p) => docPageLabel(p, 4, starts)),
    ["Page 1 of 1", "Page 1 of 2", "Page 2 of 2", "Page 1 of 1"],
  );
  // One document = the whole file (single-DO print unchanged).
  assert.equal(docPageLabel(2, 3), "Page 2 of 3");
  assert.equal(docPageLabel(1, 1, [1]), "Page 1 of 1");
  // Defensive: unsorted / duplicate / out-of-range starts.
  assert.equal(docPageLabel(3, 4, [4, 2, 2, 9]), "Page 2 of 2");
  assert.equal(docPageLabel(1, 4, [2]), "Page 1 of 1");
});

test("H3-10: the DO and CN packing lists pass each document's first page", () => {
  const dop = read("src/lib/generate-do-pdf.ts");
  const body = dop.slice(dop.indexOf("export function generateConsolidatedDoPdf"));
  assert.match(body, /starts\.push\(doc\.getNumberOfPages\(\)\);\s*renderDoInto\(/);
  assert.match(body, /stampDoFooters\(doc, starts\);/);
  assert.match(dop, /docPageLabel\(p, pages, starts\)/);
  // The owner's ask — every DO in one file, tagged STOP n / N — is kept.
  assert.match(body, /\{ seq: i \+ 1, total: orders\.length \}/);
  const cn = read("src/lib/generate-cn-pdf.ts");
  assert.match(cn, /stampCnFooters\(doc, starts\);/);
  assert.match(cn, /docPageLabel\(p, pages, starts\)/);
});

// ── B7: the in-app PDF preview closes on Back and on a route change ───────
// A minimal fake DOM — just what openPdfPreview touches.
function installFakeDom() {
  const listeners = { doc: {}, win: {} };
  const on = (bag) => (t, f) => ((bag[t] ||= new Set()).add(f));
  const off = (bag) => (t, f) => bag[t]?.delete(f);
  const fire = (bag, t, e = {}) => [...(bag[t] || [])].forEach((f) => f(e));
  function el(tag) {
    const node = {
      tagName: tag, id: "", style: {}, children: [], parent: null, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      addEventListener() {}, focus() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
    };
    return node;
  }
  const body = el("body");
  const stack = [{ idx: 0, key: "default" }];
  let pos = 0;
  const history = {
    get state() { return stack[pos]; },
    pushState(s) { stack.splice(pos + 1); stack.push(s); pos++; },
    back() { if (pos > 0) { pos--; queueMicrotask(() => fire(listeners.win, "popstate", { state: stack[pos] })); } },
  };
  const find = (n, id) => (n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean));
  globalThis.document = {
    body,
    createElement: el,
    getElementById: (id) => find(body, id) || null,
    addEventListener: on(listeners.doc),
    removeEventListener: off(listeners.doc),
  };
  globalThis.window = {
    history,
    addEventListener: on(listeners.win),
    removeEventListener: off(listeners.win),
  };
  return {
    body,
    stack: () => stack.slice(0, pos + 1),
    pressBack: () => history.back(),
    popListeners: () => listeners.win.popstate?.size ?? 0,
    keyListeners: () => listeners.doc.keydown?.size ?? 0,
  };
}

test("B7: Back closes the preview and leaves the page where it was", async () => {
  const dom = installFakeDom();
  const { openPdfPreview, PDF_PREVIEW_HISTORY_KEY } = await import("../src/lib/pdf-preview.ts");
  openPdfPreview(new Uint8Array([37, 80, 68, 70]), "DO-1.pdf");
  assert.equal(dom.body.children.length, 1, "overlay shown");
  assert.equal(dom.stack().length, 2, "one history entry pushed");
  const top = dom.stack()[1];
  assert.ok(top[PDF_PREVIEW_HISTORY_KEY], "entry is tagged");
  assert.equal(top.idx, 0, "router fields kept, so the router sees the same location");
  dom.pressBack();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dom.body.children.length, 0, "Back closed the overlay");
  assert.equal(dom.stack().length, 1, "still on the page underneath");
  assert.equal(dom.popListeners(), 0);
  assert.equal(dom.keyListeners(), 0);
});

test("B7: Close takes the history entry back off; a route change just closes", async () => {
  const dom = installFakeDom();
  const { openPdfPreview, closePdfPreview } = await import("../src/lib/pdf-preview.ts");
  const close = openPdfPreview(new Uint8Array([1]), "PO-1.pdf");
  close();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dom.body.children.length, 0);
  assert.equal(dom.stack().length, 1, "Close popped our entry, so the next Back leaves the page");
  // Route change: the router has moved on — close without going back.
  openPdfPreview(new Uint8Array([1]), "PO-2.pdf");
  assert.equal(closePdfPreview("route"), true);
  assert.equal(dom.body.children.length, 0);
  assert.equal(dom.stack().length, 2, "no history.back() on a route change");
  assert.equal(closePdfPreview("route"), false, "nothing open any more");
  // Opening a second preview closes the first properly (one listener each).
  openPdfPreview(new Uint8Array([1]), "A.pdf");
  openPdfPreview(new Uint8Array([1]), "B.pdf");
  assert.equal(dom.body.children.length, 1);
  assert.equal(dom.popListeners(), 1);
});

test("B7: the router closes the preview on every route change", () => {
  const r = read("src/router.tsx");
  assert.match(r, /import \{ closePdfPreview \} from '\.\/lib\/pdf-preview'/);
  assert.match(r, /router\.subscribe\(\(state\) => \{[\s\S]*?closePdfPreview\('route'\)/);
});

// ── H1-6: a printed invoice lists each payment and the balance due ────────
import { invoicePaymentLines, invoiceBalanceDueSen } from "../src/lib/invoice-payments-print.ts";
import { buildUnifiedInvoiceData, invoicePaymentsBlock } from "../src/lib/build-unified-doc-data.ts";
import { buildUnifiedDocPdf } from "../src/api/lib/unified-do-invoice-pdf.ts";
import { loadInvoicePrintPayments } from "../src/api/lib/invoice-print-extras.ts";

test("H1-6: receipts print their number; their invoice_payments twin is not doubled", () => {
  const lines = invoicePaymentLines(
    [
      { receiptNumber: "OR-2611-002", date: "2026-11-05", status: "RECEIVED", amountSen: 30000 },
      { receiptNumber: "OR-2611-001", date: "2026-11-01", status: "CLEARED", amountSen: 20000 },
      { receiptNumber: "OR-2611-009", date: "2026-11-06", status: "BOUNCED", amountSen: 99900 },
    ],
    [
      { date: "2026-11-01T00:00:00Z", amountSen: 20000, method: "BANK_TRANSFER", reference: "" },
      { date: "2026-11-05", amountSen: 30000, method: "CHEQUE", reference: "CHQ 1" },
      { date: "2026-11-03", amountSen: 5000, method: "CASH", reference: "" },
    ],
    55000,
  );
  assert.deepEqual(lines, [
    { date: "2026-11-01", ref: "OR-2611-001", amountSen: 20000 },
    { date: "2026-11-03T00:00:00Z".slice(0, 10), ref: "CASH", amountSen: 5000 },
    { date: "2026-11-05", ref: "OR-2611-002", amountSen: 30000 },
  ]);
});

test("H1-6: the rows always add up to the stored paidAmount", () => {
  // A contra settled 10,000 sen with no receipt row.
  const a = invoicePaymentLines([{ receiptNumber: "OR-1", date: "2026-11-01", amountSen: 20000 }], [], 30000);
  assert.deepEqual(a.at(-1), { date: "", ref: "Other settlement", amountSen: 10000 });
  // A stale row above the stored figure → a negative adjustment, never a fake paid.
  const b = invoicePaymentLines([], [{ date: "2026-11-01", amountSen: 20000, reference: "TT" }], 15000);
  assert.equal(b.reduce((s, l) => s + l.amountSen, 0), 15000);
  assert.equal(b.at(-1).ref, "Adjustment");
  assert.deepEqual(invoicePaymentLines([], [], 0), []);
  assert.equal(invoiceBalanceDueSen(100000, 55000), 45000);
  assert.equal(invoiceBalanceDueSen(100000, 120000), 0);
});

test("H1-6: an unpaid invoice prints as before; a paid one carries the block", async () => {
  const base = {
    invoiceNo: "INV-2611-001", docDate: "2026-11-01", customerName: "Acme",
    items: [{ id: "i1", productCode: "BF-1", productName: "Bed", quantity: 1, priceSen: 100000, lineTotalSen: 100000 }],
    subtotalSen: 100000, totalSen: 100000,
  };
  const unpaid = buildUnifiedInvoiceData(base);
  assert.equal(unpaid.balanceDueSen, undefined);
  assert.equal(unpaid.paymentsReceived, undefined);
  const paid = buildUnifiedInvoiceData({
    ...base,
    paidSen: 60000,
    payments: [{ date: "2026-11-05", ref: "OR-2611-002", amountSen: 60000 }],
  });
  assert.equal(paid.balanceDueSen, 40000);
  assert.deepEqual(paid.paymentsReceived, [{ date: "05 Nov 2026", ref: "OR-2611-002", amountSen: 60000 }]);
  const bytes = await buildUnifiedDocPdf(paid);
  assert.ok(bytes.length > 1000);
  // Many payments fold so the block stays on the page, still summing to paid.
  const many = Array.from({ length: 30 }, (_, i) => ({ date: "2026-11-01", ref: `OR-${i}`, amountSen: 1000 }));
  const blk = invoicePaymentsBlock({ payments: many, paidSen: 30000, totalSen: 100000 });
  assert.equal(blk.paymentsReceived.length, 20);
  assert.equal(blk.paymentsReceived.reduce((s, p) => s + p.amountSen, 0), 30000);
  assert.match(blk.paymentsReceived.at(-1).ref, /11 more payments/);
});

test("H1-6: print-extras reads receipts allocated to THIS invoice only (read-only SQL)", async () => {
  const seen = [];
  const db = {
    prepare(sql) {
      seen.push(sql);
      return {
        bind: () => ({
          all: async () => {
            if (/FROM payment_records/.test(sql)) {
              return { results: [
                { receipt_number: "OR-7", date: "2026-11-02", status: "RECEIVED",
                  allocations: JSON.stringify([{ invoiceId: "INV1", amount: 12000 }, { invoiceId: "INV10", amount: 5000 }]) },
              ] };
            }
            if (/FROM invoice_payments/.test(sql)) return { results: [{ date: "2026-11-02", amount_sen: 12000, method: "CASH" }] };
            return { results: [] };
          },
          first: async () => null,
        }),
      };
    },
  };
  const rows = await loadInvoicePrintPayments(db, "INV1", "cust-1", 12000);
  assert.deepEqual(rows, [{ date: "2026-11-02", ref: "OR-7", amountSen: 12000 }]);
  assert.ok(seen.every((s) => /^\s*SELECT/i.test(s)), "display only — no writes");
});

test("H1-6: download, batch and the delivered e-mail all pass the payments through", () => {
  const dl = read("src/lib/unified-doc-download.ts");
  assert.match(dl, /payments: Array\.isArray\(extras\?\.payments\) \? extras\.payments : undefined/);
  assert.match(dl, /paidSen: Number\(extras\?\.paidSen \?\? \(inv as \{ paidAmount\?: number \}\)\.paidAmount\) \|\| 0/);
  const h = read("src/api/routes/delivery-orders/_helpers.ts");
  assert.match(h, /payments: printExtras\?\.payments,\s*\n\s*paidSen: printExtras\?\.paidSen,/);
  const r = read("src/api/lib/unified-do-invoice-pdf.ts");
  assert.match(r, /"PAYMENTS RECEIVED"/);
  assert.match(r, /sum\("Balance due"/);
});
