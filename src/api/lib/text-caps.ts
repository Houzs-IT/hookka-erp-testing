// ---------------------------------------------------------------------------
// text-caps.ts — server-side length caps for free-text fields.
//
// Why this exists (hardening batch, owner-approved 2026-11-08)
// ------------------------------------------------------------
// Names, notes, remarks and addresses on the main documents were accepted at
// ANY length. A pasted 2 MB block into "Notes" would be stored, cached, sent to
// every list read and rendered into every PDF. Nothing legitimate is that long,
// so the routes now refuse it up front with a 400 that names the field.
//
// Rules
//   * Limits are GENEROUS on purpose — the goal is to stop abuse and accidents,
//     never to trim a real address or a long delivery note.
//   * Only a value that is actually a string is measured. Missing, null,
//     numbers and booleans are not this helper's business.
//   * NEVER list a base64 / image / file / JSON-blob field here (for example
//     `customerPOImageB64`, `customSpecials`, `materials`). Those have their own
//     size rules; a text cap on them would break uploads.
//
// Usage in a route, right after the body is parsed:
//   const tooLong = textCapError(body, SO_HEADER_CAPS, SO_ITEM_CAPS);
//   if (tooLong) return c.json({ success: false, error: tooLong }, 400);
// ---------------------------------------------------------------------------

/** A person's or company's name, a contact name, a document reference. */
export const NAME_MAX = 200;
/** Codes, phone numbers, registration / tax numbers, short references. */
export const SHORT_MAX = 100;
/** A postal address block or a single address line. */
export const ADDRESS_MAX = 1000;
/** Notes, remarks, descriptions, reasons. */
export const NOTE_MAX = 5000;

/** field key → maximum length (characters). */
export type TextCaps = Record<string, number>;

/** Readable label for a camelCase / snake_case key: "contactName" → "Contact name". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstOverlong(
  obj: Record<string, unknown>,
  caps: TextCaps,
): { key: string; max: number; length: number } | null {
  for (const [key, max] of Object.entries(caps)) {
    const v = obj[key];
    if (typeof v === "string" && v.length > max) {
      return { key, max, length: v.length };
    }
  }
  return null;
}

/**
 * The first over-long field as a plain English message, or null when every
 * capped field fits. `itemCaps` is applied to each entry of `body.items` (the
 * line array every document route here uses); entries that are not objects are
 * skipped.
 */
export function textCapError(
  body: unknown,
  caps: TextCaps,
  itemCaps?: TextCaps,
): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const head = firstOverlong(obj, caps);
  if (head) {
    return `${fieldLabel(head.key)} is too long (${head.length.toLocaleString("en-US")} characters). The maximum is ${head.max.toLocaleString("en-US")}.`;
  }
  if (itemCaps && Array.isArray(obj.items)) {
    for (let i = 0; i < obj.items.length; i++) {
      const it = obj.items[i];
      if (!it || typeof it !== "object") continue;
      const hit = firstOverlong(it as Record<string, unknown>, itemCaps);
      if (hit) {
        return `Line ${i + 1}: ${fieldLabel(hit.key)} is too long (${hit.length.toLocaleString("en-US")} characters). The maximum is ${hit.max.toLocaleString("en-US")}.`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-document cap sets. Keys are the body keys each route actually reads.
// ---------------------------------------------------------------------------

export const SO_HEADER_CAPS: TextCaps = {
  notes: NOTE_MAX,
  statusNotes: NOTE_MAX,
  holdReason: NOTE_MAX,
  reference: NAME_MAX,
  customerPO: NAME_MAX,
  customerSO: NAME_MAX,
  companySO: NAME_MAX,
  hookkaDeliveryOrder: NAME_MAX,
};

export const SO_ITEM_CAPS: TextCaps = {
  notes: NOTE_MAX,
  productName: NAME_MAX,
  lineSuffix: NAME_MAX,
  repairScope: NOTE_MAX,
};

export const PO_HEADER_CAPS: TextCaps = {
  notes: NOTE_MAX,
  supplierName: NAME_MAX,
};

export const PO_ITEM_CAPS: TextCaps = {
  materialName: NAME_MAX,
  supplierSKU: NAME_MAX,
};

export const PI_HEADER_CAPS: TextCaps = {
  remarks: NOTE_MAX,
  supplierName: NAME_MAX,
  supplierInvoiceNo: NAME_MAX,
  supplierDoNo: NAME_MAX,
};

export const PI_ITEM_CAPS: TextCaps = {
  notes: NOTE_MAX,
  description: NOTE_MAX,
};

export const CUSTOMER_CAPS: TextCaps = {
  name: NAME_MAX,
  contactName: NAME_MAX,
  companyAddress: ADDRESS_MAX,
  email: NAME_MAX,
  phone: SHORT_MAX,
  ssmNo: SHORT_MAX,
  bankAccount: NAME_MAX,
};

export const SUPPLIER_CAPS: TextCaps = {
  name: NAME_MAX,
  secondDescription: NAME_MAX,
  contactPerson: NAME_MAX,
  attention: NAME_MAX,
  agent: NAME_MAX,
  businessNature: NAME_MAX,
  email: NAME_MAX,
  email2: NAME_MAX,
  email3: NAME_MAX,
  website: NAME_MAX,
  phone: SHORT_MAX,
  phone2: SHORT_MAX,
  mobile: SHORT_MAX,
  fax: SHORT_MAX,
  registrationNo: SHORT_MAX,
  taxEntityTin: SHORT_MAX,
  address: ADDRESS_MAX,
  addressLine1: ADDRESS_MAX,
  addressLine2: ADDRESS_MAX,
  addressLine3: ADDRESS_MAX,
  addressLine4: ADDRESS_MAX,
  area: NAME_MAX,
};
