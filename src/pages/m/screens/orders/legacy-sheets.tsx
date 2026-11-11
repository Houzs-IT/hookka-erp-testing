// Sheets / dialogs for the mobile Legacy Repair Order detail (Service Orders prototype, Phase 4):
// ⋯ menu, "Choose resolution mode", "Log return", confirmations and the server-error sheet.
// Pure rules live in legacy-logic.ts; nothing here talks to the network.
import { useState, type ReactNode } from "react";
import { Ban, Factory, PackageCheck, PackageX, RefreshCw, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { CC, SH_CARD, fieldStyle } from "../cases/case-style";
import { IconTile } from "../cases/case-ui";
import { ConfirmDialog, Overlay } from "../cases/case-overlay";
import { STOCK_SWAP_UNAVAILABLE_NOTE } from "./order-model";
import { MODE_OPTIONS, RETURN_COND_OPTIONS, firstReturnStartsRepair, type ConfirmCopy, type LegacyOrder, type ModeOption, type ReturnForm } from "./legacy-logic";

// ---- Confirm dialog (centered) -------------------------------------------------------------------
export function LegacyConfirm({ copy, busy, onKeep, onGo }: { copy: ConfirmCopy; busy?: boolean; onKeep: () => void; onGo: () => void }) {
  return <ConfirmDialog open title={copy.title} text={copy.text} keepLabel="Back" goLabel={copy.go} danger={copy.danger} busy={busy} onKeep={onKeep} onGo={onGo} />;
}

// ---- Info / server error sheet -------------------------------------------------------------------
export type InfoState = { title: string; text: string; code?: string; icon?: "refresh" | "stock" | "warn" | "ban"; warn?: boolean };
const INFO_ICON: Record<NonNullable<InfoState["icon"]>, LucideIcon> = { refresh: RefreshCw, stock: PackageX, warn: TriangleAlert, ban: Ban };
export function LegacyInfoSheet({ info, onClose }: { info: InfoState | null; onClose: () => void }) {
  const I = INFO_ICON[info?.icon ?? "warn"];
  // Prototype: centred 46px icon circle, left-aligned text, then a 46px OK button under the card.
  const tone = info?.icon === "refresh" ? { bg: CC.tile, fg: CC.brown } : info?.warn ? { bg: CC.warnBg, fg: CC.warnFg } : { bg: "#F9E1DA", fg: CC.danger };
  return (
    <Sheet open={!!info} onClose={onClose} title={info?.title}>
      {info ? (
        <div>
          <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "18px 16px", textAlign: "center" }}>
            <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", background: tone.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><I size={21} strokeWidth={1.9} color={tone.fg} /></div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "#3A352C", marginTop: 12, textAlign: "left", overflowWrap: "anywhere" }}>{info.text}</div>
            {info.code ? <div style={{ marginTop: 10, fontSize: 11.5, color: CC.hint, textAlign: "left", fontVariantNumeric: "tabular-nums" }}>{info.code}</div> : null}
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={onClose} style={{ height: 46, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>OK</button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

// ---- ⋯ menu --------------------------------------------------------------------------------------
export type MenuItem = { key: string; label: string; sub?: string; icon: LucideIcon; danger?: boolean; disabled?: boolean; onTap: () => void };
export function LegacyMenuSheet({ open, onClose, subtitle, viewOnly, items }: { open: boolean; onClose: () => void; subtitle: string; viewOnly: boolean; items: MenuItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="Repair order actions">
      <div style={{ fontSize: 12.5, color: M.ink, margin: "-16px 2px 10px" }}>{viewOnly ? "View only — changes are disabled" : subtitle}</div>
      <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
        {items.map((it, i) => (
          <button key={it.key} type="button" disabled={it.disabled} onClick={it.onTap} style={{ width: "100%", minHeight: 56, display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.45 : 1 }}>
            <IconTile icon={it.icon} size={34} r={10} iconSize={17} bg={it.danger ? "#F9E1DA" : CC.tile} fg={it.danger ? CC.danger : CC.brown} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: it.danger ? CC.dangerDark : M.raisin }}>{it.label}</span>
              {it.sub ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.35 }}>{it.disabled && viewOnly ? "View only" : it.sub}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---- Choose resolution mode ----------------------------------------------------------------------
const MODE_ICON: Record<ModeOption["mode"], LucideIcon> = { REPRODUCE: Factory, STOCK_SWAP: PackageCheck, REPAIR: Wrench };
export function LegacyModeSheet({ open, onClose, no, approval, onPick }: { open: boolean; onClose: () => void; no: string; approval: "PENDING" | "REJECTED" | null; onPick: (m: ModeOption["mode"]) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Choose resolution mode">
      <div style={{ fontSize: 12.5, color: M.ink, margin: "-16px 2px 10px" }}>{no}</div>
      <div style={{ display: "grid", gap: 10 }}>
        {MODE_OPTIONS.map((m) => {
          // Prototype: Repair carries no tag; Reproduce / Stock swap carry the approval state.
          const tag = m.blocked ? "Unavailable on mobile" : m.needsApproval ? (approval === "PENDING" ? "Approval pending" : approval === "REJECTED" ? "Approval rejected" : "Needs exchange approval") : "";
          const tone = m.blocked ? { bg: CC.errBg, fg: CC.dangerDark } : approval === "PENDING" ? { bg: CC.warnBg, fg: CC.warnFg } : approval === "REJECTED" ? { bg: "#F9E1DA", fg: CC.danger } : { bg: "#F0ECE9", fg: "#4D4630" };
          return (
            <button key={m.mode} type="button" disabled={m.blocked} aria-disabled={m.blocked} onClick={() => onPick(m.mode)} style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", padding: "13px 14px", border: "none", borderRadius: 14, background: M.card, fontFamily: "inherit", cursor: m.blocked ? "default" : "pointer", opacity: m.blocked ? 0.6 : 1, boxShadow: SH_CARD, WebkitTapHighlightColor: "transparent" }}>
              <IconTile icon={MODE_ICON[m.mode]} size={36} r={10} iconSize={18} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin }}>{m.label}</span>
                  {tag ? <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: tone.bg, color: tone.fg }}>{tag}</span> : null}
                </span>
                <span style={{ display: "block", fontSize: 12.5, lineHeight: 1.45, color: M.ink, marginTop: 4 }}>{m.desc}</span>
                {m.blocked ? <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.45, color: CC.warnFg, marginTop: 6 }}>{STOCK_SWAP_UNAVAILABLE_NOTE}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ---- Log return ----------------------------------------------------------------------------------
const label = (t: string, right?: string): ReactNode => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 2px 8px" }}>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>{t}</span>
    {right ? <span style={{ fontSize: 11.5, color: M.ink }}>{right}</span> : null}
  </div>
);
const radio = (on: boolean): ReactNode => (
  <span aria-hidden style={{ flex: "none", width: 18, height: 18, boxSizing: "border-box", borderRadius: "50%", border: on ? `5px solid ${CC.brown}` : "1.5px solid #C4BDB2" }} />
);

export function LegacyReturnSheet({ order, busy, error, onClose, onSave }: { order: LegacyOrder; busy: boolean; error: string; onClose: () => void; onSave: (f: ReturnForm) => void }) {
  // Same as desktop LogReturnModal: line selector (first line preselected, "(unspecified)" available) + notes; always Pending decision.
  const [f, setF] = useState<ReturnForm>({ lineId: order.lines[0]?.id ?? "", notes: "" });
  const auto = firstReturnStartsRepair(order);
  let who = "";
  try { const u = getCurrentUser(); who = u?.displayName ?? u?.email ?? ""; } catch { /* name is display-only */ }
  const set = (p: Partial<ReturnForm>) => setF((x) => ({ ...x, ...p }));
  const canSave = !busy;
  const cond = RETURN_COND_OPTIONS[0];
  const choices = [
    ...order.lines.map((l) => ({ id: l.id, name: l.productName || l.productCode || "Item", sub: `Qty ${l.qty}${l.issueSummary ? ` \u00b7 ${l.issueSummary}` : ""}` })),
    { id: "", name: "(unspecified)", sub: "Not tied to a line" },
  ];
  return (
    <Overlay
      title="Log return"
      subtitle={order.no}
      onClose={busy ? () => undefined : onClose}
      footer={<>
        {error ? <div role="alert" style={{ display: "flex", gap: 8, marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: CC.errBg, color: CC.dangerDark, fontSize: 12.5, lineHeight: 1.45, overflowWrap: "anywhere" }}><TriangleAlert size={15} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} /><span style={{ minWidth: 0 }}>{error}</span></div> : null}
        <button type="button" onClick={() => onSave(f)} disabled={!canSave} aria-disabled={!canSave} style={{ width: "100%", height: 48, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: canSave ? "pointer" : "default", opacity: canSave ? 1 : 0.55 }}>{busy ? "Saving\u2026" : "Save return"}</button>
      </>}
    >
      <section aria-label="Item">
        {label("ITEM RECEIVED")}
        <div role="radiogroup" aria-label="Item returned" style={{ background: M.card, borderRadius: 14, boxShadow: SH_CARD, overflow: "hidden" }}>
          {choices.map((l, i) => (
            <button key={l.id || "none"} type="button" role="radio" aria-checked={f.lineId === l.id} onClick={() => set({ lineId: l.id })} style={{ width: "100%", minHeight: 52, display: "flex", alignItems: "center", gap: 11, padding: "8px 14px", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
              {radio(f.lineId === l.id)}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{l.name}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1, overflowWrap: "anywhere" }}>{l.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Condition">
        {label("CONDITION")}
        <div style={{ background: M.card, borderRadius: 14, boxShadow: SH_CARD, padding: "12px 14px" }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{cond.label}</span>
          <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>{cond.sub}</span>
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.45, color: CC.hint, marginTop: 8, padding: "0 2px" }}>A returned unit is always logged as Pending decision. After inspection, mark it repaired from the Returns list.</div>
      </section>

      <section aria-label="Notes">
        {label("NOTES", "Optional")}
        <textarea aria-label="Notes" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Condition observations, packaging state, etc." style={fieldStyle({ padding: "12px 13px", lineHeight: 1.45, resize: "vertical", minHeight: 88 })} />
      </section>

      <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink }}>{who ? <>Received by <b style={{ color: M.raisin }}>{who}</b>. </> : null}{auto ? "This is the first return, so the order moves to In repair." : ""}</div>
    </Overlay>
  );
}
