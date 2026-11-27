// ===========================================================================
// Inventory — the two read-only bottom sheets the prototype opens from a card:
// Fabric (stock, usage, price tiers, supply) and Adjustment (the record). On
// the shared Sheet (portal, focus trap, Esc). No money: the fabric price and
// the adjustment cost impact are deliberately not shown (owner S-2).
// ===========================================================================
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Info, X as XIcon } from "lucide-react";
import { Sheet } from "../../components/Sheet";
import {
  ADJ_TYPE_LABEL, ageLabel, dateLabel, fabricTone, q2, reasonLabel, signed, tierLabel, type AdjRow, type FabricRow,
} from "../../lib/inventory-lib";
import { Badge, Rows, type BadgeSpec, type KV } from "./inv-kit";
import { LABEL, SH_SECTION, X } from "./inv-style";

const PANEL = { background: X.bg, color: X.ink, display: "flex", flexDirection: "column" as const, overflow: "hidden", paddingBottom: 0 };

function InfoFrame({ open, onClose, code, badges, title, sub, note, children }: {
  open: boolean; onClose: () => void; code: string; badges: BadgeSpec[]; title: string; sub: string; note: string; children: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bare portal panelStyle={PANEL}>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: X.ln }} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: X.br, fontVariantNumeric: "tabular-nums" }}>{code}</span>
            {badges.map((b) => <Badge key={b.l} l={b.l} tone={b.tone} />)}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 5, lineHeight: 1.3, overflowWrap: "anywhere" }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: X.mut, marginTop: 2 }}>{sub}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, margin: "-8px -10px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.mut, flex: "none" }}>
          <XIcon size={20} strokeWidth={1.9} />
        </button>
      </div>
      <div className="tpl-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 16px calc(26px + env(safe-area-inset-bottom))", scrollbarWidth: "none", display: "grid", gap: 10 }}>
        {children}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "0 4px", fontSize: 11.5, lineHeight: 1.45, color: X.note }}>
          <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}>
            <Info size={14} strokeWidth={2} />
          </span>
          <span>{note}</span>
        </div>
      </div>
    </Sheet>
  );
}

function Group({ t, rows }: { t: string; rows: KV[] }) {
  return (
    <div>
      <div style={{ ...LABEL, margin: "0 4px 6px" }}>{t}</div>
      <Rows rows={rows} />
    </div>
  );
}

export function FabricSheet({ row, onClose }: { row: FabricRow | null; onClose: () => void }) {
  if (!row) return null;
  const [l, t] = fabricTone(row);
  const neg = row.shortage < 0;
  return (
    <InfoFrame
      open
      onClose={onClose}
      code={row.fabricCode}
      badges={[{ l, tone: t }]}
      title={row.fabricDescription || row.fabricCode}
      sub={row.fabricCategory}
      note="Read-only. A negative shortage means stock on hand plus open POs won't cover what's planned."
    >
      <Group
        t="STOCK"
        rows={[
          { k: "Stock on hand", v: `${q2(row.soh)} m` },
          { k: "PO outstanding", v: `${q2(row.poOutstanding)} m` },
          { k: "Shortage", v: `${signed(row.shortage)} m`, c: neg ? X.bad : X.ok },
        ]}
      />
      <Group
        t="USAGE"
        rows={[
          { k: "Last 30 days", v: `${q2(row.lastMonthUsage)} m` },
          { k: "1 week", v: `${q2(row.oneWeekUsage)} m` },
          { k: "2 weeks", v: `${q2(row.twoWeeksUsage)} m` },
          { k: "1 month", v: `${q2(row.oneMonthUsage)} m` },
        ]}
      />
      <Group
        t="PRICE TIERS"
        rows={[
          { k: "Sofa", v: tierLabel(row.sofaPriceTier, row.priceTier) },
          { k: "Bedframe", v: tierLabel(row.bedframePriceTier, row.priceTier) },
        ]}
      />
      <Group
        t="SUPPLY"
        rows={[
          { k: "Supplier", v: row.supplier },
          { k: "Lead time", v: row.leadTimeDays > 0 ? ageLabel(row.leadTimeDays) : "" },
          { k: "Reorder point", v: `${q2(row.reorderPoint)} m` },
        ]}
      />
    </InfoFrame>
  );
}

export function AdjSheet({ row, onClose }: { row: AdjRow | null; onClose: () => void }) {
  const navigate = useNavigate();
  if (!row) return null;
  const pos = row.qtyDelta > 0;
  return (
    <InfoFrame
      open
      onClose={onClose}
      code={row.adjNo || "—"}
      badges={[{ l: row.type || "—", tone: "br" }, { l: reasonLabel(row.reason), tone: pos ? "ok" : "bad" }]}
      title={row.itemName || row.itemCode || "—"}
      sub={row.itemCode}
      note="Adjustments are a record only. They can't be edited or deleted."
    >
      <Group
        t="ADJUSTMENT"
        rows={[
          { k: "Stock type", v: ADJ_TYPE_LABEL[row.type] ?? row.type },
          { k: "Change", v: signed(row.qtyDelta), c: pos ? X.ok : X.bad },
          { k: "Reason", v: reasonLabel(row.reason) },
          { k: "Adjusted by", v: row.adjustedByName },
          { k: "Date", v: row.adjustedAt ? dateLabel(row.adjustedAt) : "" },
        ]}
      />
      <Group t="ITEM" rows={[{ k: "Item code", v: row.itemCode }, { k: "Item name", v: row.itemName }]} />
      <Group t="NOTES" rows={[{ k: "Notes", v: row.notes }]} />
      {row.caseId ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            navigate(`/m/servicecases/${encodeURIComponent(row.caseId)}`);
          }}
          style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "8px 14px", borderRadius: 16, border: "none", background: X.card, boxShadow: SH_SECTION, fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Linked service case</span>
            <span style={{ display: "block", fontSize: 11.5, color: X.mut, marginTop: 1 }}>Opens the service case this top-up was made for</span>
          </span>
          <ChevronRight size={17} strokeWidth={2} color={X.gold} />
        </button>
      ) : null}
    </InfoFrame>
  );
}
