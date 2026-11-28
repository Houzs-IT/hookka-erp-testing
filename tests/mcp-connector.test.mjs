// ---------------------------------------------------------------------------
// mcp-connector.test.mjs — the Hookka ERP MCP connector (docs/plans/mcp-connector.md).
// Owner 2026-11-25: read-only, own permissions, nothing leaks because a page
// only HIDES a field (「我担心是FE而已」), and the owner sees / approves who connects.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const access = await import("../src/api/lib/mcp-access.ts");
const store = await import("../src/api/lib/mcp-store.ts");
const policy = await import("../src/api/lib/role-policy.ts");

test("module gate: auth / users / internal / MCP itself are never readable; unknown paths fail closed", () => {
  for (const p of ["/api/auth/me", "/api/users", "/api/users/u1", "/api/user-permissions/x", "/api/mcp", "/api/internal/reports/x", "/api/admin/health", "/api/worker/me", "/api/files/f1/stream", "/api/audit-events"]) {
    assert.equal(access.classifyPath(p).ok, false, p);
  }
  assert.equal(access.classifyPath("/api/not-a-module").ok, false);
  for (const bad of ["/api/sales-orders/../users", "/api//users", "/api/sales-orders?x=1", "/api/sales-orders/a b"]) {
    assert.equal(access.classifyPath(bad).ok, false, bad);
  }
  const so = access.classifyPath("/api/sales-orders/so-1");
  assert.ok(so.ok && so.resources.includes("sales-orders"));
  // longest prefix wins: /api/stock-value is its own module, not /api/stock
  const sv = access.classifyPath("/api/stock-value");
  assert.ok(sv.ok && sv.resources[0] === "stock-value");
  assert.ok(access.classifyPath("sales-orders").ok, "a bare module name is normalised");
});

test("every module maps to a real RBAC resource", () => {
  const all = new Set(policy.ALL_RESOURCES);
  for (const [prefix, rs] of Object.entries(access.MCP_PREFIX_RESOURCES)) {
    for (const r of rs) assert.ok(all.has(r), `${prefix} → ${r} is not in ALL_RESOURCES`);
  }
});

test("field redaction: cost, salary and price leave the reply unless the person holds the permission", () => {
  const row = { poNo: "SO-2611-376-01", quantity: 3, unitPriceSen: 70000, totalSen: 210000, costSen: 41000, marginPct: 30, basicSalarySen: 180000, items: [{ productCode: "5530", lineCostSen: 9 }] };
  const none = () => false;
  const prod = access.makeRedactor(none, ["production-orders"])(row);
  assert.deepEqual(prod.value, { poNo: "SO-2611-376-01", quantity: 3, items: [{ productCode: "5530" }] });
  assert.deepEqual([...prod.removed].sort(), ["cost", "price", "salary"]);
  // A sales-order reader sees the order's amounts (the module is about money) but not its cost.
  const sales = access.makeRedactor(none, ["sales-orders"])(row).value;
  assert.equal(sales.unitPriceSen, 70000);
  assert.equal(sales.costSen, undefined);
  assert.equal(sales.basicSalarySen, undefined);
  // Finance sees cost and price; payroll unlocks salary.
  const fin = access.makeRedactor((p) => p === "accounting:read", ["production-orders"])(row).value;
  assert.equal(fin.costSen, 41000);
  assert.equal(fin.unitPriceSen, 70000);
  assert.equal(fin.basicSalarySen, undefined);
  const hr = access.makeRedactor((p) => p === "payroll:read", ["workers"])(row).value;
  assert.equal(hr.basicSalarySen, 180000);
});

test("OAuth helpers: PKCE S256 = base64url(sha256(verifier)) and redirect URIs", async () => {
  const { createHash } = await import("node:crypto");
  for (const v of ["dBjftJeZ4CVP-mJ0kQKBMsYvSyBjOGGJbqOQG3-Ic5U", "a".repeat(43), "x-Y_z.~0123456789abcdefghijklmnopqrstuvwxyzABC"]) {
    assert.equal(await store.pkceS256(v), createHash("sha256").update(v).digest("base64url"), v);
  }
  assert.equal(store.validRedirectUri("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(store.validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"), true);
  assert.equal(store.validRedirectUri("http://localhost:6274/oauth/callback"), true);
  assert.equal(store.validRedirectUri("http://evil.example/cb"), false);
  assert.equal(store.validRedirectUri("javascript:alert(1)"), false);
  assert.equal(store.validRedirectUri("https://x.example/cb#frag"), false);
  // Registration needs no login: only known AI app hosts and loopback (finding #1, 2026-11-27).
  assert.equal(store.validRedirectUri("https://claude.com/api/mcp/auth_callback"), true);
  assert.equal(store.validRedirectUri("https://127.0.0.1:8443/cb"), true);
  assert.equal(store.validRedirectUri("https://evil.example/cb"), false);
  assert.equal(store.validRedirectUri("https://claude.ai.evil.example/cb"), false);
  assert.equal(store.validRedirectUri("https://evil.claude.ai/cb"), false);
  assert.equal(store.validRedirectUri("http://claude.ai/cb"), false);
  assert.equal(store.appLabel("Claude"), "Claude");
  assert.equal(store.appLabel("ChatGPT"), "ChatGPT");
});

test("an MCP token is read-only (except a confirmed, allowlisted action) and only accepted on the connector's own in-process call", () => {
  const mw = read("src/api/lib/auth-middleware.ts");
  const at = mw.indexOf("if (!cookieToken && token.startsWith(MCP_TOKEN_PREFIX)) {");
  assert.ok(at > 0);
  const block = mw.slice(at, mw.indexOf("return next();", at));
  assert.match(block, /if \(!isMcpInner\(c\.req\.header\(MCP_INNER_HEADER\)\)\) \{\n\s+return c\.json\(\{ success: false, error: "AI connector tokens are only accepted through \/api\/mcp" \}, 403\);/);
  // A non-GET needs the action header AND the one-shot armed action for this token / method / path
  // (mcp-inner.ts takeConfirmedAction, which also checks ACTION_ALLOWLIST) — tests/mcp-actions.test.mjs.
  assert.match(block, /const mcpWrite = c\.req\.method !== "GET" && c\.req\.method !== "HEAD";\n\s+if \(mcpWrite && !c\.req\.header\(MCP_ACTION_HEADER\)\) \{\n\s+return c\.json\(\{ success: false, error: "The AI connector is read-only" \}, 403\);/);
  assert.match(block, /if \(mcpWrite && !takeConfirmedAction\(c\.req\.header\(MCP_ACTION_HEADER\), id\.tokenId, c\.req\.method, path\)\) \{\n\s+return c\.json\(\{ success: false, error: "The AI connector is read-only" \}, 403\);/);
  assert.ok(at < mw.indexOf("// -------- CSRF: double-submit cookie"), "checked before the session lookup");
  // a password reset / deactivation also kills the AI app's tokens
  assert.match(mw, /await revokeUserTokens\(db, userId\);/);
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /new Request\(originOf\(c\) \+ pathWithQuery, \{\n\s+method: "GET",/);
  assert.doesNotMatch(mcp, /method: "(POST|PUT|PATCH|DELETE)"/);
});

test("every tool but the confirmed-action tools is read-only; every call is logged; module gate + redaction run before the reply", () => {
  const mcp = read("src/api/routes/mcp.ts");
  const tools = mcp.slice(mcp.indexOf("const TOOLS = ["), mcp.indexOf("];", mcp.indexOf("const TOOLS = [")));
  const names = [...tools.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ["attendance_today", "cancel_action", "confirm_action", "daily_brief", "deliveries_due", "document_flow", "erp_get", "erp_link", "export_excel", "fetch", "get_pdf", "inventory_summary", "list_endpoints", "list_modules", "material_shortages", "order_backlog", "payables_summary", "production_late", "production_summary", "propose_email", "propose_mail_reply", "propose_meeting", "propose_note", "propose_po_approval", "purchasing_summary", "receivables_summary", "sales_summary", "search", "so_overdue", "whoami"]);
  const actionTools = ["cancel_action", "confirm_action", "propose_email", "propose_meeting", "propose_mail_reply", "propose_note", "propose_po_approval"];
  assert.equal((tools.match(/readOnlyHint: true/g) ?? []).length, names.length - actionTools.length);
  assert.equal((tools.match(/readOnlyHint: false/g) ?? []).length, actionTools.length);
  // Every read — erp_get and the quick answers — goes through readValue.
  const rd = mcp.slice(mcp.indexOf("async function readValue("));
  const gate = rd.indexOf("if (!(await canAny(c, d.resources))) {");
  const fetchAt = rd.indexOf("const res = await innerGet(c, token, target);");
  const redactAt = rd.indexOf("const redact = makeRedactor(await permLookup(c), d.resources);");
  assert.ok(gate > 0 && fetchAt > gate && redactAt > fetchAt);
  assert.match(mcp, /const done = logCall\(c\.var\.DB, \{ tokenId: id\.tokenId, userId: id\.userId/);
});

test("the Allow page: ERP login first, access checked, CSRF double-submit on the form", () => {
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /return c\.redirect\(`\/login\?next=\$\{encodeURIComponent\(here\.pathname \+ here\.search\)\}`, 302\);/);
  assert.match(mcp, /if \(!csrfCookie \|\| get\("csrf"\) !== csrfCookie\)/);
  assert.match(mcp, /if \(!p\.challenge \|\| p\.method !== "S256"\)/);
  assert.match(mcp, /if \(!cl\.redirectUris\.includes\(p\.redirectUri\) \|\| !validRedirectUri\(p\.redirectUri\)\)/);
  assert.match(mcp, /if \(!cl\.redirectUris\.every\(validRedirectUri\)\) return err\("invalid_client"/);
  assert.match(mcp, /Your access goes to <b>\$\{esc\(new URL\(p\.redirectUri\)\.host\)\}<\/b>/);
  const login = read("src/pages/login.tsx");
  assert.match(login, /if \(to\.startsWith\("\/api\/mcp\/oauth\/authorize\?"\)\) \{\n\s+window\.location\.assign\(to\);/);
});

test("mounted: the connector before authMiddleware, the admin page behind it; approvals are Super Admin only", () => {
  const w = read("src/api/worker.ts");
  const pub = w.indexOf('app.route("/api/mcp", mcp);');
  const gate = w.indexOf('app.use("/api/*", authMiddleware);');
  const adm = w.indexOf('app.route("/api/mcp-admin", mcpAdmin);');
  assert.ok(pub > 0 && gate > pub && adm > gate);
  assert.match(w, /setMcpApp\(app as unknown as Parameters<typeof setMcpApp>\[0\]\);/);
  const admin = read("src/api/routes/mcp-admin.ts");
  for (const route of ['"/admin/overview"', '"/admin/requests/:id/:decision"', '"/admin/access"', '"/admin/access/:userId"', '"/admin/revoke"']) {
    const at = admin.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(admin.slice(at, at + 160), /const denied = requireSuperAdmin\(c\);/, route);
  }
});

test("leak check: list endpoints only, side-effect GETs skipped, field names only, token revoked", async () => {
  const lc = await import("../src/api/lib/mcp-leak-check.ts");
  const paths = lc.leakCheckPaths([
    { method: "GET", path: "/api/sales-orders" },
    { method: "GET", path: "/api/sales-orders/:id" },
    { method: "POST", path: "/api/sales-orders" },
    { method: "GET", path: "/api/mrp/stock-status" },
    { method: "GET", path: "/api/production-orders/warm" },
    { method: "GET", path: "/api/users" },
    { method: "GET", path: "/api/invoices/export-csv" },
  ]);
  assert.deepEqual(paths, ["/api/mrp/stock-status", "/api/sales-orders"]);
  const opened = lc.analyseToolText("/api/production-orders", 'Fields hidden for this person: price, cost.\n{"data":[{"poNo":"x","quantity":1,"lineValueRm":5}]}', false);
  assert.equal(opened.outcome, "opened");
  assert.deepEqual(opened.hidden, ["price", "cost"]);
  assert.deepEqual(opened.kept, ["lineValueRm"]);
  assert.equal(opened.keptExpected, false);
  assert.equal(lc.analyseToolText("/api/payroll", "Not available to your role: you do not have read permission for payroll.", true).outcome, "refused");
  const admin = read("src/api/routes/mcp-admin.ts");
  const at = admin.indexOf('app.post("/admin/leak-check"');
  assert.match(admin.slice(at, at + 200), /const denied = requireSuperAdmin\(c\);/);
  assert.match(admin.slice(at), /\} finally \{\n\s+await revokeToken\(db, tok\.tokenId\);/);
});

// R&D finding #9 (2026-11-27): call rows are logged after the call, so every
// message in one batch saw the same old count.
test("rate limit: a batch is capped and the calls already made in this request count", async () => {
  const { MAX_BATCH, rateDecision, RATE_MINUTE_MESSAGE } = await import("../src/api/lib/mcp-limits.ts");
  assert.equal(MAX_BATCH, 10);
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /if \(msgs\.length > MAX_BATCH\) \{/);
  assert.match(mcp, /rateDecision\(n\.lastMinute \+ seen\.calls, n\.today \+ seen\.calls\)/);
  assert.match(mcp, /seen\.calls\+\+;\n\s+return reply\(await callTool\(/);
  // 29 logged + 1 already run in this request reaches the per-minute limit.
  assert.equal(rateDecision(29 + 1, 0), RATE_MINUTE_MESSAGE);
});
