// "Scan to Create" — the four document tiles under the Home greeting (Home v11 handoff).
// All four are live: Sales Order, Purchase Invoice and Goods Receipt read through the scan queue (ScanSoSheet / ScanPiSheet /
// ScanGrnSheet), Payment Voucher through the synchronous finance scan (ScanPvSheet); each ends in an editable review and a
// DRAFT. Nothing is prepared, approved or posted by a scan.
//
// A tile shows only for a user who may create that document AND may run its scan. The scan
// routes have their own gate (purchase-orders:create for the supplier / customer PO scans,
// accounting:create for finance scans) which is not the document's create permission, so
// both are checked. Server RBAC is unchanged; this only avoids offering a 403.
import { useState, type ComponentType } from "react";
import { FileInput, PackageCheck, Receipt, ReceiptText, ScanLine } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { M } from "../../theme";
import { Label } from "./home-ui";
import { SHADOW_SMALL } from "./home-style";
import { ScanSoSheet } from "./ScanSoSheet";
import { ScanPiSheet } from "../procurement/ScanPiSheet";
import { ScanGrnSheet } from "../procurement/ScanGrnSheet";
import { ScanPvSheet } from "../finance/ScanPvSheet";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; color?: string; "aria-hidden"?: boolean | "true" | "false" }>;
type Tile = { key: "so" | "pi" | "grn" | "pv"; title: string; sub: string; icon: Icon; ok: boolean; live: boolean };

const tileBox = { display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0, padding: 9, border: "none", borderRadius: 12, backgroundColor: M.card, boxShadow: SHADOW_SMALL, textAlign: "left", fontFamily: "inherit" } as const;

export function ScanToCreate() {
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState<"so" | "pi" | "grn" | "pv" | null>(null);
  const canScan = hasPermission("purchase-orders", "create");
  const tiles: Tile[] = [
    { key: "so", title: "Sales Order", sub: "Scan customer PO", icon: FileInput, ok: hasPermission("sales-orders", "create") && canScan, live: true },
    { key: "pi", title: "Purchase Invoice", sub: "Scan supplier invoice", icon: ReceiptText, ok: hasPermission("purchase-invoices", "create") && canScan, live: true },
    { key: "grn", title: "Goods Receipt", sub: "Scan supplier document", icon: PackageCheck, ok: hasPermission("grn", "create") && canScan, live: true },
    { key: "pv", title: "Payment Voucher", sub: "Scan bill / receipt", icon: Receipt, ok: hasPermission("accounting", "create"), live: true },
  ];
  const shown = tiles.filter((t) => t.ok);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Scan to create" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 8 }}>
        <ScanLine size={13} strokeWidth={2} color={M.taupe} aria-hidden="true" />
        <Label>SCAN TO CREATE</Label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
        {shown.map((t) => {
          const Icon = t.icon;
          const body = (
            <>
              <span aria-hidden="true" style={{ width: 30, height: 30, flex: "none", borderRadius: 9, backgroundColor: M.divider, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin, lineHeight: 1.25, overflowWrap: "anywhere" }}>{t.title}</span>
                <span style={{ display: "block", fontSize: 11, color: M.muted, lineHeight: 1.3, marginTop: 1, overflowWrap: "anywhere" }}>{t.sub}</span>
                {t.live ? null : (
                  <span style={{ display: "inline-block", marginTop: 4, height: 17, lineHeight: "17px", padding: "0 7px", borderRadius: 999, backgroundColor: M.divider, color: M.ink, fontSize: 10.5, fontWeight: 700 }}>Coming soon</span>
                )}
              </span>
            </>
          );
          return t.live ? (
            <button key={t.key} type="button" onClick={() => setOpen(t.key)} aria-label={`${t.title}: ${t.sub}`} style={{ ...tileBox, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>{body}</button>
          ) : (
            <div key={t.key} role="group" aria-disabled="true" aria-label={`${t.title}: ${t.sub}. Coming soon`} style={{ ...tileBox, opacity: 0.7, cursor: "default" }}>{body}</div>
          );
        })}
      </div>
      {open === "so" ? <ScanSoSheet open onClose={() => setOpen(null)} /> : null}
      {open === "pi" ? <ScanPiSheet open onClose={() => setOpen(null)} /> : null}
      {open === "grn" ? <ScanGrnSheet open onClose={() => setOpen(null)} /> : null}
      {open === "pv" ? <ScanPvSheet open onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
