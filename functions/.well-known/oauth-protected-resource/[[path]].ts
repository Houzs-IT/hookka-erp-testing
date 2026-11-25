// ---------------------------------------------------------------------------
// OAuth discovery for the Hookka ERP MCP connector (docs/plans/mcp-connector.md).
// Claude / ChatGPT look these up at the site ROOT (RFC 9728 / RFC 8414), which
// Pages would otherwise answer with the SPA shell. Scoped to this one path so
// it can never sit in front of /api/* or the app's deep links; the Hono app
// (src/api/worker.ts → routes/mcp.ts wellKnown) builds the JSON.
// ---------------------------------------------------------------------------
import app from "../../../src/api/worker";

export const onRequest: PagesFunction = async (ctx) => app.fetch(ctx.request, ctx.env, ctx);
