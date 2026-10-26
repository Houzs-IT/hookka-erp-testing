// ===========================================================================
// WarehouseScreen — the custom L1 Warehouse screen (Warehouse v3 handoff,
// owner 2026-10-26). Three views behind one switch:
//   • Racks        — search (+ scan-rack icon → the existing /r/:id flow), the
//                    occupancy card, All/Occupied/Empty/Reserved chips, 2-column
//                    rack tiles and the rack bottom sheet. (Find is merged into
//                    the search; it still calls GET /api/warehouse/locate.)
//   • Stock In/Out — desktop fields behind picker sheets + a sticky confirm bar.
//                    UI ONLY: Stock In/Out saving is NOT enabled, see
//                    docs/WAREHOUSE-STOCK-LIMITATIONS.md.
//   • History      — type chips + From/To date filter over /api/warehouse/movements.
// The ⋯ menu carries the desktop header actions: Create Rack, Create Item QR,
// Download all rack QRs, Refresh.
//
// SCAN RACK (DEV-09): the printed rack QR encodes `/r/<rackId>`, and that page
// is the whole scan-items-into-rack flow (continuous QR + Code 128, per-piece
// resolve, move-aware stock-in). /m does NOT re-implement it: the scan icon
// decodes the rack QR and navigates there, so the movement records the user.
//
// READS: GET /api/warehouse · /api/warehouse/:id/details · /locate · /movements
//        · /api/production-orders?fields=minimal&include= (Stock In picker).
// WRITES here: POST /api/warehouse/racks (Create Rack) only. No API, permission,
// status rule or movement logic changes — the screen files live in ./warehouse/.
// QR values reuse the desktop scheme (rackScanUrl / itemQrValue).
//
// ADDITIVE: replaces the generic warehouse list ONLY at the /m/warehouse route
// (the rack DETAIL route is unchanged and still config-driven).
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, MoreHorizontal } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { getQRCodeDataURL, rackScanUrl, itemQrValue, parseRackQr } from "@/lib/qr-utils";
import { MobileHeader, SegmentedSwitch, ScanSheet } from "../components";
import { QrModal, type QrChoice } from "../components/QrModal";
import { M } from "../theme";
import { SEGMENT_WRAP } from "../lib/control-styles";
import { type Rack, type WarehouseResp, type WarehouseToast, rackLabel, sortRacks } from "./warehouse/shared";
import { RacksTab } from "./warehouse/RacksTab";
import { StockInOutTab, type StockPrefill } from "./warehouse/StockInOutTab";
import { HistoryTab } from "./warehouse/HistoryTab";
import { MenuSheet, CreateRackSheet, ItemQrSheet } from "./warehouse/ActionSheets";

type View = "racks" | "io" | "history";
const VIEWS: { key: View; label: string }[] = [
  { key: "racks", label: "Racks" },
  { key: "io", label: "Stock In/Out" },
  { key: "history", label: "History" },
];

// A scanned rack QR → its rack id. Accepts the printed `/r/<id>` URL (path-
// based, so any print-time domain works) and the in-app `HKRACK:<id>` token.
function rackIdFromScan(value: string): string | null {
  const token = parseRackQr(value);
  if (token) return token;
  const m = value.match(/\/r\/([^/?#]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function WarehouseScreen() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("racks");
  const [prefill, setPrefill] = useState<StockPrefill | null>(null);

  const { data: whResp, loading, refresh } = useCachedJson<WarehouseResp>("/api/warehouse");
  const racks = useMemo(() => sortRacks(whResp?.data ?? []), [whResp]);
  const nameById = useMemo(() => new Map(racks.map((r) => [r.id, rackLabel(r)])), [racks]);

  // Permissions are only used to HIDE actions the API would refuse anyway (the
  // API still gates every write). Stock In also needs production-orders:update
  // because desktop's last step is PUT /api/production-orders/:id.
  const { hasPermission, loading: permLoading } = usePermissions();
  const can = (res: string, act: string) => !permLoading && hasPermission(res, act);
  const canCreateRack = can("warehouse", "create");
  const canStockIn = can("warehouse", "create") && can("production-orders", "update");
  const canStockOut = can("warehouse", "delete");

  // Sheets / modals.
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [itemQrOpen, setItemQrOpen] = useState(false);
  const [qr, setQr] = useState<{ title: string; choices: QrChoice[]; downloadName?: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const [toast, setToast] = useState<WarehouseToast | null>(null);
  const showToast = (t: WarehouseToast) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2400);
  };

  const openRackQr = (r: Rack) => {
    const label = rackLabel(r);
    setQr({ title: `Rack QR · ${label}`, downloadName: `rack-${label}`, choices: [{ label, code: label, value: rackScanUrl(r.id) }] });
  };

  const [allBusy, setAllBusy] = useState(false);
  // "Download all rack QRs" → composite PNG sheet of every rack's scan QR
  // (same mechanic as the desktop button).
  const downloadAllRackQr = async () => {
    if (allBusy) return;
    if (racks.length === 0) {
      showToast({ kind: "err", text: "No racks to export." });
      return;
    }
    setAllBusy(true);
    try {
      const tiles = await Promise.all(
        racks.map(async (r) => ({
          label: rackLabel(r),
          url: await getQRCodeDataURL(rackScanUrl(r.id), 600).catch(() => null),
        })),
      );
      const imgs = await Promise.all(
        tiles.map(
          (t) =>
            new Promise<{ label: string; img: HTMLImageElement | null }>((resolve) => {
              if (!t.url) return resolve({ label: t.label, img: null });
              const im = new Image();
              im.onload = () => resolve({ label: t.label, img: im });
              im.onerror = () => resolve({ label: t.label, img: null });
              im.src = t.url;
            }),
        ),
      );
      const cols = 2;
      const cw = 240;
      const ch = 300;
      const padX = 30;
      const padY = 92;
      const gap = 24;
      const rows = Math.ceil(imgs.length / cols);
      const W = padX * 2 + cols * cw + (cols - 1) * gap;
      const H = padY + rows * (ch + gap) + 10;
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.fillStyle = M.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = M.raisin;
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.fillText("Hookka · Rack QR Codes", padX, 50);
      ctx.fillStyle = M.muted;
      ctx.font = "15px system-ui, sans-serif";
      ctx.fillText("Warehouse Main", padX, 76);
      imgs.forEach((t, i) => {
        const cx = padX + (i % cols) * (cw + gap);
        const cy = padY + Math.floor(i / cols) * (ch + gap);
        ctx.fillStyle = M.card;
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = M.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, cw, ch);
        if (t.img) ctx.drawImage(t.img, cx + (cw - 184) / 2, cy + 26, 184, 184);
        ctx.textAlign = "center";
        ctx.fillStyle = M.raisin;
        ctx.font = "bold 23px system-ui, sans-serif";
        ctx.fillText(t.label, cx + cw / 2, cy + 26 + 184 + 36);
        ctx.textAlign = "left";
      });
      const a = document.createElement("a");
      a.href = cv.toDataURL("image/png");
      a.download = "hookka-rack-qr-codes.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast({ kind: "ok", text: `Downloaded ${racks.length} rack QR codes` });
    } catch {
      showToast({ kind: "err", text: "Couldn’t build the QR sheet." });
    } finally {
      setAllBusy(false);
    }
  };

  const onRackScanned = (value: string) => {
    setScanOpen(false);
    const id = rackIdFromScan(value);
    if (!id) {
      showToast({ kind: "err", text: "That isn’t a rack QR code." });
      return;
    }
    navigate(`/r/${encodeURIComponent(id)}`);
  };

  const goStock = (mode: "in" | "out", r: Rack) => {
    setPrefill({ mode, rackId: r.id, nonce: Date.now() });
    setView("io");
  };

  return (
    <>
      <MobileHeader
        title="Warehouse"
        onBack={() => navigate(-1)}
        menu
        trailing={
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Warehouse actions"
            style={{ width: 44, height: 44, borderRadius: "50%", border: `1px solid ${M.border}`, background: M.card, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
          >
            <MoreHorizontal size={20} strokeWidth={1.9} color={M.taupe} />
          </button>
        }
      />

      <div style={SEGMENT_WRAP}>
        <SegmentedSwitch variant="prominent" ariaLabel="Warehouse view" options={VIEWS} value={view} onChange={setView} />
      </div>

      <div style={{ padding: "12px 18px 24px" }}>
        {toast ? (
          <div
            onClick={() => setToast(null)}
            role="status"
            style={{ background: M.raisin, color: "#fff", borderRadius: 13, padding: "11px 15px", marginBottom: 12, display: "flex", alignItems: "center", gap: 9, fontSize: 13, fontWeight: 600 }}
          >
            <CheckCircle2 size={17} strokeWidth={2} color={toast.kind === "ok" ? "#C6DBA8" : "#E8B2A1"} />
            {toast.text}
          </div>
        ) : null}

        {view === "racks" ? (
          <RacksTab
            racks={racks}
            summary={whResp?.summary}
            loading={loading}
            canStockIn={canStockIn}
            canStockOut={canStockOut}
            onScanRack={() => setScanOpen(true)}
            onRackQr={openRackQr}
            onStockIn={(r) => goStock("in", r)}
            onStockOut={(r) => goStock("out", r)}
          />
        ) : null}
        {view === "io" ? <StockInOutTab racks={racks} prefill={prefill} canStockIn={canStockIn} canStockOut={canStockOut} permLoading={permLoading} /> : null}
        {view === "history" ? <HistoryTab nameById={nameById} /> : null}
      </div>

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        canCreate={canCreateRack}
        rackCount={racks.length}
        allBusy={allBusy}
        onCreateRack={() => setCreateOpen(true)}
        onItemQr={() => setItemQrOpen(true)}
        onAllQr={() => void downloadAllRackQr()}
        onRefresh={() => {
          refresh();
          showToast({ kind: "ok", text: "Refreshed · live data synced" });
        }}
      />
      <CreateRackSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
          showToast({ kind: "ok", text: "Rack created" });
        }}
      />
      <ItemQrSheet
        open={itemQrOpen}
        onClose={() => setItemQrOpen(false)}
        onGenerate={(name, code) => {
          setItemQrOpen(false);
          setQr({ title: "Item QR code", choices: [{ label: name, code: code || name, value: itemQrValue(name, code || undefined) }] });
        }}
      />

      <ScanSheet open={scanOpen} title="Scan rack QR" onClose={() => setScanOpen(false)} onResult={onRackScanned} />

      {qr ? <QrModal open onClose={() => setQr(null)} title={qr.title} choices={qr.choices} downloadName={qr.downloadName} /> : null}
    </>
  );
}
