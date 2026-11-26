// m-comms-mail.test.mjs — /m Mail Center v3 (Batch 2, Claude Design "Mail Centre (standalone)" revised).
// Unit tests over the pure helpers (mail-lib.ts) and over the source: the desktop page's rules
// (src/pages/mail-center/*) and the API's (src/api/routes/mail-center.ts) must hold on the phone.
// NOT authenticated API runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  threadsUrl, narrowThreads, byCategory, emptyCopy, senderLabel, cleanSnippet, listWhen, deptGroups, missingCanonical, mailboxKind, LABEL_PALETTE, labelColor, labelList,
  withLabel, withoutLabel, addRecipients, pasteCommits, COMMIT_KEYS, isStaffAddress, replySubject, forwardSubject, forwardBody, messageBody, emailSrcDoc, ACK_DUES, ackState,
  ackIsMine, outboxStatusLabel, outboxWhen, OUTBOX_FILTERS, sendBlocker, FOLDERS, isConvFolder, deliveryLabel,
} from "../src/pages/m/screens/comms/mail/mail-lib.ts";
import { LABEL_PALETTE as DESKTOP_PALETTE } from "../src/pages/mail-center/mail-labels.ts";

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DIR = "pages/m/screens/comms/mail";
const files = readdirSync(new URL(`../src/${DIR}`, import.meta.url)).filter((f) => /\.(tsx?|css)$/.test(f));
const src = Object.fromEntries(files.map((f) => [f, read(`${DIR}/${f}`)]));
const all = Object.values(src).join("\n");
const desktopIndex = read("pages/mail-center/index.tsx");
const route = read("api/routes/mail-center.ts");

const T = (o) => ({ id: "x", mailboxAddress: "sales@hookka.com", subject: "Hello", counterpartyEmail: "a@b.my", counterpartyName: "", status: "open", lastMessageAt: "2026-11-26T02:00:00Z", lastDirection: "inbound", lastSnippet: "", messageCount: 1, unread: false, starred: false, labels: [], trashedAt: null, hasOutbound: false, ...o });

test("folders map to GET /threads exactly as desktop builds the query", () => {
  const o = { myAddress: "me@hookka.com", mailbox: { kind: "all" }, label: null };
  assert.equal(threadsUrl("inbox", o), "/api/mail-center/threads?status=open&limit=100");
  assert.equal(threadsUrl("my-inbox", o), "/api/mail-center/threads?status=open&mailbox=me%40hookka.com&limit=100");
  assert.equal(threadsUrl("archive", o), "/api/mail-center/threads?status=closed&limit=100");
  assert.equal(threadsUrl("trash", o), "/api/mail-center/threads?status=trashed&limit=100");
  assert.equal(threadsUrl("sent", o), "/api/mail-center/threads?sent=1&limit=100");
  assert.equal(threadsUrl("my-sent", o), "/api/mail-center/threads?sentBy=me&limit=100");
  assert.equal(threadsUrl("starred", { ...o, mailbox: { kind: "mailbox", value: "hr@hookka.com" }, label: "VIP" }), "/api/mail-center/threads?mailbox=hr%40hookka.com&label=VIP&limit=100");
  // desktop: same params, same page size
  assert.match(desktopIndex, /const THREADS_PAGE = 100;/);
  assert.match(desktopIndex, /if \(folder === "my-sent"\) params\.set\("sentBy", "me"\);/);
  // the API knows these params
  for (const k of ["mailbox", "status", "q", "starred", "sent", "sentBy", "label", "limit", "offset"]) assert.match(route, new RegExp(`c\\.req\\.query\\("${k}"\\)`), k);
  assert.deepEqual(FOLDERS.filter((f) => !isConvFolder(f)), ["drafts", "autosent"]);
});

test("client narrowing: starred, department, label (case-insensitive), search over subject / sender / email / preview", () => {
  const rows = [T({ id: "1", starred: true, subject: "Delivery date", labels: ["Urgent"] }), T({ id: "2", mailboxAddress: "hr@hookka.com", counterpartyName: "Sample Buyer", lastSnippet: "invoice attached" }), T({ id: "3", counterpartyEmail: "no-reply@bank.my" })];
  const ids = (l) => l.map((t) => t.id);
  assert.deepEqual(ids(narrowThreads(rows, { folder: "starred", deptAddresses: null, label: null, q: "" })), ["1"]);
  assert.deepEqual(ids(narrowThreads(rows, { folder: "all", deptAddresses: new Set(["hr@hookka.com"]), label: null, q: "" })), ["2"]);
  assert.deepEqual(ids(narrowThreads(rows, { folder: "all", deptAddresses: null, label: "urgent", q: "" })), ["1"]);
  assert.deepEqual(ids(narrowThreads(rows, { folder: "all", deptAddresses: null, label: null, q: "INVOICE" })), ["2"]);
  assert.deepEqual(ids(narrowThreads(rows, { folder: "all", deptAddresses: null, label: null, q: "buyer" })), ["2"]);
  assert.deepEqual(ids(byCategory(rows, "notifications")), ["3"], "the desktop sender heuristic");
  assert.deepEqual(ids(byCategory(rows, "primary")), ["1", "2"]);
});

test("empty folders use the desktop titles", () => {
  for (const [f, title] of [["my-inbox", "Your inbox is empty"], ["my-sent", "You have not sent any mail yet"], ["starred", "No starred mail"], ["sent", "No sent mail"], ["archive", "Nothing archived"], ["drafts", "No drafts"], ["trash", "Trash is empty"], ["all", "No mail"], ["inbox", "No mail yet"]]) {
    assert.equal(emptyCopy(f, false).title, title);
    assert.match(desktopIndex, new RegExp(`return "${title}";`), title);
  }
  assert.equal(emptyCopy("inbox", true).title, "Nothing matches");
  assert.match(emptyCopy("inbox", true).text, /loaded so far/);
});

test("rows: sender fallback, clean preview, time", () => {
  assert.equal(senderLabel({ counterpartyName: "", counterpartyEmail: "lim@x.my" }), "lim");
  assert.equal(senderLabel({ counterpartyName: "", counterpartyEmail: "" }), "(no sender)");
  assert.equal(cleanSnippet("<p>Hi&nbsp;there</p>"), "Hi there");
  assert.equal(cleanSnippet(""), "(no preview)");
  const now = new Date(2026, 10, 26, 10, 40);
  assert.equal(listWhen(new Date(2026, 10, 26, 9, 5).toISOString(), now), "09:05");
  assert.equal(listWhen(new Date(2026, 10, 25, 9, 5).toISOString(), now), "Yesterday");
  assert.equal(listWhen(new Date(2026, 10, 20, 9, 5).toISOString(), now), "20 Nov");
});

test("mailboxes: departments Support, Finance, HR first; SUPER_ADMIN set-up only for a box with no row anywhere", () => {
  const A = (address, dept, user = null) => ({ id: address, address, label: "", assignedDept: dept, assignedUserId: user, active: true });
  const g = deptGroups([A("sales@hookka.com", "Sales"), A("hr@hookka.com", "HR"), A("me@hookka.com", null, "u1"), A("support@hookka.com", "Support"), { ...A("old@hookka.com", "Sales"), active: false }]);
  assert.deepEqual(g.map((x) => x.dept), ["Support", "HR", "Sales", "Other"]);
  assert.equal(g.find((x) => x.dept === "Sales").mailboxes.length, 1, "inactive boxes are left out");
  assert.equal(mailboxKind(A("me@hookka.com", null, "u1")), "Personal");
  assert.deepEqual(missingCanonical("Finance", [A("support@hookka.com", "Support")]), ["finance@hookka.com"]);
  assert.deepEqual(missingCanonical("Finance", null), [], "nothing offered until the all=1 list loads");
  assert.match(src["MailList.tsx"], /ctx\.isSuperAdmin/);
  assert.match(src["mail-api.ts"], /isSuperAdmin \? "\/api\/mail-center\/addresses\?all=1" : null/);
});

test("labels: desktop palette, catalogue colours, merge without duplicates", () => {
  assert.deepEqual(LABEL_PALETTE, DESKTOP_PALETTE);
  assert.equal(labelColor("urgent", [{ id: "1", name: "Urgent", color: "#B91C1C" }]), "#B91C1C");
  assert.equal(labelColor("Unknown", []), "#6B5C32");
  assert.deepEqual(labelList([{ id: "1", name: "b", color: "" }], [T({ labels: ["A", "B"] })]), ["A", "b"]);
  assert.deepEqual(withLabel(["Urgent"], "urgent"), ["Urgent"]);
  assert.deepEqual(withLabel(["Urgent"], "VIP"), ["Urgent", "VIP"]);
  assert.deepEqual(withoutLabel(["Urgent", "VIP"], "vip"), ["Urgent"]);
});

test("recipients: the desktop chip rules (parse, de-dupe, paste, keys); staff = @hookka.com", () => {
  assert.deepEqual(addRecipients(["a@x.my"], "Sample Buyer <B@Y.my>; a@x.my, c@z.my"), ["a@x.my", "b@y.my", "c@z.my"]);
  assert.equal(pasteCommits("Sample <a@b.my>"), true);
  assert.equal(pasteCommits("a@b.my"), false);
  assert.deepEqual(COMMIT_KEYS, ["Enter", ",", ";", "Tab"]);
  assert.equal(isStaffAddress("Lim@Hookka.com"), true);
  assert.equal(isStaffAddress("lim@hookka.com.my"), false);
  const rec = read("pages/mail-center/recipients-input.tsx");
  assert.match(rec, /e\.key === "Enter" \|\| e\.key === "," \|\| e\.key === ";" \|\| e\.key === "Tab"/);
  assert.match(src["MailComposer.tsx"], /e\.key === "Backspace" && !text && list\.length/);
  assert.match(src["MailComposer.tsx"], /Not a valid email address/);
});

test("send gate: From, a To, valid addresses, subject (not on a reply), message, staff for an acknowledgement", () => {
  const b = { from: "me@hookka.com", to: ["a@b.my"], cc: [], bcc: [], pending: "", subject: "Hi", body: "Hello", ack: false, reply: false };
  assert.equal(sendBlocker(b), "");
  assert.match(sendBlocker({ ...b, from: "" }), /mailbox/);
  assert.match(sendBlocker({ ...b, to: [] }), /To recipient/);
  assert.match(sendBlocker({ ...b, cc: ["nope"] }), /invalid/);
  assert.match(sendBlocker({ ...b, pending: "half@" }), /invalid/);
  assert.match(sendBlocker({ ...b, subject: " " }), /subject/);
  assert.equal(sendBlocker({ ...b, subject: "", reply: true }), "", "a reply has no subject field");
  assert.match(sendBlocker({ ...b, body: "  " }), /message/);
  assert.match(sendBlocker({ ...b, ack: true }), /staff recipient/);
  assert.equal(sendBlocker({ ...b, ack: true, bcc: ["lim@hookka.com"] }), "");
});

test("subjects: Re: and Fwd: never doubled; forward quotes the whole conversation newest first", () => {
  assert.equal(replySubject("RE: Order"), "RE: Order");
  assert.equal(replySubject("Order"), "Re: Order");
  assert.equal(forwardSubject("Fwd: Order"), "Fwd: Order");
  assert.equal(forwardSubject(""), "Fwd: (no subject)");
  const msg = (id, at, text) => ({ id, direction: "inbound", fromName: `P${id}`, fromAddress: `p${id}@x.my`, toAddresses: [], ccAddresses: [], subject: "S", textBody: text, htmlBody: "", sentAt: "", receivedAt: "", createdAt: at });
  const body = forwardBody([msg("1", "2026-11-20T01:00:00Z", "first"), msg("2", "2026-11-21T01:00:00Z", "second")]);
  assert.ok(body.startsWith("---------- Forwarded message ----------"));
  assert.ok(body.indexOf("second") < body.indexOf("first"), "newest first");
  assert.match(src["MailComposer.tsx"], /Original attachments aren't forwarded\./);
  assert.match(src["MailComposer.tsx"], /forwardOf: mode === "forward" \? threadId : undefined/);
});

test("bodies: HTML goes to a sandboxed frame without scripts; text otherwise", () => {
  assert.deepEqual(messageBody({ htmlBody: "<p>x</p>", textBody: "x" }), { html: "<p>x</p>", text: "" });
  assert.deepEqual(messageBody({ htmlBody: "", textBody: "<div>doc</div>" }), { html: "<div>doc</div>", text: "" });
  assert.deepEqual(messageBody({ htmlBody: "", textBody: "plain" }), { html: "", text: "plain" });
  assert.match(emailSrcDoc("<p>x</p>"), /<base target="_blank">/);
  for (const f of ["MailThread.tsx", "MailOutbox.tsx"]) {
    assert.match(src[f], /sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"/, f);
    assert.doesNotMatch(src[f], /allow-scripts/, f);
    assert.doesNotMatch(src[f], /dangerouslySetInnerHTML/, f);
  }
});

test("acknowledgements: per message, 1 day / 2 days (default) / 3 days / 1 week, mine by account or mailbox", () => {
  assert.deepEqual(ACK_DUES.map((d) => d.hours), [24, 48, 72, 168]);
  assert.match(src["MailComposer.tsx"], /useState\(48\)/);
  const a = { id: "1", address: "sales@hookka.com", userId: null, userName: "", dueAt: "2026-11-20T00:00:00Z", ackedAt: null, chasedAt: null };
  assert.equal(ackState(a, "2026-11-21T00:00:00Z"), "overdue");
  assert.equal(ackState(a, "2026-11-19T00:00:00Z"), "pending");
  assert.equal(ackState({ ...a, ackedAt: "2026-11-19T00:00:00Z" }, "2026-11-21T00:00:00Z"), "acked");
  assert.equal(ackIsMine(a, "u1", new Set(["sales@hookka.com"])), true);
  assert.equal(ackIsMine({ ...a, userId: "u1", address: "x@y" }, "u1", new Set()), true);
  assert.equal(ackIsMine({ ...a, userId: "u2", address: "x@y" }, "u1", new Set()), false);
  assert.match(src["mail-api.ts"], /\/messages\/\$\{encodeURIComponent\(messageId\)\}\/acknowledge/);
  assert.match(src["MailThread.tsx"], /Reminded/);
});

test("auto-sent: desktop labels and filters; the time line fits the status", () => {
  assert.equal(outboxStatusLabel("RETRYING"), "Retrying");
  assert.equal(outboxStatusLabel("weird"), "Pending");
  assert.deepEqual(OUTBOX_FILTERS.map((f) => f.key), ["", "SENT", "FAILED", "PENDING"]);
  assert.equal(outboxWhen({ status: "SENT", sentAt: "s", createdAt: "c" }).label, "Sent");
  assert.equal(outboxWhen({ status: "FAILED", sentAt: null, createdAt: "c", lastAttemptAt: "l" }).label, "Last tried");
  assert.equal(outboxWhen({ status: "PENDING", sentAt: null, createdAt: "c" }).label, "Queued");
  assert.match(src["MailOutbox.tsx"], /\/attachments\/\$\{i\}\/download/);
});

test("delivery chip + reply guard are #1623's", () => {
  assert.equal(deliveryLabel("queued"), "Queued, retrying");
  assert.equal(deliveryLabel("bounced"), "Bounced: check the address");
  assert.match(src["mail-api.ts"], /use-replying-heartbeat/);
  assert.match(src["MailComposer.tsx"], /alreadyRepliedFrom\(r\.status, r\.data\)/);
  assert.match(src["MailComposer.tsx"], /Discard mine/);
  assert.match(src["MailComposer.tsx"], /Send mine too/);
  assert.match(src["mail-api.ts"], /afterMessageId: p\.afterMessageId/);
  assert.match(src["MailThread.tsx"], /is" : "are"\} writing a reply/);
});

test("attachments: the API's own rule (images + PDF, 10 files, 5 MB in total)", () => {
  assert.match(src["mail-api.ts"], /from "@\/api\/lib\/mail-attachments"/);
  assert.match(src["MailComposer.tsx"], /validateMailAttachments\(/);
  assert.match(src["MailComposer.tsx"], /isAllowedMailAttachment\(/);
  assert.match(src["MailComposer.tsx"], /accept="application\/pdf"/);
  assert.match(read("api/lib/mail-attachments.ts"), /MAIL_ATTACH_MAX_COUNT = 10;\nexport const MAIL_ATTACH_MAX_TOTAL_BYTES = 5 \* 1024 \* 1024;/);
});

test("drafts are this device's (desktop mail-local store); Save draft only on a new email", () => {
  assert.match(src["mail-api.ts"], /@\/pages\/mail-center\/mail-local/);
  assert.match(src["MailComposer.tsx"], /mode === "new" \? \(\s*<button type="button" disabled=\{!canSaveDraft\}/);
  assert.match(src["MailList.tsx"], /Drafts are kept on this device only, without attachments\./);
});

test("permissions are the API's: read / create = send + new label / update = thread changes / delete = delete a label", () => {
  for (const a of ["read", "create", "update", "delete"]) assert.match(src["mail-api.ts"], new RegExp(`hasPermission\\("mail-center", "${a}"\\)`));
  assert.match(route, /app\.post\("\/compose", async \(c\) => \{\n  const denied = await requirePermission\(c, "mail-center", "create"\);/);
  assert.match(route, /app\.delete\("\/labels\/:id", async \(c\) => \{\n  const denied = await requirePermission\(c, "mail-center", "delete"\);/);
  assert.match(src["MailList.tsx"], /ctx\.canUpdate \? \(/, "Select / row actions only with update");
  assert.match(src["MailSheets.tsx"], /ctx\.canDelete \? \(/, "delete label only with delete");
  assert.match(src["MailThread.tsx"], /const canSend = ctx\.canCreate && ctx\.addresses\.length > 0;/);
});

test("what the repo does not support is not drawn", () => {
  const code = all.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bUndo\b(?!2)/, "no Undo (the API has none)");
  assert.doesNotMatch(all, /To acknowledge|Assigned to me/);
  assert.doesNotMatch(all, /Snooze|Schedule send|Signature/i);
  assert.match(src["MailList.tsx"], /title="Mail Center"/);
  assert.doesNotMatch(all.replace(/\/\/.*$/gm, ""), /Mail Centre/, "the ERP spells it Mail Center");
});

test("layers, load failures, exports", () => {
  for (const [f, s] of Object.entries(src)) {
    assert.doesNotMatch(s, /position:\s*"fixed"/, `${f}: no fixed layer (use the kit)`);
    assert.doesNotMatch(s, /not found/i, `${f}: never says "not found" (record-load-failure class)`);
  }
  assert.match(src["MailScreens.tsx"], /export function MailCenterScreen\(/);
  assert.match(src["MailScreens.tsx"], /export function MailThreadScreen\(/);
  // every colour that changes in dark mode is a variable defined in light AND dark
  const css = src["mail-theme.css"];
  const vars = (block) => new Set([...block.matchAll(/(--mc-[a-z0-9-]+):/g)].map((m) => m[1]));
  const [light, dark] = css.split('body[data-theme="dark"]');
  assert.deepEqual([...vars(light)].sort(), [...vars(dark)].sort());
  for (const used of new Set([...all.matchAll(/var\((--mc-[a-z0-9-]+)\)/g)].map((m) => m[1]))) assert.ok(vars(light).has(used), `${used} defined`);
});
