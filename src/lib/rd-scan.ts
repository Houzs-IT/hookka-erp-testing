// ---------------------------------------------------------------------------
// rd-scan.ts (pure) — turn what was read off a filled R&D Spec Form into
// changes the operator reviews before anything is saved (plan D11 / phase 7:
// "upload, extract, review, save").
//
// The form numbers WIPs #1, #2 … in BOM order (depth-first, product level not
// counted) — the same order the costing editor shows — so a reading is
// addressed by WIP number + department / material code. Nothing here writes:
// `applyRdScan` returns a NEW BOM for the editor; the operator still presses
// Save, which goes through the normal BOM save.
// ---------------------------------------------------------------------------

export type RdScanMinutes = { wipNo: number; dept: string; minutes: number };
export type RdScanQty = { wipNo: number; code: string; qty: number; unit?: string };
export type RdScanReading = {
  formNo: string;
  filledBy: string;
  filledOn: string;
  minutes: RdScanMinutes[];
  corrections: RdScanQty[]; // materials on file with a corrected qty
  newMaterials: RdScanQty[]; // written on blank lines or the Extra table
};

type Proc = { dept?: string; deptCode?: string; minutes?: number | string; [k: string]: unknown };
type Mat = { code?: string; inventoryCode?: string; name?: string; qty?: number | string; unit?: string; [k: string]: unknown };
type Node = { quantity?: number | string; processes?: Proc[]; materials?: Mat[]; children?: Node[]; [k: string]: unknown };
export type ScanBom = { wipComponents?: Node[]; [k: string]: unknown };

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
};
const key = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");

/** The WIPs in form order: #1 = first WIP depth-first. */
export function numberedWips(bom: ScanBom): Node[] {
  const out: Node[] = [];
  const walk = (l: Node[] | undefined) => (l ?? []).forEach((n) => {
    out.push(n);
    walk(n.children);
  });
  walk(bom.wipComponents);
  return out;
}

/** Keep only readings that are well-formed and point at a WIP that exists. */
export function normaliseRdScan(raw: unknown, wipCount: number): RdScanReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const okNo = (v: unknown) => {
    const n = Math.round(num(v));
    return n >= 1 && n <= wipCount ? n : null;
  };
  const minutes: RdScanMinutes[] = [];
  for (const m of Array.isArray(r.minutes) ? r.minutes : []) {
    const o = (m ?? {}) as Record<string, unknown>;
    const wipNo = okNo(o.wipNo);
    const v = num(o.minutes);
    if (wipNo && String(o.dept ?? "").trim() && v >= 0 && v < 10000) minutes.push({ wipNo, dept: String(o.dept).trim(), minutes: v });
  }
  const qtyList = (arr: unknown): RdScanQty[] => {
    const out: RdScanQty[] = [];
    for (const m of Array.isArray(arr) ? arr : []) {
      const o = (m ?? {}) as Record<string, unknown>;
      const wipNo = okNo(o.wipNo);
      const q = num(o.qty);
      const code = String(o.code ?? "").trim();
      if (wipNo && code && q > 0 && q < 100000) out.push({ wipNo, code, qty: q, unit: String(o.unit ?? "").trim() || undefined });
    }
    return out;
  };
  const date = String(r.filledOn ?? "").trim();
  return {
    formNo: String(r.formNo ?? "").trim().slice(0, 60),
    filledBy: String(r.filledBy ?? "").trim().slice(0, 80),
    filledOn: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    minutes,
    corrections: qtyList(r.corrections),
    newMaterials: qtyList(r.newMaterials),
  };
}

export type RdChange =
  | { kind: "minutes"; wipNo: number; dept: string; from: number; to: number }
  | { kind: "qty"; wipNo: number; code: string; fromPerProduct: number; toPerProduct: number }
  | { kind: "add"; wipNo: number; code: string; perProduct: number; unit: string }
  | { kind: "unmatched"; wipNo: number; what: string };

/** What the reading would change, line by line, for the review list. */
export function rdScanChanges(bom: ScanBom, reading: RdScanReading): RdChange[] {
  const wips = numberedWips(bom);
  const out: RdChange[] = [];
  for (const m of reading.minutes) {
    const n = wips[m.wipNo - 1];
    const p = (n?.processes ?? []).find((x) => key(x.dept) === key(m.dept) || key(x.deptCode) === key(m.dept));
    if (!p) {
      out.push({ kind: "unmatched", wipNo: m.wipNo, what: `${m.dept} ${m.minutes} min` });
      continue;
    }
    const from = num(p.minutes) || 0;
    if (from !== m.minutes) out.push({ kind: "minutes", wipNo: m.wipNo, dept: String(p.dept ?? p.deptCode ?? m.dept), from, to: m.minutes });
  }
  for (const c of reading.corrections) {
    const n = wips[c.wipNo - 1];
    const pcs = num(n?.quantity) > 0 ? num(n?.quantity) : 1;
    const mat = (n?.materials ?? []).find((x) => key(x.code) === key(c.code) || key(x.inventoryCode) === key(c.code) || key(x.name) === key(c.code));
    if (!mat) {
      out.push({ kind: "add", wipNo: c.wipNo, code: c.code, perProduct: c.qty, unit: c.unit ?? "" });
      continue;
    }
    const fromPerProduct = (num(mat.qty) || 0) * pcs;
    if (Math.abs(fromPerProduct - c.qty) > 1e-9) out.push({ kind: "qty", wipNo: c.wipNo, code: String(mat.code || mat.name || c.code), fromPerProduct, toPerProduct: c.qty });
  }
  for (const a of reading.newMaterials) out.push({ kind: "add", wipNo: a.wipNo, code: a.code, perProduct: a.qty, unit: a.unit ?? "" });
  return out;
}

/** Apply the ticked changes; quantities on the form are per PRODUCT, the BOM
 *  stores per PIECE — divide by the WIP's pieces. Returns a new BOM. */
export function applyRdScan<T extends ScanBom>(bom: T, changes: RdChange[], lookup: (code: string) => { code: string; name: string; unit: string } | null): T {
  const next = JSON.parse(JSON.stringify(bom)) as T;
  const wips = numberedWips(next);
  for (const ch of changes) {
    const n = wips[ch.wipNo - 1];
    if (!n) continue;
    const pcs = num(n.quantity) > 0 ? num(n.quantity) : 1;
    if (ch.kind === "minutes") {
      const p = (n.processes ?? []).find((x) => key(x.dept) === key(ch.dept) || key(x.deptCode) === key(ch.dept));
      if (p) p.minutes = ch.to;
    } else if (ch.kind === "qty") {
      const m = (n.materials ?? []).find((x) => key(x.code) === key(ch.code) || key(x.name) === key(ch.code) || key(x.inventoryCode) === key(ch.code));
      if (m) m.qty = +(ch.toPerProduct / pcs).toFixed(4);
    } else if (ch.kind === "add") {
      const hit = lookup(ch.code);
      n.materials = [
        ...(n.materials ?? []),
        hit
          ? { code: hit.code, inventoryCode: hit.code, name: hit.name, unit: ch.unit || hit.unit, qty: +(ch.perProduct / pcs).toFixed(4) }
          : { code: ch.code, name: ch.code, unit: ch.unit || "PCS", qty: +(ch.perProduct / pcs).toFixed(4) },
      ];
    }
  }
  return next;
}
