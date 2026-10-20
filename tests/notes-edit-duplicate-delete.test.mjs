// ---------------------------------------------------------------------------
// Credit / debit notes: Edit, Duplicate, Delete — no Approve step (owner
// 2026-10-20 「edit, duplicate, delete 可以做， approve 不需要」). Only a draft
// is edited or deleted (a draft has touched nothing: no ledger, no customer
// balance, no invoice); a delete hides the note and keeps the row
// (document_lifecycle DELETED) and frees the delivery return it was raised
// from. Duplicate is the New form filled from a note. Every list leaves a
// deleted note out. Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const lib = await import(href("src/api/lib/note-edit.ts"));
const { default: cnApp } = await import(href("src/api/routes/credit-notes.ts"));
const { default: dnApp } = await import(href("src/api/routes/debit-notes.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test("lines are checked as on create: integer sen, quantity above 0, never the legacy unitPrice", () => {
  assert.deepEqual(lib.parseNoteItems([{ description: "Panel", quantity: 2, unitPriceSen: 1500 }, { description: "Leg", quantity: 1, unitPriceSen: 250 }], "Credit note"), {
    items: [
      { description: "Panel", quantity: 2, unitPriceSen: 1500, totalSen: 3000 },
      { description: "Leg", quantity: 1, unitPriceSen: 250, totalSen: 250 },
    ],
    totalSen: 3250,
  });
  assert.match(lib.parseNoteItems([], "Credit note").error, /Credit note lines are required/);
  assert.match(lib.parseNoteItems([{ quantity: 1, unitPrice: 12.5 }], "Debit note").error, /must send 'unitPriceSen'/);
  assert.match(lib.parseNoteItems([{ quantity: 1, unitPriceSen: 12.5 }], "Debit note").error, /non-negative integer/);
  assert.match(lib.parseNoteItems([{ quantity: 0, unitPriceSen: 100 }], "Credit note").error, /quantity must be > 0/);
});

test("only a draft is edited or deleted; the reason lists are the tables' own", () => {
  assert.equal(lib.noteDraftOnly("Credit note", "CN-0001", "DRAFT", "edited"), null);
  assert.equal(lib.noteDraftOnly("Credit note", "CN-0001", null, "deleted"), null);
  assert.equal(lib.noteDraftOnly("Credit note", "CN-0001", "POSTED", "edited"), "Credit note CN-0001 is posted — only a draft can be edited. Put it back to draft first.");
  assert.equal(lib.noteDraftOnly("Debit note", "DN-0001", "APPROVED", "deleted"), "Debit note DN-0001 is approved — only a draft can be deleted. Put it back to draft first.");
  assert.deepEqual([...lib.CREDIT_NOTE_REASONS], ["RETURN", "PRICE_ADJUSTMENT", "DAMAGE", "OVERCHARGE", "OTHER"]);
  assert.deepEqual([...lib.DEBIT_NOTE_REASONS], ["UNDERCHARGE", "ADDITIONAL_CHARGE", "PRICE_ADJUSTMENT", "OTHER"]);
  const init = read("migrations-postgres/0001_init.sql");
  assert.match(init, /reason TEXT CHECK \(reason IN \('RETURN','PRICE_ADJUSTMENT','DAMAGE','OVERCHARGE','OTHER'\)\)/);
  assert.match(init, /reason TEXT CHECK \(reason IN \('UNDERCHARGE','ADDITIONAL_CHARGE','PRICE_ADJUSTMENT','OTHER'\)\)/);
});

// ---------------------------------------------------------------------------
// The routes, against an in-memory database
// ---------------------------------------------------------------------------

function makeDb({ notes = [], invoices = [], deleted = [] } = {}) {
  const store = {
    notes: new Map(notes.map((n) => [n.id, { orgId: "hookka", status: "DRAFT", approvedBy: null, ...n }])),
    invoices: new Map(invoices.map((i) => [i.id, { orgId: "hookka", ...i }])),
    lifecycle: new Map(deleted.map((k) => [k, "DELETED"])),
    unlinked: [],
    audits: [],
  };
  const live = (kind, id) => store.lifecycle.get(`${kind}|${id}`) !== "DELETED";
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    let b = [];
    const stmt = {
      sql: s,
      bind(...a) { b = a; return stmt; },
      async first() {
        let m = s.match(/^SELECT \* FROM (credit|debit)_notes WHERE id = \?( AND orgId = \?)?$/);
        if (m) {
          const n = store.notes.get(b[0]);
          return n && (!m[2] || n.orgId === b[1]) ? { ...n } : null;
        }
        if (s === "SELECT state FROM document_lifecycle WHERE orgId = ? AND sourceType = ? AND sourceId = ?") {
          const st = store.lifecycle.get(`${b[1]}|${b[2]}`);
          return st ? { state: st } : null;
        }
        m = s.match(/FROM invoices WHERE id = \?( AND orgId = \?)?$/);
        if (m) {
          const inv = store.invoices.get(b[0]);
          return inv && (!m[1] || inv.orgId === b[1]) ? { ...inv } : null;
        }
        return null;
      },
      async all() {
        const m = s.match(/^SELECT \* FROM (credit|debit)_notes WHERE orgId = \? AND NOT EXISTS \(SELECT 1 FROM document_lifecycle dl WHERE dl\.sourceType = '(credit_note|debit_note)' AND dl\.sourceId = (credit|debit)_notes\.id AND dl\.state = 'DELETED'\) ORDER BY date DESC$/);
        if (m) return { results: [...store.notes.values()].filter((n) => n.orgId === b[0] && n.id.startsWith(m[1] === "credit" ? "cn-" : "dn-") && live(m[2], n.id)) };
        return { results: [] };
      },
      async run() {
        if (/^UPDATE (credit|debit)_notes SET invoiceId = \?/.test(s)) {
          const [invoiceId, invoiceNumber, customerId, customerName, customerState, customerAddress, attention, customerPhone, reason, reasonDetail, totalAmount, items, id, orgId] = b;
          const n = store.notes.get(id);
          if (n && n.orgId === orgId && n.status === "DRAFT") {
            Object.assign(n, { invoiceId, invoiceNumber, customerId, customerName, customerState, customerAddress, attention, customerPhone, reason, reasonDetail, totalAmount, items });
          }
        } else if (/^INSERT INTO document_lifecycle/.test(s)) {
          assert.match(s, /VALUES \(\?, \?, \?, 'DELETED', \?, \?, \?\) ON CONFLICT \(orgId, sourceType, sourceId\) DO UPDATE SET state = 'DELETED'/);
          store.lifecycle.set(`${b[1]}|${b[2]}`, "DELETED");
        } else if (s === "UPDATE delivery_returns SET credit_note_id = NULL WHERE credit_note_id = ?") {
          store.unlinked.push(b[0]);
        } else if (/^INSERT INTO audit_events/.test(s)) {
          store.audits.push({ resource: b[4], resourceId: b[5], action: b[6], before: b[7] && JSON.parse(b[7]), after: b[8] && JSON.parse(b[8]) });
        }
        return { success: true };
      },
    };
    return stmt;
  }
  return { db: { prepare, batch: async (stmts) => { for (const st of stmts) await st.run(); return []; } }, store };
}

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/api/credit-notes", cnApp);
  parent.route("/api/debit-notes", dnApp);
  return async (method, path, body) => {
    const res = await parent.request(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, {});
    return { status: res.status, body: await res.json() };
  };
}

const invoice = (id, over = {}) => ({
  id, invoiceNo: `INV-${id}`, customerId: `cust-${id}`, customerName: `Customer ${id}`, customerState: "Selangor",
  customerAddress: "1 Test Road", attention: "Ms Test", customerPhone: "012-0000000", totalSen: 100000, paidAmount: 20000, status: "SENT", ...over,
});
const cnDraft = (over = {}) => ({
  id: "cn-1", noteNumber: "CN-2610-001", invoiceId: "a", invoiceNumber: "INV-a", customerId: "cust-a", customerName: "Customer a",
  date: "2026-10-20", reason: "RETURN", reasonDetail: "", totalAmount: 1000, items: JSON.stringify([{ description: "Old", quantity: 1, unitPriceSen: 1000, totalSen: 1000 }]), ...over,
});

test("Edit a draft credit note: new invoice, its customer block, reason, lines and total; audited", async () => {
  const { db, store } = makeDb({ notes: [cnDraft()], invoices: [invoice("a"), invoice("b")] });
  const call = mount(db);
  const r = await call("PUT", "/api/credit-notes/cn-1/edit", {
    invoiceId: "b", reason: "DAMAGE", reasonDetail: "Torn fabric",
    items: [{ description: "Cushion", quantity: 2, unitPriceSen: 4500 }, { description: "Arm", quantity: 1, unitPriceSen: 1000 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.noteNumber, "CN-2610-001", "the number stays");
  assert.equal(r.body.data.date, "2026-10-20", "the date stays");
  assert.equal(r.body.data.invoiceNumber, "INV-b");
  assert.equal(r.body.data.customerName, "Customer b");
  assert.equal(r.body.data.reason, "DAMAGE");
  assert.equal(r.body.data.reasonDetail, "Torn fabric");
  assert.equal(r.body.data.totalAmount, 10000);
  assert.deepEqual(r.body.data.items.map((i) => i.totalSen), [9000, 1000]);
  assert.equal(store.notes.get("cn-1").customerId, "cust-b", "the customer block re-read from the invoice");
  assert.equal(store.notes.get("cn-1").customerState, "Selangor");
  assert.deepEqual(store.audits.map((a) => [a.resource, a.action]), [["credit-notes", "update"]]);
  assert.equal(store.audits[0].before.invoiceNumber, "INV-a");
  assert.equal(store.audits[0].after.invoiceNumber, "INV-b");
});

test("Edit refuses: a posted note, a total past what the invoice has uncollected, an unknown reason, bad lines", async () => {
  const { db, store } = makeDb({ notes: [cnDraft(), cnDraft({ id: "cn-2", noteNumber: "CN-2610-002", status: "POSTED" })], invoices: [invoice("a")] });
  const call = mount(db);
  const posted = await call("PUT", "/api/credit-notes/cn-2/edit", { invoiceId: "a", reason: "RETURN", items: [{ description: "x", quantity: 1, unitPriceSen: 100 }] });
  assert.equal(posted.status, 409);
  assert.match(posted.body.error, /CN-2610-002 is posted — only a draft can be edited\. Put it back to draft first\./);
  // Invoice 100,000 with 20,000 received: 80,000 is the most a note can take.
  const over = await call("PUT", "/api/credit-notes/cn-1/edit", { invoiceId: "a", reason: "RETURN", items: [{ description: "x", quantity: 1, unitPriceSen: 80001 }] });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /exceeds the invoice's uncollected balance \(80000 sen\)/);
  const reason = await call("PUT", "/api/credit-notes/cn-1/edit", { invoiceId: "a", reason: "APPROVE", items: [{ description: "x", quantity: 1, unitPriceSen: 100 }] });
  assert.equal(reason.status, 400);
  const lines = await call("PUT", "/api/credit-notes/cn-1/edit", { invoiceId: "a", reason: "RETURN", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
  assert.equal(lines.status, 400);
  const noInvoice = await call("PUT", "/api/credit-notes/cn-1/edit", { invoiceId: "zz", reason: "RETURN", items: [{ description: "x", quantity: 1, unitPriceSen: 1 }] });
  assert.equal(noInvoice.status, 404);
  assert.equal(store.notes.get("cn-1").totalAmount, 1000, "nothing saved");
  assert.equal(store.audits.length, 0);
});

test("Delete a draft credit note: hidden (the row kept), its delivery return let go, audited; then gone everywhere", async () => {
  const { db, store } = makeDb({ notes: [cnDraft(), cnDraft({ id: "cn-2", noteNumber: "CN-2610-002" })], invoices: [invoice("a")] });
  const call = mount(db);
  const r = await call("DELETE", "/api/credit-notes/cn-1");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(store.lifecycle.get("credit_note|cn-1"), "DELETED");
  assert.ok(store.notes.has("cn-1"), "the row is kept");
  assert.deepEqual(store.unlinked, ["cn-1"], "a return pointing at it lets go");
  assert.deepEqual(store.audits.map((a) => [a.resource, a.resourceId, a.action]), [["credit-notes", "cn-1", "delete"]]);
  // Gone from the list, the detail, posting, editing and a second delete.
  const list = await call("GET", "/api/credit-notes");
  assert.deepEqual(list.body.data.map((n) => n.id), ["cn-2"]);
  assert.equal((await call("GET", "/api/credit-notes/cn-1")).status, 404);
  assert.equal((await call("PUT", "/api/credit-notes/cn-1", { status: "POSTED" })).status, 404, "a deleted draft cannot be posted");
  assert.equal((await call("PUT", "/api/credit-notes/cn-1/edit", { invoiceId: "a", reason: "RETURN", items: [{ description: "x", quantity: 1, unitPriceSen: 1 }] })).status, 404);
  assert.equal((await call("DELETE", "/api/credit-notes/cn-1")).status, 404);
});

test("Delete refuses a posted credit note — Back to Draft first", async () => {
  const { db, store } = makeDb({ notes: [cnDraft({ status: "POSTED" })] });
  const r = await mount(db)("DELETE", "/api/credit-notes/cn-1");
  assert.equal(r.status, 409);
  assert.match(r.body.error, /only a draft can be deleted/);
  assert.equal(store.lifecycle.size, 0);
  assert.deepEqual(store.unlinked, []);
});

test("Debit notes: edit and delete a draft; an approved one goes back to draft first", async () => {
  const dn = (over) => ({ ...cnDraft(), id: "dn-1", noteNumber: "DN-2610-001", reason: "UNDERCHARGE", ...over });
  const { db, store } = makeDb({ notes: [dn(), dn({ id: "dn-2", noteNumber: "DN-2610-002", status: "APPROVED" })], invoices: [invoice("a"), invoice("b", { paidAmount: 100000, status: "PAID" })] });
  const call = mount(db);
  // No uncollected cap on a debit note: it adds to the invoice.
  const r = await call("PUT", "/api/debit-notes/dn-1/edit", { invoiceId: "b", reason: "ADDITIONAL_CHARGE", reasonDetail: "Delivery", items: [{ description: "Lorry", quantity: 1, unitPriceSen: 15000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.invoiceNumber, "INV-b");
  assert.equal(r.body.data.totalAmount, 15000);
  assert.equal((await call("PUT", "/api/debit-notes/dn-1/edit", { invoiceId: "b", reason: "RETURN", items: [{ description: "x", quantity: 1, unitPriceSen: 1 }] })).status, 400, "RETURN is a credit-note reason");
  const approved = await call("DELETE", "/api/debit-notes/dn-2");
  assert.equal(approved.status, 409);
  assert.match(approved.body.error, /DN-2610-002 is approved — only a draft can be deleted/);
  const del = await call("DELETE", "/api/debit-notes/dn-1");
  assert.equal(del.status, 200);
  assert.equal(store.lifecycle.get("debit_note|dn-1"), "DELETED");
  assert.deepEqual(store.unlinked, [], "a debit note has no delivery return");
  assert.deepEqual((await call("GET", "/api/debit-notes")).body.data.map((n) => n.id), ["dn-2"]);
  assert.equal((await call("GET", "/api/debit-notes/dn-1")).status, 404);
  assert.deepEqual(store.audits.map((a) => [a.resource, a.action]), [["debit-notes", "update"], ["debit-notes", "delete"]]);
});

// ---------------------------------------------------------------------------
// Every other reader leaves a deleted note out
// ---------------------------------------------------------------------------

test("a deleted note is not under its invoice, does not hold its delivery return, and frees it for a new note", () => {
  const cn = read("src/api/routes/credit-notes.ts");
  const fr = cn.slice(cn.indexOf('app.get("/from-returns"'), cn.indexOf("\n});\n", cn.indexOf('app.get("/from-returns"')));
  assert.match(fr, /db\.prepare\(`SELECT \* FROM credit_notes WHERE \$\{notDeletedSql\("credit_note", "credit_notes"\)\}`\)/);
  assert.match(cn, /SELECT noteNumber FROM credit_notes WHERE delivery_return_id = \? AND \$\{notDeletedSql\("credit_note", "credit_notes"\)\}/);
  const inv = read("src/api/routes/invoices.ts");
  assert.match(inv, /FROM credit_notes\n\s+WHERE invoiceId = \? AND \$\{notDeletedSql\("credit_note", "credit_notes"\)\}/);
  assert.match(inv, /FROM debit_notes\n\s+WHERE invoiceId = \? AND \$\{notDeletedSql\("debit_note", "debit_notes"\)\}/);
  // The edit and delete routes are scoped to the organisation.
  for (const f of ["src/api/routes/credit-notes.ts", "src/api/routes/debit-notes.ts"]) {
    const src = read(f);
    const edit = src.slice(src.indexOf('app.put("/:id/edit"'), src.indexOf('app.delete("/:id"'));
    assert.match(edit, /_notes WHERE id = \? AND orgId = \?"\)/);
    assert.match(edit, /FROM invoices WHERE id = \? AND orgId = \?/);
    assert.match(edit, /WHERE id = \? AND orgId = \? AND status = 'DRAFT'/, "never over a note posted meanwhile");
  }
});

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------

for (const [file, kind, Type] of [["src/pages/invoices/credit-notes.tsx", "credit", "CreditNote"], ["src/pages/invoices/debit-notes.tsx", "debit", "DebitNote"]]) {
  test(`${kind} notes page: the row menu, double-click, Edit saves over the draft, Duplicate is a new one`, () => {
    const src = read(file);
    const menu = src.slice(src.indexOf("const contextMenuItems = "), src.indexOf("];", src.indexOf("const contextMenuItems = ")));
    assert.match(menu, new RegExp(`\\.\\.\\.\\(row\\.status === "DRAFT" \\? \\[\\{ label: "Edit", action: \\(r: ${Type}\\) => openEdit\\(r\\) \\}\\] : \\[\\]\\),`));
    assert.match(menu, new RegExp(`\\{ label: "Duplicate", action: \\(r: ${Type}\\) => openDuplicate\\(r\\) \\},`));
    assert.match(menu, new RegExp(`\\.\\.\\.\\(row\\.status === "DRAFT" \\? \\[\\{ label: "Delete", danger: true, action: \\(r: ${Type}\\) => void deleteNote\\(r\\) \\}\\] : \\[\\]\\),`));
    assert.doesNotMatch(src, /label: "Approve"|>Approve</, "no Approve step");
    assert.match(src, /onDoubleClick=\{setViewNote\}/);
    assert.match(src, new RegExp(`<NotePopup\\n\\s+kind="${kind}"\\n\\s+note=\\{viewNote\\}`));
    // Edit → PUT /:id/edit; New and Duplicate → POST.
    assert.match(src, new RegExp(`\\? await fetchJson\\(\`/api/${kind}-notes/\\$\\{encodeURIComponent\\(editingNote\\.id\\)\\}/edit\`, [CD]NMutationSchema, \\{ method: "PUT", body \\}\\)`));
    assert.match(src, /const openDuplicate = \([a-z]+: [A-Za-z]+\) => \{ setEditingNote\(null\); setCopyOf\([a-z]+\.noteNumber\); fillFromNote\([a-z]+\); \};/);
    // Delete goes through a danger confirm, then DELETE /:id.
    assert.match(src, /confirmLabel: "Delete",\n\s+danger: true,/);
    assert.match(src, new RegExp(`await sendNote\\(\`/api/${kind}-notes/\\$\\{encodeURIComponent\\([a-z]+\\.id\\)\\}\`, \\{ method: "DELETE" \\},`));
    // A failed save says why (it used to be swallowed).
    assert.match(src, new RegExp(`toast\\.error\\(e instanceof Error && e\\.message \\? e\\.message : "Could not save the ${kind} note"\\)`));
    // On Edit the draft's own invoice stays in the pick.
    assert.match(src, /\|\| inv\.id === keepInvoiceId\)\),/);
  });
}

test("Duplicate of a credit note raised from a delivery return does not take the return (one note per return)", () => {
  const src = read("src/pages/invoices/credit-notes.tsx");
  const fill = src.slice(src.indexOf("const fillFromNote = "), src.indexOf("const openEdit = "));
  assert.match(fill, /setFromReturnDraft\(null\);/);
  assert.match(src, /body: \{\n\s+\.\.\.body,\n\s+\.\.\.\(fromReturnDraft \? \{ deliveryReturnId: fromReturnDraft\.id \} : \{\}\),\n\s+\},/);
});

test("the debit note's price box keeps what is typed, as the credit note's", () => {
  const src = read("src/pages/invoices/debit-notes.tsx");
  assert.match(src, /value=\{item\.priceStr \?\? \(item\.unitPriceSen \? \(item\.unitPriceSen \/ 100\)\.toFixed\(2\) : ""\)\}/);
  assert.match(src, /setItems\(\(prev\) => prev\.map\(\(it, i\) => \(i === idx \? \{ \.\.\.it, priceStr: txt, unitPriceSen: sen \} : it\)\)\);/);
});

test("the popup is the finance document frame", () => {
  const popup = read("src/components/finance/doc-popup.tsx");
  assert.match(popup, /useEscapeClose\(onClose\);/);
  assert.match(popup, /bg-\[rgba\(31,29,27,0\.42\)\]/);
  assert.match(popup, /rounded-\[14px\]/);
  assert.match(popup, /data-fin-modal-body/);
  const note = read("src/components/finance/note-popup.tsx");
  assert.match(note, /<PopupField label="Date">\{fmtDocDate\(note\.date\) \|\| "—"\}<\/PopupField>/);
});
