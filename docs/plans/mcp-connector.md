# Hookka ERP MCP connector — plan

> **Last verified: 2026-11-25** — v1 live (#1610); leak check on `feat/mcp-leak-check-main`.

Owner 2026-11-25: 「我的全套系统都要有mcp」, staff (non-IT) should ask Claude / ChatGPT
questions about the ERP the way the owner asks in this session; 「按员工自己的权限」 —
what a person cannot see in the ERP, the AI cannot see either; the owner must be able to
see who connected and what they asked.

## 1. What it is

A remote MCP server at `https://<erp host>/api/mcp` (Streamable HTTP, JSON-RPC, stateless).
Any MCP client that supports custom connectors with OAuth (Claude Team / Enterprise / Pro,
ChatGPT plans with connectors) adds that URL; the person signs in with **their own ERP
account**; every question is answered by calling the ERP's existing read endpoints **as that
person**, so the existing RBAC (`requirePermission`, per-user overrides, tenant scope,
customer scope) decides what comes back. Nothing is re-implemented, so the AI's figures are
the page's figures.

## 2. Rules (non-negotiable)

1. **Read-only.** An MCP token can only make `GET` requests (plus `POST /api/mcp` itself).
   Enforced in `auth-middleware.ts`, not in the tools, so no tool bug can write.
2. **Own permissions.** The token carries the user's identity; role / override changes apply
   on the next call; a deactivated user or a password reset kills every MCP token.
3. **Opt-in per person.** New resource `ai-connector` (held back from every wildcard, like
   `meeting-rooms`): only admins, or people ticked in the per-user permission editor, may
   connect.
4. **Everything logged.** Each tool call writes `mcp_calls` (who, which client, tool, path,
   status, ms, when). Admin page shows it.
5. **Revocable.** Admin can disconnect a person (all their tokens) or one connection; a person
   can disconnect themselves.
6. **No secrets through the AI.** Auth/session/user-admin/internal/cron/MCP endpoints are
   blocked from the generic reader even for admins.

## 3. Tools (v1)

| Tool | What | Backed by |
| --- | --- | --- |
| `list_modules` | The ERP's modules and the read endpoints in each, with a one-line meaning | curated catalog + `app.routes` (GET only, blocklist removed) |
| `erp_get` | Read any allowed endpoint (`path` + `query`) and return its JSON (trimmed to a safe size) | in-process `app.fetch` with the caller's MCP token |
| `search` | Global search across SO / customers / products / POs … | `GET /api/search` |
| `whoami` | Who I am connected as, my role, what I may read | `/api/auth/me/permissions` |

**Quick answers (2026-11-25, owner: "search 资料有点慢").** `sales_summary {period}` and
`production_summary {from, to}` answer the commonest questions in ONE call with a summary of a
few hundred characters (before: list_modules → list_endpoints → erp_get, and a 24–60k-character
reply). They read the same endpoints the Dashboard reads, as the person, through `readValue`, so
the module gate and redaction are unchanged. `erp_get` also takes `fields` to keep only the keys
needed, and its cap dropped to 30k. The instructions now tell the AI to try a quick answer first.

**More quick answers (2026-11-26):** `order_backlog` (sales-orders/stats + the Dashboard's production block: orders and RM by status, not yet delivered, backlog days, overdue by customer), `receivables_summary` (accounting/aging, AR only: owed by age, top debtors, oldest unpaid), `material_shortages` (mrp/plan: short materials soonest-needed first, BOM gaps). Same `readValue` path, so each is refused for a role that may not open its source page.

**search / fetch (2026-11-25).** ChatGPT outside Developer Mode only accepts a connector with a
`search` and a `fetch` tool, and deep research uses only those two
(https://developers.openai.com/api/docs/mcp). `search {query}` returns `{results:[{id,title,url}]}`
from `/api/search` (id = `<kind>:<row id>`); `fetch {id}` opens the record at the kind's detail
endpoint (`FETCH_API`) through `readValue`. **Prompts:** `prompts/list` offers three ready-made
questions (monthly sales review, production vs last month, find a document).

"The whole system" = every module's GET endpoints, through `erp_get`; the catalog tells the
model which endpoint answers which question (production revenue, department output, MRP /
stock status, orders, delivery, invoices, payroll for those allowed, …).

## 4. OAuth (what Claude / ChatGPT need)

- `/.well-known/oauth-protected-resource[/api/mcp]` and
  `/.well-known/oauth-authorization-server` (Pages Functions under `functions/.well-known/`).
- `POST /api/mcp/oauth/register` — dynamic client registration (public clients, PKCE).
- `GET /api/mcp/oauth/authorize` — uses the normal ERP login (redirects to `/login?next=…`),
  checks `ai-connector`, shows a consent page ("<client> will be able to READ Hookka ERP as
  <you>"), double-submit CSRF on Allow.
- `POST /api/mcp/oauth/token` — `authorization_code` (S256 PKCE) and rotating
  `refresh_token`. Access token `hkmcp_…` 24 h; refresh 90 days. Only SHA-256 hashes stored.
- Tables (runtime self-apply, snake_case): `mcp_oauth_clients`, `mcp_oauth_codes`,
  `mcp_tokens`, `mcp_calls`.

## 5. Admin + staff UI

`Settings › AI Connector` (`/settings/ai-connector`):
- the connector URL to copy + step-by-step "how to connect" for Claude and ChatGPT;
- admin: who is connected, which app, connected on, last used, calls; recent questions;
  Disconnect (one / all of a person);
- everyone else: their own connections + Disconnect.

## 6. Phases

1. **v1 (this branch):** server, OAuth, tools, logging, admin page, how-to. Verify end to end
   on prod with a real client before telling staff.
2. **v1.1:** richer catalog descriptions per module from what staff actually ask (read
   `mcp_calls`).
3. **Later, only if the owner asks:** any write tool (each one separately approved).

## 6b. Leak check (before any staff use)

`POST /api/mcp-admin/admin/leak-check` (Super Admin; `src/api/lib/mcp-leak-check.ts`, card on the AI Connector page): runs `tools/call erp_get` through the real `/api/mcp` as a chosen APPROVED staff account over every GET list endpoint of every readable module (side-effect-looking GETs skipped), 20 per request, 4 at a time, with a token issued for the run and revoked after. Reports only outcomes and field NAMES: opened / refused, the families hidden, and money / people keys still present (flagged unless the module is a money document). Never values.

## 7. Known limits / decisions

- A client's chat text stays on the AI vendor's side; we log only the ERP calls it made.
- Response size is trimmed (~60 KB per call); the model is told to narrow with query params.
- Binary endpoints (PDF / files) return a note, not bytes.
