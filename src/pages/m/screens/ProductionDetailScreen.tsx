// ===========================================================================
// ProductionDetailScreen — L2 Production Order detail (/m/production/:id).
//
// Claude Design "Production Orders v3" (owner 2026-10-29). Visual layer + the
// sections that design adds (hold banner, delivery dates, vertical stage
// timeline); data is the REAL GET /api/production-orders/:id + audit events.
//
// Stage states come from the DESKTOP `cellFor` / `stageKind`
// (src/pages/production/utils.ts), so Done / In progress / Pending / Overdue mean
// exactly what they mean on the Production overview. This screen shows one order,
// so the desktop FAB_CUT "sibling" walk (which needs the other orders of the
// group) is not applied: a sofa piece whose Fab Cut card sits on a sibling order
// shows N/A here, and a note says so.
//
// SAFETY: advancing/holding a production order mutates live factory state
// (job cards, cascades) — "production locks are inviolate". This back-office
// screen exposes NO stage mutation: "Change stage" only explains and deep-links to
// the desktop Production board.
// ===========================================================================
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Calendar, CalendarCheck, CalendarClock, Check, CirclePause, History, Info, Route, ShoppingCart, ChevronRight, TriangleAlert } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { cellFor, stageKind, type StageKind } from "@/pages/production/utils";
import type { ProductionOrder } from "@/pages/production/types";
import { MobileHeader, Sheet } from "../components";
import { DashLabel } from "../components/ProductionBits";
import { M, titleCaseStatus } from "../theme";
import { resolveStatus, STATUS_MAPS, str, num, dateOnly } from "../config/helpers";
import {
  DEPTS,
  fullDate,
  SHADOW_CARD,
  SHADOW_CONTROL,
  SHADOW_SECTION,
  shortDate,
  statusTint,
  TINT_DANGER,
  TINT_INFO,
  TINT_WARNING,
} from "../lib/production-ui";

type RawRow = Record<string, unknown>;
type Envelope = { success?: boolean; data?: RawRow };
type AuditResp = { data?: RawRow[] };

function arr(v: unknown): RawRow[] {
  return Array.isArray(v) ? (v as RawRow[]) : [];
}

// Stage pill look per desktop stageKind. "Done" is the teal --m-po-done.
const DONE_TINT = {
  fg: "var(--m-po-done)",
  bg: "color-mix(in srgb, var(--m-po-done) 14%, transparent)",
};
const STAGE_LOOK: Record<StageKind, { label: string; bg: string; fg: string }> = {
  done: { label: "Done", ...DONE_TINT },
  inProgress: { label: "In progress", ...TINT_INFO },
  pending: { label: "Pending", ...TINT_WARNING },
  overdue: { label: "Overdue", ...TINT_DANGER },
  skipped: { label: "N/A", bg: "transparent", fg: "var(--m-inv-ref-key)" },
};
const NODE_BG: Record<StageKind, string> = {
  done: "var(--m-po-done)",
  inProgress: "var(--m-text-status-info)",
  pending: "var(--m-card)",
  overdue: "var(--m-text-status-danger)",
  skipped: "var(--m-card)",
};

export function ProductionDetailScreen() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const url = `/api/production-orders/${encodeURIComponent(id)}`;
  const { data, loading, error } = useCachedJson<Envelope>(url);
  const { data: auditRaw } = useCachedJson<AuditResp>(
    id ? `/api/audit-events?resource=production-orders&resourceId=${encodeURIComponent(id)}` : null,
  );
  const [showDesk, setShowDesk] = useState(false);

  const doc = data?.data ?? null;
  // The shared header (with back) shows on the loading / error states too, so it
  // does not jump once the document arrives.
  const withHeader = (node: ReactNode, title = "Production Order") => (
    <>
      <MobileHeader title={title} onBack={() => navigate(-1)} />
      {node}
    </>
  );
  if (loading && !doc) return withHeader(<Center text="Loading…" />);
  if (error && !doc) return withHeader(<Center text="Couldn’t load this production order." />);
  if (!doc) return withHeader(<Center text="Production order not found." />);

  const poNo = str(doc, "poNo") || "Production Order";
  const statusKey = str(doc, "status");
  const status = resolveStatus(statusKey, STATUS_MAPS.production);
  const tint = statusTint(status.style.hex);
  const si = DEPTS.findIndex((d) => d.code === str(doc, "currentDepartment"));
  const audit = arr(auditRaw?.data);
  const jobCards = arr(doc.jobCards);

  // Desktop cell logic over this order's own job cards (see header).
  const order = { jobCards } as unknown as ProductionOrder;
  const cells = DEPTS.map((d) => cellFor(order, d.code));
  const kinds = cells.map((c) => stageKind(c));
  const applicable = kinds.filter((k) => k !== "skipped").length;
  const doneCount = kinds.filter((k) => k === "done").length;
  const noFabCut = !jobCards.some((j) => str(j, "departmentCode") === "FAB_CUT");

  const soId = str(doc, "salesOrderId");
  const soNo = str(doc, "companySO", "companySOId", "customerSO");
  const target = dateOnly(doc, "targetEndDate");
  const holdReason = statusKey === "ON_HOLD" ? str(doc, "holdReason", "hold_reason") : "";
  const holdMeta =
    statusKey === "ON_HOLD"
      ? [str(doc, "heldBy", "held_by"), str(doc, "heldAt", "held_at")].filter(Boolean).join(" · ")
      : "";
  const dates = [
    { icon: CalendarClock, label: "Expected DD", value: shortDate(target) },
    { icon: CalendarCheck, label: "Customer DD", value: shortDate(dateOnly(doc, "customerDeliveryDate")) },
    { icon: Calendar, label: "Our DD", value: shortDate(dateOnly(doc, "hookkaExpectedDD")) },
  ].filter((d) => d.value);

  const info: [string, string][] = [
    ["Product", str(doc, "productName", "productCode") || "—"],
    ["Quantity", `×${num(doc, "quantity")}`],
    ["Customer", str(doc, "customerName") || "—"],
    ["Customer PO", str(doc, "customerPO", "customerPOId") || "—"],
    ["Customer SO", str(doc, "customerSO", "customerSOId") || "—"],
    ["Reference", str(doc, "reference", "customerReference") || "—"],
    ["PIC", str(doc, "picName", "pic") || "—"],
    ["QC Status", str(doc, "qcStatus", "qc") || "—"],
    ["Expected DD", fullDate(target) || "—"],
  ];

  const canStage = statusKey !== "COMPLETED" && statusKey !== "CANCELLED";

  return (
    <div style={{ paddingBottom: 92 }}>
      <MobileHeader title={poNo} onBack={() => navigate(-1)} />

      <div style={{ padding: "2px 18px 24px", display: "grid", gridTemplateColumns: "minmax(0,1fr)" }}>
        {/* Order: status pill, product, sub line */}
        <section aria-label="Order" style={{ padding: "0 2px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              whiteSpace: "nowrap",
              padding: "0 11px",
              borderRadius: 999,
              background: tint.bg,
              color: tint.fg,
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: tint.fg }} />
            {titleCaseStatus(status.label)}
          </span>
          <h1
            style={{
              margin: "10px 0 0",
              fontSize: 21,
              lineHeight: 1.3,
              fontWeight: 700,
              letterSpacing: "-0.3px",
              color: M.raisin,
              wordBreak: "break-word",
            }}
          >
            {str(doc, "productName", "productCode") || "—"}
          </h1>
          <div style={{ fontSize: 13, color: M.ink, marginTop: 4, wordBreak: "break-word" }}>
            {[str(doc, "productCode"), str(doc, "customerName")].filter(Boolean).join(" · ")}
          </div>
        </section>

        {/* Current department */}
        <section
          aria-label="Current department"
          style={{ marginTop: 14, background: M.card, borderRadius: 20, padding: 16, boxShadow: SHADOW_CARD }}
        >
          <DashLabel>CURRENT DEPARTMENT</DashLabel>
          <div style={{ fontSize: 24, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.4px", color: M.raisin, marginTop: 6 }}>
            {si >= 0 ? DEPTS[si].name : "—"}
          </div>
          <div aria-hidden="true" style={{ display: "flex", gap: 3, marginTop: 12 }}>
            {DEPTS.map((d, i) => (
              <span
                key={d.code}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: i === si ? M.gold : si >= 0 && i < si ? M.taupe : "var(--m-segment-track)",
                  boxShadow: i === si ? "0 0 0 2px rgba(201,169,97,.28)" : "none",
                }}
              />
            ))}
          </div>
        </section>

        {/* On hold banner (reason comes from the parent SO / CO) */}
        {holdReason ? (
          <div
            role="status"
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              marginTop: 12,
              padding: "11px 13px",
              borderRadius: 14,
              background: TINT_WARNING.bg,
            }}
          >
            <span style={{ display: "flex", marginTop: 1 }}>
              <CirclePause size={16} strokeWidth={2} color="var(--m-inv-warning-fg)" aria-hidden="true" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--m-inv-warning-fg)" }}>On hold</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--m-inv-body)", marginTop: 2, wordBreak: "break-word" }}>
                {holdReason}
              </div>
              {holdMeta ? <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>{holdMeta}</div> : null}
            </div>
          </div>
        ) : null}

        {/* Delivery dates */}
        {dates.length ? (
          <section
            aria-label="Delivery dates"
            style={{ marginTop: 12, display: "grid", gridTemplateColumns: `repeat(${dates.length},minmax(0,1fr))`, gap: 8 }}
          >
            {dates.map((d) => (
              <div
                key={d.label}
                style={{ minWidth: 0, padding: "11px 12px", borderRadius: 16, background: M.card, boxShadow: SHADOW_CARD }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>
                  <d.icon size={13} strokeWidth={2} aria-hidden="true" />
                  {d.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: M.raisin, marginTop: 5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {d.value}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* Stage progress — the 10-department vertical timeline */}
        <section
          aria-label="Stage progress"
          style={{ marginTop: 12, background: M.card, borderRadius: 20, padding: "16px 16px 8px", boxShadow: SHADOW_CARD }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Route size={16} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />
            <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: M.raisin }}>Stage progress</span>
            <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>
              {doneCount} of {applicable} departments done
            </span>
          </div>
          <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
            {DEPTS.map((d, idx) => {
              const cell = cells[idx];
              const kind = kinds[idx];
              const look = STAGE_LOOK[kind];
              const nextKind = kinds[idx + 1];
              const date =
                kind === "skipped"
                  ? ""
                  : kind === "done"
                    ? cell.latestCompleted
                      ? `Completed ${shortDate(cell.latestCompleted)}`
                      : ""
                    : cell.earliestDue
                      ? `Due ${shortDate(cell.earliestDue)}`
                      : "";
              const pics = Array.from(
                new Set(
                  jobCards
                    .filter((j) => str(j, "departmentCode") === d.code)
                    .flatMap((j) => [str(j, "pic1Name"), str(j, "pic2Name")])
                    .filter(Boolean),
                ),
              );
              const meta = [date, pics.join(", ")].filter(Boolean).join(" · ");
              return (
                <li key={d.code} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 14 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 12,
                      top: 28,
                      bottom: 2,
                      width: 2,
                      borderRadius: 2,
                      background:
                        idx === DEPTS.length - 1
                          ? "transparent"
                          : kind === "done" && nextKind !== "skipped"
                            ? "var(--m-po-done)"
                            : "var(--m-segment-track)",
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      position: "relative",
                      flex: "none",
                      width: 26,
                      height: 26,
                      boxSizing: "border-box",
                      borderRadius: "50%",
                      background: NODE_BG[kind],
                      boxShadow:
                        kind === "pending" || kind === "skipped"
                          ? "inset 0 0 0 2px var(--m-inv-dot-ring)"
                          : kind === "inProgress"
                            ? "0 0 0 4px color-mix(in srgb, var(--m-text-status-info) 18%, transparent)"
                            : "none",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {kind === "done" ? <Check size={14} strokeWidth={3} /> : null}
                    {kind === "overdue" ? <TriangleAlert size={13} strokeWidth={2.6} /> : null}
                    {kind === "inProgress" ? (
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
                    ) : null}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13.5,
                          fontWeight: d.code === str(doc, "currentDepartment") ? 800 : 600,
                          color: kind === "skipped" ? "var(--m-inv-ref-key)" : M.raisin,
                        }}
                      >
                        {d.name}
                      </span>
                      <span
                        style={{
                          flex: "none",
                          height: 22,
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "0 8px",
                          borderRadius: 999,
                          background: look.bg,
                          color: look.fg,
                          boxShadow: kind === "skipped" ? "inset 0 0 0 1.5px var(--m-inv-dot-ring)" : "none",
                          fontSize: 11,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {kind === "skipped" ? "N/A" : `${look.label} ${cell.doneCards}/${cell.totalCards}`}
                      </span>
                    </div>
                    {meta ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: kind === "overdue" ? TINT_DANGER.fg : M.ink,
                          marginTop: 3,
                          wordBreak: "break-word",
                        }}
                      >
                        {meta}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {noFabCut && soId ? (
            <div
              style={{
                margin: "0 -16px",
                padding: "10px 16px 12px",
                borderTop: "1px solid var(--m-divider)",
                fontSize: 12,
                lineHeight: 1.45,
                color: M.ink,
              }}
            >
              No Fab Cut job card on this order. On desktop, Fab Cut for a sofa set can sit on a related order in the same
              sales order — this screen shows only this order’s cards.
            </div>
          ) : null}
        </section>

        {/* Linked SO */}
        {soId || soNo ? (
          <button
            type="button"
            onClick={() => navigate(`/m/sales/${encodeURIComponent(soId || soNo)}`)}
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              minHeight: 52,
              padding: "0 16px",
              border: "none",
              borderRadius: 16,
              background: M.card,
              fontFamily: "inherit",
              cursor: "pointer",
              textAlign: "left",
              boxShadow: SHADOW_CARD,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <ShoppingCart size={16} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />
            <span style={{ flex: 1, fontSize: 13.5, color: "var(--m-inv-body)" }}>Sales Order</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>{soNo || "—"}</span>
            <ChevronRight size={17} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden="true" />
          </button>
        ) : null}

        <SectionCard icon={<Info size={16} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />} title="Order info">
          <div style={{ padding: "0 16px 6px" }}>
            {info.map(([l, v], i) => (
              <div
                key={l}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 14,
                  minHeight: 42,
                  borderTop: i ? "1px solid var(--m-divider)" : "none",
                }}
              >
                <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{l}</span>
                <span
                  style={{
                    minWidth: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: v === "—" ? "var(--m-inv-ref-key)" : M.raisin,
                    textAlign: "right",
                    wordBreak: "break-word",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard icon={<History size={16} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />} title="History">
          {auditRaw && audit.length === 0 ? (
            <div style={{ padding: "4px 16px 14px", fontSize: 12.5, color: M.ink }}>No recorded events.</div>
          ) : null}
          <div style={{ padding: "0 16px 6px" }}>
            {audit.slice(0, 30).map((h, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "baseline",
                  padding: "11px 0",
                  borderTop: i ? "1px solid var(--m-divider)" : "none",
                }}
              >
                <span style={{ flex: "none", width: 70, fontSize: 11.5, fontWeight: 600, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
                  {shortDate(dateOnly(h, "createdAt", "ts", "timestamp"))}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin }}>
                  {str(h, "action", "eventLabel", "summary", "message") || "—"}
                </span>
                <span style={{ flex: "none", fontSize: 11.5, color: M.ink }}>{str(h, "actor", "userName")}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Action bar — SAFE: stage changes happen on the shop floor / desktop
          board (production state is inviolate here). */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: M.paper,
          boxShadow: "0 -1px 0 var(--m-inv-line), 0 -10px 24px -14px rgba(31,29,27,.18)",
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          display: "flex",
          gap: 9,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            flex: 1,
            height: 48,
            border: "none",
            borderRadius: 12,
            background: M.card,
            color: "var(--m-inv-body)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: SHADOW_CONTROL,
          }}
        >
          Back
        </button>
        {canStage ? (
          <button
            type="button"
            onClick={() => setShowDesk(true)}
            style={{
              flex: 1.3,
              height: 48,
              border: "none",
              borderRadius: 12,
              background: M.taupe,
              color: "var(--m-text-on-accent)",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 8px 18px -10px rgba(107,92,50,.7)",
            }}
          >
            Change stage
          </button>
        ) : null}
      </div>

      <Sheet open={showDesk} onClose={() => setShowDesk(false)} title="Change production stage">
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--m-inv-body)" }}>
          Stage moves are done on the shop floor (worker scans the job card) or on the desktop Production board — so the
          job-card cascade stays correct. Open the desktop board to change this order’s stage.
        </div>
        <button
          type="button"
          onClick={() => navigate("/production")}
          style={{
            width: "100%",
            height: 48,
            marginTop: 16,
            border: "none",
            borderRadius: 12,
            background: M.taupe,
            color: "var(--m-text-on-accent)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Open Production board
        </button>
        <button
          type="button"
          onClick={() => setShowDesk(false)}
          style={{
            width: "100%",
            height: 46,
            marginTop: 8,
            border: "none",
            borderRadius: 12,
            background: M.card,
            color: "var(--m-inv-body)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: SHADOW_CONTROL,
          }}
        >
          Cancel
        </button>
      </Sheet>
    </div>
  );
}

function SectionCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{ marginTop: 12, background: M.card, borderRadius: 18, overflow: "hidden", boxShadow: SHADOW_SECTION }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "15px 16px 4px" }}>
        {icon}
        <span style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>{title}</span>
      </div>
      {children}
    </section>
  );
}

function Center({ text }: { text: string }) {
  return <div style={{ padding: "60px 18px", textAlign: "center", color: M.ink, fontSize: 14 }}>{text}</div>;
}
