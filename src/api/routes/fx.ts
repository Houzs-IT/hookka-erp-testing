// ---------------------------------------------------------------------------
// /api/fx — Setup › Currency & FX (owner 2026-10-20 「要」; plan
// docs/superpowers/plans/2026-10-20-currency-fx.md). The currencies Finance
// keeps, each month's rate (1 unit = RM) and the accounts a realised FX
// difference posts to. Nothing here posts: a rate is the default a form fills
// in (each document keeps its own), the accounts are read when a payment
// posts. Reads: anyone who reads the books; writes: Finance / Super Admin,
// each one audited ("fx-settings").
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requireFinance, requirePermission } from "../lib/rbac";
import { emitAudit } from "../lib/audit";
import { getFxSettings, saveFxSettings } from "../lib/fx-settings";
import { normaliseCurrencyCode } from "../../lib/currency-code";
import { fxMissingFor, fxMonthsTo, fxNewCodeError, fxThisMonth, isFxYm, parseFxRate } from "../../lib/fx";

const app = new Hono<Env>();

// GET / — the settings, the six months the page shows (ending this month,
// Malaysia time) and the currencies with no rate for this month.
app.get("/", async (c) => {
  const denied = await requirePermission(c, "accounting", "read");
  if (denied) return denied;
  const s = await getFxSettings(c.var.DB);
  const thisMonth = fxThisMonth();
  return c.json({ success: true, data: { ...s, thisMonth, months: fxMonthsTo(thisMonth), missing: fxMissingFor(s, thisMonth) } });
});

// PUT /rate { currency, month: "YYYY-MM", rate } — one cell; rate null or ""
// clears it. Documents already keyed keep their own rate.
app.put("/rate", async (c) => {
  const denied = requireFinance(c);
  if (denied) return denied;
  try {
    const body = (await c.req.json().catch(() => ({}))) as { currency?: unknown; month?: unknown; rate?: unknown };
    const code = normaliseCurrencyCode(body.currency, "");
    const month = String(body.month ?? "");
    if (!isFxYm(month)) return c.json({ success: false, error: "month must be YYYY-MM" }, 400);
    const clearing = body.rate === null || body.rate === undefined || body.rate === "";
    const rate = clearing ? null : parseFxRate(body.rate);
    if (!clearing && rate === null) {
      return c.json({ success: false, error: "A rate is a number above 0 with at most six decimals (RM per 1 unit)" }, 400);
    }
    const s = await getFxSettings(c.var.DB);
    if (!s.currencies.some((x) => x.code === code)) return c.json({ success: false, error: `${code || "That currency"} is not on the list` }, 404);
    const before = s.rates[code]?.[month] ?? null;
    if (rate === null) {
      if (s.rates[code]) delete s.rates[code][month];
    } else {
      (s.rates[code] ??= {})[month] = rate;
    }
    await saveFxSettings(c.var.DB, s);
    await emitAudit(c, { resource: "fx-settings", resourceId: `${code} ${month}`, action: "update", before: { rate: before }, after: { rate } });
    return c.json({ success: true, data: { currency: code, month, rate } });
  } catch (err) {
    console.error("[PUT /fx/rate] failed:", err instanceof Error ? err.message : err);
    return c.json({ success: false, error: "Save failed" }, 400);
  }
});

// POST /currency { code, name } — add a currency to the list (no rates yet).
app.post("/currency", async (c) => {
  const denied = requireFinance(c);
  if (denied) return denied;
  try {
    const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
    const s = await getFxSettings(c.var.DB);
    const err = fxNewCodeError(s, body.code);
    if (err) return c.json({ success: false, error: err }, 400);
    const code = normaliseCurrencyCode(body.code, "");
    const name = String(body.name ?? "").trim().slice(0, 60);
    s.currencies.push({ code, name });
    await saveFxSettings(c.var.DB, s);
    await emitAudit(c, { resource: "fx-settings", resourceId: code, action: "create", after: { code, name } });
    return c.json({ success: true, data: { code, name } });
  } catch (err) {
    console.error("[POST /fx/currency] failed:", err instanceof Error ? err.message : err);
    return c.json({ success: false, error: "Save failed" }, 400);
  }
});

// DELETE /currency/:code — take a currency off the list with its monthly
// rates. Documents in that currency keep their own rate.
app.delete("/currency/:code", async (c) => {
  const denied = requireFinance(c);
  if (denied) return denied;
  try {
    const code = normaliseCurrencyCode(c.req.param("code"), "");
    const s = await getFxSettings(c.var.DB);
    const cur = s.currencies.find((x) => x.code === code);
    if (!cur) return c.json({ success: false, error: `${code || "That currency"} is not on the list` }, 404);
    const rates = s.rates[code] ?? {};
    s.currencies = s.currencies.filter((x) => x.code !== code);
    delete s.rates[code];
    await saveFxSettings(c.var.DB, s);
    await emitAudit(c, { resource: "fx-settings", resourceId: code, action: "delete", before: { ...cur, rates } });
    return c.json({ success: true, data: { code } });
  } catch (err) {
    console.error("[DELETE /fx/currency] failed:", err instanceof Error ? err.message : err);
    return c.json({ success: false, error: "Delete failed" }, 400);
  }
});

// PUT /accounts { gainAccount, lossAccount } — where a realised FX difference
// posts from now on (a gain credits the first, a loss debits the second).
// Each must be an active account that takes postings (not a parent).
app.put("/accounts", async (c) => {
  const denied = requireFinance(c);
  if (denied) return denied;
  try {
    const body = (await c.req.json().catch(() => ({}))) as { gainAccount?: unknown; lossAccount?: unknown };
    const gainAccount = String(body.gainAccount ?? "").trim();
    const lossAccount = String(body.lossAccount ?? "").trim();
    for (const [label, code] of [["Gain", gainAccount], ["Loss", lossAccount]] as const) {
      if (!code) return c.json({ success: false, error: `${label} account is required` }, 400);
      const row = await c.var.DB.prepare(
        `SELECT code, isActive,
                CASE WHEN EXISTS (SELECT 1 FROM chart_of_accounts k WHERE k.parentCode = chart_of_accounts.code) THEN 0 ELSE isPostable END AS is_postable
           FROM chart_of_accounts WHERE code = ?`,
      ).bind(code).first<Record<string, unknown>>();
      if (!row) return c.json({ success: false, error: `${label} account ${code} not found` }, 404);
      if (Number(row.isActive ?? row.is_active ?? 1) === 0) return c.json({ success: false, error: `${label} account ${code} is inactive` }, 400);
      if (Number(row.isPostable ?? row.is_postable ?? 1) === 0) return c.json({ success: false, error: `${label} account ${code} is a parent account — pick one that takes postings` }, 400);
    }
    const s = await getFxSettings(c.var.DB);
    const before = { gainAccount: s.gainAccount, lossAccount: s.lossAccount };
    s.gainAccount = gainAccount;
    s.lossAccount = lossAccount;
    await saveFxSettings(c.var.DB, s);
    await emitAudit(c, { resource: "fx-settings", resourceId: "accounts", action: "update", before, after: { gainAccount, lossAccount } });
    return c.json({ success: true, data: { gainAccount, lossAccount } });
  } catch (err) {
    console.error("[PUT /fx/accounts] failed:", err instanceof Error ? err.message : err);
    return c.json({ success: false, error: "Save failed" }, 400);
  }
});

export default app;
