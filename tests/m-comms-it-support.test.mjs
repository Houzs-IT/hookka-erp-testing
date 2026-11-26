// m-comms-it-support.test.mjs — /m IT Support v3 (Batch 2, Claude Design "IT Support (standalone)").
// Unit tests over the pure helpers (it-lib.ts, comms-files.ts) and over the source: the desktop page's rules
// (src/pages/it-support/index.tsx) must hold on the phone. NOT authenticated API runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATUS_LABEL, STATUSES, statusTone, readTickets, tabCounts, filterTickets, emptyText, listCountLabel, readDetail, eventLine, timeline, closedCopy, isClosed, isResolved,
} from "../src/pages/m/screens/comms/it-support/it-lib.ts";
import { itAddFiles, itAcceptedType, IT_MAX_FILES } from "../src/pages/m/screens/comms/comms-files.ts";

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const desktop = read("pages/it-support/index.tsx");

test("status words are the desktop's, every one", () => {
  for (const s of STATUSES) {
    assert.match(desktop, new RegExp(`${s}: "${STATUS_LABEL[s].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${s} label`);
  }
});

test("status colours keep the desktop hues (blue, amber, slate, violet, orange, emerald, slate, rose)", () => {
  const css = read("pages/m/screens/comms/comms-theme.css");
  const expect = { open: "#1D4ED8", progress: "#B45309", hold: "#475569", testing: "#6D28D9", waiting: "#C2410C", resolved: "#047857", closed: "#475569", rejected: "#BE123C" };
  for (const [k, hex] of Object.entries(expect)) assert.match(css, new RegExp(`--it-${k}: ${hex};`), k);
  assert.match(desktop, /open: \["bg-blue-50 text-blue-700/);
  assert.match(desktop, /in_progress: \["bg-amber-50 text-amber-700/);
  assert.deepEqual(statusTone("waiting_reporter"), { fg: "var(--it-waiting)", bg: "var(--it-waiting-bg)", dot: "var(--it-waiting-dot)" });
});

test("tabs: resolved = done-please-confirm, closed, rejected; only closed / rejected stop replies", () => {
  assert.equal(isResolved("resolved"), true);
  assert.equal(isClosed("resolved"), false);
  assert.equal(isClosed("rejected"), true);
  const rows = readTickets({ tickets: [
    { code: "HK-1", status: "open", priority: "high", title: "Printer", updated_at: "2026-11-20T00:00:00Z", created_at: "2026-11-19T00:00:00Z", assignee_name: null, unread: false },
    { code: "HK-2", status: "resolved", priority: "medium", title: "List", updated_at: "2026-11-25T00:00:00Z", created_at: "2026-11-18T00:00:00Z", assignee_name: "Aisyah", unread: true },
    { code: "HK-3", status: "closed", priority: "urgent", title: "Login", updated_at: "2026-10-16T00:00:00Z", created_at: "2026-10-12T00:00:00Z", assignee_name: "Lim", unread: false },
  ] });
  assert.deepEqual(rows.map((r) => r.code), ["HK-2", "HK-1", "HK-3"], "newest update first");
  assert.deepEqual(tabCounts(rows), { all: 3, active: 1, resolved: 2 });
  const f = (o) => filterTickets(rows, { tab: "all", q: "", statuses: [], priorities: [], ...o }).map((r) => r.code);
  assert.deepEqual(f({ q: "not picked up" }), ["HK-1"], "search covers the empty handler wording");
  assert.deepEqual(f({ q: "urgent" }), ["HK-3"], "search covers the urgency label");
  assert.deepEqual(f({ q: "done, please" }), ["HK-2"], "search covers the status label");
  assert.deepEqual(f({ statuses: ["open"], priorities: ["high"] }), ["HK-1"]);
  assert.deepEqual(f({ tab: "active" }), ["HK-1"]);
  assert.equal(emptyText("active", false), "Nothing is with IT right now.");
  assert.equal(emptyText("resolved", true), "No requests match.");
  assert.equal(listCountLabel(1, 3, true), "1 OF 3 REQUESTS");
  assert.equal(listCountLabel(3, 3, false), "3 REQUESTS · NEWEST UPDATE FIRST");
});

test("timeline wording is the desktop eventLine; words or files make a message", () => {
  assert.equal(eventLine({ kind: "created", to: null }), "sent this request");
  assert.equal(eventLine({ kind: "status", to: "in_progress" }), "changed it to In progress");
  assert.equal(eventLine({ kind: "assign", to: "Lim Wei Jie" }), "gave it to Lim Wei Jie");
  assert.equal(eventLine({ kind: "assign", to: null }), "took it off the person handling it");
  assert.equal(eventLine({ kind: "comment", to: null }), "replied");
  const d = readDetail({ ticket: { code: "HK-9", status: "waiting_reporter", priority: "high", type: "bug", title: "x", description: "", assignee_name: "Lim", created_at: "2026-11-24T01:00:00Z", updated_at: "2026-11-26T01:00:00Z" }, events: [
    { id: 1, kind: "created", author_kind: "reporter", author_name: "Me", body: null, created_at: "2026-11-24T01:00:00Z", attachments: [{ id: 7, filename: "do.jpg", mime: "image/jpeg", size: 10 }] },
    { id: 2, kind: "assign", author_kind: "developer", author_name: "Lim", body: null, to_value: "Lim", created_at: "2026-11-24T02:00:00Z", attachments: [] },
    { id: 3, kind: "comment", author_kind: "developer", author_name: "Lim", body: "Which DO?", created_at: "2026-11-26T01:00:00Z", attachments: [] },
    { id: 4, kind: "status", author_kind: "developer", author_name: "Lim", body: null, to_value: "waiting_reporter", created_at: "2026-11-26T01:00:00Z", attachments: [] },
  ] });
  const t = timeline(d.events);
  assert.equal(t[0].type, "msg");
  assert.equal(t[0].who, "You");
  assert.equal(t[1].type, "evt");
  assert.equal(t[1].text, "gave it to Lim");
  assert.equal(t[2].type, "msg");
  assert.equal(t[2].it, true);
  assert.equal(t[3].text, "changed it to Waiting for you");
  assert.equal(closedCopy("closed").title, "This request is closed");
  assert.equal(closedCopy("rejected").title, "IT isn't going ahead with this");
});

test("attachments: desktop types and limits, plus no duplicates", () => {
  const f = (name, type, size = 1000, lastModified = 1) => ({ name, type, size, lastModified });
  assert.equal(itAcceptedType(f("a.zip", "")), true, "ZIP judged by its name");
  assert.equal(itAcceptedType(f("setup.exe", "application/x-msdownload")), false);
  let r = itAddFiles([], [f("a.png", "image/png"), f("setup.exe", "application/x-msdownload"), f("big.mov", "video/quicktime", 24 * 1024 * 1024)]);
  assert.equal(r.files.length, 1);
  assert.match(r.rejected[0], /only images, PDF, MP4, MOV and ZIP/);
  assert.match(r.rejected[1], /the limit is 10 MB/);
  r = itAddFiles(r.files, [f("a.png", "image/png")]);
  assert.equal(r.files.length, 1);
  assert.match(r.rejected[0], /already attached/);
  const many = Array.from({ length: 7 }, (_, i) => f(`s${i}.png`, "image/png", 10, i));
  r = itAddFiles([], many);
  assert.equal(r.files.length, IT_MAX_FILES);
  assert.deepEqual(r.rejected, ["You can attach up to 5 files."]);
});

// ---- source rules --------------------------------------------------------------------------------------------------
const ticket = read("pages/m/screens/comms/it-support/ItTicket.tsx");
const form = read("pages/m/screens/comms/it-support/ItReportForm.tsx");
const screen = read("pages/m/screens/comms/it-support/ItSupportScreen.tsx");
const layout = read("pages/m/MobileLayout.tsx");

test("the phone never sets a status: replies and confirm reload from the server", () => {
  assert.doesNotMatch(ticket, /status: "in_progress"|status: "closed"|setDetail\(\{ \.\.\.detail/);
  assert.match(ticket, /\/replies`, \{ method: "POST", body: form \}\);[\s\S]*?await load\(\);/);
  assert.match(ticket, /\/confirm`, \{ method: "POST" \}\);[\s\S]*?await load\(\);/);
  assert.match(ticket, /`\$\{code\} closed\. Thank you for confirming\.`/);
  assert.match(ticket, /useInterval\(load, 30_000\)/);
  assert.match(screen, /useInterval\(loadList, 60_000\)/);
});

test("busy and error states: Sending / Closing, the server's own error, a failed open", () => {
  assert.match(ticket, /busy === "confirm" \? "Closing…" : "Yes, it is fixed"/);
  assert.match(ticket, /aria-label=\{busy === "reply" \? "Sending" : "Send reply"\}/);
  assert.match(ticket, /title="Couldn't open this request" text=\{loadError\}/);
  assert.match(screen, /title="Couldn't load your requests" text=\{error\}/, "e.g. the 503 'IT Support is not connected yet' text");
  assert.match(form, /saving \? "Sending…" : "Send"/);
});

test("report form: desktop fields, the sidebar's module list, no Area line on the ticket", () => {
  assert.match(form, /const MODULES = itModuleIndex\(navigationGroups\);/);
  assert.match(form, /<option value="">Not sure<\/option>/);
  for (const k of ["title", "description", "type", "priority", "occurred_at"]) assert.match(form, new RegExp(`form\\.set\\("${k}"`));
  assert.match(form, /if \(module\) form\.set\("module", module\);/);
  assert.match(form, /"\/tickets", \{ method: "POST", body: form \}/);
  assert.doesNotMatch(ticket, /module|Which part of the system/);
});

test("wiring: /m/it-support renders the v3 screen, not the embedded desktop page", () => {
  assert.match(layout, /const ItSupportScreen = lazy\(\(\) => import\("\.\/screens\/comms\/it-support\/ItSupportScreen"\)\);/);
  assert.doesNotMatch(layout, /import\("@\/pages\/it-support"\)/);
  assert.match(layout, /<Route path="it-support" element=\{<ItSupportRoute \/>\} \/>/);
});

test("no demo data from the prototype", () => {
  for (const src of [ticket, form, screen]) assert.doesNotMatch(src, /IT-0158|Lim Wei Jie|Demo User|Aisyah Rahman/);
});
