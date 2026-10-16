# HK-0002 — document import adapter guide

> **Last verified: 2026-10-16** against `src/lib/doc-import/core.ts`, `src/api/lib/doc-import.ts`, `src/api/lib/doc-import-invoice.ts`, `src/api/routes/doc-import.ts`.

## Column contract

Every Detail Listing starts with the same block (`src/lib/doc-columns.ts`). The document's own columns come after it.

`Doc Type | Doc No. | Doc Date | Party Code | Party Name | [Ref Doc No.] | Line ID | Item Code | Description | Qty | UOM | Unit Price | Discount | Line Total`

- `Ref Doc No.` appears only on documents that have a parent: GRN→PO, DO→SO, DI→DO, PI→PO.
- Money is ringgit, written as a number.
- Dates are YYYY-MM-DD.
- A value the document does not carry is left blank. It is never written as 0.
- The importer finds columns by **name**. When two columns share a name, it reads the first one.

## Import rules (the core does these; adapters do not repeat them)

- Rows are grouped by Doc No.:
  - an existing number edits that document
  - a blank Doc No. means one new document
  - `NEW-xxx` means one new document per key
  - an unknown number creates a document with that number
- When editing, lines are matched on Line ID:
  - a blank Line ID is a new line
  - a Line ID that is unknown or appears twice is an error
- A blank cell keeps the stored value. A typed value wins, including 0.
- Columns that are not editable but hold a different value produce a warning and are ignored.
- **One transaction.**
  - A dry run (the default) runs the full apply and then rolls it back.
  - `?execute=1` commits, but only if nothing at all was refused.

## Interface (`src/api/lib/doc-import.ts`)

```ts
interface DocImportAdapter {
  docTypes: string[];          // Doc Type cells accepted, e.g. ["DI","SI"]
  resource: string;            // RBAC resource; create/update checked per plan
  spec: ImportSpec;            // { docTypes, fields: withFields([...editable keys], [...extra FieldSpec]) }
  load(ctx: ImportCtx, docNos: string[]): Promise<Map<string, CurrentDoc>>;
  validate?(plan: ImportPlan): Issue[];   // pure refusals beyond the core rules
  create(ctx: ImportCtx, doc: DocPlan): Promise<{ id: string; docNo: string }>;
  update(ctx: ImportCtx, doc: DocPlan): Promise<void>;
}
// ctx = { c, db /* the transaction */, callRoute(subApp, method, path, body) }
```

- **Write only through the existing route.** For example: `await ctx.callRoute(invoices, "PUT", `/${id}`, body)`.
  - The call runs the real handler in-process on the transaction's DB, with the caller's identity.
  - A non-2xx response, or `success:false`, throws and rolls back the whole file.
  - Never write direct SQL that copies a route.
- **`load`.** Build the documents with the document's **own export builder**, then pass them to `currentFromListing(aoa, spec, idByDocNo, meta)`.
  - The stored values then go through the same formatter and parser as the typed values, so an unedited export always produces an empty diff.
- **Plan fields:**
  - `doc.lines[i].typed` holds the typed cells.
  - `.merged` holds the stored values with the typed editable cells applied on top. Use it for "send the whole line" routes.
  - `.changes` holds the diff.

## Register an adapter

1. Write `src/api/lib/doc-import-<doc>.ts`, exporting the adapter.
2. Add it to `ADAPTERS` in `src/api/routes/doc-import.ts`, keyed by the lower-case URL key: `po: poImportAdapter`.
3. On the list page, add `<DocImportDialog docType="po" title=… open onClose onApplied />` from `src/components/doc-import-dialog.tsx`.

## Tests

- **Pure rules** (`tests/doc-import-core.test.mjs`):
  - build the export with the real builder
  - edit the AoA
  - check `planDocImport` plus your `validate`
  - always include a round trip (`planHasWork(plan) === false` for an unedited export)
- **Runner / all-or-nothing** (`tests/doc-import-runner.test.mjs`): uses a stub DB with `transaction(fn)` and a stand-in route.
- **Column contract** (`tests/doc-columns-contract.test.mjs`): add the new listing to `LISTINGS`.

## Example: invoices (DI + SI), `src/api/lib/doc-import-invoice.ts`

- **DI** is an invoice with `deliveryOrderId` set. **SI** is an invoice with no DO: one converted from a consignment note, or an opening balance. Both live in the same `invoices` table.
- **Spec** (`src/lib/doc-import/invoice.ts`): the editable fields are Base, Divan, Leg, T.Height, Special and Discount. The Unit Price is the baseline and must still match the stored price.
- **load:**
  - `SELECT … FROM invoices WHERE orgId AND invoiceNo IN (…)`, with the customer scope applied
  - then `buildInvoiceDetailRows`, with `fetchJson` pointed at `callRoute(invoices, "GET", …)`
  - then `currentFromListing`
- **update:** `invoiceEditPlan`, which reuses `planInvoicePriceImport` for the status, paid and stale-baseline refusals, then `PUT /:id { priceEdits }`. The GL is restated for SENT invoices.
- **create:** DI only.
  - Ref Doc No. is the DO.
  - Each line matches a DO line by a unique Item Code and gives a Qty. With no lines, it bills everything that remains.
  - Then `POST /` with an optional `invoiceNo`.
  - Then, if any components were typed, `PUT /:id { priceEdits }`.
  - Creating an SI is refused because no route creates an invoice without a DO.
