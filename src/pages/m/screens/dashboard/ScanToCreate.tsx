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
import { ScanSoSheet } from "./ScanSoSheet";
import { ScanPiSheet } from "../procurement/ScanPiSheet";
import { ScanGrnSheet } from "../procurement/ScanGrnSheet";
import { ScanPvSheet } from "../finance/ScanPvSheet";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; color?: string; "aria-hidden"?: boolean | "true" | "false" }>;
type Tile = { key: "so" | "pi" | "grn" | "pv"; title: string; sub: string; icon: Icon; ok: boolean; live: boolean };

// Home Sales v12: four icon buttons in one row (52px white tile over a two-line label).
const tileBox = { minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "4px 2px", border: "none", background: "none", fontFamily: "inherit", textAlign: "center" } as const;
const iconBox = { width: 52, height: 52, flex: "none", borderRadius: 18, backgroundColor: M.card, boxShadow: `0 0 0 1px ${M.divider}, 0 8px 18px -10px rgba(107,92,50,.45)`, display: "flex", alignItems: "center", justifyContent: "center" } as const;
// "Purchase Invoice" -> "Purchase" / "Invoice" (the design's two-line label).
const twoLines = (t: string): [string, string] => { const [a, ...r] = t.split(" "); return [a, r.join(" ")]; };

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
    <section aria-label="Scan to create" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 8px" }}>
        <ScanLine size={13} strokeWidth={2} color={M.taupe} aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>SCAN TO CREATE</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
        {shown.map((t) => {
          const Icon = t.icon;
          const [l1, l2] = twoLines(t.title);
          const body = (
            <>
              <span aria-hidden="true" style={iconBox}>
                <Icon size={21} strokeWidth={1.8} color={M.taupe} aria-hidden="true" />
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 11.5, fontWeight: 700, lineHeight: 1.3, color: M.raisin, whiteSpace: "nowrap" }}>
                <span>{l1}</span><span>{l2 || " "}</span>
                {t.live ? null : <span style={{ marginTop: 3, height: 16, lineHeight: "16px", padding: "0 6px", borderRadius: 999, backgroundColor: M.divider, color: M.ink, fontSize: 10, fontWeight: 700 }}>Soon</span>}
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
