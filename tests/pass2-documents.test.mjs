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
