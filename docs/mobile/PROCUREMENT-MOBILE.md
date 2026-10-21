# Mobile Procurement core (`/m/procurement`) — corrected spec

> **Last verified: 2026-10-21** against `src/api/routes/{purchase-orders,grn,purchase-invoices,three-way-match}.ts`,
> `src/pages/procurement/{index,create,detail,grn,grn/create,grn-detail,pi,pi/create,PurchaseInvoiceDetail}.tsx`,
> `src/components/convert-to-pi-modal.tsx`, `src/pages/m/components/GrnReceiveSheet.tsx` (branch
> `design/mobile-procurement`). Code reading only — no database was queried.

The visual reference is the Claude Design handoff `Procurement.dc.html` (phone 390px, sample data). Its
**look** is approved; several of its **business assumptions** were wrong. This page is what the mobile
screen implements instead. Where it and the prototype disagree, this page wins. Where this page and the
code disagree, the code wins — fix this page.

Scope: Orders (PO) · Receipts (GRN) · Invoices (PI). Out: Purchase Returns, Suppliers / Price Comparison,
MRP, "Create Purchase Return", GRN Edit Quantities, Mark Arrived, editing shipment / landed cost.

## Data

| Section | List | Detail | Notes |
|---|---|---|---|
| PO | `GET /api/purchase-orders` | `GET /api/purchase-orders/:id` (+ `linkedGRNs`, `linkedPIs`) | PO vs GRN: `GET /api/three-way-match/by-po/:id` |
| GRN | `GET /api/grn` | `GET /api/grn/:id` | no linked-PI field — found through the PO's `linkedPIs` |
| PI | `GET /api/purchase-invoices` | `GET /api/purchase-invoices/:id` (+ `linkedGRNs`, `linkedPayments`) | |
| Low stock | `GET /api/inventory?buckets=rawMaterials` + `GET /api/supplier-materials` | | |

All three lists page **only** when `?page`/`?limit` is sent; without them they return every row. Mobile
fetches without paging, so search, chips and counts (Closed included) always see the full table.

## Statuses (as the code has them)

- **PO** `DRAFT → SUBMITTED → CONFIRMED → PARTIAL_RECEIVED → RECEIVED → CLOSED`; `CANCELLED` from
  DRAFT / SUBMITTED / CONFIRMED / PARTIAL_RECEIVED. Timeline labels: Draft, Sent, Confirmed, Partially
  Received, Fully Received, Closed. A **manual PO is born CONFIRMED** (desktop `create.tsx`); only the
  low-stock form creates DRAFT POs.
- **GRN** `DRAFT → CONFIRMED (shown "Approved") → POSTED`; `CANCELLED`. Separate `qcStatus`
  (`PENDING|PASSED|PARTIAL|FAILED`) that no code path sets, and `arrival_state`
  (`NOT_ARRIVED|IN_TRANSIT|AT_CUSTOMS|ARRIVED`, labels Planning / In Transit / At Customs / Arrived).
  Committing (Approve / Post to Stock) needs ARRIVED. A GRN created with `arrival_state:"ARRIVED"` (the
  mobile receive sheet) is **born POSTED** — stock in, PO drawn down.
- **PI** `DRAFT → CONFIRMED → PAID`; `PARTIAL_PAID` (supplier payments only); `CANCELLED` (void). Legacy
  `PENDING_APPROVAL` / `APPROVED` display as Confirmed. Every create is DRAFT.

## Actions by status (mobile = desktop)

**PO** (`detail.tsx`; all `PUT /api/purchase-orders/:id`)

| Status | Actions |
|---|---|
| DRAFT | Edit · Download PDF · Delete PO |
| SUBMITTED | Mark Confirmed · Edit · Email · PDF · Create Invoice · Cancel PO |
| CONFIRMED | no posted GRN: Create GRN + Mark Partially Received · posted GRN: Receive Goods + Mark Fully Received · Email · PDF · Invoice · Edit (nothing received) · Cancel PO |
| PARTIAL_RECEIVED | Receive Goods · Mark Fully Received (posted GRN only) · Email · PDF · Print GRN · Invoice · Cancel PO |
| RECEIVED | Close PO · Email · PDF · Print GRN · Invoice |
| CLOSED / CANCELLED | PDF (+ Invoice on CLOSED) |

"Posted GRN" = a linked GRN in POSTED **or** CONFIRMED. Invoice reads "Invoiced" when a non-cancelled PI
exists. Cancel needs a reason ≥ 10 chars ("Reason must be at least 10 characters"), appended to notes as
`[CANCELLED YYYY-MM-DD: reason]`. Fully Received sends `receivedDate`; the server 412s with
`requiresGrn` ("Create + post a GRN before marking received"). List bulk: Select drafts → "Submit N
drafts" (one `PUT {status:"SUBMITTED"}` each).

**GRN** — Post to Stock (`PUT {status:"POSTED"}`) on DRAFT / CONFIRMED, enabled only when ARRIVED
(else "Mark arrived first before posting to stock") · Cancel Receipt (`POST /:id/cancel`; server refusals
shown as is) · Create Invoice on POSTED only · Download PDF. **No Approve on mobile**
(BUG-2026-10-21-344). Shipment and landed cost are read-only.

**PI** (`PurchaseInvoiceDetail.tsx`) — DRAFT: Confirm · Edit · Delete · PDF. CONFIRMED (and legacy):
Mark Paid · Edit · Void · PDF. PAID / PARTIAL_PAID: Void shown, the server refuses it when anything is
paid. CANCELLED: Restore (`/unvoid`, back to the status before the void). Void / Restore only for
FINANCE, SUPER_ADMIN, ADMIN. Mark Paid on a non-MYR PI asks for the payment-day rate and sends
`payFxRate` (desktop list). Editing a CONFIRMED PI whose total changes asks "Save changes to a confirmed
invoice?".

## Create flows

- **New PO** (desktop `create.tsx`): active suppliers only; purchase company from `/api/organisations`
  (default: supplier's `purchaseOrgCode`, else HOOKKA); lines from supplier-material bindings (qty =
  MOQ, price = binding price, editable); `status:"CONFIRMED"`. Checks, in order: "Add at least one item",
  "Pick supplier for unbound material(s)", "Lines belong to multiple suppliers — use Split by Supplier",
  "Supplier missing". Split by Supplier: one CONFIRMED PO per supplier, each with that supplier's company,
  posted one after another 200 ms apart.
- **Low-stock PO** (desktop `index.tsx` POFormDialog): banner when an active RM has `minStock > 0` and
  `balanceQty <= minStock`; lines prefilled with qty = max(maxStock − balance, MOQ), main binding (else
  first). **No status sent → DRAFT**; no purchase company sent (server derives it). Split creates DRAFTs.
- **Receive goods (GRN)**: the existing mobile receive body, unchanged — `POST /api/grn {poId,
  purchaseOrgCode, receivedBy, notes, ocrUsed:false, arrival_state:"ARRIVED", items:[{poItemIndex,
  receivedQty, acceptedQty, rejectedQty:0, rejectionReason:""}]}` with `Idempotency-Key`. Received By is
  required on the client, as on desktop ("Enter the name of the person who received the goods").
  Over-receipt beyond 110% is refused by the server (message shown as is).
- **New PI** (desktop `pi/create.tsx` + `convert-to-pi-modal.tsx`): Supplier *, then import a GRN
  (non-cancelled, POSTED first; lines up to `availableQty`, carry `grnItemId`; one GRN only) or a PO
  (not DRAFT / CANCELLED / CLOSED; lines up to `availableQty`; more POs may be appended), or add items
  from the supplier's bindings. Mismatch: "This invoice is for {A}. Create a separate PI for {B}."
  Purchase company, Supplier Invoice No., Invoice Date, Supplier DO No., Remarks ("From GRN …" /
  "Created from PO …"). `status:"DRAFT"`. **No due date** (the server sets the last day of next month and
  ignores one sent on create). No currency field exists on PI create.

## Permissions

Segments: Orders needs `purchase-orders:read`, Receipts `grn:read`, Invoices `purchase-invoices:read`; the
switch hides when only one is readable. Actions follow the server's gates: PO create / update / delete,
plus `approve` for Mark Confirmed and `receive` for Partially / Fully Received; GRN create / update /
delete (cancel = delete); PI create / update / delete; void / restore = FINANCE / SUPER_ADMIN / ADMIN.
SUPER_ADMIN / ADMIN bypass. PI reads are not gated on the server (BUG-2026-10-21-345), so the Invoices
hide is screen-level only.

## Prototype assumptions corrected

| Prototype | Real |
|---|---|
| New PO saved as Draft | Confirmed (Draft only from low stock) |
| Mobile GRN created as Draft / QC Pending | Posted on save (arrival ARRIVED); QC never set |
| Approve on GRN | Not on mobile (BUG-2026-10-21-344) |
| GRN shipping fields on create | Omitted — filling them makes the GRN NOT_ARRIVED / Draft |
| Create Invoice from an Approved GRN | Posted only |
| PI Restore → Draft | Back to the status before the void |
| PI editable in Draft only | Draft and Confirmed |
| PI Due Date on create | Server-set, field removed |
| Low stock `<` minStock, cheapest supplier | `<=`, main binding |
| PO vs GRN qty only | Qty and value, zero tolerance, posted GRNs only |
| Partial Paid missing | Shown |
| "Customer" / "Customer PO" labels (old mobile) | Supplier / PO No. |

## Gaps (documented, not worked around)

- Foreign-currency PI from a GRN: only desktop GRN detail's Convert to Invoice asks for currency / FX;
  PI create has no currency field, so mobile PIs are MYR.
- Mark Arrived, GRN Edit Quantities, editing shipment / landed cost, adding free-text lines while editing
  a PI or PO, per-line SST / invoice discount entry on PI create: desktop only.
- Desktop PI list "Overdue" counts Draft / Cancelled invoices (not changed).
