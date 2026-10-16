// ---------------------------------------------------------------------------
// invoice-detail-export — fetch the lines for a set of invoices (sales AND
// purchase) and hand them to the pure mappers in `invoice-detail-listing.ts`
// and `doc-detail-listings.ts` (buildPiDetailListingAoa). Both list endpoints
// ship no items, so both need the same paced per-document re-fetch.
//
// Split out of the invoices page for two reasons. The page may only export
// components (react-refresh), and more usefully: the pacing and the failure
// handling below are the parts most likely to be wrong, so they belong
// somewhere a test can reach them.
// ---------------------------------------------------------------------------

import {
  buildInvoiceDetailListingAoa,
  type InvoiceDetailDoc,
  type InvoiceDetailItem,
} from "./invoice-detail-listing";
import { buildPiDetailListingAoa, type PiDetailDoc, type PartyCodeLookup } from "./doc-detail-listings";

/**
 * How many invoices one Detail Listing may pull without asking.
 *
 * Each costs two requests (the invoice and its `/print-extras`), and this API
 * SERIALISES concurrent requests and aborts them under load — measured on
 * 2026-08-20, a 500-invoice sweep died with "signal is aborted without reason"
 * three separate times before it was paced. A cap plus a confirm beats an
 * export that half-fails and hands over a file that looks complete.
 */
export const DETAIL_EXPORT_CAP = 200;

/**
 * Gap between invoices. Not a magic number: the same sweep ran clean at this
 * spacing and aborted below it.
 */
export const DETAIL_EXPORT_GAP_MS = 250;

export type InvoiceRowLike = { id?: string | null; invoiceNo?: string | null };

export type DetailExportDeps = {
  /** Injected so tests can drive this without a network. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Injected so tests do not wait in real time. */
  wait?: (ms: number) => Promise<void>;
  /** Returns true to proceed past the cap. Defaults to `window.confirm`. */
  confirmLarge?: (count: number, minutes: number) => boolean;
  /** customer/supplier id → code, for the Party Code column. */
  partyCodes?: PartyCodeLookup;
};

const defaultFetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/**
 * The pacing + cap + confirm shared by every per-document listing. Returns null
 * when the operator declined the large-export confirm (export nothing — a
 * refusal must not half-export). `fetchOne` throwing is the caller's to report.
 */
async function forEachPaced<R extends { id?: string | null }, D>(
  rows: R[],
  noun: string,
  deps: DetailExportDeps,
  fetchOne: (id: string, getJson: (url: string) => Promise<unknown>) => Promise<D>,
  onFail: (row: R, e: unknown) => D,
): Promise<D[] | null> {
  const getJson = deps.fetchJson ?? defaultFetchJson;
  const wait =
    deps.wait ??
    ((ms: number) => new Promise<void>((res) => window.setTimeout(res, ms)));
  const confirmLarge =
    deps.confirmLarge ??
    ((count: number, minutes: number) =>
      window.confirm(
        `This will read ${count} ${noun} one at a time — roughly ${minutes} minute(s).\n\n` +
          `Filter the list first if you only need part of it. Continue?`,
      ));
  const wanted = rows.filter((r) => r.id);
  if (wanted.length > DETAIL_EXPORT_CAP) {
    const minutes = Math.ceil((wanted.length * DETAIL_EXPORT_GAP_MS * 2) / 1000 / 60);
    if (!confirmLarge(wanted.length, minutes)) return null;
  }
  const out: D[] = [];
  for (const r of wanted) {
    try {
      out.push(await fetchOne(String(r.id), getJson));
    } catch (e) {
      out.push(onFail(r, e));
    }
    await wait(DETAIL_EXPORT_GAP_MS);
  }
  return out;
}

const failNote = (e: unknown) => `EXPORT FAILED — ${e instanceof Error ? e.message : "unknown"}`;

/**
 * Fetch every line of every invoice given, and map it to the export rows.
 *
 * Failures are REPORTED, never skipped quietly: an invoice whose lines could
 * not be read is emitted as a single row carrying the reason, so a short export
 * is visibly short. A silently dropped invoice is how a spreadsheet comes to be
 * trusted for something it does not contain — and this codebase has already
 * paid for one absence read as a value today (BUG-2026-08-20-158).
 */
export async function buildInvoiceDetailRows(
  rows: InvoiceRowLike[],
  deps: DetailExportDeps = {},
) {
  const docs = await forEachPaced<InvoiceRowLike, InvoiceDetailDoc>(
    rows,
    "invoices",
    deps,
    async (id, getJson) => {
      const invJson = (await getJson(`/api/invoices/${encodeURIComponent(id)}`)) as {
        data?: InvoiceDetailDoc;
      };
      const inv = invJson?.data ?? ({} as InvoiceDetailDoc);

      // `/print-extras` carries the per-line category and the resolved
      // references. Without it the export still works — it just cannot say
      // which components apply, so all five render. Losing the enrichment must
      // never lose the invoice.
      let extras: Record<string, Partial<InvoiceDetailItem>> = {};
      try {
        const exJson = (await getJson(
          `/api/invoices/${encodeURIComponent(id)}/print-extras`,
        )) as { data?: { items?: Record<string, Partial<InvoiceDetailItem>> } };
        extras = exJson?.data?.items ?? {};
      } catch {
        // keep the invoice, lose only the enrichment
      }

      return {
        ...inv,
        items: (inv.items ?? []).map((it) => ({
          ...it,
          ...(extras[String(it.id)] ?? {}),
        })),
      };
    },
    (r, e) => ({ invoiceNo: r.invoiceNo ?? String(r.id), status: failNote(e), items: [] }),
  );
  return buildInvoiceDetailListingAoa(docs ?? [], deps.partyCodes);
}

/**
 * Purchase Invoice Detail Listing (HK-0002). Same reason, same pacing: the PI
 * list (rowToPI) carries no items, so each PI is re-read from GET
 * /api/purchase-invoices/:id. A PI that cannot be read is reported as a row.
 */
export async function buildPiDetailRows(
  rows: Array<{ id?: string | null; piNo?: string | null }>,
  deps: DetailExportDeps = {},
) {
  const docs = await forEachPaced(
    rows,
    "purchase invoices",
    deps,
    async (id, getJson) => {
      const j = (await getJson(`/api/purchase-invoices/${encodeURIComponent(id)}`)) as { data?: PiDetailDoc };
      return j?.data ?? ({} as PiDetailDoc);
    },
    (r, e): PiDetailDoc => ({ piNo: r.piNo ?? String(r.id), status: failNote(e), items: [] }),
  );
  return buildPiDetailListingAoa(docs ?? [], deps.partyCodes);
}
