// ---------------------------------------------------------------------------
// worker-announcement-acked-tag.test.mjs — HK-0155. The worker's only ack
// control is the one-time "Got it" popup. After it, the home list showed the
// notice with no button and no state, so the office read it as "received the
// notification but there is no acknowledge button". An acked notice on the
// home list now carries an "Acknowledged" tag, gated by the same predicate
// that drives the popup (so a reminded notice is NOT tagged).
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/pages/worker/index.tsx'), 'utf8').replace(/\r\n/g, '\n');
const dict = readFileSync(resolve(process.cwd(), 'src/lib/worker-i18n.ts'), 'utf8').replace(/\r\n/g, '\n');

test('home list tags a notice Acknowledged exactly when the popup would not show it', () => {
  assert.match(
    page,
    /\{!unackedAnnouncements\.includes\(a\) && \([\s\S]{0,400}?t\("home\.announcementAcknowledged"\)/,
  );
});

test('the Acknowledged tag exists in all four languages', () => {
  const block = dict.match(/'home\.announcementAcknowledged': \{\n([\s\S]*?)\n\s*\},/);
  assert.ok(block, 'home.announcementAcknowledged is missing from worker-i18n.ts');
  for (const lang of ['en', 'ms', 'zh', 'my']) {
    assert.match(block[1], new RegExp(`^\\s*${lang}: '.+',$`, 'm'), `${lang} is missing`);
  }
});
