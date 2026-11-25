// The auto-sent log hides one-time sign-in links from non-admins (BUG-2026-11-26-560).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_LINK, maskLoginLinks } from "../src/api/lib/mail-outbox-mask.ts";

test("masks reset-password / accept-invite ?token= links and /reset/ /invite/ paths", () => {
  const t = "New password: https://erp.hookka.com/reset-password?token=xxxxxxxxxxxxxxxx — join: /accept-invite?token=yyyyyyyyyyyy and /invite/zzzzzzzzzzzz";
  const out = maskLoginLinks(t);
  assert.doesNotMatch(out, /x{16}|y{12}|z{12}/);
  assert.equal(out.split(HIDDEN_LINK).length - 1, 3);
});

test("leaves document links and empty bodies alone", () => {
  const t = "Your delivery order: https://erp.hookka.com/delivery/do-123";
  assert.equal(maskLoginLinks(t), t);
  assert.equal(maskLoginLinks(null), "");
});

test("the outbox endpoints mask for non-admins", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/api/routes/mail-center.ts", import.meta.url), "utf8");
  assert.match(src, /bodyText: scope\.isAdmin \? r\.bodyText \?\? "" : maskLoginLinks\(r\.bodyText\)/);
  assert.match(src, /bodyHtml: scope\.isAdmin \? r\.bodyHtml \?\? "" : maskLoginLinks\(r\.bodyHtml\)/);
  assert.match(src, /scope\.isAdmin \? s : maskLoginLinks\(s\)/);
});
