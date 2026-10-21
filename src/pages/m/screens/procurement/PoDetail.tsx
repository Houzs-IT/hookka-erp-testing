// ===========================================================================
// PoDetail — purchase order detail (/m/procurement/po-…), prototype layout.
// Data: GET /api/purchase-orders/:id (+ linkedGRNs, linkedPIs) and, with
// three-way-match:read and a GRN on file, GET /api/three-way-match/by-po/:id.
// Actions: desktop detail.tsx per status (lib/procurement-mobile.ts
// poActions), each shown only with the permission its server route checks.
// ===========================================================================
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Ban, CircleCheck, Download, Files, Lock, Mail, Package, PackageCheck, Pencil, Printer, Receipt, Scale, Trash2, type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { fmtDate } from "../../lib/do-mobile";
import {
  PARTIAL_CANCEL_WARNING, PO_ACTION_LABEL, PO_ACTION_PERMS, PO_FLOW, PO_STATUS_TARGET, RECEIVED_GATE_ERROR, cancelReasonError, dateOnly,
  flowSteps, hasPostedGrn, n, poActions, poAdvanceBody, poCancelBody, poExpectedLate, poQtyTotals, rows, s, statusOf, todayIso,
  type PoActionKey, type RawRow,
} from "../../lib/procurement-mobile";
import { BottomDock, ConfirmLines, FieldLabel, PrimaryButton, SecondaryButton, SheetFooter, SheetSub, Surface } from "../delivery/ui";
import { DL, INPUT, SHADOW_SECTION, T } from "../delivery/ui-tokens";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { downloadPoPdf, printGrnFromPo, putPo, refreshProcurementCaches, send } from "./actions";
import { Banner, ChainRow, DetailColumn, Fact, InfoRows, KvSection, LineCard, MenuGroup, MenuRow, OffFlow, Progress, SectionTitle, Timeline, TilePill, TotalBlock, type ChainNode } from "./parts";
import { DetailFrame } from "./ProcurementDetailScreen";
import { PoForm, type PoFormMode } from "./PoForm";
import { ReceiveForm } from "./ReceiveForm";
import { PiForm } from "./PiForm";

type Env = { success?: boolean; data?: RawRow; linkedGRNs?: RawRow[]; linkedPIs?: RawRow[] };

const ICON: Record<PoActionKey, LucideIcon> = {
  EDIT: Pencil, MARK_CONFIRMED: CircleCheck, CREATE_GRN: PackageCheck, RECEIVE_GOODS: PackageCheck, MARK_PARTIAL: Package,
  MARK_RECEIVED: PackageCheck, CLOSE: Lock, CANCEL: Ban, DELETE: Trash2, EMAIL: Mail, PDF: Download, PRINT_GRN: Printer, CREATE_INVOICE: Receipt,
};

const CONFIRM_TEXT: Partial<Record<PoActionKey, string>> = {
  MARK_CONFIRMED: "Records that the supplier confirmed this order.",
  MARK_PARTIAL: "Sets the PO to Partial Received.",
  MARK_RECEIVED: "Sets the PO to Received and stamps today as the received date.",
  CLOSE: "Closes this purchase order.",
};

/** The reason detail.tsx appended on cancel: the last "[CANCELLED date: reason]". */
function cancelReasonOf(notes: string): string {
  const m = notes.match(/\[CANCELLED [^:\]]+: ([^\]]*)\]\s*$/);
  return m ? m[1] : "";
}

export function PoDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useResponsiveLayout();
  const url = `/api/purchase-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, failure, refresh } = useCachedJson<Env>(url);
  const po = (data?.data ?? null) as RawRow | null;
  const grns = rows(data?.linkedGRNs);
  const pis = rows(data?.linkedPIs);
  const { hasPermission } = usePermissions();
  const allowed = (k: PoActionKey) => PO_ACTION_PERMS[k].every(([r, a]) => hasPermission(r, a));
  const canMatch = hasPermission("three-way-match", "read");
  const match = useCachedJson<{ data?: { lines?: RawRow[] } }>(po && canMatch && grns.length ? `/api/three-way-match/by-po/${encodeURIComponent(id)}` : null);

  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [poForm, setPoForm] = useState<PoFormMode | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [piOpen, setPiOpen] = useState(false);

  const after = (ok: boolean, msg: string, err?: string) => {
    if (!ok) {
      if (err) toast.show(err, "error");
      return;
    }
    refreshProcurementCaches();
    refresh();
    toast.show(msg, "success");
  };

  const run = async (k: PoActionKey) => {
    if (!po || busy) return;
    setMoreOpen(false);
    const poNo = s(po, "poNo");
    if (k === "EDIT") return setPoForm({ kind: "edit", po });
    if (k === "CREATE_GRN" || k === "RECEIVE_GOODS") return setReceiveOpen(true);
    if (k === "CANCEL") return setCancelOpen(true);
    if (k === "PDF") return void downloadPoPdf(po).catch(() => toast.show("Could not generate the PDF.", "error"));
    if (k === "PRINT_GRN") return void printGrnFromPo(po).catch(() => toast.show("Could not generate the PDF.", "error"));
    if (k === "CREATE_INVOICE") {
      const live = pis.find((p) => s(p, "status") !== "CANCELLED");
      if (live) return navigate({ pathname: `/m/procurement/${encodeURIComponent(s(live, "id"))}`, search: location.search });
      return setPiOpen(true);
    }
    if (k === "EMAIL") {
      setBusy(true);
      const r = await send(`${url}/email`, "POST");
      setBusy(false);
      return after(r.ok, "Queued for delivery", r.ok ? undefined : r.error);
    }
    if (k === "DELETE") {
      const ok = await confirmSheet.confirm({ title: "Delete PO", sub: poNo, lines: [{ icon: "warning", text: `Permanently delete PO ${poNo}? This cannot be undone.` }], confirmLabel: "Delete" });
      if (!ok) return;
      setBusy(true);
      const r = await send(url, "DELETE");
      setBusy(false);
      if (!r.ok) return toast.show(r.error, "error");
      refreshProcurementCaches();
      navigate({ pathname: "/m/procurement", search: location.search }, { replace: true });
      return;
    }
    const target = PO_STATUS_TARGET[k];
    if (!target) return;
    if (target === "RECEIVED" && !hasPostedGrn(grns)) return toast.show(RECEIVED_GATE_ERROR, "error");
    const ok = await confirmSheet.confirm({ title: PO_ACTION_LABEL[k], sub: poNo, lines: [{ icon: "info", text: CONFIRM_TEXT[k] ?? "" }], confirmLabel: PO_ACTION_LABEL[k] });
    if (!ok) return;
    setBusy(true);
    const r = await putPo(id, poAdvanceBody(target, todayIso()));
    setBusy(false);
    after(r.ok, `${poNo} → ${statusOf("po", target).label}`, r.ok ? undefined : r.status === 412 ? r.error || RECEIVED_GATE_ERROR : r.error);
  };

  const status = po ? s(po, "status") : "";
  const st = statusOf("po", status);
  const acts = po ? poActions(po, grns, pis) : { primary: null, secondary: null, menu: [] as PoActionKey[], invoiced: false };
  const primary = acts.primary && allowed(acts.primary) ? acts.primary : null;
  const secondary = acts.secondary && allowed(acts.secondary) ? acts.secondary : null;
  const menu = acts.menu.filter((k) => allowed(k) || (k === "CREATE_INVOICE" && acts.invoiced));
  const label = (k: PoActionKey) =>
    k === "CREATE_INVOICE" && acts.invoiced ? "Invoiced" : k === "EMAIL" && po && s(po, "lastEmailedAt") ? "Resend Email" : PO_ACTION_LABEL[k];
  const dockScope = layout.canSplitDetail ? "detail" : "content";
  const today = todayIso();

  return (
    <DetailFrame noun="Purchase Order" code={po ? s(po, "poNo") || "Purchase Order" : ""} loading={loading} failure={failure} error={error} hasDoc={!!po} onRetry={refresh} onMore={() => setMoreOpen(true)}>
      {po ? (
        <>
          <DetailColumn>
            <section aria-label="Header" style={{ padding: "0 2px" }}>
              <TilePill tone={st.tone} label={st.label} size="md" dot />
              <h1 style={{ margin: "10px 0 0", fontSize: "var(--m-type-section-heading-size)", lineHeight: "var(--m-type-section-heading-line-height)", fontWeight: 700, letterSpacing: "var(--m-type-section-heading-tracking)", color: M.raisin, wordBreak: "break-word" }}>
                {s(po, "supplierName") || "—"}
              </h1>
              <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>Purchase company {s(po, "purchaseOrgCode") || "HOOKKA"}</div>
              {status === "CANCELLED" ? (
                <Banner tone="danger" icon={Ban} title="Cancelled.">
                  {cancelReasonOf(s(po, "notes"))}
                </Banner>
              ) : null}
            </section>

            <Surface ariaLabel="Order overview" radius={20} shadow={SHADOW_SECTION} style={{ marginTop: 16, padding: "16px 16px 14px" }}>
              <TotalBlock k="PO TOTAL" v={money(n(po, "totalSen"))} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 16px" }}>
                <Fact k="Order date" v={fmtDate(dateOnly(s(po, "orderDate")))} />
                <Fact k="Expected date" v={fmtDate(dateOnly(s(po, "expectedDate")))} warn={poExpectedLate(po, today)} />
                <Fact k="Received date" v={fmtDate(dateOnly(s(po, "receivedDate")))} />
                <Fact k="Items" v={String(rows(po.items).length)} />
              </div>
              {status !== "DRAFT" && status !== "CANCELLED" ? <Progress label="Received" {...poQtyTotals(po)} /> : null}
              <div style={{ height: 1, background: DL.track, margin: "16px -16px 14px" }} />
              {status === "CANCELLED" ? <OffFlow>This Purchase Order has been cancelled.</OffFlow> : <Timeline label="Status timeline" steps={flowSteps(PO_FLOW, status)} />}
            </Surface>

            <SectionTitle icon={Package} title="Items" summary={`${rows(po.items).length} line${rows(po.items).length === 1 ? "" : "s"}`} />
            <div style={{ display: "grid", gap: 10 }}>
              {rows(po.items).map((it, i) => {
                const q = n(it, "quantity");
                const r = n(it, "receivedQty");
                const tag = status === "DRAFT" || status === "CANCELLED" ? null : r >= q ? { label: "Fully received", tone: "success" as const } : r > 0 ? { label: "Partial", tone: "warning" as const } : { label: "Outstanding", tone: "neutral" as const };
                return (
                  <LineCard
                    key={s(it, "id") || i}
                    name={s(it, "materialName")}
                    code={[s(it, "materialCode"), s(it, "supplierSKU") ? `Supplier SKU ${s(it, "supplierSKU")}` : ""].filter(Boolean).join(" · ")}
                    spec={`${q} ${s(it, "unit")} × ${money(n(it, "unitPriceSen"))}`.replace("  ", " ")}
                    right={money(n(it, "totalSen"))}
                    rightSub={`Received ${r} / ${q}`}
                    tag={tag}
                  />
                );
              })}
            </div>

            {canMatch && grns.length ? <MatchSection lines={rows(match.data?.data?.lines)} loading={match.loading && !match.data} /> : null}

            <Surface ariaLabel="Document lineage" style={{ marginTop: 26, padding: "14px 15px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Files size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
                <span style={{ ...T.cardTitle, color: M.raisin }}>Document lineage</span>
              </div>
              <Chain po={po} grns={grns} pis={pis} open={(docId) => navigate({ pathname: `/m/procurement/${encodeURIComponent(docId)}`, search: location.search })} />
            </Surface>

            <InfoRows
              list={[
                { k: "Supplier", v: s(po, "supplierName") },
                { k: "Purchase company", v: s(po, "purchaseOrgCode") || "HOOKKA" },
                { k: "Emailed to supplier", v: s(po, "lastEmailedAt") ? fmtDate(dateOnly(s(po, "lastEmailedAt"))) : "Not sent" },
                { k: "Notes", v: s(po, "notes") || "—" },
              ]}
            />
            {primary ? <div aria-hidden style={{ height: 84 }} /> : null}
          </DetailColumn>

          {primary ? (
            <BottomDock variant="detail" scope={dockScope}>
              {secondary ? (
                <SecondaryButton onClick={() => void run(secondary)} disabled={busy}>
                  {PO_ACTION_LABEL[secondary]}
                </SecondaryButton>
              ) : null}
              <PrimaryButton icon={ICON[primary]} iconSize={17} onClick={() => void run(primary)} disabled={busy} style={{ flex: 1.4 }}>
                {busy ? "Working…" : PO_ACTION_LABEL[primary]}
              </PrimaryButton>
            </BottomDock>
          ) : null}

          <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
            <MenuGroup>
              {menu.map((k, i) => (
                <MenuRow key={k} icon={ICON[k]} label={label(k)} first={i === 0} danger={k === "CANCEL" || k === "DELETE"} onClick={() => void run(k)} />
              ))}
            </MenuGroup>
            <div style={{ height: 16 }} />
          </Sheet>

          <CancelPoSheet
            open={cancelOpen}
            po={po}
            onClose={() => setCancelOpen(false)}
            onCancelled={() => {
              setCancelOpen(false);
              after(true, "Purchase order cancelled");
            }}
          />
          <PoForm
            mode={poForm}
            onClose={() => setPoForm(null)}
            onDone={(msg) => {
              setPoForm(null);
              after(true, msg);
            }}
          />
          <ReceiveForm
            open={receiveOpen}
            presetPoId={id}
            onClose={() => setReceiveOpen(false)}
            onDone={(msg) => {
              setReceiveOpen(false);
              after(true, msg);
            }}
          />
          <PiForm
            open={piOpen}
            source={{ kind: "po", doc: po }}
            onClose={() => setPiOpen(false)}
            onDone={(msg, newId) => {
              setPiOpen(false);
              after(true, msg);
              if (newId) navigate({ pathname: `/m/procurement/${encodeURIComponent(newId)}`, search: location.search });
            }}
          />
        </>
      ) : null}
      {confirmSheet.node}
      {toast.node}
    </DetailFrame>
  );
}

/** PO vs GRN (vs PI) — the desktop ThreeWayMatchPanel's per-line verdict. */
function MatchSection({ lines, loading }: { lines: RawRow[]; loading: boolean }) {
  const nv = lines.filter((l) => s(l, "status") === "VARIANCE").length;
  return (
    <KvSection
      icon={Scale}
      title="PO vs GRN"
      badge={loading || !lines.length ? null : nv ? { label: `${nv} variance`, tone: "warning" } : { label: "All match", tone: "success" }}
      note={loading ? "Loading…" : "Ordered quantity and value against posted goods receipts and invoices."}
      rowsList={lines.map((l) => {
        const dq = n(l, "qtyVarianceVsPo");
        const dv = n(l, "senVarianceVsPo");
        return {
          k: s(l, "materialName") || s(l, "materialCode"),
          sub: `PO ${n(l, "poQty")} · GRN ${n(l, "grnQty")} · PI ${n(l, "piQty")}${dq ? ` · Δ qty ${dq > 0 ? "+" : ""}${dq}` : ""}${dv ? ` · Δ ${money(dv)}` : ""}`,
          v: "",
          tag: s(l, "status") === "VARIANCE" ? { label: "Variance", tone: "warning" } : { label: "Match", tone: "success" },
        };
      })}
    />
  );
}

function Chain({ po, grns, pis, open }: { po: RawRow; grns: RawRow[]; pis: RawRow[]; open: (id: string) => void }) {
  const liveGrns = grns.filter((g) => s(g, "status") !== "CANCELLED");
  const livePis = pis.filter((p) => s(p, "status") !== "CANCELLED");
  const nodes: ChainNode[] = [
    { label: "Purchase Order", doc: s(po, "poNo"), sub: "This order", state: "current" },
    ...(liveGrns.length
      ? liveGrns.map<ChainNode>((g) => ({ label: "Goods Receipt", doc: s(g, "grnNumber"), sub: [statusOf("grn", s(g, "status")).label, fmtDate(dateOnly(s(g, "receiveDate")))].filter(Boolean).join(" · "), state: "linked", onClick: () => open(s(g, "id")) }))
      : [{ label: "Goods Receipt", doc: "Not created", sub: "Created when goods arrive", state: "pending" as const }]),
    ...(livePis.length
      ? livePis.map<ChainNode>((p) => ({ label: "Purchase Invoice", doc: s(p, "piNo"), sub: [statusOf("pi", s(p, "status")).label, money(n(p, "amountSen"))].join(" · "), state: "linked", onClick: () => open(s(p, "id")) }))
      : [{ label: "Purchase Invoice", doc: "Not created", sub: "Created from a GRN or this PO", state: "pending" as const }]),
  ];
  return (
    <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
      {nodes.map((c, i) => (
        <ChainRow key={`${c.label}-${c.doc}-${i}`} node={c} nextPending={nodes[i + 1]?.state === "pending"} last={i === nodes.length - 1} />
      ))}
    </ol>
  );
}

/** detail.tsx Cancel-PO modal: reason ≥ 10 chars, appended to the notes. */
function CancelPoSheet({ open, po, onClose, onCancelled }: { open: boolean; po: RawRow; onClose: () => void; onCancelled: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setReason("");
    setErr(null);
  }
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Cancel PO">
      <SheetSub>{s(po, "poNo")}</SheetSub>
      {s(po, "status") === "PARTIAL_RECEIVED" ? <ConfirmLines lines={[{ icon: "warning", text: PARTIAL_CANCEL_WARNING }]} /> : null}
      <label style={{ display: "block", marginTop: 12 }}>
        <FieldLabel required>Reason</FieldLabel>
        <textarea
          className="dl-input"
          value={reason}
          rows={3}
          placeholder="At least 10 characters"
          onChange={(e) => {
            setReason(e.target.value);
            setErr(null);
          }}
          style={{ ...INPUT, height: "auto", padding: "11px 13px", resize: "none" }}
        />
      </label>
      {err ? <div role="alert" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--dl-sem-danger)" }}>{err}</div> : null}
      <SheetFooter
        onCancel={onClose}
        confirmLabel="Cancel PO"
        busy={busy}
        onConfirm={async () => {
          const e = cancelReasonError(reason);
          if (e) return setErr(e);
          setBusy(true);
          const r = await putPo(s(po, "id"), poCancelBody(s(po, "notes"), reason, todayIso()));
          setBusy(false);
          if (!r.ok) return setErr(r.error);
          onCancelled();
        }}
      />
    </Sheet>
  );
}
