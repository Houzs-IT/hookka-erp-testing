// m-inventory-mobile.test.mjs — the rules behind the phone / tablet Inventory
// screens (Final Batch 5): src/pages/m/lib/inventory-lib.ts (pure) and source
// assertions over src/pages/m/screens/inventory/. Run with the repo's test
// runner: node --import tsx/esm --test tests/m-inventory-mobile.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  mergeFg, toDeltas, fgTone, fgSub, fgKpis, rmTone, rmKpis, toRm, minStockLabel, ageTone, ageLabel, wipAge, wipKpis, wipList, wipTitle,
  deptLabel, reasonLabel, tierLabel, fabricKpis, fabricTone, toFabric, toAdj, detailId, detailPath, parseDetailId, validateReduceQty,
  reduceBody, keyForIntent, classifyOutcome, URLS, SORTS, DEFAULT_SORT, sortFg, sortWip, sortRm, sortAdj, rmMoveLabel, ymdMY, dateLabel,
  signed, q2, chipsFromData, PRODUCT_CATEGORIES,
} from "../src/pages/m/lib/inventory-lib.ts";
import { mergeFgDeltas } from "../src/lib/fg-stock.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DIR = "src/pages/m/screens/inventory";
const FILES = readdirSync(new URL(`../${DIR}`, import.meta.url)).filter((f) => /\.tsx?$/.test(f));
const SRC = Object.fromEntries(FILES.map((f) => [f, read(`${DIR}/${f}`)]));
const ALL = Object.values(SRC).join("\n") + "\n" + read("src/pages/m/lib/inventory-lib.ts");
/** Source without // line comments (the file headers name what was dropped, on purpose). */
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

// ── Finished goods ───────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: "p1", code: "1013-(Q)", name: "ROMA (Q)", category: "BEDFRAME", sizeLabel: "5FT", baseModel: "1013", status: "ACTIVE" },
  { id: "p2", code: "5530-3S", name: "LUNA 3S", category: "SOFA", sizeLabel: "", baseModel: "5530", status: "ACTIVE" },
  { id: "p3", code: "ACC-1", name: "PILLOW", category: "ACCESSORY", sizeLabel: "45cm", baseModel: "", status: "INACTIVE" },
];
const ENV = {
  success: true,
  data: { counts: [{ id: "p1", stockQty: 6, reservedQty: 2 }, { id: "p2", stockQty: 0, reservedQty: 3 }], dyn: [{ id: "fg-dyn-x", code: "X-1", name: "CUSTOM", category: "BEDFRAME", stockQty: 1, reservedQty: 0 }] },
};

test("FG list = the catalogue with fg-stock counts merged by id (mergeFgDeltas); absent ids read 0 / 0; dyn rows appended", () => {
  const rows = mergeFg(PRODUCTS, toDeltas(ENV));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.id, r.stockQty, r.reservedQty, r.dyn]), [["p1", 6, 2, false], ["p2", 0, 3, false], ["p3", 0, 0, false], ["fg-dyn-x", 1, 0, true]]);
  const ref = mergeFgDeltas(PRODUCTS, toDeltas(ENV));
  assert.deepEqual(rows.map((r) => r.stockQty), ref.map((r) => r.stockQty));
  assert.deepEqual(toDeltas(null), { counts: [], dyn: [] });
});

test("FG never reads a quantity from /api/inventory (stockQty is null there) and never coerces a missing count to 0", () => {
  assert.doesNotMatch(ALL, /\/api\/inventory\?buckets/);
  assert.doesNotMatch(ALL, /stockQty \?\? 0/);
  assert.equal(URLS.fgStock, "/api/inventory/fg-stock");
});

test("FG tone: out of stock / all on draft DO / low (< 5) / in stock", () => {
  assert.deepEqual(fgTone({ stockQty: 0, reservedQty: 0 }), ["Out of stock", "bad"]);
  assert.deepEqual(fgTone({ stockQty: 0, reservedQty: 2 }), ["All on draft DO", "warn"]);
  assert.deepEqual(fgTone({ stockQty: 4, reservedQty: 0 }), ["Low stock", "warn"]);
  assert.deepEqual(fgTone({ stockQty: 5, reservedQty: 0 }), ["In stock", "ok"]);
  const [p1, p2] = mergeFg(PRODUCTS, toDeltas(ENV));
  assert.equal(fgSub(p1), "Bedframe · 5FT");
  assert.equal(fgSub(p2), "Sofa · 5530");
});

test("FG KPIs: SKUs, available / on draft DO totals, bedframe and sofa counts", () => {
  assert.deepEqual(fgKpis(mergeFg(PRODUCTS, toDeltas(ENV))), { total: 4, available: 7, draft: 5, bedframe: 2, sofa: 1 });
});

test("wording: the draft-DO figure is never called 'Reserved'; the breakdown's SO-claimed count is never shown as On draft DO", () => {
  for (const [f, s] of Object.entries(SRC)) {
    assert.doesNotMatch(s.replace(/\/\/.*$/gm, ""), /["'`>]Reserved/, `${f} labels something "Reserved"`);
  }
  assert.doesNotMatch(SRC["FgDetail.tsx"], /assignedQty|freeQty/, "FG detail must not render the breakdown's assigned / free pieces");
  assert.match(SRC["FgDetail.tsx"], /l: "Pieces on hand", v: h\?\.totalQty/);
  assert.match(SRC["FgDetail.tsx"], /l: "On draft DO", v: row \? `\$\{q2\(row\.reservedQty\)\} pcs`/);
});

test("FG card has no age, and FG / RM have no date sorts (no list source)", () => {
  assert.deepEqual(SORTS.fg.map((s) => s.k), ["code", "codeD", "name", "nameD", "availA"]);
  assert.deepEqual(SORTS.rm.map((s) => s.k), ["code", "codeD", "name", "qtyA"]);
  assert.equal(DEFAULT_SORT.fg, "code");
  const fgCard = SRC["InventoryScreen.tsx"].slice(SRC["InventoryScreen.tsx"].indexOf('if (active === "fg") {\n      const f'), SRC["InventoryScreen.tsx"].indexOf('if (active === "wip") {\n      const w'));
  assert.doesNotMatch(fgCard, /age|FIFO/i);
});

// ── WIP ──────────────────────────────────────────────────────────────────────
const WIP_ENV = {
  data: [
    { id: "w1", wipCode: "A", wipType: "Headboard", category: "BEDFRAME", completedBy: "WOOD_CUT", relatedProduct: "1013-(Q)", totalQty: 12, oldestAgeDays: 9, sources: [{ poCode: "PO-1", quantity: 12, ageDays: 9 }] },
    { id: "w2", wipCode: "B", wipType: "Cushion", category: "SOFA", completedBy: "PENDING", relatedProduct: "5530-3S-LUNA", totalQty: -2, oldestAgeDays: null, sources: [] },
    { id: "w3", wipCode: "C", wipType: "Frame", category: "ACCESSORY", completedBy: "FRAMING", relatedProduct: "ACC-1", totalQty: 5, oldestAgeDays: 16, sources: [] },
    { id: "w4", wipCode: "D", wipType: "SET", category: "SOFA", completedBy: "UPHOLSTERY", relatedProduct: "X", totalQty: 2, oldestAgeDays: 2, sources: [] },
  ],
};
test("WIP: SET rows dropped, KPIs exclude null ages, negative rows have no age, SOFA title rule, dept labels", () => {
  const L = wipList(WIP_ENV);
  assert.deepEqual(L.map((w) => w.id), ["w1", "w2", "w3"]);
  assert.deepEqual(wipKpis(L), { total: 3, qty: 15, oldest: 16, over7: 2 });
  assert.equal(wipAge(L[1]), null);
  assert.equal(wipAge({ totalQty: -1, oldestAgeDays: 4 }), null);
  assert.equal(wipTitle(L[1]), "5530");
  assert.equal(wipTitle(L[0]), "1013-(Q)");
  assert.equal(deptLabel("FAB_CUT"), "Fabric Cutting");
  assert.equal(deptLabel("FOAM"), "Foam Bonding");
  assert.equal(deptLabel("PENDING"), "Pending");
  assert.deepEqual(PRODUCT_CATEGORIES, ["BEDFRAME", "SOFA", "ACCESSORY"], "WIP chips include ACCESSORY");
  assert.deepEqual(sortWip(L, "oldest").map((w) => w.id), ["w3", "w1", "w2"]);
});

test("ages: Today / 1 day / N days; > 7 warn, > 14 danger", () => {
  assert.equal(ageLabel(0), "Today");
  assert.equal(ageLabel(1), "1 day");
  assert.equal(ageLabel(9), "9 days");
  assert.equal(ageLabel(null), "—");
  assert.equal(ageTone(7), "neu");
  assert.equal(ageTone(8), "warn");
  assert.equal(ageTone(15), "bad");
});

test("WIP detail drops the invented parts breakdown and worker names; history is minutes", () => {
  const s = SRC["WipDetail.tsx"];
  assert.doesNotMatch(s, /part A|parts|by \$\{/i);
  assert.match(s, /`\$\{q2\(m\.qty\)\} min`/);
  assert.match(s, /Minute entries are labour time logged on job cards/);
  assert.match(s, /useBreakdown\("WIP", row \? row\.wipCode : null\)/, "the WIP breakdown is keyed by the WIP code");
});

// ── Raw materials ────────────────────────────────────────────────────────────
test("RM tone, KPIs (low = 0 < qty < 5), min stock 'Not set', movement labels", () => {
  const L = [toRm({ id: "rm-1", itemCode: "A", itemGroup: "F", balanceQty: 0 }), toRm({ id: "rm-2", itemCode: "B", itemGroup: "F", balanceQty: 4.5, minStock: 10, baseUOM: "MTR" }), toRm({ id: "rm-3", itemCode: "C", itemGroup: "T", balanceQty: 5 })];
  assert.deepEqual(rmTone(L[0]), ["Zero stock", "bad"]);
  assert.deepEqual(rmTone(L[1]), ["Low stock", "warn"]);
  assert.deepEqual(rmTone(L[2]), ["In stock", "ok"]);
  assert.deepEqual(rmKpis(L), { total: 3, groups: 2, low: 1, zero: 1 });
  assert.equal(minStockLabel(L[0]), "Not set");
  assert.equal(minStockLabel(L[1]), "10 MTR");
  assert.equal(rmMoveLabel({ direction: "IN", type: "RM_RECEIPT" }), "Received");
  assert.equal(rmMoveLabel({ direction: "OUT", type: "RM_ISSUE" }), "Issued to production");
  assert.equal(rmMoveLabel({ direction: "OUT", type: "ADJUSTMENT" }), "Adjustment");
  assert.deepEqual(sortRm(L, "qtyA").map((r) => r.id), ["rm-1", "rm-2", "rm-3"]);
});

test("RM suppliers are queried by ITEM CODE (bindings are keyed by materialCode), never by the RM id", () => {
  assert.equal(URLS.suppliers("PC151-01"), "/api/supplier-materials?materialCode=PC151-01");
  assert.match(SRC["RmDetail.tsx"], /URLS\.suppliers\(rm\.itemCode\)/);
  assert.doesNotMatch(SRC["RmDetail.tsx"], /URLS\.suppliers\(id\)/);
});

// ── Fabrics / adjustments ────────────────────────────────────────────────────
test("fabrics: tiers PRICE_n → n with the desktop fallback, real category codes, KPIs, shortage tone", () => {
  const f = toFabric({ fabricCode: "PC151-01", fabricCategory: "S-FABR", priceTier: "PRICE_1", sofaPriceTier: "PRICE_2", bedframePriceTier: null, soh: 10.5, shortage: -3 });
  assert.equal(tierLabel(f.sofaPriceTier, f.priceTier), "2");
  assert.equal(tierLabel(f.bedframePriceTier, f.priceTier), "1");
  assert.equal(tierLabel("", ""), "2");
  assert.deepEqual(fabricTone(f), ["Under-provisioned", "bad"]);
  assert.deepEqual(fabricKpis([f, toFabric({ soh: 2.25 })]), { total: 2, soh: 12.75 });
  assert.deepEqual(chipsFromData(["S-FABR", "B.M-FABR", "S-FABR", ""]), ["B.M-FABR", "S-FABR"]);
  assert.doesNotMatch(ALL, /Tier [ABC]|Velvet|Linen/);
});

test("adjustments: reason labels, newest first, the case id is not shown as a case number", () => {
  assert.equal(reasonLabel("SERVICE_REPLACEMENT"), "Service top-up");
  assert.equal(reasonLabel("COUNT_CORRECTION"), "Count Corr.");
  assert.equal(reasonLabel("WRITE_OFF"), "Write-Off");
  const L = [toAdj({ id: "1", adjNo: "ADJ-1", adjustedAt: "2026-11-01T00:00:00Z" }), toAdj({ id: "2", adjNo: "", adjustedAt: "2026-11-20T00:00:00Z" })];
  assert.deepEqual(sortAdj(L, "new").map((a) => a.id), ["2", "1"]);
  assert.deepEqual(sortAdj(L, "old").map((a) => a.id), ["1", "2"]);
  assert.match(SRC["InfoSheets.tsx"], /Linked service case/);
  assert.doesNotMatch(SRC["InfoSheets.tsx"], /SC-\d/);
});

test("dates are Malaysian calendar days; signed quantities use a real minus", () => {
  assert.equal(ymdMY("2026-11-26T17:30:00.000Z"), "2026-11-27");
  assert.equal(dateLabel("2026-11-26"), "26 Nov 2026");
  assert.equal(signed(-2.5), "−2.50");
  assert.equal(signed(4), "+4");
  assert.equal(q2(182.5), "182.50");
});

// ── Routes ───────────────────────────────────────────────────────────────────
test("detail ids: fg.<id>, wip.<id>, RM keeps its own id (old links keep working); one encoded segment", () => {
  assert.equal(detailId({ kind: "fg", id: "prod-1" }), "fg.prod-1");
  assert.equal(detailId({ kind: "rm", id: "rm-4410" }), "rm-4410");
  assert.equal(detailPath({ kind: "wip", id: 'w 1"' }), "/m/inventory/wip.w%201%22");
  for (const ref of [{ kind: "fg", id: "fg-dyn-po-1" }, { kind: "wip", id: "wip-dyn-31" }, { kind: "rm", id: "rm-4410" }]) {
    assert.deepEqual(parseDetailId(detailId(ref)), ref);
  }
});

test("MobileLayout routes /m/inventory and /m/inventory/:id to these screens and keeps inventoryConfig", () => {
  const ml = read("src/pages/m/MobileLayout.tsx");
  assert.match(ml, /inventory: InventoryRoute/);
  assert.match(ml, /inventory: InventoryDetailRoute/);
  assert.match(read("src/pages/m/config/modules.ts"), /^\s+inventoryConfig,$/m);
});

// ── Reduce stock ─────────────────────────────────────────────────────────────
test("reduce: validation messages (empty, NaN, negative, zero, too many decimals, above balance)", () => {
  assert.equal(validateReduceQty("", 10, "PCS"), "Enter a quantity above 0.");
  assert.equal(validateReduceQty("abc", 10, "PCS"), "Enter a number.");
  assert.equal(validateReduceQty("-1", 10, "PCS"), "Quantity can't be negative.");
  assert.equal(validateReduceQty("0", 10, "PCS"), "Enter a quantity above 0.");
  assert.equal(validateReduceQty("1.23456", 10, "MTR"), "Use at most 4 decimal places.");
  assert.equal(validateReduceQty("12", 10.5, "MTR"), "You can remove up to 10.50 MTR.");
  assert.equal(validateReduceQty("2.5", 10, "MTR"), "");
});

test("reduce: the body is desktop's contract — RM, negative delta, enum reason, unitCostSen 0, adjuster sent", () => {
  const body = reduceBody({ itemId: "rm-1", qty: 2.5, reason: "DAMAGED", notes: "  wet ", user: { id: "usr-001", displayName: "Aisyah", email: "a@x" } });
  assert.deepEqual(body, { type: "RM", itemId: "rm-1", qtyDelta: -2.5, unitCostSen: 0, reason: "DAMAGED", notes: "wet", adjustedBy: "usr-001", adjustedByName: "Aisyah" });
  assert.equal(reduceBody({ itemId: "x", qty: 1, reason: "WRITE_OFF", notes: "", user: { id: "u", displayName: "", email: "e@x" } }).adjustedByName, "e@x");
  assert.equal(reduceBody({ itemId: "x", qty: 1, reason: "WRITE_OFF", notes: "", user: null }).notes, null);
  assert.match(read("src/pages/inventory/adjustments.tsx"), /adjustedByName: user\?\.displayName \?\? user\?\.email \?\? null/, "desktop still sends the adjuster this way");
});

test("reduce: one Idempotency-Key per intent — the same body reuses it, a changed body mints a new one", () => {
  let n = 0;
  const mint = () => `k${++n}`;
  const b1 = { a: 1 };
  const k1 = keyForIntent(null, b1, mint);
  assert.equal(keyForIntent(k1, { a: 1 }, mint).key, "k1");
  assert.equal(keyForIntent(k1, { a: 2 }, mint).key, "k2");
});

test("reduce: outcome — 2xx ok, definite 4xx shown verbatim, anything unclear is UNCERTAIN (no immediate resubmit)", () => {
  assert.deepEqual(classifyOutcome(201, { success: true, data: { adjNo: "ADJ-2611-059" } }), { kind: "ok", adjNo: "ADJ-2611-059" });
  const below = "Cannot subtract 9 — only 3 currently on hand for PLY-18-48.";
  assert.deepEqual(classifyOutcome(409, { success: false, error: below }), { kind: "rejected", status: 409, error: below });
  assert.equal(classifyOutcome(400, { success: false, error: "qtyDelta must be non-zero" }).error, "qtyDelta must be non-zero");
  assert.equal(classifyOutcome(403, { success: false, error: "Forbidden" }).kind, "rejected");
  assert.equal(classifyOutcome(409, { success: false, error: "in flight", inFlight: true }).kind, "uncertain");
  assert.equal(classifyOutcome(0, null).kind, "uncertain");
  assert.equal(classifyOutcome(500, null).kind, "uncertain");
  assert.equal(classifyOutcome(500, { success: false, error: "Failed to reload after insert" }).kind, "uncertain");
  assert.equal(classifyOutcome(201, null).kind, "uncertain");
});

test("reduce sheet: in-flight guard, header key from the intent, uncertain → re-read the balance first, success → re-read (never computed)", () => {
  const s = SRC["ReduceStockSheet.tsx"];
  assert.match(s, /if \(inflight\.current \|\| err\) return;/);
  assert.match(s, /key\.current = keyForIntent\(key\.current, body, mintKey\)/);
  assert.match(s, /"Idempotency-Key": key\.current\.key/);
  assert.match(s, /\} else \{\n\s+setMsg\(out\.error\);\n\s+await refreshBalance\(\);\n\s+setStep\("uncertain"\);/);
  assert.match(s, /if \(out\.kind === "ok"\) \{\n\s+const fresh = await readBalance\(rm\.id\);/);
  assert.match(s, /primaryL = "Check again"/, "no resubmit until the balance could be re-read");
  assert.match(s, /disabled=\{locked\}/);
  assert.match(s, /getCurrentUser\(\)/);
  assert.doesNotMatch(s, /uuid\(\)/);
});

test("reduce is gated on inventory:create; every flag is false while permissions load", () => {
  const d = SRC["inv-data.ts"];
  assert.match(d, /reduce: module && can\("inventory", "create"\)/);
  assert.match(d, /if \(loading\) return \{ loading, module: false, fabrics: false, adjustments: false, reduce: false \};/);
  assert.match(d, /isNavAllowed\("\/inventory"\)/);
  assert.match(d, /isNavAllowed\("\/inventory\/fabrics"\) && can\("fabrics", "read"\)/);
  assert.match(d, /isNavAllowed\("\/inventory\/adjustments"\) && can\("stock-movements", "read"\)/);
  assert.match(SRC["RmDetail.tsx"], /perms\.reduce \?/);
  assert.match(SRC["RmDetail.tsx"], /Reducing stock needs inventory edit access/);
});

// ── Guards shared with the rest of /m ─────────────────────────────────────────
test("no money anywhere (owner S-2): no price, cost or value fields, no currency formatting", () => {
  for (const [f, s] of Object.entries(SRC)) {
    assert.doesNotMatch(code(s), /unitPrice|unitCostSen|valueSen|estUnitCostSen|estTotalValueSen|laborPostedSen|formatCurrency|formatRM|roundSen|"RM "/, f);
  }
});

test("dropped prototype actions stay dropped: no Add FG, Batch Import or Export", () => {
  assert.doesNotMatch(code(ALL), /Add FG|Batch Import|Export \(|Add finished good/);
});

test("folder guards: no fixed layers, no viewport widths, no native confirm, no 'not found' copy, no UTC today", () => {
  for (const [f, s] of Object.entries(SRC)) {
    assert.doesNotMatch(s, /position:\s*"fixed"/, `${f}: use ResponsiveActionDock / the shared sheets`);
    assert.doesNotMatch(s, /100vw/, f);
    assert.doesNotMatch(s, /\bconfirm\(/, f);
    assert.doesNotMatch(s, /not found/i, `${f}: only a real 404 may say "not found"`);
    assert.doesNotMatch(s, /new Date\(\)\.toISOString\(\)\.slice/, f);
  }
  assert.match(SRC["inv-detail.tsx"], /b\.failure\?\.kind === "notFound"/, "the breakdown 404 is told apart from a failure");
});

test("loading / failure / empty are separate states on every list (C15)", () => {
  const s = SRC["InventoryScreen.tsx"];
  const order = ["perms.loading", "restricted", "cur.denied", "cur.failed", "cur.loading", "!total", "!view.length"].map((k) => s.indexOf(`if (${k})`) === -1 ? s.indexOf(`else if (${k})`) : s.indexOf(`if (${k})`));
  assert.ok(order.every((i) => i > -1), String(order));
  assert.match(s, /title="Couldn't load inventory"/);
  assert.match(s, /title="You can't see inventory"/);
});
