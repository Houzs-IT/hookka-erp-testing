// meetings-unread.test.mjs — the Meetings count on the menus (src/lib/meetings-unread.ts, src/pages/m/nav.ts).
//   1. The count is read from the relay's { count } (or { data: { count } }) and is never negative or garbage.
//   2. The phone menus put it on the Meetings row only, capped at "99+", and show nothing at 0.
import test from "node:test";
import assert from "node:assert/strict";

const { meetingsCount } = await import("../src/lib/meetings-unread.ts");
const { withMeetingsBadge } = await import("../src/pages/m/nav.ts");

test("the count comes from the relay answer, never negative or garbage", () => {
  assert.equal(meetingsCount({ count: 3 }), 3);
  assert.equal(meetingsCount({ data: { count: 4 } }), 4);
  assert.equal(meetingsCount({ count: 0 }), 0);
  assert.equal(meetingsCount({ count: -1 }), 0);
  assert.equal(meetingsCount({ count: "x" }), 0);
  assert.equal(meetingsCount(null), 0);
});

test("the phone menus badge only the Meetings row", () => {
  const groups = [{ title: "System", items: [{ label: "Meetings", path: "/m/meetings" }, { label: "IT Support", path: "/m/it-support" }] }];
  const out = withMeetingsBadge(groups, 5);
  assert.equal(out[0].items[0].badge, 5);
  assert.equal(out[0].items[1].badge, undefined);
  assert.equal(withMeetingsBadge(groups, 120)[0].items[0].badge, "99+");
  assert.equal(withMeetingsBadge(groups, 0), groups);
});
