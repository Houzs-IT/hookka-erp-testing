// m-comms-announcements.test.mjs — /m Announcements v3 (Batch 2, Claude Design "Announcements (standalone)").
// Unit tests over the pure helpers (ann-lib.ts, comms-files.ts) and over the source: the ERP's rules (desktop
// src/pages/announcements.tsx, API src/api/routes/announcements.ts) must hold on the phone. NOT authenticated API runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeAnn, readAnnList, annStatus, orderChip, recipientLabel, sentToLine, filterAnns, countLabel, readReceipts, readPct,
  composeBody, composerErrors, errorSentence, localToIso,
} from "../src/pages/m/screens/comms/announcements/ann-lib.ts";
import { kindOf, formatBytes } from "../src/pages/m/screens/comms/comms-files.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const NOW = Date.parse("2026-11-26T10:40:00+08:00");
const row = (o = {}) => ({ id: "ann-1", title: "T", body: "B", isActive: true, expiresAt: null, createdAt: "2026-11-25T01:00:00Z", category: "WARNING", targetType: "ALL", targetDeptCodes: [], targetWorkerIds: [], attachments: [], priority: null, orderNo: null, createdByName: "Nurul", ...o });

test("normalizeAnn reads the API row dual-keyed and defaults like the API", () => {
  const a = normalizeAnn({ id: "x", title: "Hi", is_active: true, expires_at: "2026-12-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z", category: "nonsense", target_dept_codes: '["PACKING"]', attachments: [{ fileId: "f1", name: "a.pdf", mime: "application/pdf" }, { name: "no id" }] });
  assert.equal(a.isActive, true);
  assert.equal(a.category, "GENERAL");
  assert.deepEqual(a.targetDeptCodes, ["PACKING"]);
  assert.equal(a.targetType, "DEPTS");
  assert.equal(a.attachments.length, 1);
  assert.equal(a.attachments[0].kind, "pdf");
  assert.equal(a.priority, null);
});

test("status: hidden beats expired beats live (desktop isExpired + isActive)", () => {
  assert.equal(annStatus({ isActive: false, expiresAt: "2020-01-01T00:00:00Z" }, NOW), "hidden");
  assert.equal(annStatus({ isActive: true, expiresAt: "2026-11-26T02:40:00Z" }, NOW), "expired");
  assert.equal(annStatus({ isActive: true, expiresAt: "2026-11-27T00:00:00Z" }, NOW), "live");
  assert.equal(annStatus({ isActive: true, expiresAt: null }, NOW), "live");
});

test("list is newest first, as the API orders it", () => {
  const list = readAnnList({ success: true, data: [row({ id: "old", createdAt: "2026-10-01T00:00:00Z" }), row({ id: "new", createdAt: "2026-11-25T00:00:00Z" })] });
  assert.deepEqual(list.map((a) => a.id), ["new", "old"]);
});

test("order notice chip uses the ERP priorities and order numbers, never invented ranks", () => {
  assert.equal(orderChip({ priority: null, orderNo: "PO-1" }), "");
  assert.equal(orderChip({ priority: "URGENT", orderNo: "SO-2611-088" }), "Urgent · SO-2611-088");
  assert.equal(orderChip({ priority: "OVERDUE", orderNo: "SO-1, SO-2, SO-3" }), "Overdue · SO-1 +2");
  assert.equal(orderChip({ priority: "PRIORITY", orderNo: null }), "Priority");
});

test("recipient label comes from the stored target, exactly", () => {
  const name = (c) => ({ WOOD_CUT: "Wood Cutting", FRAMING: "Framing" })[c] ?? c;
  const ann = (t, d, w) => normalizeAnn(row({ targetType: t, targetDeptCodes: d, targetWorkerIds: w }));
  assert.equal(recipientLabel(ann("ALL", [], []), name), "All workers");
  assert.equal(recipientLabel(ann("DEPTS", ["WOOD_CUT", "FRAMING"], []), name), "Wood Cutting, Framing");
  assert.equal(recipientLabel(ann("DEPTS", ["A", "B", "C"], []), name), "3 departments");
  assert.equal(recipientLabel(ann("WORKERS", [], ["w1"]), name), "1 person");
  assert.equal(recipientLabel(ann("MIXED", ["FRAMING"], ["w1", "w2"]), name), "Framing · 2 people");
  assert.equal(sentToLine("All workers", 24, "ALL"), "All workers · 24");
  assert.equal(sentToLine("2 people", 2, "WORKERS"), "2 people");
});

test("search, Live chip and category filter", () => {
  const list = [normalizeAnn(row({ id: "1", title: "Goggles", category: "WARNING" })), normalizeAnn(row({ id: "2", title: "Menu", category: "GENERAL", isActive: false })), normalizeAnn(row({ id: "3", title: "QC", body: "tension", category: "SOP" }))];
  assert.deepEqual(filterAnns(list, { q: "goggles", chip: "all", cats: [] }, NOW).map((a) => a.id), ["1"]);
  assert.deepEqual(filterAnns(list, { q: "sop", chip: "all", cats: [] }, NOW).map((a) => a.id), ["3"]);
  assert.deepEqual(filterAnns(list, { q: "", chip: "live", cats: [] }, NOW).map((a) => a.id), ["1", "3"]);
  assert.deepEqual(filterAnns(list, { q: "", chip: "all", cats: ["GENERAL"] }, NOW).map((a) => a.id), ["2"]);
  assert.equal(countLabel(1, 3, true), "1 OF 3 POSTED");
  assert.equal(countLabel(3, 3, false), "3 POSTED");
});

test("read receipts: the acks payload, percentage and tone", () => {
  const r = readReceipts({ success: true, data: { total: 5, ackedCount: 4, acked: [{ id: "w1", name: "A", empNo: "E1", ackedAt: "2026-11-25T02:00:00Z" }], pending: [{ id: "w2", name: "B", empNo: "E2" }] } });
  assert.equal(r.total, 5);
  assert.equal(r.acked[0].empNo, "E1");
  assert.deepEqual(readPct({ total: 5, ackedCount: 4 }), { pct: 80, tone: "green" });
  assert.deepEqual(readPct({ total: 4, ackedCount: 2 }), { pct: 50, tone: "amber" });
  assert.deepEqual(readPct({ total: 0, ackedCount: 0 }), { pct: 0, tone: "red" });
  assert.equal(readReceipts({ success: false }), null);
});

test("composer posts the desktop body: empty lists = everyone, only the active audience is sent", () => {
  const base = { title: " Hi ", message: " m ", category: "SOP", depts: ["PACKING"], people: ["w1"], hideOn: false, hideDate: "", hideTime: "18:00", attachments: [{ fileId: "f", name: "a.jpg", mime: "image/jpeg" }] };
  assert.deepEqual(composeBody({ ...base, audience: "all" }), { title: "Hi", body: "m", expiresAt: undefined, attachments: base.attachments, targetDeptCodes: [], targetWorkerIds: [], category: "SOP" });
  assert.deepEqual(composeBody({ ...base, audience: "depts" }).targetWorkerIds, []);
  assert.deepEqual(composeBody({ ...base, audience: "people" }).targetDeptCodes, []);
  const withHide = composeBody({ ...base, audience: "all", hideOn: true, hideDate: "2026-12-31", hideTime: "18:00" });
  assert.equal(withHide.expiresAt, new Date("2026-12-31T18:00").toISOString(), "the phone's local time, sent as an instant");
  assert.equal(localToIso("", "18:00"), undefined);
});

test("composer checks, in the prototype's words", () => {
  const ok = { title: "x", audience: "all", depts: [], people: [], hideOn: false, hideDate: "", hideTime: "", uploading: false, failed: false };
  assert.deepEqual(composerErrors(ok), []);
  assert.deepEqual(composerErrors({ ...ok, title: " ", audience: "depts", uploading: true }), ["Add a title", "pick a department", "wait for uploads"]);
  assert.equal(errorSentence(["Add a title", "pick a department"]), "Add a title, pick a department.");
  assert.deepEqual(composerErrors({ ...ok, hideOn: true }), ["set the date and time to hide it"]);
});

test("file kinds and sizes for the attachment rows", () => {
  assert.equal(kindOf("image/png"), "image");
  assert.equal(kindOf("video/mp4"), "video");
  assert.equal(kindOf("application/pdf"), "pdf");
  assert.equal(formatBytes(420 * 1024), "420 KB");
  assert.equal(formatBytes(2.4 * 1024 * 1024), "2.4 MB");
});

// ---- source rules --------------------------------------------------------------------------------------------------
const detail = read("screens/comms/announcements/AnnouncementDetail.tsx");
const composer = read("screens/comms/announcements/AnnouncementComposer.tsx");
const list = read("screens/comms/announcements/AnnouncementsScreen.tsx");
const ui = read("screens/comms/announcements/ann-ui.tsx");
const layout = read("MobileLayout.tsx");

test("Remind all says the receipts reset and reloads them (API deletes announcement_acks)", () => {
  assert.match(detail, /Their read receipts are reset, so the count starts again from 0 of \$\{n\}\./);
  assert.match(detail, /JSON\.stringify\(\{ scope \}\)/);
  assert.match(detail, /invalidateCachePrefix\(acksUrl\);\s*\n\s*acks\.refresh\(\);/);
});

test("create / update / delete stay separate permissions", () => {
  assert.match(ui, /canCreate: hasPermission\("announcements", "create"\)/);
  assert.match(ui, /canUpdate: hasPermission\("announcements", "update"\)/);
  assert.match(ui, /canDelete: hasPermission\("announcements", "delete"\)/);
  assert.match(list, /trailing=\{canCreate \?/);
  assert.match(detail, /\{canUpdate && receipts \?/, "reminders need update");
  assert.match(detail, /\{canUpdate \? \(\s*\n\s*<ManageRow icon=\{a\.isActive \? EyeOff : Eye\}/, "hide / show needs update");
  assert.match(detail, /\{canDelete \? <ManageRow icon=\{Trash2\} danger/, "delete needs delete");
  assert.match(composer, /if \(!canCreate\) \{/);
});

test("the composer uploads to the shared /api/files store and keeps the File for Retry", () => {
  assert.match(composer, /fd\.append\("resourceType", "announcement"\);\s*\n\s*fd\.append\("resourceId", "compose"\);/);
  assert.match(composer, /function retry\(u: Upload\)/);
  assert.match(composer, /fetch\("\/api\/announcements", \{ method: "POST"/);
  // Back to "All workers" clears both pickers (desktop resetTargeting).
  assert.match(composer, /if \(k === "all"\) \{\s*\n\s*setSelDepts\(\[\]\);\s*\n\s*setSelPeople\(\[\]\);/);
});

test("wiring: list (CUSTOM_L1) and the v3 detail (CUSTOM_L2) under /m/announcements", () => {
  assert.match(layout, /import \{ AnnouncementsScreen \} from "\.\/screens\/comms\/announcements\/AnnouncementsScreen";/);
  assert.match(layout, /announcements: AnnouncementsScreen,/);
  assert.match(layout, /announcements: AnnouncementDetail,/);
});

test("no demo data: nothing from the prototype's sample notices reaches the screens", () => {
  for (const src of [detail, composer, list, ui]) {
    assert.doesNotMatch(src, /Deepavali, 20 Oct|Wear safety goggles|High priority · #1|Demo User/);
  }
});
