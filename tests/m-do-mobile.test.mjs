// m-do-mobile.test.mjs — the rules behind the PHONE Delivery screens
// (src/pages/m/lib/do-mobile.ts). Each rule is a copy of desktop behaviour, so
// every block asserts the phone answer AND that the desktop source still says
// the same thing (src/pages/delivery/index.tsx, detail.tsx, POD-dialog.tsx,
// and the server's VALID_TRANSITIONS).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DELIVERY_TABS, TAB_DO_STATUSES, DO_STATUS_LABEL, doStatusLabel, tabForStatus, doBrowseUrl, doSearchUrl,
  tabCounts, DO_SEARCH_KEYS, PO_SEARCH_KEYS, matchesSearch, salesOrderNos, searchJumpTab,
  doDetailActions, ACTION_TARGET, acceptedAfter, actionConfirmLines, bulkConfirmLines,
  calculateOverdueDays, overdueBadgeDays, timeline,
  POD_MAX_PHOTOS, POD_MAX_JSON_BYTES, podCanSubmit, podSizeError, podOversizeFileError,
  poSelectable, setStatusLabel, oneCustomerError, buildDrops, createDoBody, plFirstBody, EMPTY_CREATE_FORM,
  estDeliveryCostSen, plFirstCostSen, bulkEligible, plNoneEligibleMessage, plStatusCounts,
  fmtDate, fmtShort, totalQty, totalM3, m3,
} from "../src/pages/m/lib/do-mobile.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const LIST = read("src/pages/delivery/index.tsx");
const DETAIL = read("src/pages/delivery/detail.tsx");
const POD = read("src/components/delivery/POD-dialog.tsx");
const HELPERS = read("src/api/routes/delivery-orders/_helpers.ts");

test("tabs and status buckets are desktop's ALL_TABS / TAB_DO_STATUSES", () => {
  assert.deepEqual(
    DELIVERY_TABS.map((t) => t.key),
    ["planning", "pending_delivery", "pending_dispatch", "dispatched", "delivered", "cancelled", "packing_list"],
  );
  for (const t of DELIVERY_TABS) assert.ok(LIST.includes(`{ key: "${t.key}", label: "${t.label}" }`), t.key);
  assert.deepEqual(TAB_DO_STATUSES, {
    pending_dispatch: ["DRAFT"],
    dispatched: ["LOADED", "IN_TRANSIT"],
    delivered: ["DELIVERED", "INVOICED"],
    cancelled: ["CANCELLED"],
  });
  assert.match(LIST, /pending_dispatch: \["DRAFT"\]/);
  assert.match(LIST, /dispatched: \["LOADED", "IN_TRANSIT"\]/);
  assert.match(LIST, /delivered: \["DELIVERED", "INVOICED"\]/);
  assert.match(LIST, /cancelled: \["CANCELLED"\]/);
  assert.equal(tabForStatus("IN_TRANSIT"), "dispatched");
  assert.equal(tabForStatus("INVOICED"), "delivered");
  assert.equal(tabForStatus("DISPATCHED"), null);
});

test("status labels are desktop STATUS_LABEL (no DISPATCHED / SIGNED)", () => {
  for (const [k, v] of Object.entries(DO_STATUS_LABEL)) assert.ok(LIST.includes(`${k}: "${v}"`), k);
  assert.equal(doStatusLabel("LOADED"), "Dispatched");
  assert.equal(doStatusLabel("DRAFT"), "Pending Dispatch");
  assert.ok(!("DISPATCHED" in DO_STATUS_LABEL));
  assert.ok(!("SIGNED" in DO_STATUS_LABEL));
});

test("per-tab browse URL is desktop doBrowseUrl", () => {
  assert.equal(doBrowseUrl("pending_dispatch", 1), "/api/delivery-orders?page=1&limit=50&status=DRAFT");
  assert.equal(doBrowseUrl("dispatched", 2), "/api/delivery-orders?page=2&limit=50&status=LOADED,IN_TRANSIT");
  assert.equal(doBrowseUrl("packing_list", 3), "/api/delivery-orders?page=1&limit=200&status=DRAFT,LOADED,IN_TRANSIT");
  assert.equal(doBrowseUrl("planning", 1), null);
  assert.ok(LIST.includes('"/api/delivery-orders?page=1&limit=200&status=DRAFT,LOADED,IN_TRANSIT"'));
  assert.equal(doSearchUrl("  "), null);
  assert.equal(doSearchUrl("SO 1"), "/api/delivery-orders?search=SO%201&limit=2000");
  assert.match(LIST, /\/api\/delivery-orders\?search=\$\{encodeURIComponent\(doServerSearch\)\}&limit=2000/);
});

test("tab counts come from whole-table sources, never the loaded page", () => {
  const c = tabCounts({
    byStatus: { DRAFT: 4, LOADED: 2, IN_TRANSIT: 1, DELIVERED: 5, INVOICED: 7, CANCELLED: 1 },
    planning: 9, ready: 3, packingLists: 2,
  });
  assert.deepEqual(c, {
    planning: 9, pending_delivery: 3, pending_dispatch: 4, dispatched: 3, delivered: 12, cancelled: 1, packing_list: 2,
  });
  assert.equal(tabCounts({}).delivered, 0);
});

test("search keys are desktop's alwaysSearchKeys", () => {
  for (const k of DO_SEARCH_KEYS) assert.ok(LIST.includes(`"${k}"`), k);
  for (const k of PO_SEARCH_KEYS) assert.ok(LIST.includes(`"${k}"`), k);
  assert.ok(matchesSearch({ poNo: "SO-2610-030-01" }, PO_SEARCH_KEYS, "030-01"));
  assert.ok(!matchesSearch({ productName: "Harbour" }, PO_SEARCH_KEYS, "harbour"));
  assert.equal(salesOrderNos({ items: [{ salesOrderNo: "SO-1" }, { salesOrderNo: "SO-2" }, { salesOrderNo: "SO-1" }] }), "SO-1, SO-2");
  assert.equal(salesOrderNos({ companySO: "SO-9", items: [] }), "SO-9");
  assert.equal(searchJumpTab(["delivered", "delivered"]), "delivered");
  assert.equal(searchJumpTab(["delivered", "dispatched"]), null);
});

test("detail actions follow desktop STATUS_FLOW and its extra buttons", () => {
  const a = (st, inc = false, pod = false) => doDetailActions(st, inc, pod);
  assert.deepEqual([a("DRAFT").primary?.key, a("DRAFT").secondary], ["LOAD", null]);
  assert.deepEqual([a("LOADED").primary?.key, a("LOADED").secondary?.key], ["DISPATCH", "DELIVER"]);
  assert.equal(a("IN_TRANSIT").primary?.key, "DELIVER");
  assert.equal(a("DELIVERED", true).primary?.key, "RESOLVE");
  assert.equal(a("DELIVERED", false).primary?.key, "CONVERT_INVOICE");
  assert.equal(a("INVOICED").primary, null);
  assert.equal(a("CANCELLED").primary, null);
  // Desktop labels.
  assert.match(DETAIL, /DRAFT: \{ next: "LOADED", label: "Load & Generate DO"/);
  assert.match(DETAIL, /LOADED: \{ next: "IN_TRANSIT", label: "Dispatch"/);
  assert.match(DETAIL, /IN_TRANSIT: \{ next: "DELIVERED", label: "Mark Delivered"/);
  // Lorry: DRAFT / LOADED only. POD: LOADED / IN_TRANSIT / DELIVERED without one.
  assert.deepEqual(["DRAFT", "LOADED", "IN_TRANSIT", "DELIVERED"].map((st) => a(st).canAssignLorry), [true, true, false, false]);
  assert.deepEqual(["DRAFT", "LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"].map((st) => a(st).canCapturePod), [false, true, true, true, false]);
  assert.equal(a("DELIVERED", false, true).canCapturePod, false);
  assert.deepEqual(["DELIVERED", "INVOICED", "LOADED"].map((st) => a(st).canConvertToReturn), [true, true, false]);
});

test("every action target is an edge the server allows", () => {
  const edges = {
    LOAD: ["DRAFT", "LOADED"],
    DISPATCH: ["LOADED", "IN_TRANSIT"],
    DELIVER: ["IN_TRANSIT", "DELIVERED"],
    CONVERT_INVOICE: ["DELIVERED", "INVOICED"],
  };
  for (const [key, [from, to]] of Object.entries(edges)) {
    assert.equal(ACTION_TARGET[key], to);
    const line = HELPERS.match(new RegExp(`\\n  ${from}: \\[([^\\]]*)\\]`))?.[1] ?? "";
    assert.ok(line.includes(`"${to}"`), `${from} → ${to}`);
  }
  assert.match(HELPERS, /\n  LOADED: \[[^\]]*"DELIVERED"/);
  assert.deepEqual(acceptedAfter("DELIVERED"), ["DELIVERED", "INVOICED"]);
  assert.deepEqual(acceptedAfter("LOADED"), ["LOADED"]);
});

test("Convert to Invoice copy says it is a status update, not a new invoice", () => {
  const lines = actionConfirmLines("CONVERT_INVOICE").map((l) => l.text).join(" ");
  assert.match(lines, /status to Invoiced/);
  assert.match(lines, /does not create an invoice/);
  // The server agrees: the flip is bare, and refused while paperwork is open.
  assert.match(HELPERS, /DELIVERED → INVOICED is a bare status flip that does NOT create an\s+\/\/ invoice row/);
  assert.match(HELPERS, /body\.status === "INVOICED" && wasIncomplete/);
  assert.ok(!/creates the (sales )?invoice from/i.test(lines));
});

test("overdue is desktop calculateOverdueDays on deliveryDate", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  assert.equal(calculateOverdueDays("2026-10-18", null, now), 2);
  assert.equal(calculateOverdueDays("2026-10-25", null, now), -5);
  assert.equal(calculateOverdueDays("", null, now), 0);
  assert.equal(calculateOverdueDays("2026-10-10", "2026-10-13T12:00:00Z", now), 3);
  assert.equal(overdueBadgeDays({ status: "LOADED", deliveryDate: "2026-10-18" }, now), 2);
  assert.equal(overdueBadgeDays({ status: "DELIVERED", deliveryDate: "2026-10-01" }, now), 0);
  assert.equal(overdueBadgeDays({ status: "INVOICED", deliveryDate: "2026-10-01" }, now), 0);
  // Mobile presentation rule (owner 2026-10-20): Cancelled shows no overdue.
  assert.equal(overdueBadgeDays({ status: "CANCELLED", deliveryDate: "2026-10-01" }, now), 0);
  // …while the shared count itself (desktop's) is untouched.
  assert.equal(calculateOverdueDays("2026-10-01", null, now), 19);
  // Expected DD is not the rule.
  assert.equal(overdueBadgeDays({ status: "DRAFT", deliveryDate: "2026-10-30", hookkaExpectedDD: "2026-10-01" }, now), 0);
  assert.match(DETAIL, /function calculateOverdueDays\(deliveryDate: string, deliveredAt: string \| null\)/);
  assert.match(DETAIL, /overdueDays > 0 && order\.status !== "DELIVERED" && order\.status !== "INVOICED"/);
});

test("timeline: five forward steps with desktop's timestamps; Cancelled has none", () => {
  const t = timeline({ status: "IN_TRANSIT", deliveryDate: "2026-10-18", dispatchedAt: "2026-10-17T08:15:00Z" });
  assert.deepEqual(t.map((x) => x.state), ["done", "done", "current", "pending", "pending"]);
  assert.deepEqual(t.map((x) => x.when), ["2026-10-18", "2026-10-17T08:15:00Z", "2026-10-17T08:15:00Z", "", ""]);
  assert.equal(timeline({ status: "CANCELLED" }), null);
  assert.match(DETAIL, /const ALL_STATUSES = \["DRAFT", "LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"\]/);
});

test("POD rules are desktop POD-dialog's: name + (signature or photo), 5 photos, 700 KB", () => {
  assert.equal(podCanSubmit("Azlan", false, 0), false);
  assert.equal(podCanSubmit("Azlan", true, 0), true);
  assert.equal(podCanSubmit("Azlan", false, 1), true);
  assert.equal(podCanSubmit("  ", true, 2), false);
  assert.match(POD, /receiverName\.trim\(\)\.length > 0 && \(hasSignature \|\| photos\.length > 0\)/);
  assert.equal(POD_MAX_PHOTOS, 5);
  assert.match(POD, /const MAX_PHOTOS = 5;/);
  assert.equal(POD_MAX_JSON_BYTES, 700 * 1024);
  assert.match(POD, /const MAX_POD_JSON_BYTES = 700 \* 1024;/);
  assert.equal(podSizeError({ a: "x" }), null);
  assert.match(podSizeError({ a: "x".repeat(800 * 1024) }), /over the 700 KB limit\. Remove a photo and try again\./);
  assert.equal(podOversizeFileError("a.jpg"), '"a.jpg" is larger than 10 MB. Please choose a smaller photo.');
});

test("Pending Delivery: incomplete sofa sets are not selectable; prototype set pill on sofa rows", () => {
  assert.equal(poSelectable({ setComplete: false }), false);
  assert.equal(poSelectable({ setComplete: true }), true);
  // Prototype wording ("Set 3 / 5 ready"), desktop's data (set siblings).
  assert.equal(setStatusLabel({ itemCategory: "SOFA", setComplete: false, setTotalSiblings: 5, setReadySiblings: 3 }), "Set 3 / 5 ready");
  assert.equal(setStatusLabel({ itemCategory: "SOFA", setComplete: true, setTotalSiblings: 3, setReadySiblings: 3 }), "Set 3 / 3 ready");
  assert.equal(setStatusLabel({ itemCategory: "BEDFRAME", setComplete: true, setTotalSiblings: 1, setReadySiblings: 1 }), "");
  assert.match(LIST, /rows\.filter\(\(r\) => r\.setComplete\)/);
});

test("confirm lines carry the prototype icons", () => {
  assert.deepEqual(actionConfirmLines("LOAD").map((l) => l.icon), ["info", "mail"]);
  assert.deepEqual(actionConfirmLines("DELIVER").map((l) => l.icon), ["receipt"]);
  assert.deepEqual(actionConfirmLines("RESOLVE").map((l) => l.icon), ["warning", "receipt"]);
  assert.deepEqual(bulkConfirmLines("DELIVERED", false).map((l) => l.icon), ["receipt", "warning"]);
  assert.deepEqual(bulkConfirmLines("LOADED", false).map((l) => l.icon), ["mail"]);
  assert.deepEqual(bulkConfirmLines("LOADED", true).map((l) => l.icon), ["info"]);
});

test("Create DO: one customer, drops by customer + state, desktop body", () => {
  const pos = [
    { id: "p1", customerId: "c1", customerName: "Desa", customerState: "SEL" },
    { id: "p2", customerId: "c1", customerName: "Desa", customerState: "SEL" },
  ];
  assert.equal(oneCustomerError(pos), null);
  const msg = oneCustomerError([...pos, { id: "p3", customerId: "c2", customerName: "Kian", customerState: "PG" }]);
  assert.match(msg, /^A delivery order can only be for one customer\. You picked 2 \(Desa, Kian\)\./);
  assert.match(LIST, /A delivery order can only be for one customer\. You picked \$\{distinctCustomerIds\.size\}/);

  const hubs = { c1: [
    { id: "h0", state: "JHR", address: "JB", isDefault: true },
    { id: "h1", state: "SEL", address: "Shah Alam", contactName: "Lee", phone: "012" },
  ] };
  const drops = buildDrops(pos, hubs);
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0], { customerId: "c1", customerName: "Desa", hubId: "h1", address: "Shah Alam", contactName: "Lee", contactPhone: "012", poIds: ["p1", "p2"] });
  assert.match(LIST, /const key = `\$\{po\.customerId\}__\$\{po\.customerState\}`;/);
  // Falls back to the default hub, then the first.
  assert.equal(buildDrops([{ id: "p", customerId: "c1", customerState: "KDH" }], hubs)[0].hubId, "h0");

  const body = createDoBody(["p1", "p2"], { ...EMPTY_CREATE_FORM, providerId: "v1", remarks: "Bay B" }, drops);
  assert.deepEqual(body, {
    productionOrderIds: ["p1", "p2"], providerId: "v1", vehicleId: null, driverId: null,
    deliveryAddress: "Shah Alam", dropPoints: 1, remarks: "Bay B", deliveryDate: "",
  });
  assert.match(LIST, /providerId: createDOForm\.driverId \|\| null,\n\s+vehicleId: createDOForm\.vehicleId \|\| null,\n\s+driverId: createDOForm\.driverPersonId \|\| null,\n\s+deliveryAddress,/);
  assert.deepEqual(plFirstBody(["p1"], EMPTY_CREATE_FORM), {
    productionOrderIds: ["p1"], providerId: null, vehicleId: null, driverId: null, deliveryDate: "", remarks: "",
  });
  assert.match(LIST, /toast\.error\("Pick a 3PL provider first"\)/);
});

test("est. delivery cost: vehicle beats provider; extra drops scale", () => {
  assert.equal(estDeliveryCostSen(1, null, null), null);
  assert.equal(estDeliveryCostSen(1, null, { ratePerTripSen: 45000, ratePerExtraDropSen: 8000 }), 45000);
  assert.equal(estDeliveryCostSen(3, null, { ratePerTripSen: 45000, ratePerExtraDropSen: 8000 }), 61000);
  assert.equal(estDeliveryCostSen(2, { ratePerTripSen: 30000, ratePerExtraDropSen: 5000 }, { ratePerTripSen: 45000, ratePerExtraDropSen: 8000 }), 35000);
  assert.match(LIST, /v\.ratePerTripSen \+ Math\.max\(0, drops - 1\) \* v\.ratePerExtraDropSen/);
  assert.deepEqual(plFirstCostSen(2, null, { ratePerTripSen: 45000 }), { perTripSen: 45000, totalSen: 90000 });
  assert.equal(plFirstCostSen(0, null, { ratePerTripSen: 45000 }), null);
});

test("bulk moves take only eligible DOs, as desktop", () => {
  const dos = [{ status: "DRAFT" }, { status: "LOADED" }, { status: "IN_TRANSIT" }, { status: "DELIVERED" }];
  assert.deepEqual(bulkEligible(dos, "LOADED").map((d) => d.status), ["DRAFT"]);
  assert.deepEqual(bulkEligible(dos, "DELIVERED").map((d) => d.status), ["LOADED", "IN_TRANSIT"]);
  assert.match(LIST, /selectedIds\.has\(d\.id\) && d\.status === "DRAFT"/);
  assert.match(LIST, /selectedIds\.has\(d\.id\) && \(d\.status === "LOADED" \|\| d\.status === "IN_TRANSIT"\)/);
  assert.equal(plNoneEligibleMessage("PL-1", "LOADED"), "No pending DOs in PL-1 — they are already dispatched or delivered.");
  assert.ok(LIST.includes("`No pending DOs in ${pl.packingNo} — they are already dispatched or delivered.`"));
  assert.ok(LIST.includes("`No dispatched DOs in ${pl.packingNo} — dispatch them first, or they are already delivered.`"));
  assert.deepEqual(plStatusCounts({ doStatusCounts: { pending: 1, dispatched: 2, delivered: 3 } }), { pending: 1, dispatched: 2, delivered: 3 });
  assert.deepEqual(plStatusCounts({}), { pending: 0, dispatched: 0, delivered: 0 });
});

// ---------------------------------------------------------------------------
// Wiring — the screens call desktop's endpoints and use the rules above.
// ---------------------------------------------------------------------------
const code = (p) => read(p).replace(/^\s*\/\/.*$/gm, "");
const SCREEN = code("src/pages/m/screens/delivery/DeliveryScreen.tsx");
const PHONE_DETAIL = code("src/pages/m/screens/delivery/DeliveryDetailPhone.tsx");
const SHEETS = code("src/pages/m/screens/delivery/DeliverySheets.tsx");
const ACTIONS = code("src/pages/m/screens/delivery/actions.ts");
const PODSHEET = code("src/pages/m/components/PodSheet.tsx");
const DPOD = code("src/pages/m/screens/delivery/DeliveryPodSheet.tsx");
const UI = code("src/pages/m/screens/delivery/ui.tsx");
const TOKENS = code("src/pages/m/screens/delivery/ui-tokens.ts");
const THEME = read("src/pages/m/screens/delivery/delivery-theme.css");
const MODULES = read("src/pages/m/config/modules.ts");
const LAYOUT = read("src/pages/m/MobileLayout.tsx");

test("phone list reads what desktop reads (POs from /ready-planning, counts from /stats)", () => {
  assert.match(SCREEN, /"\/api\/delivery-orders\/ready-planning"/);
  assert.match(SCREEN, /"\/api\/delivery-orders\/stats"/);
  assert.match(SCREEN, /doBrowseUrl\(tab, page\)/);
  assert.match(SCREEN, /doSearchUrl\(dq\)/);
  assert.ok(!SCREEN.includes("/pending-sos"), "Pending Delivery is production orders, not sales orders");
  assert.match(SCREEN, /hasPermission\("delivery-orders", "create"\)/);
  assert.match(SCREEN, /hasPermission\("delivery-orders", "update"\)/);
  // Code-split: the shell chunk does not carry the Delivery screens.
  assert.match(LAYOUT, /delivery: DeliveryRoute,/);
  assert.match(LAYOUT, /delivery: DeliveryDetailRoute,/);
  assert.match(LAYOUT, /lazy\(\(\) =>\s*import\("\.\/screens\/delivery\/DeliveryScreen"\)/);
  assert.match(LAYOUT, /lazy\(\(\) =>\s*import\("\.\/screens\/delivery\/DeliveryDetailScreen"\)/);
  assert.ok(!/^import .*screens\/delivery\//m.test(LAYOUT), "no static import of the Delivery screens");
});

test("create sheets use desktop's endpoints, idempotency and credit retry", () => {
  assert.match(SHEETS, /mutateJson<[^>]*>\("\/api\/delivery-orders", "POST", b, \{ "Idempotency-Key": key \}\)/);
  assert.match(SHEETS, /"\/api\/delivery-orders\/packing-list-first",\s*"POST",\s*\{ productionOrderIds: openKey\.split\(","\), preview: true \}/);
  assert.match(SHEETS, /isCreditBlock\(res\.body\)/);
  assert.match(SHEETS, /creditOverride: \{ reason \}/);
  assert.match(SHEETS, /"\/api\/packing-lists", "POST"/);
  assert.match(SHEETS, /setErr\("Pick a 3PL provider first"\)/);
});

test("writes: read-back verified, bulk is sequential, notices only claimed when queued", () => {
  assert.match(ACTIONS, /verifiedSave<RawRow>\(/);
  assert.match(ACTIONS, /for \(const d of dos\) \{[\s\S]*await put\(\)/);
  assert.ok(!/Promise\.all\(/.test(ACTIONS), "bulk moves must not run in parallel");
  assert.match(ACTIONS, /=== "queued"\) queued\+\+/);
  assert.match(ACTIONS, /if \(queued <= 0\) return null;/);
  assert.match(ACTIONS, /\/resolve-incomplete/);
  assert.match(read("src/pages/delivery/index.tsx"), /from "@\/lib\/delivery-customer-notice"/);
  assert.ok(!/^async function sendCustomerNotice\(/m.test(read("src/pages/delivery/index.tsx")), "one notice code path");
});

test("detail: POD before delivery, Convert to Invoice copy, no Edit / Cancel", () => {
  assert.match(PHONE_DETAIL, /if \(key === "DELIVER" && !pod\) \{\s*setPodOpen\(true\);/);
  assert.match(PHONE_DETAIL, /actionConfirmLines\(key\)/);
  assert.match(PHONE_DETAIL, /hasPermission\("delivery-orders", "update"\)/);
  // Creating a return = POST /api/delivery-returns, gated delivery-returns:update.
  assert.match(PHONE_DETAIL, /hasPermission\("delivery-returns", "update"\)/);
  assert.match(read("src/api/routes/delivery-returns.ts"), /app\.post\("\/", async \(c\) => \{\s*const denied = await requirePermission\(c, "delivery-returns", "update"\)/);
  assert.ok(!/"CANCELLED" \}|status: "CANCELLED"/.test(PHONE_DETAIL + ACTIONS), "no cancel action on the phone");
  // Both POD sheets carry desktop's rules.
  for (const src of [PODSHEET, DPOD]) {
    assert.match(src, /podCanSubmit\(receiverName, hasSignature, photos\.length\)/);
    assert.match(src, /podSizeError\(pod\)/);
    assert.match(src, /compressImage\(f, \{ maxDim: POD_PHOTO_MAX_DIMENSION, quality: POD_PHOTO_JPEG_QUALITY \}\)/);
  }
  assert.match(PHONE_DETAIL, /<DeliveryPodSheet/);
});

test("shared PodSheet keeps its original look (only the rules changed)", () => {
  assert.match(PODSHEET, /background: busy \? "#B7C4A6" : "#4F7C3A"/);
  assert.match(PODSHEET, /Receiver IC \/ phone/);
  assert.match(PODSHEET, /\{busy \? "Confirming…" : "Confirm Delivery"\}/);
});

test("design fidelity pins (Delivery.dc.html)", () => {
  // Chips: solid taupe selected, white + #3A352C unselected, prototype shadows,
  // counts always shown; Sales type (600).
  assert.match(SCREEN, /background: on \? M\.taupe : M\.card, color: on \? "var\(--m-text-on-accent\)" : "var\(--dl-body\)"/);
  assert.match(TOKENS, /SHADOW_CHIP_ON = "0 6px 14px -6px rgba\(107,92,50,\.6\)"/);
  assert.match(TOKENS, /SHADOW_CHIP = "0 1px 2px rgba\(31,29,27,\.06\),0 4px 10px -6px rgba\(31,29,27,\.16\)"/);
  assert.match(THEME, /--dl-body: #3A352C;/);
  // Section switch with the Truck / Users icons on the #F0ECE9 track.
  assert.match(UI, /\{ key: "deliveries", label: "Deliveries", icon: Truck \}/);
  assert.match(UI, /\{ key: "3pl", label: "3PL Providers", icon: Users \}/);
  assert.match(THEME, /--dl-track: #F0ECE9;/);
  // Fixed bottom bars on the shared dock (phone above the tab bar, tablet panes).
  assert.match(UI, /<ResponsiveActionDock scope=\{scope\} phoneBottom=\{72\}/);
  // The bottom DOCK is fixed (the /m content wrapper's overflow breaks sticky);
  // the only sticky element is the sheet footer, inside the Sheet's own scroller.
  const dock = UI.slice(UI.indexOf("export function BottomDock"), UI.indexOf("export function FieldLabel"));
  assert.ok(!/position: "sticky"/.test(dock), "the bottom bar is not sticky");
  assert.equal((UI.match(/position: "sticky"/g) ?? []).length, 1, "only the sheet footer is sticky");
  assert.match(SCREEN, /<BottomDock variant="list"/);
  assert.match(PHONE_DETAIL, /<BottomDock variant="detail"/);
  // List cards: no meta icons; prototype pill colours.
  assert.ok(!/icon=\{/.test(code("src/pages/m/screens/delivery/DeliveryCards.tsx")), "no icons in card metas");
  assert.match(THEME, /--dl-pill-warning-bg: #FAEFCB; --dl-pill-warning-fg: #85600F;/);
  // Related documents connector + linked colour.
  assert.match(PHONE_DETAIL, /position: "absolute", left: 11, top: 34, bottom: -6, width: 2/);
  assert.match(THEME, /--dl-linked: #2F6E62;/);
  // Pending Delivery: always-selectable cards + Packing List / Create DO bar.
  assert.match(SCREEN, /Packing List \(\{selectedPos\.length\}\)/);
  assert.match(SCREEN, /Create DO \(\{selectedPos\.length\}\)/);
});

test("tablet uses the same Delivery screens (generic Delivery path retired)", () => {
  assert.ok(!/ModuleListScreen|DocumentDetailScreen/.test(SCREEN + PHONE_DETAIL + code("src/pages/m/screens/delivery/DeliveryDetailScreen.tsx")));
  assert.match(SCREEN, /const inPane = layout\.canSplitDetail && !!openId;/);
});

test("tablet config bugs fixed: real buckets, Cancelled tab, real steps, CTA only when deliverable", () => {
  assert.ok(!/"DISPATCHED", "IN_TRANSIT"\]\.includes/.test(MODULES));
  assert.ok(!/"SIGNED"/.test(MODULES.match(/const DO_STATUSES = \[[^\]]*\]/)[0]));
  assert.match(MODULES, /\{ key: "dispatch", label: "Pending Dispatch", match: \(r\) => str\(r, "status"\) === "DRAFT" \}/);
  assert.match(MODULES, /\{ key: "cancelled", label: "Cancelled", match: \(r\) => str\(r, "status"\) === "CANCELLED" \}/);
  assert.match(MODULES, /steps: TIMELINE_STEPS\.map/);
  assert.match(MODULES, /return s === "LOADED" \|\| s === "IN_TRANSIT" \? "Mark Delivered" : undefined;/);
});

test("display helpers", () => {
  assert.equal(fmtDate("2026-10-22"), "22 Oct 2026");
  assert.equal(fmtShort("2026-10-02T09:00:00Z"), "2 Oct");
  assert.equal(fmtDate(""), "");
  const d = { items: [{ quantity: 2, itemM3: 1.12 }, { quantity: 1, itemM3: 1.64 }] };
  assert.equal(totalQty(d), 3);
  assert.equal(m3(totalM3(d)), "3.88");
  assert.equal(totalM3({ totalM3: 11.7, items: [] }), 11.7);
});
