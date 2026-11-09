import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/pages/invoices/index.tsx", "utf8");

// Filtered / searched invoice lists used to ask limit=2000 with no page: the
// server clamps to 500, so matches past 500 never showed and Prev/Next changed
// the page number without changing the rows.
test("filtered and searched invoice lists are paged server-side", () => {
  assert.doesNotMatch(src, /\/api\/invoices\?[^`]*limit=2000/);
  assert.match(src, /`page=\$\{page\}&limit=\$\{PAGE_SIZE\}`/);
});

test("search keeps the status / customer / date filters", () => {
  assert.match(src, /filterQs,\s*\n?\s*gridSearch\.trim\(\) \? `search=/);
});

test("a new search starts from page 1", () => {
  assert.match(src, /\[filterStatus, filterCustomer, filterDateFrom, filterDateTo, gridSearch\]/);
});

test("the header count is the whole match count, not one page", () => {
  assert.match(src, /totalInvoicesServer\.toLocaleString\(\)\} matching/);
});
