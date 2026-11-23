// ---------------------------------------------------------------------------
// MRP · Raw Material Stock Status (owner 2026-11-23 — full Houzs parity,
// design canvas board ① approved 「可以了 去做吧」).
//
// One row per raw material needed by open production orders, netted against
// RM stock and open POs (GET /api/mrp/plan, recomputed live). Expand a row for
// each production order: what covers it (Stock / PO / Short), its need-by and
// order-by dates and the supplier to buy from. Tick shortage lines → Proceed PO
// creates REAL (CONFIRMED) purchase orders, Combined (one per supplier) or Per
// SO (one per supplier per order), through the normal PO endpoint.
//
// Tabs = merged material groups (src/lib/mrp-groups.ts). Dates dd/mm/yyyy.
// No KPI tiles (owner: 「这些不需要」).
// ---------------------------------------------------------------------------
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { RefreshCw, Loader2, Download, ChevronRight, ChevronDown, Clock, ShoppingCart, Columns3, WrapText, Filter } from "lucide-react";
import type { RowKind, StyledSheet } from "@/lib/styled-xlsx";

// ---- API shapes -----------------------------------------------------------
type Cover =
  | { source: "STOCK"; qty: number }
  | { source: "PO"; ref: string; eta: string; qty: number };

type OrderLine = {
  productionOrderId: string;
  poNo: string;
  productCode: string;
  quantity: number;
  jobCardId: string | null;
  dept: string;
  wipKey: string;
  required: number;
  needBy: string;
  due: string;
  soDate: string;
  covers: Cover[];
  shortQty: number;
  status: "READY" | "WAITING_PO" | "SHORT";
};

type BoundSupplier = {
  supplierId: string;
  name: string;
  code: string;
  unitPriceSen: number;
  leadTimeDays: number;
  moq: number;
  isMain: boolean;
};

type MaterialRow = {
  rmId: string;
  code: string;
  description: string;
  itemGroup: string;
  group: string;
  uom: string;
  needed: number;
  stock: number;
  poOutstanding: number;
  poOtherUnit: { ref: string; eta: string; qty: number; unit: string }[];
  short: number;
  firstNeedBy: string;
  mainSupplier: string | null;
  mainSupplierId: string | null;
  suppliers: BoundSupplier[];
  orders: OrderLine[];
};

type Plan = {
  calculatedAt: string;
  groups: string[];
  materials: MaterialRow[];
  productionOrders: { open: number; counted: number; alreadyDeducted: number; noBom: number };
  unresolved: { poNo: string; productCode: string; material: string; required: number }[];
  openPoLinesUnresolved: number;
  allSuppliers: { id: string; name: string; code: string }[];
  leadTimes: Record<string, number>;
};

// ---- helpers --------------------------------------------------------------
type DateType = "needBy" | "orderBy" | "due" | "soDate";
type Mode = "combined" | "perso";
type ColKey = "code" | "group" | "uom" | "need" | "stock" | "po" | "short" | "needBy" | "orderBy" | "sup" | "orders" | "status";

const COLS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "code", label: "Raw material" },
  { key: "group", label: "Material" },
  { key: "uom", label: "UOM" },
  { key: "need", label: "Needed", num: true },
  { key: "stock", label: "Stock", num: true },
  { key: "po", label: "PO Outstanding", num: true },
  { key: "short", label: "Short", num: true },
  { key: "needBy", label: "Need-by" },
  { key: "orderBy", label: "Order-by" },
  { key: "sup", label: "Main supplier" },
  { key: "orders", label: "Orders", num: true },
  { key: "status", label: "Status" },
];

const DEPT_LABEL: Record<string, string> = {
  FAB_CUT: "Fab Cut",
  FAB_SEW: "Fab Sew",
  WOOD_CUT: "Wood Cut",
  FOAM_CUTTING: "Foam Cutting",
  FOAM: "Foam",
  FIBRE: "Fibre",
  FRAMING: "Framing",
  WEBBING: "Webbing",
  UPHOLSTERY: "Upholstery",
  PACKING: "Packing",
};

const EPS = 1e-9;
const COLS_STORE = "mrp.hiddenCols.v1";

const fmtQty = (n: number): string =>
  Math.abs(n) < EPS ? "—" : n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// System date standard: dd/mm/yyyy, read straight off the ISO string (no
// timezone shift).
const dmy = (iso: string): string => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const dmyTime = (iso: string): string => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
};

const minusDays = (iso: string, days: number): string => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const lineKey = (rmId: string, o: OrderLine): string => `${rmId}|${o.productionOrderId}|${o.wipKey}|${o.dept}`;

function readHidden(): Partial<Record<ColKey, boolean>> {
  try {
    const raw = localStorage.getItem(COLS_STORE);
    return raw ? (JSON.parse(raw) as Partial<Record<ColKey, boolean>>) : {};
  } catch {
    return {};
  }
}
function writeHidden(h: Partial<Record<ColKey, boolean>>) {
  try {
    localStorage.setItem(COLS_STORE, JSON.stringify(h));
  } catch {
    /* per-viewer convenience only */
  }
}

type Dialog =
  | { kind: "confirm" }
  | { kind: "info"; title: string; body: string }
  | { kind: "stale"; body: string }
  | { kind: "created"; body: string }
  | { kind: "lead" };

// One order line as the page sees it: chosen supplier, its lead time, order-by.
type ViewLine = OrderLine & { key: string; supplierId: string; supplierName: string; lead: number; orderBy: string };
type ViewRow = MaterialRow & { lines: ViewLine[]; wNeed: number; wShort: number; wFirstNeed: string; wFirstOrderBy: string; statusLabel: string };

function summarise(r: MaterialRow, lines: ViewLine[]): ViewRow {
  const wShort = lines.reduce((s, l) => s + l.shortQty, 0);
  return {
    ...r,
    lines,
    wNeed: lines.reduce((s, l) => s + l.required, 0),
    wShort,
    wFirstNeed: lines.map((l) => l.needBy).filter(Boolean).sort()[0] ?? "",
    wFirstOrderBy: lines.filter((l) => l.shortQty > EPS).map((l) => l.orderBy).filter(Boolean).sort()[0] ?? "",
    statusLabel: wShort > EPS ? "Short" : lines.some((l) => l.covers.some((c) => c.source === "PO")) ? "Waiting PO" : "Ready",
  };
}

export default function MRPPage() {
  const navigate = useNavigate();
  const { data: resp, loading, error } = useCachedJson<{ success?: boolean; data?: Plan; error?: string }>("/api/mrp/plan");
  const [fresh, setFresh] = useState<Plan | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const plan = fresh ?? (resp?.success ? resp.data : undefined);

  const [mode, setMode] = useState<Mode>("combined");
  const [tab, setTab] = useState("ALL");
  const [dateType, setDateType] = useState<DateType>("needBy");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showNoDate, setShowNoDate] = useState(true);
  const [onlyShort, setOnlyShort] = useState(false);
  const [q, setQ] = useState("");
  const [wrap, setWrap] = useState(false);
  const [hidden, setHidden] = useState<Partial<Record<ColKey, boolean>>>(readHidden);
  const [colsOpen, setColsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [colFilter, setColFilter] = useState<Partial<Record<ColKey, string>>>({});
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 }>({ key: "short", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [supPick, setSupPick] = useState<Record<string, string>>({});
  const [leadEdit, setLeadEdit] = useState<Record<string, number> | null>(null);
  const [leadOverride, setLeadOverride] = useState<Record<string, number> | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [expectedAt, setExpectedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const leadTimes = useMemo(() => leadOverride ?? plan?.leadTimes ?? {}, [leadOverride, plan]);
  const supplierName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of plan?.allSuppliers ?? []) m.set(s.id, s.name);
    return m;
  }, [plan]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/mrp/plan", { cache: "no-store" });
      const json = (await res.json()) as { success?: boolean; data?: Plan; error?: string };
      if (json.success && json.data) {
        setFresh(json.data);
        setSel(new Set());
        invalidateCachePrefix("/api/mrp/plan");
      } else {
        setRefreshError(json.error || `MRP calculation failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  // Every row with its lines resolved (supplier, lead time, order-by), before
  // any filter — Export All and the tab counts use this.
  const allRows: ViewRow[] = useMemo(
    () =>
      (plan?.materials ?? []).map((m) => {
        const lines: ViewLine[] = m.orders.map((o) => {
          const key = lineKey(m.rmId, o);
          const supplierId = supPick[key] ?? m.mainSupplierId ?? m.suppliers[0]?.supplierId ?? "";
          const bound = m.suppliers.find((s) => s.supplierId === supplierId);
          const lead = bound && bound.leadTimeDays > 0 ? bound.leadTimeDays : (leadTimes[supplierId] ?? 0);
          return { ...o, key, supplierId, supplierName: bound?.name ?? supplierName.get(supplierId) ?? "", lead, orderBy: minusDays(o.needBy, lead) };
        });
        return summarise(m, lines);
      }),
    [plan, supPick, leadTimes, supplierName],
  );

  // Rows after the date window (lines outside it drop; Needed / Short recount).
  const windowed: ViewRow[] = useMemo(() => {
    const dateOf = (l: ViewLine): string => (dateType === "orderBy" ? l.orderBy : l[dateType]) || "";
    const inWindow = (l: ViewLine): boolean => {
      const d = dateOf(l);
      if (!d) return showNoDate;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    return allRows.map((r) => summarise(r, r.lines.filter(inWindow))).filter((r) => r.lines.length > 0);
  }, [allRows, dateType, from, to, showNoDate]);

  const cellText = (r: ViewRow, k: ColKey): string => {
    switch (k) {
      case "code": return `${r.code} ${r.description}`;
      case "group": return `${r.group} ${r.itemGroup}`;
      case "uom": return r.uom;
      case "need": return fmtQty(r.wNeed);
      case "stock": return fmtQty(r.stock);
      case "po": return fmtQty(r.poOutstanding);
      case "short": return r.wShort > EPS ? fmtQty(r.wShort) : "—";
      case "needBy": return dmy(r.wFirstNeed);
      case "orderBy": return r.wShort > EPS ? dmy(r.wFirstOrderBy) : "—";
      case "sup": return r.mainSupplier ?? "Not set";
      case "orders": return String(r.lines.length);
      case "status": return r.statusLabel;
    }
  };
  const sortVal = (r: ViewRow, k: ColKey): string | number => {
    switch (k) {
      case "need": return r.wNeed;
      case "stock": return r.stock;
      case "po": return r.poOutstanding;
      case "short": return r.wShort;
      case "orders": return r.lines.length;
      case "needBy": return r.wFirstNeed || "9999";
      case "orderBy": return r.wFirstOrderBy || "9999";
      default: return cellText(r, k).toLowerCase();
    }
  };

  const needle = q.trim().toLowerCase();
  const rows = windowed
    .filter((r) => tab === "ALL" || r.group === tab)
    .filter((r) => !onlyShort || r.wShort > EPS)
    .filter(
      (r) =>
        !needle ||
        r.code.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.lines.some((l) => l.poNo.toLowerCase().includes(needle) || l.productCode.toLowerCase().includes(needle)),
    )
    .filter((r) =>
      (Object.entries(colFilter) as [ColKey, string][]).every(([k, v]) => !v || cellText(r, k).toLowerCase().includes(v.toLowerCase())),
    )
    .sort((a, b) => {
      const x = sortVal(a, sort.key);
      const y = sortVal(b, sort.key);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir || a.code.localeCompare(b.code);
    });

  const shown = COLS.filter((c) => !hidden[c.key]);
  const tabs = useMemo(() => {
    const groups = plan?.groups ?? [];
    const extra = [...new Set(windowed.map((r) => r.group))].filter((g) => !groups.includes(g));
    return ["ALL", ...groups, ...extra].map((g) => {
      const rs = windowed.filter((r) => g === "ALL" || r.group === g);
      return { key: g, label: g === "ALL" ? "All" : g, count: rs.length, short: rs.filter((r) => r.wShort > EPS).length };
    });
  }, [plan, windowed]);

  // Selection = shortage lines (by key).
  const visibleShortKeys = rows.flatMap((r) => r.lines.filter((l) => l.shortQty > EPS).map((l) => l.key));
  const allVisibleSelected = visibleShortKeys.length > 0 && visibleShortKeys.every((k) => sel.has(k));
  const picks = allRows.flatMap((r) => r.lines.filter((l) => l.shortQty > EPS && sel.has(l.key)).map((l) => ({ row: r, line: l })));

  const toggleKeys = (keys: string[], on: boolean) =>
    setSel((prev) => {
      const n = new Set(prev);
      for (const k of keys) {
        if (on) n.add(k);
        else n.delete(k);
      }
      return n;
    });

  // ---- Proceed PO ---------------------------------------------------------
  const openProceed = () => {
    if (picks.length === 0) {
      setDialog({ kind: "info", title: "Nothing to order", body: "No uncovered (shortage) lines in the current selection." });
      return;
    }
    const noSup = [...new Set(picks.filter((p) => !p.line.supplierId).map((p) => p.row.code))];
    if (noSup.length > 0) {
      setDialog({
        kind: "info",
        title: "Pick a supplier first",
        body: `These materials have no supplier yet. Choose one in the Supplier column (any supplier — it will be bound to the material):\n${noSup.map((c) => `• ${c}`).join("\n")}`,
      });
      return;
    }
    setExpectedAt("");
    setDialog({ kind: "confirm" });
  };

  const runCreate = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      // 1. Stale-plan guard — a PO raised for these materials after the plan
      //    was calculated means the shortage may already be covered.
      const codes = [...new Set(picks.map((p) => p.row.code))];
      const chk = await fetch(`/api/mrp/plan-check?asOf=${encodeURIComponent(plan.calculatedAt)}&codes=${encodeURIComponent(codes.join(","))}`);
      const chkJson = (await chk.json()) as { success?: boolean; stale?: boolean; data?: { poNo: string; code: string }[]; error?: string };
      if (!chkJson.success) throw new Error(chkJson.error || `Plan check failed (HTTP ${chk.status})`);
      if (chkJson.stale) {
        const list = (chkJson.data ?? []).map((h) => `${h.poNo} (${h.code})`).join(", ");
        setDialog({ kind: "stale", body: `${list} was raised after this plan was calculated (${dmyTime(plan.calculatedAt)}). Refresh and tick again, so nothing is ordered twice.` });
        return;
      }
      // 2. Bind a supplier picked for a material it is not bound to yet
      //    (owner option 2). A duplicate (409) means it is already bound.
      const boundNow = new Set<string>();
      for (const p of picks) {
        const bk = `${p.line.supplierId}|${p.row.code}`;
        if (boundNow.has(bk) || p.row.suppliers.some((s) => s.supplierId === p.line.supplierId)) continue;
        const res = await fetch("/api/supplier-materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: p.line.supplierId,
            materialCode: p.row.code,
            materialName: p.row.description || p.row.code,
            supplierSku: p.row.code,
            unitPrice: 0,
          }),
        });
        if (!res.ok && res.status !== 409) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(`Could not bind ${p.line.supplierName} to ${p.row.code}: ${j.error ?? res.status}`);
        }
        boundNow.add(bk);
      }
      // 3. Group: Combined = one PO per supplier; Per SO = per supplier per order.
      type G = { supplierId: string; supplierName: string; key: string; orders: Set<string>; needBy: string; items: Map<string, { row: ViewRow; qty: number }> };
      const groups = new Map<string, G>();
      for (const p of picks) {
        const gk = mode === "combined" ? p.line.supplierId : `${p.line.supplierId}|${p.line.productionOrderId}`;
        const g = groups.get(gk) ?? { supplierId: p.line.supplierId, supplierName: p.line.supplierName, key: gk, orders: new Set<string>(), needBy: p.line.needBy, items: new Map() };
        g.orders.add(p.line.poNo);
        if (p.line.needBy && (!g.needBy || p.line.needBy < g.needBy)) g.needBy = p.line.needBy;
        const it = g.items.get(p.row.rmId) ?? { row: p.row, qty: 0 };
        it.qty += p.line.shortQty;
        g.items.set(p.row.rmId, it);
        groups.set(gk, g);
      }
      const created: string[] = [];
      const failed: string[] = [];
      for (const g of groups.values()) {
        const items = [...g.items.values()].map(({ row, qty }) => {
          const bound = row.suppliers.find((s) => s.supplierId === g.supplierId);
          // MOQ is a MINIMUM order quantity; 0 = not stated.
          const quantity = Math.round(Math.max(qty, bound?.moq ?? 0) * 100) / 100;
          return {
            materialCategory: row.itemGroup,
            materialCode: row.code,
            materialName: `${row.code} - ${row.description}`,
            supplierSKU: row.code,
            quantity,
            unitPriceSen: bound?.unitPriceSen ?? 0,
            unit: row.uom,
          };
        });
        const res = await fetch("/api/purchase-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `mrp-${plan.calculatedAt}-${g.key}`.slice(0, 120) },
          body: JSON.stringify({
            supplierId: g.supplierId,
            supplierName: g.supplierName,
            status: "CONFIRMED",
            expectedDate: expectedAt || g.needBy || "",
            notes: `From MRP (${mode === "combined" ? "Combined" : "Per SO"}) — for ${[...g.orders].join(", ")}`,
            items,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { poNo?: string }; error?: string };
        if (res.ok && j.success) created.push(`${j.data?.poNo ?? "PO"} ${g.supplierName} (${items.length} line${items.length === 1 ? "" : "s"})`);
        else failed.push(`${g.supplierName}: ${j.error ?? `HTTP ${res.status}`}`);
      }
      invalidateCachePrefix("/api/purchase-orders");
      setSel(new Set());
      setDialog({
        kind: "created",
        body:
          (created.length ? `${created.length} purchase order${created.length === 1 ? "" : "s"} created (CONFIRMED): ${created.join("; ")}.` : "No purchase order was created.") +
          (failed.length ? `\nFailed: ${failed.join("; ")}` : ""),
      });
      await refresh();
    } catch (err) {
      setDialog({ kind: "info", title: "Proceed PO failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  // ---- Lead times ---------------------------------------------------------
  const saveLead = async () => {
    if (!leadEdit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mrp/lead-times", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadTimes: leadEdit }),
      });
      const j = (await res.json()) as { success?: boolean; data?: Record<string, number>; error?: string };
      if (!j.success || !j.data) throw new Error(j.error || `HTTP ${res.status}`);
      setLeadOverride(j.data);
      setDialog(null);
    } catch (err) {
      setDialog({ kind: "info", title: "Lead times not saved", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  // Suppliers worth listing in the Lead Times dialog: the ones on this plan.
  const leadSuppliers = useMemo(() => {
    const ids = new Set<string>();
    for (const r of allRows) {
      for (const s of r.suppliers) ids.add(s.supplierId);
      for (const l of r.lines) if (l.supplierId) ids.add(l.supplierId);
    }
    return [...ids].map((id) => ({ id, name: supplierName.get(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows, supplierName]);

  // ---- Export ---------------------------------------------------------------
  const exportRows = async (which: ViewRow[], label: string) => {
    if (!plan) return;
    setExporting(true);
    try {
      const { exportStyledWorkbookXlsx } = await import("@/lib/styled-xlsx");
      const stamp = `As of ${dmyTime(plan.calculatedAt)} · ${label}`;
      const mat: (string | number)[][] = [
        ["MRP · Raw Material Stock Status"],
        [stamp],
        [],
        ["Code", "Description", "Material", "RM category", "UOM", "Needed", "Stock", "PO outstanding", "Other-unit PO", "Short", "Need-by", "Order-by", "Main supplier", "Orders", "Status"],
      ];
      const mk: RowKind[] = ["title", "meta", "blank", "header"];
      const ord: (string | number)[][] = [
        ["MRP · production orders per material"],
        [stamp],
        [],
        ["Code", "Production order", "Product", "Qty", "Used at", "Needs", "UOM", "Need-by", "Order-by", "Customer due", "SO date", "Covered by", "Short", "Supplier", "Status"],
      ];
      const ok: RowKind[] = ["title", "meta", "blank", "header"];
      for (const r of which) {
        mat.push([
          r.code, r.description, r.group, r.itemGroup, r.uom, r.wNeed, r.stock, r.poOutstanding,
          r.poOtherUnit.map((p) => `${p.ref} ${p.qty} ${p.unit}`).join("; "), r.wShort, dmy(r.wFirstNeed),
          r.wShort > EPS ? dmy(r.wFirstOrderBy) : "", r.mainSupplier ?? "", r.lines.length, r.statusLabel,
        ]);
        mk.push("item");
        for (const l of r.lines) {
          ord.push([
            r.code, l.poNo, l.productCode, l.quantity, DEPT_LABEL[l.dept] ?? l.dept, l.required, r.uom, dmy(l.needBy),
            l.shortQty > EPS ? dmy(l.orderBy) : "", dmy(l.due), dmy(l.soDate),
            l.covers.map((c) => (c.source === "STOCK" ? `Stock ${fmtQty(c.qty)}` : `${c.ref} ${fmtQty(c.qty)}`)).join("; "),
            l.shortQty, l.supplierName, l.status === "READY" ? "Ready" : l.status === "WAITING_PO" ? "Waiting PO" : "Short",
          ]);
          ok.push("item");
        }
      }
      const sheets: StyledSheet[] = [
        { name: "Materials", aoa: mat, kinds: mk, cols: [18, 30, 12, 11, 7, 10, 10, 12, 18, 10, 11, 11, 24, 7, 10], numCols: [5, 6, 7, 9, 13] },
        { name: "Orders", aoa: ord, kinds: ok, cols: [18, 18, 18, 5, 11, 9, 6, 11, 11, 11, 11, 34, 9, 24, 10], numCols: [3, 5, 12] },
      ];
      await exportStyledWorkbookXlsx(`MRP-${plan.calculatedAt.slice(0, 10)}${label === "All" ? "" : `-${label}`}.xlsx`, sheets);
    } finally {
      setExporting(false);
    }
  };

  const today = todayIso();
  const failedLoad = !loading && !plan;
  const btn = "inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#D8D1C3] bg-white px-3 text-xs font-semibold tracking-wide text-[#374151] cursor-pointer hover:bg-[#FAF8F4] disabled:opacity-50";
  const lbl = "text-[11px] font-bold tracking-wider text-[#6B7280]";
  const input = "h-8 rounded-lg border border-[#D8D1C3] bg-white px-2 text-xs text-[#111827]";
  const primary = "inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[#6B5C32] px-4 text-sm font-bold text-white cursor-pointer disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-bold tracking-[.12em] text-[#6B7280]">— PLANNING</div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold text-[#1F1D1B] sm:text-2xl">MRP · Raw Material Stock Status</h1>
        <div className="inline-flex overflow-hidden rounded-lg border border-[#D8D1C3] bg-white" role="group" aria-label="PO mode">
          {(["combined", "perso"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`h-[34px] px-4 text-xs font-bold tracking-wide cursor-pointer ${mode === m ? "bg-[#6B5C32] text-white" : "text-[#374151]"}`}
            >
              {m === "combined" ? "COMBINED" : "PER SO"}
            </button>
          ))}
        </div>
        <button type="button" className={btn} onClick={() => setOpen(new Set())}>COLLAPSE</button>
        <button type="button" className={btn} onClick={() => setOpen(new Set(rows.map((r) => r.rmId)))}>EXPAND</button>
        <button type="button" className={btn} onClick={refresh} disabled={refreshing || loading}>
          {refreshing || loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} REFRESH
        </button>
        {plan && (
          <span className="inline-flex items-center gap-1 text-xs text-[#6B7280]">
            <Clock className="h-3.5 w-3.5" /> as of {dmyTime(plan.calculatedAt)}
          </span>
        )}
        <button type="button" className={btn} onClick={() => { setLeadEdit({ ...leadTimes }); setDialog({ kind: "lead" }); }} disabled={!plan}>
          <Clock className="h-3.5 w-3.5" /> LEAD TIMES
        </button>
        <button
          type="button"
          onClick={openProceed}
          disabled={!plan || busy}
          className={`inline-flex h-[38px] items-center gap-1.5 rounded-lg px-4 text-sm font-bold text-white cursor-pointer ${picks.length ? "bg-[#6B5C32] hover:bg-[#5A4D29]" : "bg-[#B9AE95]"}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />} Proceed PO ({picks.length})
        </button>
      </div>

      {refreshError && (
        <div className="rounded-lg border border-[#EBC6BF] bg-[#FDF1EF] p-3 text-sm text-[#9A3A2D]">Refresh failed: {refreshError}</div>
      )}
      {loading && !plan && (
        <div className="flex h-64 items-center justify-center text-[#6B7280]">
          <Loader2 className="h-6 w-6 animate-spin text-[#6B5C32]" />
          <span className="ml-3">Calculating MRP…</span>
        </div>
      )}
      {failedLoad && (
        <div className="rounded-lg border border-[#EBC6BF] bg-[#FDF1EF] p-4 text-sm text-[#9A3A2D]">
          {resp?.error || error || "The MRP could not be calculated."} Press Refresh to try again.
        </div>
      )}

      {plan && (
        <>
          <div className="flex flex-wrap gap-0.5 border-b border-[#E2DDD8]" role="tablist" aria-label="Material">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] cursor-pointer ${
                  tab === t.key ? "border-[#6B5C32] font-bold text-[#6B5C32]" : `border-transparent ${t.count ? "text-[#374151]" : "text-[#B8B0A0]"}`
                }`}
              >
                {t.label} <span className="text-[11px] text-[#9CA3AF]">{t.count}</span>
                {t.short > 0 && <span className="ml-1 rounded-full bg-[#B42318] px-1.5 py-px text-[10px] font-bold text-white">{t.short}</span>}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className={lbl}>DATE</span>
            <select className={`${input} w-44 font-semibold`} value={dateType} onChange={(e) => setDateType(e.target.value as DateType)} aria-label="Date type">
              <option value="needBy">Need-by date</option>
              <option value="orderBy">Order-by date</option>
              <option value="due">Customer due date</option>
              <option value="soDate">SO date</option>
            </select>
            <span className={lbl}>FROM</span>
            <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className={lbl}>TO</span>
            <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            <label className={`${lbl} flex items-center gap-1.5 cursor-pointer`}>
              <input type="checkbox" checked={showNoDate} onChange={(e) => setShowNoDate(e.target.checked)} /> SHOW NO-DATE
            </label>
            <label className={`${lbl} flex items-center gap-1.5 cursor-pointer`}>
              <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} /> ONLY SHORTAGES
            </label>
            <span className={lbl}>WAREHOUSE</span>
            <select className={`${input} w-44`} disabled title="Raw materials have no warehouse yet" aria-label="Warehouse">
              <option>All warehouses</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="search"
              className={`${input} h-[34px] w-72`}
              placeholder="Material, production order, product…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search"
            />
            <span className="text-xs text-[#6B7280]">
              <b className="text-[#111827]">{rows.length}</b> rows · <b className="text-[#111827]">{shown.length}</b> of {COLS.length} cols
            </span>
            <span className="flex-1" />
            <button type="button" className={btn} onClick={() => exportRows(windowed, "All")} disabled={exporting}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} EXPORT ALL
            </button>
            <button type="button" className={btn} onClick={() => exportRows(rows, tab === "ALL" ? "All" : tab)} disabled={exporting || rows.length === 0}>
              <Download className="h-3.5 w-3.5" /> EXPORT CURRENT TAB ({rows.length})
            </button>
            <button type="button" className={`${btn} ${wrap ? "border-[#6B5C32] text-[#6B5C32]" : ""}`} onClick={() => setWrap((w) => !w)} aria-pressed={wrap}>
              <WrapText className="h-3.5 w-3.5" /> WRAP
            </button>
            <button type="button" className={`${btn} ${showFilters ? "border-[#6B5C32] text-[#6B5C32]" : ""}`} onClick={() => setShowFilters((v) => !v)} aria-pressed={showFilters}>
              <Filter className="h-3.5 w-3.5" /> FILTERS
            </button>
            <div className="relative">
              <button type="button" className={btn} onClick={() => setColsOpen((v) => !v)} aria-expanded={colsOpen}>
                <Columns3 className="h-3.5 w-3.5" /> Columns · {shown.length}
              </button>
              {colsOpen && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-[#E2DDD8] bg-white p-2.5 shadow-lg">
                  <div className={`${lbl} mb-1`}>COLUMNS</div>
                  {COLS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 py-0.5 text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!hidden[c.key]}
                        disabled={c.key === "code"}
                        onChange={() => {
                          const n = { ...hidden, [c.key]: !hidden[c.key] };
                          setHidden(n);
                          writeHidden(n);
                        }}
                      />
                      {c.label}
                    </label>
                  ))}
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" className={btn} onClick={() => { setHidden({}); writeHidden({}); }}>Show all</button>
                    <button type="button" className={btn} onClick={() => setColsOpen(false)}>Done</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#E2DDD8] bg-white">
            <div className="max-h-[70vh] overflow-auto" data-testid="mrp-requirements-scroll">
              <table className="w-full min-w-[1100px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#FAF8F4] text-left text-xs text-[#374151]">
                    <th className="w-12 bg-[#FAF8F4] px-2 py-2">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={() => toggleKeys(visibleShortKeys, !allVisibleSelected)}
                        aria-label="Select all shortage lines"
                      />
                    </th>
                    {shown.map((c) => (
                      <th
                        key={c.key}
                        className={`${c.key === "code" ? "sticky left-0 z-10 " : ""}whitespace-nowrap border-l border-[#EFEBE3] bg-[#FAF8F4] px-2 py-2 font-semibold ${c.num ? "text-right" : ""}`}
                      >
                        <button
                          type="button"
                          className="cursor-pointer"
                          onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                          aria-label={`Sort by ${c.label}`}
                        >
                          {c.label} <span className="text-[#9CA3AF]">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                  {showFilters && (
                    <tr className="bg-[#FAF8F4]">
                      <th className="bg-[#FAF8F4]" />
                      {shown.map((c) => (
                        <th key={c.key} className={`${c.key === "code" ? "sticky left-0 z-10 " : ""}border-l border-[#EFEBE3] bg-[#FAF8F4] px-1.5 pb-1.5`}>
                          <input
                            type="text"
                            value={colFilter[c.key] ?? ""}
                            onChange={(e) => setColFilter((f) => ({ ...f, [c.key]: e.target.value }))}
                            placeholder="Filter…"
                            aria-label={`Filter ${c.label}`}
                            className="h-7 w-full min-w-[60px] rounded border border-[#D8D1C3] px-1.5 text-xs font-normal"
                          />
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={shown.length + 1} className="px-4 py-10 text-center text-sm text-[#6B7280]">
                        {plan.materials.length === 0 ? "No raw materials are needed by open production orders." : "Nothing matches these filters."}
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => {
                    const isOpen = open.has(r.rmId);
                    const isShort = r.wShort > EPS;
                    const shortKeys = r.lines.filter((l) => l.shortQty > EPS).map((l) => l.key);
                    const allOn = shortKeys.length > 0 && shortKeys.every((k) => sel.has(k));
                    const late = isShort && !!r.wFirstOrderBy && r.wFirstOrderBy < today;
                    const bg = isShort ? "bg-[#FFFBFA]" : "bg-white";
                    const ws = wrap ? "whitespace-normal" : "whitespace-nowrap";
                    const bound = new Set(r.suppliers.map((s) => s.supplierId));
                    return (
                      <Fragment key={r.rmId}>
                        <tr className={`border-t border-[#EFEBE3] ${bg}`}>
                          <td className="whitespace-nowrap px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(r.rmId)) n.delete(r.rmId); else n.add(r.rmId); return n; })}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} orders for ${r.code}`}
                              className="mr-1 align-middle text-[#6B7280] cursor-pointer"
                            >
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                            {isShort && (
                              <input type="checkbox" className="align-middle" checked={allOn} onChange={() => toggleKeys(shortKeys, !allOn)} aria-label={`Select shortage lines of ${r.code}`} />
                            )}
                          </td>
                          {shown.map((c) => {
                            const base = `border-l border-[#F5F2EC] px-2 py-2 tabular-nums ${ws} ${c.num ? "text-right" : ""}`;
                            if (c.key === "code")
                              return (
                                <td key={c.key} className={`${base} sticky left-0 z-[5] ${bg}`}>
                                  <b>{r.code}</b> <span className="text-[#6B7280]">{r.description}</span>
                                </td>
                              );
                            if (c.key === "group")
                              return (
                                <td key={c.key} className={base}>
                                  <span className="rounded bg-[#F3EFE6] px-1.5 py-0.5 text-[11px] text-[#5B4D27]">{r.group}</span>{" "}
                                  <span className="text-[10px] text-[#9CA3AF]">{r.itemGroup}</span>
                                </td>
                              );
                            if (c.key === "po")
                              return (
                                <td key={c.key} className={base}>
                                  {fmtQty(r.poOutstanding)}
                                  {r.poOtherUnit.length > 0 && (
                                    <div className="text-[11px] font-semibold text-[#8A6A12]" title="Ordered in another unit — not counted (no unit conversion)">
                                      {r.poOtherUnit.map((p) => `+${fmtQty(p.qty)} ${p.unit}`).join(", ")}
                                    </div>
                                  )}
                                </td>
                              );
                            const cls =
                              c.key === "short" ? `font-bold ${isShort ? "text-[#B42318]" : "text-[#9CA3AF]"}`
                              : c.key === "need" ? "font-semibold"
                              : c.key === "orderBy" && late ? "font-bold text-[#B42318]"
                              : c.key === "sup" && !r.mainSupplier ? "text-[#8A6A12]"
                              : c.key === "status" ? `font-bold ${isShort ? "text-[#B42318]" : r.statusLabel === "Ready" ? "text-[#1E6B3F]" : "text-[#1F4E6B]"}`
                              : c.key === "uom" ? "text-[#6B7280]"
                              : "";
                            return (
                              <td key={c.key} className={`${base} ${cls}`}>
                                {cellText(r, c.key)}
                                {c.key === "orderBy" && late ? " · late" : ""}
                              </td>
                            );
                          })}
                        </tr>
                        {isOpen && (
                          <tr className="bg-[#FCFBF8]">
                            <td colSpan={shown.length + 1} className="px-8 pb-3 pt-1">
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[980px] border-collapse rounded-lg border border-[#EFEBE3] bg-white text-xs">
                                  <thead>
                                    <tr className="text-left text-[11px] text-[#6B7280]">
                                      <th className="w-7 px-2 py-1.5" />
                                      <th className="px-1.5 py-1.5">Production order</th>
                                      <th className="px-1.5 py-1.5">Product</th>
                                      <th className="px-1.5 py-1.5 text-right">Qty</th>
                                      <th className="px-1.5 py-1.5">Used at</th>
                                      <th className="px-1.5 py-1.5 text-right">Needs</th>
                                      <th className="px-1.5 py-1.5">Need-by</th>
                                      <th className="px-1.5 py-1.5">Order-by</th>
                                      <th className="px-1.5 py-1.5">Covered by</th>
                                      <th className="px-1.5 py-1.5">Supplier</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.lines.map((l) => {
                                      const lShort = l.shortQty > EPS;
                                      const lLate = lShort && !!l.orderBy && l.orderBy < today;
                                      return (
                                        <tr key={l.key} className="border-t border-[#F3F0EA]">
                                          <td className="px-2 py-1.5">
                                            {lShort && (
                                              <input type="checkbox" checked={sel.has(l.key)} onChange={() => toggleKeys([l.key], !sel.has(l.key))} aria-label={`Select ${l.poNo}`} />
                                            )}
                                          </td>
                                          <td className="px-1.5 py-1.5 font-semibold text-[#6B5A2E]">{l.poNo}</td>
                                          <td className="px-1.5 py-1.5">{l.productCode}</td>
                                          <td className="px-1.5 py-1.5 text-right">{l.quantity}</td>
                                          <td className="px-1.5 py-1.5 text-[#6B7280]">{DEPT_LABEL[l.dept] ?? l.dept}</td>
                                          <td className="px-1.5 py-1.5 text-right tabular-nums">{fmtQty(l.required)} {r.uom}</td>
                                          <td className="px-1.5 py-1.5 tabular-nums">{dmy(l.needBy)}</td>
                                          <td className={`px-1.5 py-1.5 tabular-nums ${lLate ? "font-bold text-[#B42318]" : ""}`}>
                                            {lShort ? `${dmy(l.orderBy)}${lLate ? " · late" : ""}` : "—"}
                                          </td>
                                          <td className="px-1.5 py-1.5">
                                            <span className="flex flex-wrap gap-1">
                                              {l.covers.map((c, j) => (
                                                <span key={j} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${c.source === "STOCK" ? "bg-[#E7F3EC] text-[#1E6B3F]" : "bg-[#E8F0F8] text-[#1F4E6B]"}`}>
                                                  {c.source === "STOCK" ? `Stock ${fmtQty(c.qty)} ${r.uom}` : `${c.ref}${c.eta ? ` · ETA ${dmy(c.eta)}` : ""} · ${fmtQty(c.qty)} ${r.uom}`}
                                                </span>
                                              ))}
                                              {lShort && (
                                                <span className="rounded bg-[#FDECEA] px-1.5 py-0.5 text-[11px] font-semibold text-[#B42318]">Short {fmtQty(l.shortQty)} {r.uom}</span>
                                              )}
                                            </span>
                                          </td>
                                          <td className="px-1.5 py-1.5">
                                            {lShort ? (
                                              <select
                                                className="h-7 max-w-[240px] rounded border border-[#D8D1C3] bg-white px-1 text-[11px]"
                                                value={l.supplierId}
                                                onChange={(e) => setSupPick((p) => ({ ...p, [l.key]: e.target.value }))}
                                                aria-label={`Supplier for ${l.poNo} ${r.code}`}
                                              >
                                                <option value="">— choose supplier —</option>
                                                {r.suppliers.length > 0 && (
                                                  <optgroup label="Bound to this material">
                                                    {r.suppliers.map((s) => (
                                                      <option key={s.supplierId} value={s.supplierId}>
                                                        {s.name}{s.isMain ? " ★" : ""}{s.unitPriceSen ? ` · RM ${(s.unitPriceSen / 100).toFixed(2)}` : ""}
                                                      </option>
                                                    ))}
                                                  </optgroup>
                                                )}
                                                <optgroup label="Other suppliers (will be bound)">
                                                  {plan.allSuppliers.filter((s) => !bound.has(s.id)).map((s) => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                  ))}
                                                </optgroup>
                                              </select>
                                            ) : (
                                              <span className="text-[#9CA3AF]">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {r.poOtherUnit.length > 0 && (
                                <div className="mt-1.5 text-[11px] font-semibold text-[#8A6A12]">
                                  Also on order in another unit — not counted, check before ordering more:{" "}
                                  {r.poOtherUnit.map((p) => `${p.ref} · ${fmtQty(p.qty)} ${p.unit}${p.eta ? ` · ETA ${dmy(p.eta)}` : ""}`).join("; ")}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 border-t border-[#EFEBE3] px-3.5 py-2.5 text-xs text-[#6B7280]">
              <div>
                {plan.productionOrders.counted} of {plan.productionOrders.open} open production orders still need materials (
                {plan.productionOrders.alreadyDeducted} already deducted, {plan.productionOrders.noBom} with no BOM materials). Stock first,
                then the earliest PO, by need-by date (that department&apos;s due date, else the order&apos;s date); the rest is short.
                Order-by = need-by − the supplier&apos;s lead time (red = already late). A WIP stops counting once its job card is completed.
              </div>
              {plan.materials.some((m) => m.poOtherUnit.length > 0) && (
                <div className="font-semibold text-[#8A6A12]">
                  Some open POs are in another unit than the stock (e.g. fabric ordered in ROLL, stocked in MTR). There is no conversion, so
                  they are shown in amber under PO Outstanding but not counted.
                </div>
              )}
              {plan.openPoLinesUnresolved > 0 && (
                <div className="font-semibold text-[#8A6A12]">
                  PO outstanding is a floor: {plan.openPoLinesUnresolved} open PO lines name no known raw material, so they are not counted as coming in.
                </div>
              )}
              {plan.unresolved.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-semibold text-[#8A6A12]">
                    {plan.unresolved.length} BOM lines name a material that is not in Raw Materials — not planned
                  </summary>
                  <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5">
                    {plan.unresolved.map((u, i) => (
                      <li key={i}>{u.poNo} · {u.productCode} · {u.material} ({fmtQty(u.required)})</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-32" onClick={() => !busy && setDialog(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[480px] rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === "confirm" && (
              <>
                <h2 className="text-lg font-bold">Proceed PO</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#374151]">
                  Generate purchase orders for {picks.length} {picks.length === 1 ? "line" : "lines"} (
                  {new Set(picks.map((p) => p.row.uom)).size > 1
                    ? "mixed units"
                    : `${fmtQty(picks.reduce((s, p) => s + p.line.shortQty, 0))} ${picks[0]?.row.uom ?? ""}`}
                  ) in {mode === "combined" ? "Combined (one PO per supplier)" : "Per SO (one PO per supplier per order)"} mode.
                </p>
                <label className="mt-3 block">
                  <span className={lbl}>EXPECTED DELIVERY (OPTIONAL — LEAVE BLANK TO USE EACH ORDER&apos;S OWN NEED-BY DATE)</span>
                  <input type="date" className={`${input} mt-1.5 h-9 w-full`} value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} aria-label="Expected delivery date" />
                </label>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className={btn} onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
                  <button type="button" onClick={runCreate} disabled={busy} className={primary}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} {busy ? "Processing…" : "Confirm"}
                  </button>
                </div>
              </>
            )}
            {(dialog.kind === "info" || dialog.kind === "created" || dialog.kind === "stale") && (
              <>
                <h2 className="text-lg font-bold">
                  {dialog.kind === "info" ? dialog.title : dialog.kind === "created" ? "Purchase orders created" : "Plan changed — refresh first"}
                </h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#374151]">{dialog.body}</p>
                <div className="mt-5 flex justify-end gap-2">
                  {dialog.kind === "created" ? (
                    <>
                      <button type="button" className={btn} onClick={() => setDialog(null)}>Stay here</button>
                      <button type="button" className={primary} onClick={() => { setDialog(null); navigate("/procurement"); }}>Open Purchase Orders</button>
                    </>
                  ) : dialog.kind === "stale" ? (
                    <button type="button" className={primary} onClick={() => { setDialog(null); void refresh(); }}>Refresh now</button>
                  ) : (
                    <button type="button" className={primary} onClick={() => setDialog(null)}>OK</button>
                  )}
                </div>
              </>
            )}
            {dialog.kind === "lead" && leadEdit && (
              <>
                <h2 className="text-lg font-bold">Lead times</h2>
                <p className="mt-1 text-xs text-[#6B7280]">
                  Days from placing the PO to receiving it, per supplier. Order-by = need-by − lead time. A lead time set on a supplier&apos;s
                  material price (Supplier Materials) wins over this one.
                </p>
                <div className="mt-3 max-h-80 overflow-y-auto">
                  {leadSuppliers.length === 0 && <div className="py-2 text-sm text-[#6B7280]">No suppliers on this plan yet.</div>}
                  {leadSuppliers.map((s) => (
                    <div key={s.id} className="flex items-center gap-2.5 border-t border-[#F3F0EA] py-1.5">
                      <span className="flex-1 text-[13px]">{s.name}</span>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        className={`${input} w-20 text-right`}
                        value={leadEdit[s.id] ?? ""}
                        placeholder="0"
                        onChange={(e) => setLeadEdit((p) => ({ ...(p ?? {}), [s.id]: Math.max(0, Math.min(365, Number(e.target.value) || 0)) }))}
                        aria-label={`Lead time days for ${s.name}`}
                      />
                      <span className="text-xs text-[#6B7280]">days</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className={btn} onClick={() => setDialog(null)} disabled={busy}>Close</button>
                  <button type="button" onClick={saveLead} disabled={busy} className={primary}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
