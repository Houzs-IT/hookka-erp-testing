// ---------------------------------------------------------------------------
// A credit note takes its own date (owner 2026-11-17 「开cn 日期放5月31」: a CN
// that clears an opening-month invoice belongs to that month). Blank = today,
// as before; never after today; never before the invoice it credits. The
// ledger already posts a note on its own date (note-ledger.ts docDate).
// Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const { resolveNoteDate } = await import(href("src/api/lib/note-edit.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const TODAY = "2026-11-17";

test("blank or missing = today, as before", () => {
  assert.deepEqual(resolveNoteDate(undefined, "2026-05-30", TODAY, "Credit note"), { date: TODAY });
  assert.deepEqual(resolveNoteDate("", "2026-05-30", TODAY, "Credit note"), { date: TODAY });
  assert.deepEqual(resolveNoteDate("  ", null, TODAY, "Credit note"), { date: TODAY });
});

test("a back date on or after the invoice is kept", () => {
  assert.deepEqual(resolveNoteDate("2026-05-31", "2026-05-30", TODAY, "Credit note"), { date: "2026-05-31" });
  assert.deepEqual(resolveNoteDate("2026-05-30", "2026-05-30", TODAY, "Credit note"), { date: "2026-05-30" });
  assert.deepEqual(resolveNoteDate(TODAY, "2026-05-30", TODAY, "Credit note"), { date: TODAY });
  // An invoice date carrying a time still compares on its day.
  assert.deepEqual(resolveNoteDate("2026-05-30", "2026-05-30T00:00:00.000Z", TODAY, "Credit note"), { date: "2026-05-30" });
});

test("refused: before the invoice, in the future, not a real date", () => {
  assert.match(resolveNoteDate("2026-05-29", "2026-05-30", TODAY, "Credit note").error, /before its invoice's date 2026-05-30/);
  assert.match(resolveNoteDate("2026-11-18", "2026-05-30", TODAY, "Credit note").error, /in the future/);
  for (const bad of ["2026-02-30", "31/05/2026", "2026-5-31", "tomorrow", 20260531]) {
    const r = resolveNoteDate(bad, "2026-05-30", TODAY, "Credit note");
    if (typeof bad === "number") assert.deepEqual(r, { date: TODAY }, "a non-string is treated as not sent");
    else assert.match(r.error, /must be a real date/, String(bad));
  }
});

test("create and edit both use the rule; edit keeps the draft's date when none is sent", () => {
  const src = read("src/api/routes/credit-notes.ts");
  assert.match(src, /resolveNoteDate\(body\.date, invoice\.invoiceDate \?\? invoice\.invoice_date, todayYmdMY\(\), "Credit note"\)/);
  assert.match(src, /body\.date === undefined \? existing\.date : body\.date/);
  assert.match(src, /items = \?, date = \?\s+WHERE id = \? AND orgId = \? AND status = 'DRAFT'/);
  assert.doesNotMatch(src, /const date = todayYmdMY\(\);/, "the create route no longer forces today");
});

test("the form has the picker, sends it, and blocks a date before the invoice", () => {
  const page = read("src/pages/invoices/credit-notes.tsx");
  assert.match(page, /type="date"\s+data-cn-date=""/);
  assert.match(page, /min=\{selectedInvoiceDate \|\| undefined\}/);
  assert.match(page, /max=\{todayYmdMY\(\)\}/);
  assert.match(page, /const body = \{ invoiceId: selectedInvoiceId, date: noteDate,/);
  assert.match(page, /noteDate < selectedInvoiceDate\) \|\| items\.every/);
  // Edit opens on the note's date; Duplicate and New start on today.
  assert.match(page, /openEdit = \(cn: CreditNote\) => \{[^}]*setNoteDate\(\(cn\.date/);
  assert.match(page, /openDuplicate = \(cn: CreditNote\) => \{[^}]*setNoteDate\(todayYmdMY\(\)\)/);
});
