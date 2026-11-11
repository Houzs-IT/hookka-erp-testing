// HK-0144: the Dashboard's overdue-order link opens Production Overview
// filtered to one sales order via `/production?soId=<SO no>-`. The Overview's
// SO ID filter is a case-insensitive substring match on the production order
// number (`<SO no>-NN`), so the value must catch every line of that SO and no
// other SO — including a 4-digit sequence that starts with the same digits.
import test from "node:test";
import assert from "node:assert/strict";
import { productionOverviewHref, overviewSoFilterFromSearch } from "../src/pages/production/utils.ts";

// Same predicate as the Overview's soId filter (src/pages/production/index.tsx).
const matches = (filter, poNo) => poNo.toLowerCase().includes(filter.toLowerCase());

test("link round-trips to a filter that selects exactly that SO's production orders", () => {
  const href = productionOverviewHref("SO-2609-100");
  assert.equal(href, "/production?soId=SO-2609-100-");
  const filter = overviewSoFilterFromSearch(href.slice(href.indexOf("?")));
  assert.equal(filter, "SO-2609-100-");
  assert.ok(matches(filter, "SO-2609-100-01"));
  assert.ok(matches(filter, "SO-2609-100-12"));
  assert.ok(!matches(filter, "SO-2609-1000-01"));
  assert.ok(!matches(filter, "SO-2609-101-01"));
});

test("no or blank soId param means no URL filter", () => {
  assert.equal(overviewSoFilterFromSearch(""), "");
  assert.equal(overviewSoFilterFromSearch("?other=1"), "");
  assert.equal(overviewSoFilterFromSearch("?soId=%20%20"), "");
  assert.equal(overviewSoFilterFromSearch("soId=+SO-2609-294-+"), "SO-2609-294-");
});
