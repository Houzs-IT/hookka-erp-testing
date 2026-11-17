import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// BUG-2026-11-17-530: finance figures kept in kv_config need the page's permission.
const src = readFileSync("src/api/routes/kv-config.ts", "utf8");

test("board report, P&L and forecast keys are gated before the read", () => {
  assert.match(src, /k\.startsWith\("board_report_"\), resource: "accounting"/);
  assert.match(src, /k\.startsWith\("pnl_"\), resource: "accounting"/);
  assert.match(src, /k === "forecast_pnl" \|\| k\.startsWith\("cashflow_forecast_"\), resource: "forecasts"/);
  const get = src.slice(src.indexOf('app.get("/:key"'));
  const gate = get.indexOf("requirePermission(c, gate.resource, \"read\")");
  const read = get.indexOf("SELECT key, value");
  assert.ok(gate > 0 && gate < read, "the permission check runs before the row is read");
});

test("settings keys the front end reads stay open", () => {
  const { GATED_KEYS } = { GATED_KEYS: [
    (k) => k.startsWith("board_report_"), (k) => k.startsWith("pnl_"),
    (k) => k === "forecast_pnl" || k.startsWith("cashflow_forecast_"),
  ] };
  for (const k of ["public_holidays", "variants-config", "org-letterhead", "gst_rate_pct", "finance_print_footer", "org-departments", "coa_stock_map", "daily-report-config"]) {
    assert.ok(!GATED_KEYS.some((t) => t(k)), k);
  }
  for (const k of ["board_report_cache:2026-10", "board_report_notes:2026-10", "forecast_pnl", "cashflow_forecast_inputs", "pnl_opening_prior_cum"]) {
    assert.ok(GATED_KEYS.some((t) => t(k)), k);
  }
});
