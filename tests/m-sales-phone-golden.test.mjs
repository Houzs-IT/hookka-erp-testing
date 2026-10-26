// The approved 390px phone Sales Order screens must not change while the tablet
// layouts are migrated. This server-renders the ENTRY screens in phone mode with
// fixture data and compares the markup fingerprint with the one captured from
// upstream/staging before the migration (tests/fixtures/m-sales-phone-golden.json).
// Fixture data only: it proves the phone DOM + inline styles are byte-identical for
// these order shapes, not that real orders render well, and not how it looks on a device.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderScreen, soFixture, withFrozenClock, GOLDEN_NOW } from "./_ssr-sales.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/m-sales-phone-golden.json", import.meta.url), "utf8"));
const fp = (html) => createHash("sha256").update(html).digest("hex").slice(0, 16);

const DETAIL = ["src/pages/m/screens/SalesDetailScreen.tsx", "SalesDetailScreen"];
const LIST = ["src/pages/m/screens/SalesScreen.tsx", "SalesScreen"];

const detailCases = {
  "detail-390-DRAFT": { width: 390, fixture: soFixture({ status: "DRAFT" }) },
  "detail-390-CONFIRMED": { width: 390, fixture: soFixture({ status: "CONFIRMED" }) },
  "detail-390-IN_PRODUCTION": { width: 390, fixture: soFixture({ status: "IN_PRODUCTION" }) },
  "detail-390-READY_TO_SHIP": { width: 390, fixture: soFixture({ status: "READY_TO_SHIP" }) },
  "detail-390-DELIVERED": { width: 390, fixture: soFixture({ status: "DELIVERED" }) },
  "detail-390-CANCELLED": { width: 390, fixture: soFixture({ status: "CANCELLED" }) },
  "detail-390-ON_HOLD": { width: 390, fixture: soFixture({ status: "ON_HOLD" }) },
  "detail-390-nonotes": { width: 390, fixture: soFixture({ notes: "" }) },
  "detail-390-longnotes": {
    width: 390,
    fixture: soFixture({ notes: "Line one.\nLine two with more text that goes on and on to exceed the clamp threshold for sure. ".repeat(3) }),
  },
  "detail-390-noitems": { width: 390, fixture: soFixture({ items: [] }) },
  "detail-600-CONFIRMED": { width: 600, fixture: soFixture({ status: "CONFIRMED" }) },
};

for (const [name, opts] of Object.entries(detailCases)) {
  test(`phone Sales Order detail is unchanged: ${name}`, async () => {
    const html = await withFrozenClock(GOLDEN_NOW, () => renderScreen(...DETAIL, opts));
    assert.equal(fp(html), golden.detail[name]);
  });
}

const listCases = {
  "list-390": { width: 390 },
  "list-390-empty": { width: 390, list: { success: true, data: [] } },
  "list-600": { width: 600 },
};

for (const [name, opts] of Object.entries(listCases)) {
  test(`phone Sales Orders list is unchanged: ${name}`, async () => {
    // Frozen clock: these screens show countdowns to Expected DD, which depend on today.
    const html = await withFrozenClock(GOLDEN_NOW, () => renderScreen(...LIST, { route: "/m/sales", routePath: "/m/sales", ...opts }));
    assert.equal(fp(html), golden.list[name]);
  });
}

test("the golden set covers every order status chip the list offers", () => {
  for (const st of ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "DELIVERED", "CANCELLED"]) {
    assert.ok(golden.detail[`detail-390-${st}`], st);
  }
});
