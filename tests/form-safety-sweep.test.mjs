// ---------------------------------------------------------------------------
// form-safety-sweep.test.mjs — review pass 2 follow-ups (WORK-TRACKER 128).
//
//   C2-1 follow-up   hand-built form popups ask "Discard your changes?" on Esc /
//                    backdrop once something was typed or picked
//   H3-1 follow-up   more create / edit forms ask "Leave without saving?"
//   C1-11 follow-up  KPI tiles and header counts show "—" while loading
//   BUG-2026-11-10-496  Leads money figures were divided by 100 twice
//
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style, see tests/fe-quality-batch-a.test.mjs).
// Run: node --import tsx/esm --test tests/form-safety-sweep.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { figureOrDash, LOADING_DASH } from "../src/lib/loading-figure.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── C2-1 follow-up: discard guard on form popups ───────────────────────────

test("useFormDiscardGuard = useFormDirty + useDiscardGuard, and exposes markClean", () => {
  const src = read("src/lib/use-discard-guard.ts");
  assert.match(src, /export function useFormDiscardGuard\(/);
  assert.match(src, /const \[dirty, markClean\] = useFormDirty\(snapshot, open && \(opts\.ready \?\? true\)\);/);
  assert.match(src, /useDiscardGuard\(\{ open, dirty, onClose: opts\.onClose, busy: opts\.busy, message: opts\.message \}\)/);
});

test("markClean re-bases on the next render, so a same-tick field reset counts as saved", () => {
  const src = read("src/lib/use-nav-guard.ts");
  assert.match(src, /const markClean = useCallback\(\(\) => setRebase\(\(n\) => n \+ 1\), \[\]\);/);
  assert.match(src, /if \(rebase > 0 && ready\) setBaseline\(key\);/);
});

// Each popup: the guard is wired, its backdrop goes through onBackdrop, and the
// old unconditional closer is gone.
const POPUPS = [
  ["src/pages/procurement/supplier-form-dialog.tsx", /useFormDiscardGuard\(\s*\{ code, name, contactPerson,/, /if \(e\.key === "Escape"\) onClose\(\)/],
  ["src/pages/procurement/sku-form-dialog.tsx", /useFormDiscardGuard\(\s*\{ internalRMCode, materialName, supplierId,/, /if \(e\.key === "Escape"\) onClose\(\)/],
  ["src/components/convert-to-pi-modal.tsx", /useDiscardGuard\(\{ open, dirty: !!selectedId, onClose \}\)/, /if \(e\.target === e\.currentTarget\) onClose\(\)/],
  ["src/components/convert-from-po-modal.tsx", /useDiscardGuard\(\{ open, dirty: !!selectedPoId, onClose \}\)/, /if \(e\.target === e\.currentTarget\) onClose\(\)/],
  ["src/components/orders/HubEditModal.tsx", /useFormDiscardGuard\(\{ hubId, reason \}, \{ open, onClose, busy: saving \}\)/, /onClick=\{\(\) => \(saving \? null : onClose\(\)\)\}/],
  ["src/components/orders/DatesEditModal.tsx", /useFormDiscardGuard\(\{ customerDD, hookkaDD \}/, /onClick=\{\(\) => \(saving \? null : onClose\(\)\)\}/],
  ["src/components/orders/CustomerEditModal.tsx", /useFormDiscardGuard\(\{ customerId, hubId, reason \}/, /onClick=\{\(\) => \(saving \? null : onClose\(\)\)\}/],
  ["src/components/add-user-drawer.tsx", /useDiscardGuard\(\{ open: true, dirty, onClose, busy \}\)/, /bg-black\/20" onClick=\{onClose\}/],
  ["src/components/user-detail-drawer.tsx", /useFormDiscardGuard\(\{ displayName, department, position, role, reportsTo \}/, /bg-black\/20" onClick=\{onClose\}/],
  ["src/components/employee-drawer.tsx", /useFormDiscardGuard\(draft, /, /onClick=\{saving \? undefined : onClose\}/],
  ["src/components/scan-supplier-modal.tsx", /dirty: phase === "review", busy: phase === "scanning" \|\| applying/, /bg-black\/40" onClick=\{close\}/],
  ["src/pages/warehouse.tsx", /useFormDiscardGuard\(\{ newRackName, newRackPosition \}/, /p-4" onClick=\{\(\) => setShowCreateRack\(false\)\}>/],
  ["src/pages/service-cases/index.tsx", /useFormDiscardGuard\(\s*\{ sourceType, sourceId, externalCustomerId,/, /bg-black\/40" onClick=\{onClose\}/],
  ["src/pages/service-cases/detail.tsx", /useFormDiscardGuard\(\{ mode, linePicks, freeLines \}/, /bg-black\/40" onClick=\{onClose\}/],
  ["src/pages/service-orders/index.tsx", /useFormDiscardGuard\(\s*\{ kind, sourceType, sourceId,/, /bg-black\/40" onClick=\{onClose\}/],
  ["src/pages/service-orders/detail.tsx", /useFormDiscardGuard\(\{ serviceOrderLineId, notes \}/, /bg-black\/40" onClick=\{onClose\}/],
  ["src/pages/sales/detail.tsx", /dirty: holdModal\.reason\.trim\(\) !== ""/, /bg-black\/40" onClick=\{\(\) => setHoldModal\(/],
  ["src/pages/consignment/detail.tsx", /dirty: overrideModal\.reason\.trim\(\) !== ""/, /bg-black\/40" onClick=\{\(\) => setHoldModal\(/],
  ["src/pages/leads/index.tsx", /useFormDiscardGuard\(form, \{ open: showAdd/, /onClick=\{\(\) => setShowAdd\(false\)\}>/],
  ["src/pages/maintenance/sofa-combos.tsx", /useFormDiscardGuard\(\{ effectiveFrom, mode, percent, setRm \}/, /if \(e\.key === "Escape" && !saving\) onClose\(\)/],
  ["src/pages/procurement/maintenance.tsx", /useFormDiscardGuard\(\{ field, value \}/, /bg-black\/40" onClick=\{\(\) => !busy && onClose\(\)\}/],
  ["src/pages/bom.tsx", /useDiscardGuard\(\{ open, dirty: dirtyCount > 0, busy: saving, onClose \}\)/, null],
  ["src/pages/inventory/index.tsx", /useDiscardGuard\(\{ open, dirty: pendingByRm\.size > 0, busy: saving, onClose \}\)/, null],
  ["src/pages/products/MaintenanceConfigHistoryDialog.tsx", /dirty: notes\.trim\(\) !== "" \|\| effectiveFrom !== \(defaultEffectiveFrom \?\? todayIso\(\)\)/, /if \(e\.key === "Escape" && !saving\) onClose\(\)/],
  ["src/pages/rd/index.tsx", /useFormDiscardGuard\(form, \{ onClose, busy: submitting \}\)/, null],
  ["src/pages/delivery-returns/index.tsx", /useDiscardGuard\(\{ open: true, dirty, busy: creating, onClose \}\)/, null],
  ["src/pages/purchase-returns/index.tsx", /useDiscardGuard\(\{ open: true, dirty, busy, onClose \}\)/, null],
  ["src/pages/customers.tsx", /useDiscardGuard\(\{ open, dirty: picked\.size > 0, busy: saving, onClose \}\)/, null],
  ["src/pages/settings/organisations.tsx", /useFormDiscardGuard\(form, \{ onClose, busy: saving \}\)/, /if \(e\.key === "Escape"\) onClose\(\)/],
  ["src/pages/settings/Users.tsx", /useFormDiscardGuard\(\{ resetPassword \}/, /onClick=\{\(\) => !resetSubmitting && setResetForUser\(null\)\}/],
  ["src/pages/employees.tsx", /message: "The PINs on screen will not be shown again\."/, /p-4"\n\s*onClick=\{closePinModal\}/],
  ["src/pages/production/wip-times.tsx", /useFormDiscardGuard\(\{ batchMinutes \}/, /p-4"\n\s*onClick=\{\(\) => !batchSaving && setBatchOpen\(false\)\}/],
  ["src/pages/mail-center/compose.tsx", /\{ open, ready: seeded, busy: sending, onClose \}/, /bg-black\/40"\n\s*onClick=/],
  ["src/pages/mail-center/index.tsx", /useDiscardGuard\(\{ open, dirty: newName\.trim\(\) !== "", busy, onClose \}\)/, null],
  ["src/pages/procurement/grn.tsx", /useFormDiscardGuard\(\s*\{ selectedPO, receivedBy, notes, itemEntries \}/, /bg-black\/40" onClick=\{onClose\}/],
  ["src/pages/sales/create.tsx", /dirty: step === 2 \|\| sourceLookup\.trim\(\) !== ""/, null],
  ["src/pages/delivery/index.tsx", /useFormDiscardGuard\(providerForm, \{/, /onClick=\{\(\) => !providerSaving && setProviderDialog\(null\)\}/],
  ["src/pages/consignment/note.tsx", /useFormDiscardGuard\(createCNForm, \{/, /onClick=\{\(\) => !creatingCNFromPO && setCreateCNDialog\(null\)\}/],
  ["src/pages/accounting/index.tsx", /useFormDiscardGuard\(newPartyDraft, \{/, /p-4" onClick=\{\(\) => \{ if \(!creatingParty\) setNewPartyDraft\(null\); \}\}/],
  ["src/pages/invoices/e-invoice.tsx", /useFormDiscardGuard\(\{ submissionId, result, uuid, reason, selectedXmlId \}/, /useEscapeClose\(/],
];

for (const [file, wired, gone] of POPUPS) {
  test(`discard guard wired: ${file}`, () => {
    const src = read(file);
    assert.match(src, wired, `${file}: guard`);
    // e-invoice's step popup never closed on a backdrop click; only its Esc is guarded.
    if (!file.endsWith("e-invoice.tsx")) {
      assert.match(src, /onMouseDown=\{[a-zA-Z]*[gG]uard\.onBackdrop\}/, `${file}: backdrop goes through the guard`);
    }
    if (gone) assert.doesNotMatch(src, gone, `${file}: old unconditional closer removed`);
  });
}

test("the scan-vouchers backdrop asks like its Esc does", () => {
  const src = read("src/pages/accounting/index.tsx");
  assert.match(src, /onMouseDown=\{\(e\) => \{ if \(isBackdropClick\(e\)\) void escClose\(\); \}\}/);
});

test("the recipient picker takes Esc before the Compose dialog under it", () => {
  assert.match(read("src/pages/mail-center/recipient-picker.tsx"), /useEscapeClose\(onClose, open\);/);
});

test("a seeded popup waits for its own seeding before taking the baseline", () => {
  const dlv = read("src/pages/delivery/index.tsx");
  assert.match(dlv, /ready: pendingDriverName === "",/);
  assert.match(dlv, /ready: invoiceLines !== null && !invoiceLinesLoading,/);
  assert.match(read("src/pages/procurement/grn.tsx"), /ready: lockedPoId \? itemEntries\.length > 0 : true/);
  // A deep-linked DO / PI loading by itself is not the operator's change.
  assert.match(read("src/pages/delivery-returns/index.tsx"), /doId !== "" && doId !== \(initialDoId \?\? ""\)/);
  assert.match(read("src/pages/purchase-returns/index.tsx"), /piId !== "" && piId !== \(initialPiId \?\? ""\)/);
});

// ── H3-1 follow-up: leave guard on more create / edit forms ────────────────

test("more create / edit forms ask Leave without saving", () => {
  const cases = [
    ["src/pages/delivery/index.tsx", /useNavGuard\(\s*createDODirty \|\| printGuard\.dirty \|\| invoiceGuard\.dirty \|\| providerGuard\.dirty,/],
    ["src/pages/consignment/note.tsx", /useNavGuard\(\s*createPLGuard\.dirty \|\| dispatchGuard\.dirty \|\| createCNGuard\.dirty,/],
    ["src/pages/delivery-returns/index.tsx", /const nav = useNavGuard\(dirty, /],
    ["src/pages/purchase-returns/index.tsx", /useNavGuard\(dirty, /],
    ["src/pages/invoices/credit-notes.tsx", /useNavGuard\(formDirty, "You have an unsaved credit note\./],
    ["src/pages/invoices/debit-notes.tsx", /useNavGuard\(formDirty, "You have an unsaved debit note\./],
    ["src/pages/inventory/adjustments.tsx", /useNavGuard\(\s*rows\.some\(\(r\) => r\.status !== "saved" && Boolean\(r\.itemId \|\| r\.qty\.trim\(\)/],
    ["src/pages/customers.tsx", /useNavGuard\(addDirty \|\| editCustDirty \|\| hubDirty, /],
    ["src/pages/procurement/supplier-form-dialog.tsx", /useNavGuard\(guard\.dirty, /],
    ["src/pages/procurement/sku-form-dialog.tsx", /useNavGuard\(guard\.dirty, /],
    ["src/components/employee-drawer.tsx", /useNavGuard\(guard\.dirty, /],
  ];
  for (const [file, re] of cases) assert.match(read(file), re, file);
});

test("the jump to a new delivery return after a create never asks", () => {
  const src = read("src/pages/delivery-returns/index.tsx");
  assert.match(src, /nav\.allowNext\(\);\n\s*onCreated\(json\.data\.id\);/);
});

// ── C1-11 follow-up: "—" while loading ─────────────────────────────────────

test("figureOrDash: a dash while loading, the real figure (zero included) after", () => {
  assert.equal(LOADING_DASH, "—");
  assert.equal(figureOrDash(true, 0), "—");
  assert.equal(figureOrDash(true, 12), "—");
  assert.equal(figureOrDash(false, 0), "0");
  assert.equal(figureOrDash(false, 12), "12");
  assert.equal(figureOrDash(false, 12345, (v) => `RM ${(v / 100).toFixed(2)}`), "RM 123.45");
  assert.equal(figureOrDash(true, 12345, () => "never"), "—");
  assert.equal(figureOrDash(false, "4.5"), "4.5");
});

test("list KPI tiles dash until their data arrives", () => {
  const cases = [
    ["src/pages/sales/index.tsx", /const kpiLoading = !statsResp && !ordersResp;/, 10],
    ["src/pages/consignment/index.tsx", /const kpiLoading = !statsResp && !ordersResp;/, 5],
    ["src/pages/procurement/pi.tsx", /const kpiLoading = loading && !piResp;/, 4],
    ["src/pages/procurement/maintenance.tsx", /const kpiLoading = !suppliersResp;/, 4],
    ["src/pages/customers.tsx", /const kpiLoading = loading && !customersResp;/, 2],
  ];
  for (const [file, flag, n] of cases) {
    const src = read(file);
    assert.match(src, flag, file);
    assert.equal((src.match(/figureOrDash\(kpiLoading, /g) ?? []).length, n, `${file}: ${n} tiles`);
  }
  const dr = read("src/pages/delivery-returns/index.tsx");
  assert.match(dr, /const countsLoading = loading && !raw;/);
  assert.equal((dr.match(/figureOrDash\(countsLoading, counts\./g) ?? []).length, 3);
  assert.match(read("src/pages/employees.tsx"), /figureOrDash\(loading && !resp, totals\?\.workerCount \?\? 0\)/);
  assert.match(read("src/pages/leads/index.tsx"), /figureOrDash\(!loaded, byStage\[s\.key\]\.length\)/);
});

// ── BUG-2026-11-10-496: Leads money shown 100× too small ───────────────────

test("BUG-2026-11-10-496: Leads money goes to formatCurrency in sen, once", () => {
  const src = read("src/pages/leads/index.tsx");
  assert.match(src, /figureOrDash\(!loaded, openValueSen, formatCurrency\)/);
  assert.match(src, /figureOrDash\(!loaded, wonValueSen, formatCurrency\)/);
  assert.match(src, /formatCurrency\(it\.price_sen\)/);
  assert.doesNotMatch(src, /formatCurrency\([^()]*[sS]en[^()]*\/ ?100\)/);
});
