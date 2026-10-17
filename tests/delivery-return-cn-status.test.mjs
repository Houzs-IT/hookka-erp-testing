// ---------------------------------------------------------------------------
// BUG-2026-10-17-318 — a delivery return read "CN issued" with no credit note
// behind it (owner 2026-10-17 「这个要修」). "Return to stock" on an invoiced
// order sets CN_ISSUED before the note exists, and the note form can be left
// without saving. The chip is now worked from the note actually linked, and
// the return's page offers the form again. Made-up data only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { deliveryReturnStatus } from "../src/lib/delivery-return-status.ts";
import { returnCandidateBlock } from "../src/lib/cn-from-return.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("CN_ISSUED with no note behind it reads 'Awaiting credit note'", () => {
  assert.deepEqual(deliveryReturnStatus({ status: "CN_ISSUED", creditNoteId: "" }), {
    label: "Awaiting credit note", chip: "PENDING", awaitingCreditNote: true,
  });
  assert.equal(deliveryReturnStatus({ status: "CN_ISSUED", creditNoteId: null }).awaitingCreditNote, true);
});

test("a linked note decides the label: drafted, or issued", () => {
  assert.deepEqual(deliveryReturnStatus({ status: "CN_ISSUED", creditNoteId: "cn-1", creditNoteStatus: "DRAFT" }), {
    label: "Credit note drafted", chip: "DRAFT", awaitingCreditNote: false,
  });
  assert.equal(deliveryReturnStatus({ status: "CN_ISSUED", creditNoteId: "cn-1", creditNoteStatus: "POSTED" }).label, "CN issued");
  assert.equal(deliveryReturnStatus({ status: "CN_ISSUED", creditNoteId: "cn-1", creditNoteStatus: "APPROVED" }).label, "CN issued");
});

test("every other status keeps its label", () => {
  assert.equal(deliveryReturnStatus({ status: "OPEN" }).label, "Open");
  assert.equal(deliveryReturnStatus({ status: "SERVICE_SPAWNED" }).label, "Service in progress");
  assert.equal(deliveryReturnStatus({ status: "SOMETHING_NEW" }).label, "SOMETHING_NEW");
});

test("the API returns the linked note's status; both pages label from it", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  assert.match(api, /\(SELECT cn\.status FROM credit_notes cn WHERE cn\.id = delivery_returns\.credit_note_id\) AS "creditNoteStatus"/);
  assert.match(api, /creditNoteStatus: h\.creditNoteStatus \?\? "",/);
  const detail = read("src/pages/delivery-returns/detail.tsx");
  assert.match(detail, /const statusView = deliveryReturnStatus\(dr\);/);
  assert.match(detail, /<Badge variant="status" status=\{statusView\.chip\}>\{statusView\.label\}<\/Badge>/);
  assert.match(detail, /statusView\.awaitingCreditNote && \(/);
  assert.match(detail, /navigate\(`\/invoices\/credit-notes\?fromReturn=\$\{id\}`\)\}>\n\s*Create credit note/);
  assert.doesNotMatch(detail, /const STATUS_LABEL/);
  const list = read("src/pages/delivery-returns/index.tsx");
  assert.match(list, /const v = deliveryReturnStatus\(row\);/);
  assert.match(list, /if \(deliveryReturnStatus\(r\)\.awaitingCreditNote\) c\.open \+= 1;/);
  assert.doesNotMatch(list, /const STATUS_LABEL/);
});

test("a return waiting for its note says why none can be raised, instead of a dead-end button", () => {
  const cand = (over) => ({
    id: "dr-1", returnNo: "DR-0001", date: "2026-01-02", customerId: "c-1", customerName: "A customer", status: "CN_ISSUED",
    invoice: { id: "i-1", invoiceNo: "INV-0001", outstandingSen: 5000 }, lines: [], valueSen: 5000, unpriced: 0, creditNote: null, ...over,
  });
  assert.equal(returnCandidateBlock(cand({})), "");
  assert.equal(returnCandidateBlock(cand({ invoice: { id: "i-1", invoiceNo: "INV-0001", outstandingSen: 0 } })), "Invoice settled");
  assert.equal(returnCandidateBlock(cand({ invoice: null })), "Not invoiced");
  const detail = read("src/pages/delivery-returns/detail.tsx");
  // Asked only while the return waits for its note.
  assert.match(detail, /dr && deliveryReturnStatus\(dr\)\.awaitingCreditNote \? `\/api\/credit-notes\/from-returns\?returnId=\$\{encodeURIComponent\(String\(id\)\)\}` : null,/);
  assert.match(detail, /cnBlock === "Invoice settled" \? \(\n\s*<span>Returned to stock — invoice \{cnCandidate\?\.invoice\?\.invoiceNo\} is fully paid, so no credit note can go against it/);
  assert.match(detail, /cnBlock === "Not invoiced" \? \(\n\s*<span>Returned to stock — this delivery was never invoiced, so no credit note is needed\.<\/span>/);
});
