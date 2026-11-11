// Review pass 2 C1-5 (Conts#278): photos, videos and PDFs on every flow
// document and each of its lines, with a line's files carried down READ-ONLY
// to the lines made from it. Pure helpers and the server-side line resolver are
// exercised directly (a fake DB for the resolver); the wiring into files.ts and
// the six detail pages is pinned by source pattern (house style for UI).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  flowFileResource,
  flowFileKind,
  shouldDownscale,
  jpegName,
  groupLineFiles,
  lineFileCount,
  mapProdOrdersToSoItems,
  uniqueDoLineByProdOrder,
  normalizeFileRow,
  FLOW_LINE_TYPE,
  FLOW_DOC_RESOURCE,
  isFlowDoc,
} from "../src/lib/flow-files.ts";
import { resolveFlowLineScope, loadFilesForRefs } from "../src/api/lib/flow-line-files.ts";

const read = (p) => readFileSync(p, "utf8");

// ── The gate map ───────────────────────────────────────────────────────────
test("a flow document's files are guarded by that document's resource", () => {
  assert.equal(flowFileResource("PO"), "purchase-orders");
  assert.equal(flowFileResource("PO_LINE"), "purchase-orders");
  assert.equal(flowFileResource("GRN"), "grn");
  assert.equal(flowFileResource("grn"), "grn", "the GRN receipt-photo type (review C2-4) is the same document");
  assert.equal(flowFileResource("GRN_LINE"), "grn");
  assert.equal(flowFileResource("PI_LINE"), "purchase-invoices");
  assert.equal(flowFileResource("DO"), "delivery-orders");
  assert.equal(flowFileResource("DO_LINE"), "delivery-orders");
  assert.equal(flowFileResource("INVOICE_LINE"), "invoices");
  assert.equal(flowFileResource("DR_LINE"), "delivery-returns");
});

test("every other file type keeps the old file-store gate (unchanged)", () => {
  for (const t of ["SO", "SO_LINE", "modular", "equipment", "worker-penalty", "purchase-invoice-source", "org-photo", "", null, "toString", "__proto__"]) {
    assert.equal(flowFileResource(t), null, `${String(t)} must not be remapped`);
  }
});

test("each flow document has a line type and a resource", () => {
  for (const d of ["PO", "GRN", "PI", "DO", "INVOICE", "DR"]) {
    assert.ok(isFlowDoc(d));
    assert.equal(flowFileResource(FLOW_LINE_TYPE[d]), FLOW_DOC_RESOURCE[d]);
  }
  assert.equal(isFlowDoc("SO"), false);
});

// ── Upload helpers ─────────────────────────────────────────────────────────
test("file kinds: photo, video, PDF", () => {
  assert.equal(flowFileKind("image/jpeg", "a.jpg"), "image");
  assert.equal(flowFileKind("", "IMG_1.HEIC"), "image");
  assert.equal(flowFileKind("video/quicktime", "clip.mov"), "video");
  assert.equal(flowFileKind("application/pdf", "x"), "pdf");
  assert.equal(flowFileKind("", "Delivery note.PDF"), "pdf");
  assert.equal(flowFileKind("application/zip", "a.zip"), "other");
});

test("only big still photos are shrunk before upload", () => {
  const MB = 1024 * 1024;
  assert.equal(shouldDownscale({ type: "image/jpeg", size: 4 * MB }), true);
  assert.equal(shouldDownscale({ type: "image/png", size: 2 * MB }), true);
  assert.equal(shouldDownscale({ type: "image/jpeg", size: 100 * 1024 }), false, "already small");
  assert.equal(shouldDownscale({ type: "image/gif", size: 4 * MB }), false, "keeps its animation");
  assert.equal(shouldDownscale({ type: "image/heic", size: 4 * MB }), false, "a desktop browser can't decode it");
  assert.equal(shouldDownscale({ type: "video/mp4", size: 40 * MB }), false);
  assert.equal(shouldDownscale({ type: "application/pdf", size: 4 * MB }), false);
  assert.equal(jpegName("IMG_1234.PNG"), "IMG_1234.jpg");
  assert.equal(jpegName(""), "photo.jpg");
});

// ── Grouping own vs carried-down files ────────────────────────────────────
const f = (id, type, rid, at = "2026-11-10T01:00:00Z") => ({
  id, resourceType: type, resourceId: rid, filename: `${id}.jpg`, contentType: "image/jpeg", sizeBytes: 10, uploadedAt: at,
});

test("groupLineFiles splits own files from the upstream line's, labelled and read-only", () => {
  const upstream = new Map([
    ["11", [{ type: "PO_LINE", id: "p1" }]],
    ["12", [{ type: "PO_LINE", id: "p2" }, { type: "PO_LINE", id: "p2" }]],
  ]);
  const rows = [
    f("a", "GRN_LINE", "11", "2026-11-10T03:00:00Z"),
    f("b", "GRN_LINE", "11", "2026-11-10T02:00:00Z"),
    f("c", "PO_LINE", "p1"),
    f("d", "PO_LINE", "p2"),
    f("x", "GRN_LINE", "99"), // another line — not ours
  ];
  const out = groupLineFiles(["11", "12", "13"], "GRN_LINE", upstream, rows);
  assert.deepEqual(out["11"].own.map((r) => r.id), ["b", "a"], "oldest first");
  assert.deepEqual(out["11"].inherited.map((r) => [r.id, r.fromLabel]), [["c", "Purchase order line"]]);
  assert.deepEqual(out["12"].inherited.map((r) => r.id), ["d"], "a repeated ref shows the file once");
  assert.deepEqual(out["13"], { own: [], inherited: [] });
  assert.equal(lineFileCount(out["11"]), 3);
  assert.equal(lineFileCount(undefined), 0);
});

test("normalizeFileRow reads snake_case rows too", () => {
  const r = normalizeFileRow({ id: "fa-1", resource_type: "PO_LINE", resource_id: "7", filename: "a.pdf", content_type: "application/pdf", size_bytes: "12", uploaded_at: "t" });
  assert.deepEqual(r, { id: "fa-1", resourceType: "PO_LINE", resourceId: "7", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 12, uploadedAt: "t" });
});

// ── Line links: a wrong link is worse than none ───────────────────────────
test("production order → SO line by (sales order, line no); ambiguous → no link", () => {
  const m = mapProdOrdersToSoItems(
    [
      { id: "pord-1", salesOrderId: "so1", lineNo: 1 },
      { id: "pord-2", salesOrderId: "so1", lineNo: 2 },
      { id: "pord-3", salesOrderId: "so1", lineNo: null },
    ],
    [
      { id: "soi-1", salesOrderId: "so1", lineNo: 1 },
      { id: "soi-2a", salesOrderId: "so1", lineNo: 2 },
      { id: "soi-2b", salesOrderId: "so1", lineNo: 2 },
    ],
  );
  assert.equal(m.get("pord-1"), "soi-1");
  assert.equal(m.has("pord-2"), false, "two SO lines claim line 2 — refuse");
  assert.equal(m.has("pord-3"), false);
});

test("DO line by production order only when exactly one line carries it", () => {
  const m = uniqueDoLineByProdOrder([
    { id: "d1", productionOrderId: "p1" },
    { id: "d2", productionOrderId: "p2" },
    { id: "d3", productionOrderId: "p2" },
    { id: "d4", productionOrderId: "" },
  ]);
  assert.equal(m.get("p1"), "d1");
  assert.equal(m.has("p2"), false);
});

// ── The resolver against a fake DB ─────────────────────────────────────────
function fakeDb(tables) {
  const log = [];
  return {
    log,
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async all() {
              log.push(sql);
              for (const [re, fn] of tables) if (re.test(sql)) return { results: fn(binds) };
              throw new Error(`unexpected SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test("GRN lines resolve to their PO line: explicit id, else the position on the owning PO", async () => {
  const db = fakeDb([
    [/FROM grns WHERE id = \? AND org_id/, () => [{ id: "g1" }]],
    [/SELECT id FROM grn_items WHERE grn_id/, () => [{ id: 1 }, { id: 2 }, { id: 3 }]],
    [/FROM grn_items WHERE id IN/, () => [
      { id: 1, grn_id: "g1", po_item_index: 0, po_id: null, po_item_id: "poi-B" },
      { id: 2, grn_id: "g1", po_item_index: 0, po_id: null, po_item_id: null },
      { id: 3, grn_id: "g1", po_item_index: 9, po_id: null, po_item_id: null },
    ]],
    [/FROM grns WHERE id IN/, () => [{ id: "g1", po_id: "po1" }]],
    [/FROM purchase_order_items WHERE purchase_order_id IN .*ORDER BY line_no NULLS LAST, id/s, () => [
      { id: "poi-A", purchase_order_id: "po1" },
      { id: "poi-B", purchase_order_id: "po1" },
    ]],
  ]);
  const s = await resolveFlowLineScope(db, "org1", "GRN", "g1");
  assert.deepEqual(s.lineIds, ["1", "2", "3"]);
  assert.equal(s.ownType, "GRN_LINE");
  assert.deepEqual(s.upstream.get("1"), [{ type: "PO_LINE", id: "poi-B" }]);
  assert.deepEqual(s.upstream.get("2"), [{ type: "PO_LINE", id: "poi-A" }], "position 0 on the PO, paper order");
  assert.equal(s.upstream.has("3"), false, "out-of-range position → no link");
  assert.ok(db.log.every((q) => /^\s*SELECT/i.test(q)), "read-only");
});

test("a PI line shows its GRN line's and that GRN line's PO line's files", async () => {
  const db = fakeDb([
    [/FROM purchase_invoices WHERE id = \? AND org_id/, () => [{ id: "pi1" }]],
    [/FROM purchase_invoice_items WHERE pi_id/, () => [
      { id: "pii-1", grn_item_id: "5", po_item_id: null },
      { id: "pii-2", grn_item_id: null, po_item_id: "poi-Z" },
    ]],
    [/FROM grn_items WHERE id IN/, () => [{ id: 5, grn_id: "g1", po_item_index: null, po_id: "po1", po_item_id: "poi-A" }]],
    [/FROM grns WHERE id IN/, () => [{ id: "g1", po_id: "po1" }]],
    [/FROM purchase_order_items WHERE purchase_order_id IN/, () => [{ id: "poi-A", purchase_order_id: "po1" }]],
  ]);
  const s = await resolveFlowLineScope(db, "org1", "PI", "pi1");
  assert.deepEqual(s.upstream.get("pii-1"), [{ type: "PO_LINE", id: "poi-A" }, { type: "GRN_LINE", id: "5" }]);
  assert.deepEqual(s.upstream.get("pii-2"), [{ type: "PO_LINE", id: "poi-Z" }]);
});

test("an invoice line shows its DO line (stored link, else the production order) and SO line", async () => {
  const db = fakeDb([
    [/FROM invoices WHERE id = \? AND org_id/, () => [{ id: "inv1", delivery_order_id: "do1" }]],
    [/SELECT \* FROM invoice_items WHERE invoice_id/, () => [
      { id: "ii-1", production_order_id: "pord-1", delivery_order_item_id: "doi-9", so_item_id: null },
      { id: "ii-2", production_order_id: "pord-2" }, // older DB: no link columns
    ]],
    [/FROM delivery_order_items WHERE delivery_order_id/, () => [
      { id: "doi-1", production_order_id: "pord-1" },
      { id: "doi-2", production_order_id: "pord-2" },
    ]],
    [/FROM production_orders WHERE id IN/, () => [
      { id: "pord-1", sales_order_id: "so1", line_no: 1 },
      { id: "pord-2", sales_order_id: "so1", line_no: 2 },
    ]],
    [/FROM sales_order_items WHERE sales_order_id IN/, () => [
      { id: "soi-1", sales_order_id: "so1", line_no: 1 },
      { id: "soi-2", sales_order_id: "so1", line_no: 2 },
    ]],
  ]);
  const s = await resolveFlowLineScope(db, "org1", "INVOICE", "inv1");
  assert.deepEqual(s.upstream.get("ii-1"), [{ type: "SO_LINE", id: "soi-1" }, { type: "DO_LINE", id: "doi-9" }]);
  assert.deepEqual(s.upstream.get("ii-2"), [{ type: "SO_LINE", id: "soi-2" }, { type: "DO_LINE", id: "doi-2" }]);
});

test("a document outside the org resolves to null (404), and no lines query runs", async () => {
  const db = fakeDb([[/FROM delivery_orders WHERE id = \? AND org_id/, () => []]]);
  assert.equal(await resolveFlowLineScope(db, "org1", "DO", "do-x"), null);
  assert.equal(db.log.length, 1);
});

test("loadFilesForRefs: one org-scoped query, empty refs skipped", async () => {
  let seen = null;
  const db = { prepare: (sql) => ({ bind: (...b) => ({ all: async () => { seen = { sql, b }; return { results: [] }; } }) }) };
  assert.deepEqual(await loadFilesForRefs(db, "org1", new Map([["PO_LINE", []]])), []);
  assert.equal(seen, null, "nothing to ask → no query");
  await loadFilesForRefs(db, "org1", new Map([["GRN_LINE", ["1", "2", "2"]], ["PO_LINE", ["p"]], ["SO_LINE", []]]));
  assert.match(seen.sql, /WHERE orgId = \? AND \(\(resourceType = \? AND resourceId IN \(\?, \?\)\) OR \(resourceType = \? AND resourceId IN \(\?\)\)\)/);
  assert.deepEqual(seen.b, ["org1", "GRN_LINE", "1", "2", "PO_LINE", "p"]);
});

// ── Wiring: the file store gate ────────────────────────────────────────────
test("files.ts gates flow files on the document: read to view, update to upload", () => {
  const src = read("src/api/routes/files.ts");
  assert.match(src, /from "\.\.\/\.\.\/lib\/flow-files"/);
  // Upload: the document's update for a flow type, files:create otherwise.
  assert.match(src, /flowFileResource\(resourceType\)\s*\?\s*await flowGate\(c, resourceType, "update"\)\s*:\s*await requirePermission\(c, "files", "create"\)/);
  // List by type, metadata, download, stream: the document's read.
  assert.match(src, /if \(resourceType\) \{\s*const denied = await flowGate\(c, resourceType, "read"\)/);
  assert.equal((src.match(/flowGate\(c, row\.resourceType, "read"\)/g) ?? []).length, 3, "metadata + download + stream");
  // Delete keeps files:delete for every file and adds the document's update.
  assert.match(src, /await requirePermission\(c, "files", "delete"\)\) \?\? \(await flowGate\(c, targetType, "update"\)\)/);
  // The unfiltered list drops flow files the reader may not see.
  assert.match(src, /if \(!resourceType\) \{[\s\S]*?hasPermission\(c, resource, "read"\)/);
  // flow-lines is registered BEFORE "/:id", or "flow-lines" would be read as a file id.
  const flow = src.indexOf('app.get("/flow-lines"');
  const byId = src.indexOf('app.get("/:id"');
  assert.ok(flow > 0 && byId > flow, "/flow-lines must precede /:id");
  assert.match(src.slice(flow, byId), /requirePermission\(c, FLOW_DOC_RESOURCE\[doc\], "read"\)/);
});

test("the line resolver never writes (money, stock and payroll untouched)", () => {
  const src = read("src/api/lib/flow-line-files.ts").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/);
});

// ── Wiring: the six detail pages ───────────────────────────────────────────
const PAGES = [
  ["src/pages/procurement/detail.tsx", "PO", "PO_LINE"],
  ["src/pages/procurement/grn-detail.tsx", "GRN", "GRN_LINE"],
  ["src/pages/procurement/PurchaseInvoiceDetail.tsx", "PI", "PI_LINE"],
  ["src/pages/delivery/detail.tsx", "DO", "DO_LINE"],
  ["src/pages/delivery-returns/detail.tsx", "DR", "DR_LINE"],
  ["src/pages/invoices/detail.tsx", "INVOICE", "INVOICE_LINE"],
];

for (const [page, doc, lineType] of PAGES) {
  test(`${page}: document attachments + a paperclip on each line`, () => {
    const src = read(page);
    assert.match(src, /from "@\/components\/flow-files"/);
    assert.match(src, /from "@\/lib\/use-flow-line-files"/);
    assert.match(src, new RegExp(`<FlowFilesCard[\\s\\S]{0,40}resourceType="${doc}"`));
    assert.match(src, new RegExp(`useFlowLineFiles\\("${doc}",`));
    assert.match(src, new RegExp(`lineType="${lineType}"`));
  });
}

test("the component: downscaled photos, PDFs in the in-app preview, rights from the document", () => {
  const src = read("src/components/flow-files.tsx");
  assert.match(src, /uploadFileAsset\(/, "the hardened upload helper");
  assert.match(src, /compressImage\(file, \{ maxDim: FLOW_PHOTO_MAX_DIM, quality: FLOW_PHOTO_QUALITY \}\)/);
  assert.match(src, /openPdfPreview\(blob/);
  assert.match(src, /hasPermission\(resource, "update"\)/);
  assert.match(src, /canUpload && hasPermission\("files", "delete"\)/);
  assert.match(read("src/lib/use-flow-line-files.ts"), /\/api\/files\/flow-lines\?doc=/);
  assert.match(src, /read-only/);
  assert.match(src, /useEscapeClose\(onClose/);
});
