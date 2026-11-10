// ---------------------------------------------------------------------------
// pass2-forms-search.test.mjs — cross-system review pass 2, batch A3 (forms,
// navigation, loading). The global-search half lives in
// tests/search-sources.test.mjs.
//
//   H3-1 / C2-2  leaving a half-filled document form asks "Leave without saving?"
//   C2-1         Esc / backdrop on a half-filled form popup asks "Discard your changes?"
//   H1-4         arrow keys / Enter move between line fields on the editors
//   C1-8         Back returns the list to the row you opened
//   C1-11        "—" while a list is still loading, not "All (0)"
//   H2-10 / C1-9 IT Support takes .zip attachments
//
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style, see tests/fe-quality-batch-a.test.mjs).
// Run: node --import tsx/esm --test tests/pass2-forms-search.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  shouldBlockNav,
  firstDirtyMessage,
  formSnapshotKey,
  DEFAULT_NAV_GUARD_MESSAGE,
} from "../src/lib/nav-guard-rules.ts";
import { closeUnlessKept, isBackdropClick } from "../src/lib/escape-stack.ts";
import { isLineGridField, planLineMove } from "../src/lib/line-grid-nav.ts";
import {
  gridReturnKey,
  recallGridRow,
  rememberGridRow,
  rowKeySelector,
  shouldReturnToRow,
} from "../src/lib/grid-return.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── H3-1 / C2-2: leave guard ───────────────────────────────────────────────

test("leave guard: only a real path change while dirty, never after allowNext", () => {
  const base = { isDirty: true, bypass: false, fromPath: "/sales/create", toPath: "/sales" };
  assert.equal(shouldBlockNav(base), true);
  assert.equal(shouldBlockNav({ ...base, isDirty: false }), false, "nothing changed → no prompt");
  assert.equal(shouldBlockNav({ ...base, bypass: true }), false, "the redirect after a save");
  assert.equal(shouldBlockNav({ ...base, toPath: "/sales/create" }), false, "a ?query change on the same page");
  assert.match(DEFAULT_NAV_GUARD_MESSAGE, /Leave without saving\?$/);
});

test("leave guard: any dirty form in the registry holds the navigation", () => {
  // React Router honours only the newest blocker; the registry makes it ask
  // about every mounted form, so a clean newer form cannot release a dirty one.
  assert.equal(firstDirtyMessage([{ dirty: false, message: "a" }, { dirty: true, message: "b" }]), "b");
  assert.equal(firstDirtyMessage([{ dirty: false, message: "a" }]), null);
  const hook = read("src/lib/use-nav-guard.ts");
  assert.match(hook, /const registry = new Map<symbol, GuardEntry>\(\);/);
  assert.match(hook, /isDirty: dirtyGuardMessage\(\) !== null/);
  // The in-app confirm, not window.confirm (owner rule).
  assert.match(hook, /void confirm\(\{\s*title: "Leave without saving\?"/);
  assert.doesNotMatch(hook, /window\.confirm\(/);
});

test("form snapshots compare by value (a dropdown pick changes them)", () => {
  assert.equal(formSnapshotKey({ a: 1, b: ["x"] }), formSnapshotKey({ a: 1, b: ["x"] }));
  assert.notEqual(formSnapshotKey({ method: "CASH" }), formSnapshotKey({ method: "BANK_TRANSFER" }));
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(formSnapshotKey(cyclic), "", "an unserialisable snapshot never throws");
});

const GUARDED = [
  ["src/pages/sales/create.tsx", "This sales order is not saved. Leave without saving?", true],
  ["src/pages/sales/edit.tsx", "Your changes to this sales order are not saved. Leave without saving?", true],
  ["src/pages/consignment/create.tsx", "This consignment order is not saved. Leave without saving?", true],
  ["src/pages/consignment/edit.tsx", "Your changes to this consignment order are not saved. Leave without saving?", true],
  ["src/pages/procurement/create.tsx", "This purchase order is not saved. Leave without saving?", true],
  ["src/pages/procurement/detail.tsx", "Your changes to this purchase order are not saved. Leave without saving?", false],
  ["src/pages/procurement/grn/create.tsx", "This goods receipt is not saved. Leave without saving?", true],
  ["src/pages/procurement/pi/create.tsx", "This purchase invoice is not saved. Leave without saving?", true],
  ["src/pages/invoices/payments.tsx", "This receipt is not saved. Leave without saving?", false],
  ["src/pages/invoices/supplier-payments.tsx", "This supplier payment is not saved. Leave without saving?", false],
];

test("every document form is guarded in-app, not only on tab close", () => {
  for (const [file, msg, redirects] of GUARDED) {
    const src = read(file);
    assert.ok(src.includes(`"${msg}"`), `${file}: guard message`);
    assert.match(src, /useNavGuard\(/, `${file}: useNavGuard`);
    assert.doesNotMatch(src, /useUnsavedChanges\(isDirty\)/, `${file}: still tab-close only`);
    if (redirects) {
      // Each redirect after a save is let through first.
      const navs = src.match(/navGuard\.allowNext\(\);\s*\n\s*navigate\(/g) || [];
      assert.ok(navs.length >= 1, `${file}: redirect after save not let through`);
    }
  }
});

test("a save redirect is never asked about: allowNext precedes it", () => {
  const so = read("src/pages/sales/create.tsx");
  // All three post-save redirects to the new SO.
  assert.equal((so.match(/navGuard\.allowNext\(\);\n\s*navigate\(`\$\{basePath\}\/\$\{newId\}`\);/g) || []).length, 3);
  const po = read("src/pages/procurement/create.tsx");
  assert.equal((po.match(/navGuard\.allowNext\(\);\n\s*navigate\("\/procurement"\);/g) || []).length, 2);
});

// ── C2-1: discard prompt on a form popup ───────────────────────────────────

test("closeUnlessKept: clean closes at once; dirty asks; busy does nothing", async () => {
  let closed = 0;
  const close = () => { closed++; };
  assert.equal(await closeUnlessKept({ dirty: false, ask: async () => false, close }), true);
  assert.equal(closed, 1);
  assert.equal(await closeUnlessKept({ dirty: true, ask: async () => false, close }), false, "Keep editing");
  assert.equal(closed, 1);
  assert.equal(await closeUnlessKept({ dirty: true, ask: async () => true, close }), true, "Discard");
  assert.equal(closed, 2);
  let asked = false;
  assert.equal(await closeUnlessKept({ dirty: true, busy: true, ask: async () => { asked = true; return true; }, close }), false);
  assert.equal(asked, false, "a save in flight is never interrupted");
});

test("a backdrop click is one on the backdrop itself", () => {
  const el = {};
  assert.equal(isBackdropClick({ target: el, currentTarget: el }), true);
  assert.equal(isBackdropClick({ target: {}, currentTarget: el }), false);
});

test("form popups route Esc and backdrop through the discard guard; Cancel closes at once", () => {
  const guard = read("src/lib/use-discard-guard.ts");
  assert.match(guard, /DISCARD_TITLE = "Discard your changes\?"/);
  assert.match(guard, /useEscapeClose\(\(\) => void requestClose\(\), opts\.open\);/);
  for (const f of ["src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx"]) {
    const src = read(f);
    assert.match(src, /useFormDirty\(\s*\{ selectedCustomerId, selectedInvoiceId, reason, reasonDetail, items:/, `${f}: dropdowns in the snapshot`);
    assert.match(src, /useDiscardGuard\(\{ open: showCreateModal, dirty: formDirty, onClose: closeForm, busy: creating \}\)/);
    assert.match(src, /z-50" onMouseDown=\{formGuard\.onBackdrop\}>/);
    assert.match(src, /<Button variant="ghost" onClick=\{closeForm\}>Cancel<\/Button>/, `${f}: Cancel still closes at once`);
  }
  const dlv = read("src/pages/delivery/index.tsx");
  assert.match(dlv, /useFormDirty\(\{ createDOForm, manualCustomerId, createDODrops \}, !!createDODialog\)/);
  assert.match(dlv, /bg-black\/40" onMouseDown=\{createDOGuard\.onBackdrop\} \/>/);
  assert.match(dlv, /<Button variant="outline" onClick=\{\(\) => setCreateDODialog\(null\)\}>Cancel<\/Button>/);
  const popup = read("src/components/finance/doc-popup.tsx");
  assert.match(popup, /useDiscardGuard\(\{ open: true, dirty, busy, onClose \}\)/);
  assert.match(popup, /onClick=\{guard\.onBackdrop\}/);
});

// ── H1-4: arrow keys between line fields ───────────────────────────────────

const field = (over = {}) => ({
  tagName: "INPUT", type: "text", disabled: false, readOnly: false,
  getAttribute: (n) => (over.attrs ?? {})[n] ?? null, ...over,
});

test("line fields: plain text / number inputs only", () => {
  assert.equal(isLineGridField(field()), true);
  assert.equal(isLineGridField(field({ type: "number" })), true);
  for (const type of ["checkbox", "date", "file", "hidden", "radio"]) {
    assert.equal(isLineGridField(field({ type })), false, type);
  }
  assert.equal(isLineGridField(field({ tagName: "SELECT" })), false, "a dropdown keeps its arrows");
  assert.equal(isLineGridField(field({ tagName: "TEXTAREA" })), false);
  assert.equal(isLineGridField(field({ attrs: { role: "combobox" } })), false, "a product picker keeps its arrows");
  assert.equal(isLineGridField(field({ attrs: { "aria-expanded": "false" } })), false);
  assert.equal(isLineGridField(field({ disabled: true })), false);
  assert.equal(isLineGridField(field({ readOnly: true })), false);
});

test("line moves follow the Forecast sheet rule", () => {
  const edges = { atStart: true, atEnd: true };
  const mid = { atStart: false, atEnd: false };
  assert.deepEqual(planLineMove({ key: "ArrowDown", caret: mid, row: 0, rows: 3, col: 0, cols: 1 }), { kind: "row", row: 1 });
  assert.deepEqual(planLineMove({ key: "Enter", caret: mid, row: 1, rows: 3, col: 0, cols: 1 }), { kind: "row", row: 2 });
  assert.equal(planLineMove({ key: "Enter", caret: mid, row: 2, rows: 3, col: 0, cols: 1 }), null, "last line: Enter does its usual thing");
  assert.deepEqual(planLineMove({ key: "ArrowUp", caret: mid, row: 2, rows: 3, col: 0, cols: 1 }), { kind: "row", row: 1 });
  assert.equal(planLineMove({ key: "ArrowRight", caret: mid, row: 0, rows: 1, col: 0, cols: 3 }), null, "caret mid-text stays");
  assert.deepEqual(planLineMove({ key: "ArrowRight", caret: edges, row: 0, rows: 1, col: 0, cols: 3 }), { kind: "col", col: 1 });
  assert.deepEqual(planLineMove({ key: "ArrowLeft", caret: edges, row: 0, rows: 1, col: 1, cols: 3 }), { kind: "col", col: 0 });
  assert.equal(planLineMove({ key: "Tab", caret: edges, row: 0, rows: 2, col: 0, cols: 2 }), null);
});

test("the line editors carry the grid handler", () => {
  const nav = read("src/lib/line-grid-nav.ts");
  assert.match(nav, /import \{ caretEdges, nextCell \} from "\.\/grid-keys";/, "reuses grid-keys");
  assert.match(nav, /e\.defaultPrevented/, "a key an inner control used is left alone");
  for (const f of [
    "src/pages/procurement/create.tsx",
    "src/pages/procurement/grn/create.tsx",
    "src/pages/procurement/pi/create.tsx",
    "src/pages/procurement/PurchaseInvoiceDetail.tsx",
  ]) {
    assert.match(read(f), /<table className="w-full text-sm" \{\.\.\.LINE_GRID_PROPS\}>/, f);
  }
  for (const f of [
    "src/pages/sales/create.tsx",
    "src/pages/sales/edit.tsx",
    "src/pages/consignment/create.tsx",
    "src/pages/consignment/edit.tsx",
    "src/pages/procurement/detail.tsx",
  ]) {
    const src = read(f);
    assert.match(src, /\{\.\.\.LINE_GRID_PROPS\}>/, `${f}: container`);
    assert.match(src, /data-line-row=""/, `${f}: line rows`);
  }
});

// ── C1-8: Back returns to the row you opened ───────────────────────────────

test("grid return: remembered per page + grid, restored only on Back / Forward", () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const key = gridReturnKey("/sales", "sales-orders");
  assert.notEqual(key, gridReturnKey("/procurement", "sales-orders"));
  rememberGridRow(store, key, "so-42");
  assert.equal(recallGridRow(store, key), "so-42");
  assert.equal(shouldReturnToRow("POP"), true);
  assert.equal(shouldReturnToRow("PUSH"), false, "a menu visit opens at the top");
  assert.equal(shouldReturnToRow("REPLACE"), false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => rememberGridRow(broken, key, "x"));
  assert.equal(recallGridRow(broken, key), null);
  assert.equal(recallGridRow(null, key), null);
  assert.equal(rowKeySelector('a"b'), 'tr[data-row-key="a\\"b"]');
});

test("the DataGrid remembers the opened row and scrolls back to it", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  assert.match(grid, /shouldReturnToRow\(navigationType\) \? recallGridRow\(sessionStore, returnStoreKey\) : null/);
  assert.match(grid, /rememberRow\(row\);\n\s*if \(checkboxSelectOnly\)/, "single click remembers");
  assert.match(grid, /onDoubleClick=\{\(\) => \{ rememberRow\(row\); onDoubleClick\?\.\(row\); \}\}/, "double click remembers");
  assert.match(grid, /rowVirtualizer\.scrollToIndex\(idx, \{ align: "center" \}\)/, "a windowed list scrolls by index");
  assert.match(grid, /scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(grid, /data-row-key=\{key\}/);
  assert.match(grid, /flashKey === key && !isSelected && "!bg-\[#FFF3D6\]/);
});

// ── C1-11: "—" while loading ───────────────────────────────────────────────

test("status tab counts read — until the list arrives; real zeros unchanged", () => {
  const strip = read("src/components/ui/status-tab-strip.tsx");
  assert.match(strip, /\{loading \? "—" : tab\.count\}/);
  assert.match(strip, /\{tab\.label\} \(\{loading \? "—" : tab\.count\}\)/);
  const wired = {
    "src/pages/sales/index.tsx": "loading && !ordersResp",
    "src/pages/invoices/index.tsx": "loading && !invResp",
    "src/pages/procurement/grn.tsx": "grnLoading && !grnResp",
    "src/pages/procurement/pi.tsx": "loading && !piResp",
    "src/pages/consignment/index.tsx": "loading && !ordersResp",
    "src/pages/procurement/index.tsx": "poLoading && !poResp",
    "src/pages/delivery/index.tsx": "doLoading && !doRaw",
  };
  for (const [f, expr] of Object.entries(wired)) {
    assert.ok(read(f).includes(`<StatusTabStrip\n`) && read(f).includes(`loading={${expr}}`), `${f}: loading only while there is no data`);
  }
  const dash = read("src/pages/dashboard-b/index.tsx");
  assert.match(dash, /loading=\{pendingL \|\| \(doStatsL && !doStatsRaw\)\}/, "Pending Delivery waits for its DO money too");
});

// ── H2-10 / C1-9: zip on IT Support ────────────────────────────────────────

test("IT Support takes .zip whatever MIME the browser gives it", () => {
  const page = read("src/pages/it-support/index.tsx");
  assert.match(page, /const FILE_ACCEPT = "image\/\*,video\/mp4,video\/quicktime,application\/pdf,\.zip";/);
  assert.match(page, /f\.name\.toLowerCase\(\)\.endsWith\("\.zip"\)/);
  assert.match(page, /images, PDF, MP4, MOV or ZIP\./);
  // The server forwards files without a type filter (the hub judges them;
  // Houzs-IT/houzs-hub#42 accepts .zip).
  const route = read("src/api/routes/it-support.ts");
  assert.doesNotMatch(route, /application\/pdf/);
});
