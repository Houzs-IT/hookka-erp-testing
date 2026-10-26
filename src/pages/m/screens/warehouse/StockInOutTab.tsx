// Stock In/Out tab — desktop fields behind picker sheets, with a sticky confirm bar.
//
// Stock In  : completed production order (not yet stocked in) → rack → notes.
// Stock Out : occupied rack → item to remove → reason (required, like desktop).
//
// UI ONLY. The confirm button never calls an endpoint: Stock In/Out writes are
// NOT enabled in this release (owner 2026-10-26). The desktop chains this would
// have to reproduce, and the backend limitations they hit, are written up in
// docs/WAREHOUSE-STOCK-LIMITATIONS.md. Reads only: /api/production-orders?fields=
// minimal&include= (the same list desktop uses) and the racks from the screen.
import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, Search } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { Sheet } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { M } from "../../theme";
import { str } from "../../config/helpers";
import { segmentTrack, segmentButton } from "../../lib/control-styles";
import {
  type Rack,
  rackLabel,
  rackStatusOf,
  rackItemDescription,
  rackItemRefs,
  itemsOf,
  pluralItems,
  FIELD_INPUT,
} from "./shared";
import { FieldLabel, Notice } from "./atoms";

type Mode = "in" | "out";
type PoRow = Record<string, unknown>;
type PoResp = { success?: boolean; data?: PoRow[] };
export type StockPrefill = { mode: Mode; rackId: string; nonce: number };

type Option = { id: string; title: string; sub?: string; right?: string; disabled?: boolean };

export function StockInOutTab({
  racks,
  prefill,
  canStockIn,
  canStockOut,
  permLoading,
}: {
  racks: Rack[];
  prefill: StockPrefill | null;
  canStockIn: boolean;
  canStockOut: boolean;
  permLoading: boolean;
}) {
  const layout = useResponsiveLayout();
  const [mode, setMode] = useState<Mode>("in");
  const [poId, setPoId] = useState("");
  const [inRackId, setInRackId] = useState("");
  const [notes, setNotes] = useState("");
  const [outRackId, setOutRackId] = useState("");
  const [itemIdx, setItemIdx] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [picker, setPicker] = useState<null | "po" | "inRack" | "outRack" | "item">(null);

  // Hand-off from the rack sheet ("Stock in here" / "Stock Out"): render-time
  // adjustment keyed by the prefill nonce (the repo's alternative to an effect).
  const [seen, setSeen] = useState(0);
  if (prefill && prefill.nonce !== seen) {
    setSeen(prefill.nonce);
    setMode(prefill.mode);
    if (prefill.mode === "in") setInRackId(prefill.rackId);
    else {
      setOutRackId(prefill.rackId);
      const n = itemsOf(racks.find((r) => r.id === prefill.rackId) ?? ({} as Rack)).length;
      setItemIdx(n === 1 ? 0 : null);
    }
  }

  const { data: poResp, loading: poLoading } = useCachedJson<PoResp>("/api/production-orders?fields=minimal&include=", 30);
  // Same rule as desktop: completed and not yet stocked in.
  const pos = useMemo(
    () => (poResp?.data ?? []).filter((p) => str(p, "status") === "COMPLETED" && !p.stockedIn),
    [poResp],
  );
  const po = pos.find((p) => str(p, "id") === poId);
  const poTitle = (p: PoRow) => str(p, "poNo", "po_no") || str(p, "id");
  const poProduct = (p: PoRow) => [str(p, "productName", "product_name"), str(p, "sizeLabel", "size_label")].filter(Boolean).join(" ");

  const stockInRacks = useMemo(
    () => racks.filter((r) => rackStatusOf(r) !== "RESERVED").sort((a, b) => Number(rackStatusOf(a) === "OCCUPIED") - Number(rackStatusOf(b) === "OCCUPIED")),
    [racks],
  );
  const occupiedRacks = useMemo(() => racks.filter((r) => rackStatusOf(r) === "OCCUPIED"), [racks]);
  const inRack = racks.find((r) => r.id === inRackId);
  const outRack = racks.find((r) => r.id === outRackId);
  const outItems = outRack ? itemsOf(outRack) : [];
  const outItem = itemIdx != null ? outItems[itemIdx] : undefined;

  const allowed = mode === "in" ? canStockIn : canStockOut;
  const valid = mode === "in" ? !!(po && inRack) : !!(outRack && outItem && reason.trim());
  const summary =
    mode === "in"
      ? po && inRack
        ? `${poTitle(po)} → ${rackLabel(inRack)}`
        : "Pick a production order and a rack"
      : outItem && outRack
        ? `${rackItemDescription(outItem)} → ${rackLabel(outRack)}`
        : "Pick a rack, an item and a reason";

  const pickOutRack = (id: string) => {
    setOutRackId(id);
    const n = itemsOf(racks.find((r) => r.id === id) ?? ({} as Rack)).length;
    setItemIdx(n === 1 ? 0 : null);
  };

  const options: Option[] =
    picker === "po"
      ? pos.map((p) => ({ id: str(p, "id"), title: poTitle(p), sub: [poProduct(p), str(p, "customerName", "customer_name")].filter(Boolean).join(" · ") }))
      : picker === "inRack"
        ? stockInRacks.map((r) => ({ id: r.id, title: rackLabel(r), right: rackStatusOf(r) === "OCCUPIED" ? pluralItems(itemsOf(r).length) : "Empty" }))
        : picker === "outRack"
          ? occupiedRacks.map((r) => ({
              id: r.id,
              title: rackLabel(r),
              right: pluralItems(itemsOf(r).length),
              sub: itemsOf(r).slice(0, 2).map((it) => it.customerName || rackItemDescription(it)).join(" · "),
              // searchable extras (not shown): every item's SO / customer / PO
            }))
          : picker === "item"
            ? outItems.map((it, i) => ({ id: String(i), title: rackItemDescription(it), sub: [it.customerName, rackItemRefs(it)].filter(Boolean).join(" · ") }))
            : [];
  const searchHay = (o: Option): string => {
    if (picker === "outRack") {
      const r = racks.find((x) => x.id === o.id);
      return r ? itemsOf(r).map((it) => [rackItemDescription(it), it.customerName, rackItemRefs(it)].join(" ")).join(" ") : "";
    }
    return "";
  };

  const onPick = (id: string) => {
    if (picker === "po") setPoId(id);
    else if (picker === "inRack") setInRackId(id);
    else if (picker === "outRack") pickOutRack(id);
    else if (picker === "item") setItemIdx(Number(id));
    setPicker(null);
  };
  const pickerTitle = { po: "Production order", inRack: "Rack", outRack: "Occupied rack", item: "Item to remove" }[picker ?? "po"];

  return (
    <>
      <div role="group" aria-label="Stock direction" style={segmentTrack(2)}>
        {(["in", "out"] as Mode[]).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} style={segmentButton(mode === m)}>
            {m === "in" ? <ArrowDownToLine size={15} strokeWidth={1.9} /> : <ArrowUpFromLine size={15} strokeWidth={1.9} />}
            {m === "in" ? "Stock In" : "Stock Out"}
          </button>
        ))}
      </div>

      {!permLoading && !allowed ? (
        <div style={{ marginTop: 12 }}>
          <Notice>View only — your role can’t {mode === "in" ? "stock in" : "stock out"}.</Notice>
        </div>
      ) : null}

      <div style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 18, padding: 16, marginTop: 12 }}>
        {mode === "in" ? (
          <>
            <FieldLabel>Production order</FieldLabel>
            <PickerField
              value={po ? poTitle(po) : ""}
              sub={po ? [poProduct(po), str(po, "customerName", "customer_name")].filter(Boolean).join(" · ") : ""}
              placeholder={poLoading ? "Loading orders…" : pos.length ? "Select a completed order" : "No completed orders waiting"}
              onClick={() => setPicker("po")}
              disabled={pos.length === 0}
            />
            <Gap />
            <FieldLabel>Rack</FieldLabel>
            <PickerField value={inRack ? rackLabel(inRack) : ""} sub={inRack && rackStatusOf(inRack) === "OCCUPIED" ? pluralItems(itemsOf(inRack).length) : ""} placeholder="Select a rack" onClick={() => setPicker("inRack")} />
            <Gap />
            <FieldLabel hint="(optional)">Notes</FieldLabel>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes…" aria-label="Notes" style={FIELD_INPUT} />
          </>
        ) : (
          <>
            <FieldLabel>Occupied rack</FieldLabel>
            <PickerField value={outRack ? rackLabel(outRack) : ""} sub={outRack ? pluralItems(outItems.length) : ""} placeholder={occupiedRacks.length ? "Select a rack" : "No occupied racks"} onClick={() => setPicker("outRack")} disabled={occupiedRacks.length === 0} />
            <Gap />
            <FieldLabel>Item to remove</FieldLabel>
            <PickerField
              value={outItem ? rackItemDescription(outItem) : ""}
              sub={outItem ? [outItem.customerName, rackItemRefs(outItem)].filter(Boolean).join(" · ") : ""}
              placeholder={outRack ? "Select an item" : "Pick a rack first"}
              onClick={() => setPicker("item")}
              disabled={!outRack}
            />
            <Gap />
            <FieldLabel hint="(required)">Reason</FieldLabel>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Delivered, transferred, damaged…" aria-label="Reason" style={FIELD_INPUT} />
          </>
        )}
      </div>

      {/* Sticky confirm bar — sits above the bottom tabs on phones. */}
      <div
        style={{
          position: "sticky",
          bottom: layout.hasBottomNavigation ? "calc(64px + env(safe-area-inset-bottom))" : 12,
          zIndex: 5,
          marginTop: 14,
          padding: "10px 12px",
          background: M.card,
          border: `1px solid ${M.border}`,
          borderRadius: 16,
          boxShadow: "0 8px 24px -12px rgba(31,29,27,.35)",
        }}
      >
        <div style={{ fontSize: 12, color: valid ? M.raisin : M.muted, fontWeight: 600, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</div>
        {allowed ? (
          <button
            type="button"
            disabled
            aria-describedby="stock-confirm-note"
            style={{
              width: "100%",
              height: 48,
              border: "none",
              borderRadius: 13,
              background: mode === "in" ? "#B7C4A6" : "#E0B6AC",
              color: "#fff",
              fontSize: 14.5,
              fontWeight: 700,
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              cursor: "default",
            }}
          >
            {mode === "in" ? <ArrowDownToLine size={17} strokeWidth={1.9} /> : <ArrowUpFromLine size={17} strokeWidth={1.9} />}
            {mode === "in" ? "Confirm Stock In" : "Confirm Stock Out"}
          </button>
        ) : null}
        <div id="stock-confirm-note" style={{ fontSize: 11.5, color: M.muted, marginTop: 8, lineHeight: 1.4 }}>
          Stock In/Out saving is not enabled in this release. Use the desktop Warehouse page to record stock in/out.
        </div>
      </div>

      <PickerSheet
        open={picker !== null}
        title={pickerTitle}
        options={options}
        searchHay={searchHay}
        placeholder={picker === "outRack" ? "Search rack, SO, customer" : picker === "po" ? "Search PO, product, customer" : "Search"}
        onPick={onPick}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

function Gap() {
  return <div style={{ height: 14 }} />;
}

function PickerField({ value, sub, placeholder, onClick, disabled }: { value: string; sub?: string; placeholder: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 52, padding: "6px 13px", border: `1px solid ${M.hairline}`, borderRadius: 12, background: M.paper, textAlign: "left", fontFamily: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: value ? 700 : 500, color: value ? M.raisin : M.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || placeholder}</span>
        {value && sub ? <span style={{ display: "block", fontSize: 11.5, color: M.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span> : null}
      </span>
      <ChevronRight size={18} strokeWidth={1.75} color={M.faint} />
    </button>
  );
}

function PickerSheet({
  open,
  title,
  options,
  searchHay,
  placeholder,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  options: Option[];
  searchHay: (o: Option) => string;
  placeholder: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const shown = ql ? options.filter((o) => [o.title, o.sub ?? "", searchHay(o)].join(" ").toLowerCase().includes(ql)) : options;
  const LIMIT = 60;
  const close = () => {
    setQ("");
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={title}>
      {options.length > 6 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 13px", background: M.card, border: `1px solid ${M.hairline}`, borderRadius: 12, marginBottom: 10 }}>
          <Search size={17} strokeWidth={1.75} color={M.faint} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 15, color: M.raisin, fontFamily: "inherit" }} />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <div style={{ color: M.muted, fontSize: 13, textAlign: "center", padding: 18 }}>Nothing matches.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.slice(0, LIMIT).map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                setQ("");
                onPick(o.id);
              }}
              style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "6px 4px", border: "none", borderBottom: `1px solid ${M.divider}`, background: "none", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{o.title}</span>
                {o.sub ? <span style={{ display: "block", fontSize: 12, color: M.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</span> : null}
              </span>
              {o.right ? <span style={{ fontSize: 12, fontWeight: 600, color: M.ink, flex: "none" }}>{o.right}</span> : null}
            </button>
          ))}
          {shown.length > LIMIT ? <div style={{ fontSize: 12, color: M.muted, padding: "10px 4px" }}>Showing {LIMIT} of {shown.length} — type to narrow.</div> : null}
        </div>
      )}
    </Sheet>
  );
}
