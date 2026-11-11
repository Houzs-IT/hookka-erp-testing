// ⋯ menu + its two form sheets. Mirrors the desktop header buttons:
// Create Rack · Create Item QR · Download all rack QRs · Refresh.
import { useState } from "react";
import { Plus, QrCode, Download, RefreshCw } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { mutateJson, refreshList } from "../../config/mutate";
import {
  FIELD_INPUT,
} from "./shared";
import { FieldLabel, Notice } from "./atoms";

export function MenuSheet({
  open,
  onClose,
  canCreate,
  rackCount,
  allBusy,
  onCreateRack,
  onItemQr,
  onAllQr,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  canCreate: boolean;
  rackCount: number;
  allBusy: boolean;
  onCreateRack: () => void;
  onItemQr: () => void;
  onAllQr: () => void;
  onRefresh: () => void;
}) {
  const row = (label: string, sub: string | undefined, icon: React.ReactNode, onClick: () => void, opts?: { primary?: boolean; disabled?: boolean }) => (
    <button
      key={label}
      type="button"
      disabled={opts?.disabled}
      onClick={() => {
        onClose();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 56,
        padding: "0 14px",
        border: opts?.primary ? "none" : `1px solid ${M.hairline}`,
        borderRadius: 14,
        background: opts?.primary ? M.taupe : M.card,
        color: opts?.primary ? "var(--m-text-on-accent)" : M.raisin,
        opacity: opts?.disabled ? 0.5 : 1,
        textAlign: "left",
        fontFamily: "inherit",
        cursor: opts?.disabled ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{label}</span>
        {sub ? <span style={{ display: "block", fontSize: 12, fontWeight: 500, opacity: 0.75, marginTop: 1 }}>{sub}</span> : null}
      </span>
    </button>
  );
  const ic = (el: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>, primary = false) => {
    const I = el;
    return <I size={20} strokeWidth={1.75} color={primary ? "currentColor" : M.taupe} />;
  };
  return (
    <Sheet open={open} onClose={onClose} title="Warehouse actions">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {canCreate ? row("Create Rack", "Add a new empty rack", ic(Plus, true), onCreateRack, { primary: true }) : null}
        {row("Create Item QR", "Loose item, not in the system", ic(QrCode), onItemQr)}
        {row(allBusy ? "Building…" : "Download all rack QRs", `${rackCount} rack${rackCount === 1 ? "" : "s"}`, ic(Download), onAllQr, { disabled: rackCount === 0 || allBusy })}
        {row("Refresh", "Reload live data", ic(RefreshCw), onRefresh)}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Create Rack — same call as desktop: POST /api/warehouse/racks {rack, position?}.
// No reserved option (desktop has none). A duplicate name comes back as 409 with
// the server's own message, shown inline.
export function CreateRackSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setName("");
    setPosition("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    const rack = name.trim();
    if (!rack || busy) return;
    setBusy(true);
    setError(null);
    const res = await mutateJson("/api/warehouse/racks", "POST", { rack, position: position.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Failed to create rack");
      return;
    }
    refreshList("/api/warehouse");
    setName("");
    setPosition("");
    onCreated();
  };
  return (
    <Sheet open={open} onClose={close} title="Create Rack">
      <FieldLabel>Rack name *</FieldLabel>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rack 21" aria-label="Rack name" style={FIELD_INPUT} />
      <div style={{ height: 14 }} />
      <FieldLabel hint="(optional)">Position / zone</FieldLabel>
      <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Row A" aria-label="Position or zone" style={FIELD_INPUT} />
      {error ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="err">{error}</Notice>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!name.trim() || busy}
        style={{ width: "100%", height: 50, marginTop: 16, border: "none", borderRadius: 14, background: name.trim() && !busy ? M.taupe : M.hairline, color: name.trim() && !busy ? "var(--m-text-on-accent)" : M.muted, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: name.trim() && !busy ? "pointer" : "default" }}
      >
        {busy ? "Creating…" : "Create Rack"}
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Create Item QR — desktop version: item name * + optional product code. There
// is no backend record; the name/code are encoded in the QR (itemQrValue).
export function ItemQrSheet({ open, onClose, onGenerate }: { open: boolean; onClose: () => void; onGenerate: (name: string, code: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const ok = name.trim().length > 0;
  return (
    <Sheet open={open} onClose={onClose} title="Create Item QR">
      <FieldLabel>Item name *</FieldLabel>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" aria-label="Item name" style={FIELD_INPUT} />
      <div style={{ height: 14 }} />
      <FieldLabel hint="(optional)">Product code</FieldLabel>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Linked product code" aria-label="Product code" style={FIELD_INPUT} />
      <button
        type="button"
        disabled={!ok}
        onClick={() => {
          onGenerate(name.trim(), code.trim());
          setName("");
          setCode("");
        }}
        style={{ width: "100%", height: 50, marginTop: 16, border: "none", borderRadius: 14, background: ok ? M.taupe : M.hairline, color: ok ? "var(--m-text-on-accent)" : M.muted, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: ok ? "pointer" : "default" }}
      >
        Generate QR
      </button>
    </Sheet>
  );
}
