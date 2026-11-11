// ===========================================================================
// ProcurementScreen — L1 /m/procurement, phone AND tablet (owner 2026-10-21).
//
// Visuals: Claude Design `Procurement.dc.html` (same shell as Delivery);
// typography: the /m Sales / Delivery screens. Business rules: the desktop's,
// via ../../lib/procurement-mobile.ts (spec: docs/mobile/PROCUREMENT-MOBILE.md).
//
// Reads (the desktop's, full lists — no paging, so chips / counts / search
// always see every row):
//   Orders    GET /api/purchase-orders
//   Receipts  GET /api/grn
//   Invoices  GET /api/purchase-invoices (+ /api/grn for the GRN number, when readable)
//   Low stock GET /api/inventory?buckets=rawMaterials + /api/supplier-materials
// A segment shows only with its read permission; the switch hides when one is left.
// ===========================================================================
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ClipboardList, PackageCheck, Receipt, Send, TriangleAlert } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { useUrlBatch, useUrlState } from "@/lib/use-url-state";
import { MobileHeader, ResponsiveGrid } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useDebounced } from "../../lib/use-debounced";
import { SEGMENT_WRAP } from "../../lib/control-styles";
import { fmtShort } from "../../lib/do-mobile";
import {
  CHIPS, SECTIONS, bulkSubmitEligible, chipMatches, dateOnly, grnIsFull, lowStockRms, matchesQuery, n, piPastDue,
  poExpectedLate, poOutstanding, rows, s, statusOf, todayIso, visibleSections,
  type RawRow, type Section,
} from "../../lib/procurement-mobile";
import { EmptyCard } from "../delivery/DeliveryCards";
import { BottomDock, Notice, PrimaryButton } from "../delivery/ui";
import { SHADOW_CARD, pill } from "../delivery/ui-tokens";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { submitDrafts } from "./actions";
import { Chips, DocCard, ErrorCard, HeaderPlus, SearchRow, SectionSwitch, SkeletonCards } from "./parts";
import { PoForm, type PoFormMode } from "./PoForm";
import { ReceiveForm } from "./ReceiveForm";
import { PiForm } from "./PiForm";

type Envelope = { success?: boolean; data?: RawRow[] };

const SECTION_ICON = { po: ClipboardList, grn: PackageCheck, pi: Receipt } as const;
const NOUN: Record<Section, string> = { po: "PURCHASE ORDER", grn: "GOODS RECEIPT", pi: "PURCHASE INVOICE" };
const SEARCH_PH: Record<Section, string> = {
  po: "Search PO, supplier, material",
  grn: "Search GRN, PO, supplier, DO",
  pi: "Search PI, supplier invoice, supplier",
};

export function ProcurementScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: openId } = useParams();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const inPane = layout.canSplitDetail && !!openId;
  // One column on a phone and in the split view's list pane; as many 320px+ columns as fit otherwise.
  const gridMaxColumns = tablet && !inPane ? undefined : 1;

  const { hasPermission, loading: permLoading } = usePermissions();
  const can = (resource: string, action: string) => hasPermission(resource, action);
  const sections = visibleSections((r) => can(r, "read"));

  const [secRaw] = useUrlState<string>("sec", "");
  const [statusRaw] = useUrlState<string>("status", "");
  const setUrl = useUrlBatch();
  const sec: Section | null = (sections.includes(secRaw as Section) ? (secRaw as Section) : sections[0]) ?? null;
  const chip = sec && CHIPS[sec].some((c) => c.key === statusRaw) ? statusRaw : "";

  const [q, setQ] = useState("");
  const dq = useDebounced(q).trim();

  // ---- reads (desktop's) ----
  const canCreatePo = can("purchase-orders", "create");
  const poList = useCachedJson<Envelope>(sec === "po" ? "/api/purchase-orders" : null);
  const grnList = useCachedJson<Envelope>(sec === "grn" || (sec === "pi" && can("grn", "read")) ? "/api/grn" : null);
  const piList = useCachedJson<Envelope>(sec === "pi" ? "/api/purchase-invoices" : null);
  const inv = useCachedJson<{ success?: boolean; data?: { rawMaterials?: RawRow[] } }>(sec === "po" && canCreatePo ? "/api/inventory?buckets=rawMaterials" : null);
  const bindingsResp = useCachedJson<{ data?: RawRow[] } | RawRow[]>(sec === "po" && canCreatePo ? "/api/supplier-materials" : null);

  const source = sec === "po" ? poList : sec === "grn" ? grnList : piList;
  const all = useMemo(() => rows(source.data?.data), [source.data]);
  const grnById = useMemo(() => new Map(rows(grnList.data?.data).map((g) => [s(g, "id"), g])), [grnList.data]);
  const rawMaterials = useMemo(() => (inv.data?.success ? rows(inv.data.data?.rawMaterials) : []), [inv.data]);
  const bindings = useMemo(() => {
    const b = (bindingsResp.data as { data?: RawRow[] } | null)?.data ?? bindingsResp.data;
    return Array.isArray(b) ? (b as RawRow[]) : [];
  }, [bindingsResp.data]);
  const lowStock = useMemo(() => lowStockRms(rawMaterials), [rawMaterials]);

  // Plain derivations (the React Compiler memoizes them).
  const matched = sec ? all.filter((r) => matchesQuery(sec, r, dq)) : [];
  const counts: Record<string, number> = {};
  if (sec) for (const ch of CHIPS[sec]) counts[ch.key] = matched.filter((r) => chipMatches(sec, ch.key, r)).length;
  const shown = sec ? matched.filter((r) => chipMatches(sec, chip, r)) : [];
  const totalSen = shown.reduce((a, r) => a + (sec === "po" ? n(r, "totalSen") : sec === "grn" ? n(r, "totalAmount") : n(r, "amountSen")), 0);

  // ---- selection (PO drafts → Submit N drafts) ----
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const clearSel = () => {
    setSelecting(false);
    setSel(new Set());
  };
  const canSelect = sec === "po" && can("purchase-orders", "update") && (chip === "" || chip === "DRAFT") && bulkSubmitEligible(all).length > 0;

  // ---- forms / feedback ----
  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const [poForm, setPoForm] = useState<PoFormMode | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [piOpen, setPiOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const goSection = (k: Section) => {
    setUrl({ sec: k === sections[0] ? null : k, status: null });
    setQ("");
    clearSel();
  };
  const goChip = (k: string) => {
    setUrl({ status: k || null });
    clearSel();
  };
  const openDoc = (id: string) => navigate({ pathname: `/m/procurement/${encodeURIComponent(id)}`, search: location.search });

  const createFor: Record<Section, { label: string; allowed: boolean; open: () => void }> = {
    po: { label: "New Purchase Order", allowed: canCreatePo, open: () => setPoForm({ kind: "new" }) },
    grn: { label: "New Goods Receipt", allowed: can("grn", "create"), open: () => setReceiveOpen(true) },
    pi: { label: "New Purchase Invoice", allowed: can("purchase-invoices", "create"), open: () => setPiOpen(true) },
  };
  const create = sec ? createFor[sec] : null;

  const selectedDrafts = useMemo(() => bulkSubmitEligible(all).filter((p) => sel.has(s(p, "id"))), [all, sel]);
  const submitSelected = async () => {
    const drafts = selectedDrafts;
    if (!drafts.length || busy) return;
    const ok = await confirmSheet.confirm({
      title: "Submit drafts",
      sub: `${drafts.length} purchase order${drafts.length === 1 ? "" : "s"}`,
      lines: [{ icon: "info", text: `Submit ${drafts.length} draft purchase order(s)? They will move to SUBMITTED and be ready for supplier acknowledgement.` }],
      confirmLabel: `Submit ${drafts.length}`,
    });
    if (!ok) return;
    setBusy(true);
    const res = await submitDrafts(drafts);
    setBusy(false);
    clearSel();
    poList.refresh();
    if (res.failures.length) toast.show(`Submitted: ${res.ok} · Failed: ${res.failures.length} — ${res.failures[0]}`, "error");
    else toast.show(`Submitted ${res.ok} order${res.ok !== 1 ? "s" : ""} successfully.`, "success");
  };

  const today = todayIso();
  const card = (r: RawRow) => {
    const id = s(r, "id");
    const current = inPane && id === openId;
    if (sec === "po") {
      const st = statusOf("po", s(r, "status"));
      const out = poOutstanding(r);
      const draft = s(r, "status") === "DRAFT";
      const selectable = selecting && draft;
      return (
        <DocCard
          key={id}
          code={s(r, "poNo") || "—"}
          status={st}
          rail={st.tone}
          title={s(r, "supplierName") || "—"}
          sub={rows(r.items).map((i) => s(i, "materialName")).filter(Boolean).join(", ") || "No items"}
          metas={[
            { k: "EXPECTED", v: fmtShort(dateOnly(s(r, "expectedDate"))) || "—", warn: poExpectedLate(r, today) },
            { k: "OUTSTANDING", v: out == null ? "—" : String(out) },
            { k: "TOTAL", v: money(n(r, "totalSen")), bold: true, align: "right" },
          ]}
          selectable={selectable}
          checked={sel.has(id)}
          current={current}
          onClick={
            selectable
              ? () =>
                  setSel((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
              : () => openDoc(id)
          }
        />
      );
    }
    if (sec === "grn") {
      const st = statusOf("grn", s(r, "status"));
      return (
        <DocCard
          key={id}
          code={s(r, "grnNumber") || "—"}
          status={st}
          flag={s(r, "qcStatus") === "PENDING" ? { label: "QC Pending", tone: "warning" } : null}
          rail={st.tone}
          title={s(r, "supplierName") || "—"}
          sub={[s(r, "poNumber") || "No PO", grnIsFull(r) ? "full" : "partial", `DO ${s(r, "supplier_do_no", "supplierDoNo") || "—"}`].join(" · ")}
          metas={[
            { k: "RECEIVED", v: fmtShort(dateOnly(s(r, "receiveDate"))) || "—" },
            { k: "BY", v: s(r, "receivedBy") || "—", muted: !s(r, "receivedBy") },
            { k: "TOTAL", v: money(n(r, "totalAmount")), bold: true, align: "right" },
          ]}
          current={current}
          onClick={() => openDoc(id)}
        />
      );
    }
    const st = statusOf("pi", s(r, "status"));
    const past = piPastDue(r, today);
    const grn = grnById.get(s(r, "grnId"));
    const ref = grn ? s(grn, "grnNumber") : s(r, "poRef") || "No GRN";
    return (
      <DocCard
        key={id}
        code={s(r, "piNo") || "—"}
        status={st}
        flag={past ? { label: "Past due", tone: "danger" } : null}
        rail={st.tone}
        title={s(r, "supplierName", "supplier") || "—"}
        sub={`${ref} · Supplier inv ${s(r, "supplierInvoiceNo") || "—"}`}
        metas={[
          { k: "INVOICE", v: fmtShort(dateOnly(s(r, "invoiceDate"))) || "—" },
          { k: "DUE", v: fmtShort(dateOnly(s(r, "dueDate"))) || "—", warn: past },
          { k: "AMOUNT", v: money(n(r, "amountSen")), bold: true, align: "right" },
        ]}
        current={current}
        onClick={() => openDoc(id)}
      />
    );
  };

  const title = sec ? SECTIONS.find((x) => x.key === sec)!.title : "Procurement";
  const loading = (permLoading && !sections.length) || (source.loading && !source.data);
  const failed = !!source.error && !source.data;
  const showLowStock = sec === "po" && canCreatePo && !selecting && lowStock.length > 0;
  const dockScope = inPane ? "list" : "content";

  return (
    <>
      <MobileHeader
        title={title}
        onBack={() => navigate(-1)}
        menu
        trailing={create && create.allowed ? <HeaderPlus label={create.label} onClick={create.open} /> : null}
      />

      {sec === null && !permLoading ? (
        <div style={{ padding: "0 18px" }}>
          <EmptyCard text="You don't have access to purchase orders, goods receipts or purchase invoices." />
        </div>
      ) : (
        <>
          {sections.length > 1 && sec ? (
            <div style={SEGMENT_WRAP}>
              <SectionSwitch
                value={sec}
                onChange={goSection}
                options={SECTIONS.filter((x) => sections.includes(x.key)).map((x) => ({ key: x.key, label: x.label, full: x.title, icon: SECTION_ICON[x.key] }))}
              />
            </div>
          ) : null}

          {sec ? <SearchRow q={q} setQ={setQ} placeholder={SEARCH_PH[sec]} /> : null}
          {sec ? <Chips label="Status" chips={CHIPS[sec]} value={chip} counts={source.data ? counts : null} onPick={goChip} /> : null}

          {sec === "po" && selecting ? (
            <div style={{ margin: "10px 18px 0" }}>
              <Notice>Select draft POs to submit them together.</Notice>
            </div>
          ) : null}

          {showLowStock ? (
            <LowStockBanner
              count={lowStock.length}
              sub={lowStock.map((rm) => `${s(rm, "itemCode")} ${n(rm, "balanceQty")}/${n(rm, "minStock")}`).join(" · ")}
              onCreate={() => setPoForm({ kind: "lowStock" })}
            />
          ) : null}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 20px 8px", minHeight: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {loading || !sec ? "" : `${shown.length} ${NOUN[sec]}${shown.length === 1 ? "" : "S"}`}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {!loading && shown.length ? (
                <span style={{ fontSize: 12.5, color: M.ink, whiteSpace: "nowrap" }}>
                  Total <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(totalSen)}</span>
                </span>
              ) : null}
              {canSelect ? (
                <button
                  type="button"
                  onClick={() => (selecting ? clearSel() : setSelecting(true))}
                  style={{ height: 32, padding: "0 4px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer" }}
                >
                  {selecting ? "Cancel" : "Select"}
                </button>
              ) : null}
            </div>
          </div>

          <div style={{ padding: `0 18px ${selecting && selectedDrafts.length ? 140 : 32}px` }}>
            {loading ? (
              <SkeletonCards maxColumns={gridMaxColumns} />
            ) : failed ? (
              <ErrorCard text="Couldn’t load this list. Check your connection and try again." onRetry={() => source.refresh()} />
            ) : shown.length === 0 ? (
              <EmptyCard text={dq ? "No matches for your search." : "Nothing here yet."} />
            ) : (
              <ResponsiveGrid maxColumns={gridMaxColumns} gap={10}>{shown.map(card)}</ResponsiveGrid>
            )}
          </div>
        </>
      )}

      {selecting && selectedDrafts.length ? (
        <BottomDock variant="list" scope={dockScope}>
          <PrimaryButton icon={Send} onClick={() => void submitSelected()} disabled={busy}>
            {busy ? "Working…" : `Submit ${selectedDrafts.length} draft${selectedDrafts.length === 1 ? "" : "s"}`}
          </PrimaryButton>
        </BottomDock>
      ) : null}

      <PoForm
        mode={poForm}
        rawMaterials={rawMaterials}
        bindings={bindings}
        onClose={() => setPoForm(null)}
        onDone={(msg, id) => {
          setPoForm(null);
          poList.refresh();
          toast.show(msg, "success");
          if (id) openDoc(id);
          else if (poForm?.kind === "lowStock") goChip("DRAFT");
        }}
      />
      <ReceiveForm
        open={receiveOpen}
        presetPoId=""
        onClose={() => setReceiveOpen(false)}
        onDone={(msg, id) => {
          setReceiveOpen(false);
          grnList.refresh();
          toast.show(msg, "success");
          if (id) openDoc(id);
        }}
      />
      <PiForm
        open={piOpen}
        source={null}
        onClose={() => setPiOpen(false)}
        onDone={(msg, id) => {
          setPiOpen(false);
          piList.refresh();
          toast.show(msg, "success");
          if (id) openDoc(id);
        }}
      />
      {confirmSheet.node}
      {toast.node}
    </>
  );
}

function LowStockBanner({ count, sub, onCreate }: { count: number; sub: string; onCreate: () => void }) {
  const w = pill("warning");
  return (
    <div style={{ margin: "12px 18px 0", padding: "12px 14px", borderRadius: 14, background: M.card, display: "flex", alignItems: "center", gap: 12, boxShadow: SHADOW_CARD }}>
      <span aria-hidden style={{ width: 36, height: 36, flex: "none", borderRadius: 10, background: w.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <TriangleAlert size={17} strokeWidth={2} color={w.fg} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>
          {count} raw material{count === 1 ? "" : "s"} below minStock
        </div>
        <div style={{ fontSize: 12, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
      </div>
      <button
        type="button"
        onClick={onCreate}
        aria-label="Create PO from Low Stock"
        style={{ flex: "none", height: 36, padding: "0 12px", borderRadius: 10, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Create PO
      </button>
    </div>
  );
}
