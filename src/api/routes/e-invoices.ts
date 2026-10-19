// ---------------------------------------------------------------------------
// D1-backed e-invoices route.
//
// The e-Invoice record (owner 2026-10-19 「1 做」, the design's MyInvois
// tracking). This route is NOT connected to LHDN and claims nothing about it:
// it builds the XML from the sales invoice and keeps the record; the owner
// sends each invoice through MyInvois and keys back what MyInvois gave —
//
//   POST /                  Generate the XML            → PENDING
//   PUT  /:id mark-submitted  the Submission ID          → SUBMITTED
//                             (no buyer TIN on file      → INVALID, not sent)
//   PUT  /:id record-result   LHDN's UUID                → VALID
//                             or the reason it refused   → REJECTED
//   PUT  /:id cancel          a valid one, cancelled in MyInvois → CANCELLED
//
// Nothing turns VALID without a UUID the owner keyed (BUG-2026-08-13-014: the
// old Submit minted one). Notes:
//
//   - `invoiceId` is intentionally NOT FK-enforced on the DB side (see
//     schema comment). Some legacy/standalone e-invoices reference invoices
//     that aren't in the live set — POST validates that the invoice exists
//     but list/get never reject rows just because the invoice is missing.
//   - `xmlContent` is a TEXT column storing the full UBL XML payload; it's
//     returned as a string.
//   - The three amount columns are INTEGER and hold sen (BUG-2026-10-20-345:
//     POST used to write ringgit with decimals into them, which Postgres
//     refuses — every generate for a total with cents failed, and the catch
//     answered "Invalid request body").
//   - The DB column is `created_at` (snake_case) but the API contract
//     exposes `createdAt` (camelCase) — rowToEInvoice handles the mapping.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import { memoizeSelfApply, runSelfApply } from "../lib/self-apply";
import {
  E_INVOICE_ID_MAX,
  E_INVOICE_REASON_MAX,
  E_INVOICE_STATUSES,
  E_INVOICE_STATUS_NAME,
  MISSING_TIN_ON_GENERATE,
  MISSING_TIN_ON_MARK,
  buildEInvoiceXml,
  isEInvoiceStatus,
  type EInvoiceStatus,
} from "../../lib/e-invoice";

type Db = Env["Variables"]["DB"];

// A customer's TIN from its Onboarding / KYC block (customer_onboarding,
// created by the CRM routes). "" when none is on file or the table is not
// there yet — the XML then says the TIN is missing and the record flags it.
async function customerKycTin(db: Env["Variables"]["DB"], customerId: string | null): Promise<string> {
  if (!customerId) return "";
  const row = await db.prepare("SELECT * FROM customer_onboarding WHERE customer_id = ?")
    .bind(customerId).first<Record<string, unknown>>().catch(() => null);
  return String((row?.tinNumber ?? row?.tin_number) ?? "").trim();
}

// The customer's company registration number (the buyer's BRN in the XML).
async function customerBrn(db: Db, customerId: string | null): Promise<string> {
  if (!customerId) return "";
  const row = await db.prepare("SELECT ssmNo FROM customers WHERE id = ?")
    .bind(customerId).first<Record<string, unknown>>().catch(() => null);
  return String((row?.ssmNo ?? row?.ssm_no) ?? "").trim();
}

// REJECTED ("Rejected by LHDN") is newer than the table's CHECK, which only
// knew PENDING / SUBMITTED / VALID / INVALID / CANCELLED. Find whatever CHECK
// is on e_invoices.status by asking the catalogue (the grns lesson: a guessed
// constraint name is not a migration), drop it, and add the full list. NOT
// VALID: old rows are not re-checked, new writes are. Once per isolate, and
// retried by the next request if it failed (memoizeSelfApply drops the memo).
let statusCheck: Promise<void> | null = null;
function ensureEInvoiceStatuses(db: Db): Promise<void> {
  return memoizeSelfApply(
    () => statusCheck,
    (p) => {
      statusCheck = p;
    },
    async () => {
      const stmts: string[] = [];
      try {
        const found = await db
          .prepare(
            `SELECT conname AS "conname", pg_get_constraintdef(oid) AS "def"
               FROM pg_constraint
              WHERE conrelid = 'e_invoices'::regclass
                AND contype = 'c'
                AND pg_get_constraintdef(oid) ILIKE '%status%'`,
          )
          .all<{ conname: string; def: string }>();
        const checks = found.results ?? [];
        if (checks.some((r) => String(r.def ?? "").includes("REJECTED"))) return;
        for (const r of checks) {
          if (r.conname) stmts.push(`ALTER TABLE e_invoices DROP CONSTRAINT IF EXISTS "${r.conname}"`);
        }
      } catch (err) {
        console.warn("[e-invoices] could not read pg_constraint, using known names:", err);
        stmts.push(
          "ALTER TABLE e_invoices DROP CONSTRAINT IF EXISTS e_invoices_status_check",
          "ALTER TABLE e_invoices DROP CONSTRAINT IF EXISTS e_invoices_status_chk_v2",
        );
      }
      stmts.push(
        "ALTER TABLE e_invoices ADD CONSTRAINT e_invoices_status_chk_v2 " +
          `CHECK (status IN (${E_INVOICE_STATUSES.map((s) => `'${s}'`).join(",")})) NOT VALID`,
      );
      await runSelfApply(db as unknown as Parameters<typeof runSelfApply>[0], "e-invoices", stmts);
    },
  );
}

const app = new Hono<Env>();

type EInvoiceRow = {
  id: string;
  invoiceId: string | null;
  invoiceNo: string;
  customerName: string | null;
  customerTIN: string | null;
  submissionId: string | null;
  uuid: string | null;
  status: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  errorMessage: string | null;
  xmlContent: string | null;
  totalExcludingTax: number;
  taxAmount: number;
  totalIncludingTax: number;
  createdAt: string | null;
};

// The sales invoice an e-invoice is built from.
type InvoiceRow = {
  id: string;
  invoiceNo: string;
  invoiceDate: string | null;
  customerName: string | null;
  customerId: string | null;
  subtotalSen: number | null;
  taxSen: number | null;
  totalSen: number | null;
  status: string | null;
  isOpening: number | null;
};

// Amounts are sen (see the header).
function rowToEInvoice(row: EInvoiceRow) {
  const obj: Record<string, unknown> = {
    id: row.id,
    invoiceId: row.invoiceId ?? "",
    invoiceNo: row.invoiceNo,
    customerName: row.customerName ?? "",
    status: row.status ?? "PENDING",
    totalExcludingTax: Number(row.totalExcludingTax ?? 0),
    taxAmount: Number(row.taxAmount ?? 0),
    totalIncludingTax: Number(row.totalIncludingTax ?? 0),
    createdAt: row.createdAt ?? "",
  };
  if (row.customerTIN != null) obj.customerTIN = row.customerTIN;
  if (row.submissionId != null) obj.submissionId = row.submissionId;
  if (row.uuid != null) obj.uuid = row.uuid;
  if (row.submittedAt != null) obj.submittedAt = row.submittedAt;
  if (row.validatedAt != null) obj.validatedAt = row.validatedAt;
  if (row.errorMessage != null) obj.errorMessage = row.errorMessage;
  if (row.xmlContent != null) obj.xmlContent = row.xmlContent;
  return obj;
}

function genId(): string {
  return `einv-${crypto.randomUUID().slice(0, 8)}`;
}

async function loadInvoice(db: Db, orgId: string, invoiceId: string | null): Promise<InvoiceRow | null> {
  if (!invoiceId) return null;
  return db
    .prepare(
      "SELECT id, invoiceNo, invoiceDate, customerName, customerId, subtotalSen, taxSen, totalSen, status, isOpening FROM invoices WHERE id = ? AND orgId = ?",
    )
    .bind(invoiceId, orgId)
    .first<InvoiceRow>();
}

// The invoice's three figures, sen. totalSen is gross (subtotal + the SST the
// invoice stored when it was raised), so the taxable amount is total − tax.
function invoiceAmounts(inv: InvoiceRow) {
  const totalSen = Math.round(Number(inv.totalSen ?? 0));
  const taxSen = Math.max(0, Math.round(Number(inv.taxSen ?? 0)));
  return { totalSen, taxSen, subtotalSen: totalSen - taxSen };
}

function invoiceXml(inv: InvoiceRow, buyerTin: string, buyerBrn: string): string {
  return buildEInvoiceXml({
    invoiceNo: inv.invoiceNo,
    issueDate: String(inv.invoiceDate ?? "").slice(0, 10),
    buyerName: String(inv.customerName ?? ""),
    buyerTin,
    buyerBrn,
    ...invoiceAmounts(inv),
  });
}

async function loadEInvoice(db: Db, orgId: string, id: string): Promise<EInvoiceRow | null> {
  return db.prepare("SELECT * FROM e_invoices WHERE id = ? AND orgId = ?").bind(id, orgId).first<EInvoiceRow>();
}

const fail = (msg: string) => ({ success: false as const, error: msg });

// The id of an invoice keyed on the Opening Balance page
// (POST /api/accounting/opening-balance/ar).
const OPENING_KEYED_PREFIX = "inv-ob-";

// GET /api/e-invoices — list all
app.get("/", async (c) => {
  // RBAC gate (P3.3-followup) — e-invoices:read.
  const denied = await requirePermission(c, "e-invoices", "read");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const res = await c.var.DB.prepare(
    "SELECT * FROM e_invoices WHERE orgId = ? ORDER BY created_at DESC",
  )
    .bind(orgId)
    .all<EInvoiceRow>();
  const data = (res.results ?? []).map(rowToEInvoice);
  return c.json({ success: true, data, total: data.length });
});

// GET /api/e-invoices/candidates — the Generate tab: issued sales invoices
// that have no e-invoice yet, each with its buyer's TIN (KYC) and BRN.
// The balances keyed on the Opening Balance page (`inv-ob-…`, the old
// system's invoices) are not sales issued here, so they are not listed; a
// real invoice counted into the opening (ar-include sets its isOpening) is
// still a sales invoice and is. Registered before /:id.
app.get("/candidates", async (c) => {
  const denied = await requirePermission(c, "e-invoices", "read");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const sql = (withKyc: boolean) =>
    `SELECT i.id, i.invoiceNo, i.invoiceDate, i.customerName, i.customerId, i.totalSen, i.status, cu.ssmNo${withKyc ? ", co.tin_number" : ""}
       FROM invoices i
       LEFT JOIN customers cu ON cu.id = i.customerId${withKyc ? " LEFT JOIN customer_onboarding co ON co.customer_id = i.customerId" : ""}
      WHERE i.orgId = ?
        AND i.status NOT IN ('DRAFT','CANCELLED')
        AND i.id NOT LIKE '${OPENING_KEYED_PREFIX}%'
        AND NOT EXISTS (SELECT 1 FROM e_invoices e WHERE e.invoiceId = i.id)
      ORDER BY i.invoiceDate DESC, i.invoiceNo DESC`;
  type Cand = Record<string, unknown>;
  let rows: Cand[];
  try {
    rows = (await c.var.DB.prepare(sql(true)).bind(orgId).all<Cand>()).results ?? [];
  } catch (err) {
    // No KYC table yet (the CRM routes create it on first use): every buyer's
    // TIN is then simply missing.
    console.warn("[e-invoices] candidates without KYC:", err);
    rows = (await c.var.DB.prepare(sql(false)).bind(orgId).all<Cand>()).results ?? [];
  }
  const s = (r: Cand, a: string, b: string) => String((r[a] ?? r[b]) ?? "");
  const data = rows.map((r) => ({
    id: s(r, "id", "id"),
    invoiceNo: s(r, "invoiceNo", "invoice_no"),
    invoiceDate: s(r, "invoiceDate", "invoice_date").slice(0, 10),
    customerName: s(r, "customerName", "customer_name"),
    customerId: s(r, "customerId", "customer_id"),
    totalSen: Number((r.totalSen ?? r.total_sen) ?? 0),
    status: s(r, "status", "status"),
    buyerTin: s(r, "tinNumber", "tin_number").trim(),
    buyerBrn: s(r, "ssmNo", "ssm_no").trim(),
  }));
  return c.json({ success: true, data, total: data.length });
});

// POST /api/e-invoices — Generate: build the XML from the sales invoice and
// keep it as a PENDING record.
app.post("/", async (c) => {
  // RBAC gate (P3.3-followup) — e-invoices:create.
  const denied = await requirePermission(c, "e-invoices", "create");
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json(fail("Invalid request body"), 400);
  }
  const invoiceId = String(body.invoiceId ?? "").trim();
  if (!invoiceId) {
    return c.json(fail("invoiceId is required"), 400);
  }
  const orgId = getOrgId(c);
  try {
    const invoice = await loadInvoice(c.var.DB, orgId, invoiceId);
    if (!invoice) {
      return c.json(fail("Invoice not found"), 404);
    }
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      return c.json(fail(`${invoice.invoiceNo} is ${invoice.status} — only an issued invoice gets an e-Invoice.`), 400);
    }
    if (invoice.id.startsWith(OPENING_KEYED_PREFIX)) {
      return c.json(fail(`${invoice.invoiceNo} is an opening balance keyed from the old system — it gets no e-Invoice here.`), 400);
    }

    const existing = await c.var.DB.prepare(
      "SELECT id FROM e_invoices WHERE invoiceId = ? AND orgId = ?",
    )
      .bind(invoiceId, orgId)
      .first<{ id: string }>();
    if (existing) {
      return c.json(fail(`${invoice.invoiceNo} already has an e-Invoice.`), 409);
    }

    // The buyer's TIN: the request's, else the one on the customer's KYC block
    // (Finance v2 party fields, owner 2026-10-17 — "TIN · e-Invoice"). With
    // neither, the record says so instead of borrowing another TIN.
    const customerTIN = String(body.customerTIN ?? "").trim() || (await customerKycTin(c.var.DB, invoice.customerId));
    const { totalSen, taxSen, subtotalSen } = invoiceAmounts(invoice);
    const xmlContent = invoiceXml(invoice, customerTIN, await customerBrn(c.var.DB, invoice.customerId));
    const now = new Date().toISOString();

    const id = genId();
    await c.var.DB.prepare(
      `INSERT INTO e_invoices (id, invoiceId, invoiceNo, customerName, customerTIN,
         submissionId, uuid, status, submittedAt, validatedAt, errorMessage,
         xmlContent, totalExcludingTax, taxAmount, totalIncludingTax, created_at, orgId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        invoice.id,
        invoice.invoiceNo,
        invoice.customerName,
        customerTIN || null,
        null,
        null,
        "PENDING",
        null,
        null,
        customerTIN ? null : MISSING_TIN_ON_GENERATE,
        xmlContent,
        subtotalSen,
        taxSen,
        totalSen,
        now,
        orgId,
      )
      .run();

    const created = await loadEInvoice(c.var.DB, orgId, id);
    if (!created) {
      return c.json(fail("Failed to create e-invoice"), 500);
    }
    await emitAudit(c, {
      resource: "e-invoices",
      resourceId: id,
      action: "create",
      after: rowToEInvoice(created),
    });
    return c.json({ success: true, data: rowToEInvoice(created) }, 201);
  } catch (err) {
    console.error("[e-invoices] generate failed:", err);
    return c.json(fail(`Could not save the e-Invoice: ${err instanceof Error ? err.message : String(err)}`), 500);
  }
});

// GET /api/e-invoices/:id — single
app.get("/:id", async (c) => {
  const denied = await requirePermission(c, "e-invoices", "read");
  if (denied) return denied;
  const row = await loadEInvoice(c.var.DB, getOrgId(c), c.req.param("id"));
  if (!row) {
    return c.json({ success: false, error: "e-Invoice not found" }, 404);
  }
  return c.json({ success: true, data: rowToEInvoice(row) });
});

// PUT /api/e-invoices/:id — keep the record in step with MyInvois:
// mark-submitted / record-result / cancel. (`submit`, the LHDN transmission,
// stays refused — see below.)
//
// Spec asked for `e-invoices:submit` / `e-invoices:cancel` actions, but the
// 0045 seed only has read/create/update/delete for this resource. Every
// action here only updates our own record, so the gate is e-invoices:update.
app.put("/:id", async (c) => {
  // RBAC gate (P3.3-followup) — e-invoices:update.
  const denied = await requirePermission(c, "e-invoices", "update");
  if (denied) return denied;
  const id = c.req.param("id");
  const orgId = getOrgId(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json(fail("Invalid request body"), 400);
  }

  // -----------------------------------------------------------------------
  // action:"submit" — DISABLED. It MINTED an LHDN identity that LHDN had
  // never issued. BUG-2026-08-13-014.
  //
  // What it used to do:
  //
  //   submissionId = `LHDN-SUB-${yyyymmdd}-${Math.floor(Math.random()*999)}`
  //   uuid         = 15 random chars from [A-Z0-9]
  //   UPDATE e_invoices SET status='VALID', submittedAt=now, validatedAt=now,
  //                        submissionId=?, uuid=?
  //   // comment on that line: "Mock auto-validation: SUBMITTED → VALID"
  //
  // There is NO LHDN / MyInvois client anywhere in this repo (checked across
  // src/: the only other mentions of "LHDN" are a page heading, a comment,
  // and a mail-sender regex). Nothing was ever transmitted. The row then
  // rendered on /invoices/e-invoice as a green **VALID** badge carrying a
  // fabricated clearance UUID — a number the owner could hand to an auditor
  // — and the audit journal recorded it under a comment calling it "the LHDN
  // transmission moment ... for tax-audit traceability".
  //
  // This is the one figure in this sweep that is not merely wrong: it is a
  // government-issued identifier that no government issued. It cannot be
  // sourced, so it must not be produced. Wiring the real MyInvois API
  // (credentials, TIN validation, digital signature, the 72-hour rejection
  // window) is a project, not a fix — it is the top owner decision in the PR.
  //
  // The tracking actions below never produce an identifier either: the
  // Submission ID and the UUID are what the owner keys from MyInvois.
  // -----------------------------------------------------------------------
  if (body.action === "submit") {
    return c.json(
      {
        success: false,
        error:
          "Submission to LHDN is not implemented. This action used to mint a " +
          "random submission ID and UUID and mark the e-invoice VALID without " +
          "contacting LHDN, so the clearance shown was not real. Send the " +
          "invoice through MyInvois, then use Mark as Submitted.",
      },
      501,
    );
  }

  try {
    const existing = await loadEInvoice(c.var.DB, orgId, id);
    if (!existing) {
      return c.json({ success: false, error: "e-Invoice not found" }, 404);
    }
    const status: EInvoiceStatus = isEInvoiceStatus(existing.status) ? existing.status : "PENDING";
    const name = E_INVOICE_STATUS_NAME[status];
    const now = new Date().toISOString();

    // REJECTED needs the widened CHECK; the others are in the old one.
    try {
      await ensureEInvoiceStatuses(c.var.DB);
    } catch (err) {
      console.error("[e-invoices] status check:", err);
    }

    const finish = async (action: string, httpError?: string) => {
      const updated = await loadEInvoice(c.var.DB, orgId, id);
      if (!updated) {
        return c.json({ success: false, error: "e-Invoice not found" }, 404);
      }
      await emitAudit(c, {
        resource: "e-invoices",
        resourceId: id,
        action,
        before: rowToEInvoice(existing),
        after: rowToEInvoice(updated),
      });
      if (httpError) return c.json({ success: false, error: httpError, data: rowToEInvoice(updated) }, 422);
      return c.json({ success: true, data: rowToEInvoice(updated) });
    };

    // Mark as Submitted — the owner sent it through MyInvois and keys the
    // Submission ID MyInvois gave. The buyer's TIN is read again (it may have
    // been added since the XML was built); without one it is not sent: the
    // record turns INVALID ("Failed our own check · not sent").
    if (body.action === "mark-submitted") {
      if (status !== "PENDING" && status !== "INVALID" && status !== "REJECTED") {
        return c.json(fail(`${existing.invoiceNo} is ${name} — only a Pending, Invalid or Rejected e-invoice can be marked submitted.`), 409);
      }
      const submissionId = String(body.submissionId ?? "").trim();
      if (!submissionId) {
        return c.json(fail("Key the Submission ID MyInvois gave you."), 400);
      }
      if (submissionId.length > E_INVOICE_ID_MAX) {
        return c.json(fail("That Submission ID is too long — key the ID only."), 400);
      }
      const invoice = await loadInvoice(c.var.DB, orgId, existing.invoiceId);
      if (invoice?.status === "CANCELLED") {
        return c.json(fail(`${invoice.invoiceNo} has been cancelled — its e-Invoice is not to be sent.`), 409);
      }
      const tin = (invoice ? await customerKycTin(c.var.DB, invoice.customerId) : "") || String(existing.customerTIN ?? "").trim();
      if (!tin) {
        await c.var.DB.prepare("UPDATE e_invoices SET status = ?, errorMessage = ? WHERE id = ? AND orgId = ?")
          .bind("INVALID", MISSING_TIN_ON_MARK, id, orgId)
          .run();
        return finish("mark-submitted", `${existing.invoiceNo} not marked — ${MISSING_TIN_ON_MARK}.`);
      }
      // The record keeps the XML of what was sent: rebuilt from the invoice as
      // it stands now (the TIN may be new). A legacy row whose invoice is gone
      // keeps its stored XML and figures.
      let xml = existing.xmlContent;
      let figures = [existing.totalExcludingTax, existing.taxAmount, existing.totalIncludingTax];
      if (invoice) {
        const a = invoiceAmounts(invoice);
        xml = invoiceXml(invoice, tin, await customerBrn(c.var.DB, invoice.customerId));
        figures = [a.subtotalSen, a.taxSen, a.totalSen];
      }
      const next: EInvoiceStatus = "SUBMITTED";
      await c.var.DB.prepare(
        `UPDATE e_invoices SET status = ?, submissionId = ?, submittedAt = ?, errorMessage = NULL,
            uuid = NULL, validatedAt = NULL, customerTIN = ?, xmlContent = ?,
            totalExcludingTax = ?, taxAmount = ?, totalIncludingTax = ?
          WHERE id = ? AND orgId = ?`,
      )
        .bind(next, submissionId, now, tin, xml, figures[0], figures[1], figures[2], id, orgId)
        .run();
      return finish("mark-submitted");
    }

    // Record Result — what LHDN answered. Valid needs the UUID LHDN issued
    // (keyed, never made up); Rejected needs the reason.
    if (body.action === "record-result") {
      if (status !== "SUBMITTED") {
        return c.json(fail(`${existing.invoiceNo} is ${name} — only a Submitted e-invoice gets LHDN's result.`), 409);
      }
      const result = String(body.result ?? "").toUpperCase();
      if (result === "VALID") {
        const uuid = String(body.uuid ?? "").trim();
        if (!uuid) {
          return c.json(fail("Key the UUID LHDN issued — nothing turns Valid without it."), 400);
        }
        if (uuid.length > E_INVOICE_ID_MAX) {
          return c.json(fail("That UUID is too long — key the UUID only."), 400);
        }
        const clash = await c.var.DB.prepare("SELECT invoiceNo FROM e_invoices WHERE uuid = ? AND id <> ? AND orgId = ?")
          .bind(uuid, id, orgId)
          .first<{ invoiceNo: string }>();
        if (clash) {
          return c.json(fail(`That UUID is already recorded on ${clash.invoiceNo}.`), 409);
        }
        const next: EInvoiceStatus = "VALID";
        await c.var.DB.prepare(
          "UPDATE e_invoices SET status = ?, uuid = ?, validatedAt = ?, errorMessage = NULL WHERE id = ? AND orgId = ?",
        )
          .bind(next, uuid, now, id, orgId)
          .run();
        return finish("record-result");
      }
      if (result === "REJECTED") {
        const reason = String(body.reason ?? "").trim();
        if (!reason) {
          return c.json(fail("Key why LHDN rejected it."), 400);
        }
        const next: EInvoiceStatus = "REJECTED";
        await c.var.DB.prepare("UPDATE e_invoices SET status = ?, errorMessage = ? WHERE id = ? AND orgId = ?")
          .bind(next, reason.slice(0, E_INVOICE_REASON_MAX), id, orgId)
          .run();
        return finish("record-result");
      }
      return c.json(fail("result must be VALID or REJECTED."), 400);
    }

    // Cancel — a valid e-invoice the owner cancelled in MyInvois (LHDN allows
    // it within 72 hours of validation). Only the record changes here.
    if (body.action === "cancel") {
      if (status !== "VALID") {
        return c.json(fail(`${existing.invoiceNo} is ${name} — only a Valid e-invoice can be cancelled.`), 400);
      }
      await c.var.DB.prepare("UPDATE e_invoices SET status = ? WHERE id = ? AND orgId = ?")
        .bind("CANCELLED", id, orgId)
        .run();
      // Audit emit (P3.4) — every state change on this tax record is journalled.
      return finish("cancel");
    }

    return c.json(fail("Invalid action. Use 'mark-submitted', 'record-result' or 'cancel'."), 400);
  } catch (err) {
    console.error("[e-invoices] update failed:", err);
    return c.json(fail(`Could not update the e-Invoice: ${err instanceof Error ? err.message : String(err)}`), 500);
  }
});

export default app;
