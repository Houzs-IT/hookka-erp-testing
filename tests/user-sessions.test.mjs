// ---------------------------------------------------------------------------
// user-sessions.test.mjs — "Signed-in devices" (list / revoke own sessions).
//
// Hardening batch (owner-approved 2026-11-08). Exercises the real
// /api/auth/sessions sub-app (src/api/routes/auth-sessions.ts) and
// src/api/lib/user-sessions.ts against an in-memory user_sessions table.
// Pins the safety properties that matter:
//   * a user sees ONLY their own unexpired sessions, the current one flagged;
//   * the raw token is never sent to the browser;
//   * one user cannot end another user's session (404, row untouched);
//   * the current session cannot be ended from here (Sign Out does that);
//   * "sign out all others" keeps exactly the current session;
//   * the sign-in device stamp is best-effort — a DB failure never throws.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import sessionsApp from '../src/api/routes/auth-sessions.ts';
import {
  describeUserAgent,
  sessionPublicId,
  stampSessionDevice,
} from '../src/api/lib/user-sessions.ts';

const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

function makeDb(rows) {
  const db = {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) {
          args = a;
          return stmt;
        },
        async all() {
          if (/FROM user_sessions WHERE userId = \?/.test(sql)) {
            return { results: db.rows.filter((r) => r.userId === args[0]), success: true };
          }
          return { results: [], success: true };
        },
        async first() {
          return null;
        },
        async run() {
          if (/^ALTER TABLE/.test(sql)) return { success: true };
          const del = sql.match(/DELETE FROM user_sessions WHERE userId = \? AND token IN/);
          if (del) {
            const [userId, ...tokens] = args;
            db.rows = db.rows.filter((r) => !(r.userId === userId && tokens.includes(r.token)));
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return db;
}

function seed() {
  const now = Date.now();
  return [
    {
      token: 'tok-alice-laptop',
      userId: 'alice',
      createdAt: iso(now - 48 * HOUR),
      expiresAt: iso(now + 100 * HOUR),
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
      ip_address: '203.0.113.5',
      last_seen_at: iso(now - 1 * HOUR),
    },
    {
      token: 'tok-alice-phone',
      userId: 'alice',
      createdAt: iso(now - 24 * HOUR),
      expiresAt: iso(now + 100 * HOUR),
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ip_address: '198.51.100.7',
      last_seen_at: iso(now - 2 * HOUR),
    },
    {
      token: 'tok-alice-old',
      userId: 'alice',
      createdAt: iso(now - 400 * HOUR),
      expiresAt: iso(now - 1 * HOUR), // expired — must not be listed
      user_agent: null,
      ip_address: null,
      last_seen_at: null,
    },
    {
      token: 'tok-bob-desktop',
      userId: 'bob',
      createdAt: iso(now - 10 * HOUR),
      expiresAt: iso(now + 100 * HOUR),
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/131.0',
      ip_address: '192.0.2.9',
      last_seen_at: iso(now),
    },
  ];
}

function appAs(db, userId) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('DB', db);
    if (userId) {
      c.set('userId', userId);
      c.set('userRole', 'SALES');
    }
    await next();
  });
  app.route('/api/auth/sessions', sessionsApp);
  return app;
}

const ENV = {};
const req = (app, path, token, init = {}) =>
  app.request(
    path,
    { ...init, headers: { ...(token ? { cookie: `hookka_session=${token}` } : {}), ...(init.headers || {}) } },
    ENV,
  );

function quietly(fn) {
  return async () => {
    const w = console.warn;
    const e = console.error;
    console.warn = () => {};
    console.error = () => {};
    try {
      await fn();
    } finally {
      console.warn = w;
      console.error = e;
    }
  };
}

test('describeUserAgent gives a readable label', () => {
  assert.equal(describeUserAgent(seed()[0].user_agent), 'Chrome on Windows');
  assert.equal(describeUserAgent(seed()[1].user_agent), 'Safari on iPhone');
  assert.equal(describeUserAgent(seed()[3].user_agent), 'Firefox on Mac');
  assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130'), 'Edge on Windows');
  assert.equal(describeUserAgent(''), 'Unknown device');
  assert.equal(describeUserAgent(null), 'Unknown device');
});

test('sessionPublicId is a stable 32-hex hash that does not contain the token', async () => {
  const a = await sessionPublicId('tok-alice-laptop');
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, await sessionPublicId('tok-alice-laptop'));
  assert.notEqual(a, await sessionPublicId('tok-alice-phone'));
  assert.ok(!a.includes('tok'));
});

test(
  'GET lists only my unexpired sessions, current first, and never the raw token',
  quietly(async () => {
    const db = makeDb(seed());
    const res = await req(appAs(db, 'alice'), '/api/auth/sessions', 'tok-alice-phone');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('tok-'), 'raw session tokens must never be sent to the browser');
    const { success, data } = JSON.parse(text);
    assert.equal(success, true);
    assert.equal(data.length, 2, 'expired sessions and other users are excluded');
    assert.equal(data[0].current, true);
    assert.equal(data[0].device, 'Safari on iPhone');
    assert.equal(data[0].ipAddress, '198.51.100.7');
    assert.equal(data[1].current, false);
    assert.equal(data[1].device, 'Chrome on Windows');
    assert.ok(data[1].lastSeenAt && data[1].createdAt && data[1].expiresAt);
  }),
);

test(
  'GET without a signed-in user is 401',
  quietly(async () => {
    const res = await req(appAs(makeDb(seed()), null), '/api/auth/sessions', null);
    assert.equal(res.status, 401);
  }),
);

test(
  "DELETE cannot end another user's session (404, row untouched)",
  quietly(async () => {
    const db = makeDb(seed());
    const bobId = await sessionPublicId('tok-bob-desktop');
    const res = await req(appAs(db, 'alice'), `/api/auth/sessions/${bobId}`, 'tok-alice-phone', {
      method: 'DELETE',
    });
    assert.equal(res.status, 404);
    assert.ok(db.rows.some((r) => r.token === 'tok-bob-desktop'));
  }),
);

test(
  'DELETE refuses the current session and rejects malformed ids',
  quietly(async () => {
    const db = makeDb(seed());
    const app = appAs(db, 'alice');
    const mine = await sessionPublicId('tok-alice-phone');
    const res = await req(app, `/api/auth/sessions/${mine}`, 'tok-alice-phone', { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Sign Out/);
    assert.ok(db.rows.some((r) => r.token === 'tok-alice-phone'));
    const bad = await req(app, '/api/auth/sessions/tok-alice-laptop', 'tok-alice-phone', { method: 'DELETE' });
    assert.equal(bad.status, 404);
    assert.ok(db.rows.some((r) => r.token === 'tok-alice-laptop'));
  }),
);

test(
  'DELETE ends one of my other sessions',
  quietly(async () => {
    const db = makeDb(seed());
    const laptop = await sessionPublicId('tok-alice-laptop');
    const res = await req(appAs(db, 'alice'), `/api/auth/sessions/${laptop}`, 'tok-alice-phone', {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    assert.ok(!db.rows.some((r) => r.token === 'tok-alice-laptop'));
    assert.ok(db.rows.some((r) => r.token === 'tok-alice-phone'));
    assert.ok(db.rows.some((r) => r.token === 'tok-bob-desktop'));
  }),
);

test(
  'POST revoke-others keeps exactly the current session and leaves other users alone',
  quietly(async () => {
    const db = makeDb(seed());
    const res = await req(appAs(db, 'alice'), '/api/auth/sessions/revoke-others', 'tok-alice-phone', {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.revoked, 2); // laptop + the expired row
    assert.deepEqual(
      db.rows.filter((r) => r.userId === 'alice').map((r) => r.token),
      ['tok-alice-phone'],
    );
    assert.ok(db.rows.some((r) => r.token === 'tok-bob-desktop'));
  }),
);

test(
  'POST revoke-others without an identifiable session is refused (nothing deleted)',
  quietly(async () => {
    const db = makeDb(seed());
    const res = await req(appAs(db, 'alice'), '/api/auth/sessions/revoke-others', null, { method: 'POST' });
    assert.equal(res.status, 400);
    assert.equal(db.rows.length, 4);
  }),
);

test(
  'stampSessionDevice never throws, even when the database fails',
  quietly(async () => {
    const broken = {
      prepare() {
        throw new Error('connection reset');
      },
    };
    const app = new Hono();
    app.get('/', async (c) => {
      c.set('DB', broken);
      await stampSessionDevice(c, 'tok-x');
      return c.json({ ok: true });
    });
    const res = await app.request('/', { headers: { 'user-agent': 'UA' } }, ENV);
    assert.equal(res.status, 200);
  }),
);
