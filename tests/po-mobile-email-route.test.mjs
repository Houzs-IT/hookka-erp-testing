// ---------------------------------------------------------------------------
// po-mobile-email-route.test.mjs — HK-0113 follow-up.
//
// PR #1119 moved desktop "Email to Supplier" to the Mail Center composer and
// deleted POST /api/purchase-orders/:id/email. The phone PO screen kept
// calling it, so every tap failed. This pins: every `${url}/<action>` the
// phone PO screen calls is a real /:id/<action> route on purchase-orders.ts.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync('src/pages/m/screens/procurement/PoDetail.tsx', 'utf8');
const routes = readFileSync('src/api/routes/purchase-orders.ts', 'utf8');

test('phone PO screen only calls /:id/<action> routes that exist', () => {
  const called = [...screen.matchAll(/`\$\{url\}\/([a-z-]+)`/g)].map((m) => m[1]);
  assert.ok(called.includes('mark-emailed'), 'Email to Supplier stamps lastEmailedAt');
  for (const seg of called) {
    assert.match(routes, new RegExp(`app\\.(post|put|get|delete)\\("/:id/${seg}"`), `no route for /:id/${seg}`);
  }
});

test('phone Email to Supplier opens the Mail Center composer', () => {
  assert.match(screen, /ComposeDialog/);
  assert.doesNotMatch(screen, /\$\{url\}\/email`/);
});
