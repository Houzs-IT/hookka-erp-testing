// ---------------------------------------------------------------------------
// po-email-draft.test.mjs — buildPoEmailDraft (src/lib/po-email-draft.ts).
//
// HK-0113: the PO "Email to Supplier" button opens the Mail Center composer
// pre-filled instead of queueing a noreply notice. These tests pin:
//   - no supplier email → null (the button refuses instead of opening blank)
//   - the subject names the letterhead company, not always Hookka
//   - the PO PDF rides as <poNo>.pdf with its decoded size
//   - several supplier addresses in one field become several To chips
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

try {
  register('tsx/esm', pathToFileURL('./'));
} catch {
  // Native type-stripping handles it on newer Node.
}

const { buildPoEmailDraft } = await import('../src/lib/po-email-draft.ts');

const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');

const base = {
  poNo: 'PO-2610-001',
  supplierName: 'ACME FOAM SDN BHD',
  supplierEmail: 'sales@acme.my',
  companyName: 'HOOKKA INDUSTRIES SDN BHD',
  pdfBase64: PDF,
};

test('no supplier email → null', () => {
  assert.equal(buildPoEmailDraft({ ...base, supplierEmail: '' }), null);
  assert.equal(buildPoEmailDraft({ ...base, supplierEmail: null }), null);
  assert.equal(buildPoEmailDraft({ ...base, supplierEmail: '  ' }), null);
});

test('subject and body name the PO and the letterhead company', () => {
  const d = buildPoEmailDraft({ ...base, companyName: 'OHANA MARKETING SDN BHD' });
  assert.equal(d.subject, 'Purchase Order PO-2610-001 from OHANA MARKETING SDN BHD');
  assert.match(d.body, /^Dear ACME FOAM SDN BHD,/);
  assert.match(d.body, /attached Purchase Order PO-2610-001/);
  assert.doesNotMatch(d.body, /Hookka/i);
});

test('PO PDF is attached as <poNo>.pdf with its decoded size', () => {
  const d = buildPoEmailDraft(base);
  assert.equal(d.attachments.length, 1);
  assert.equal(d.attachments[0].name, 'PO-2610-001.pdf');
  assert.equal(d.attachments[0].type, 'application/pdf');
  assert.equal(d.attachments[0].contentBase64, PDF);
  assert.equal(d.attachments[0].size, Buffer.from(PDF, 'base64').length);
});

test('several addresses in the supplier email field → several recipients', () => {
  const d = buildPoEmailDraft({ ...base, supplierEmail: 'Sales@Acme.my; acc@acme.my, sales@acme.my' });
  assert.deepEqual(d.to, ['sales@acme.my', 'acc@acme.my']);
});
