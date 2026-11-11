// Racks tab — search (+ scan-rack), occupancy card, status chips, 2-column v3
// rack tiles and the rack bottom sheet. Read-only apart from the hand-offs to
// Stock In/Out; no write happens here.
import { useMemo, useState } from "react";
import { ScanLine, Search, QrCode, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { useDebounced } from "../../lib/use-debounced";
import { Sheet } from "../../components";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { str } from "../../config/helpers";
import { CHIP_ROW, CHIP_ROW_CLASS, CHIP_COUNT, chip as chipStyle, chipDot } from "../../lib/control-styles";
import {
  type Rack,
  type RackItem,
  type RackStatus,
  type WarehouseSummary,
  type LocateResp,
  type LocateHit,
  type RackDetailsResp,
  type Movement,
  TILE,
  STATUS_DOT,
  STATUS_LABEL,
  rackLabel,
  rackItemDescription,
  rackItemRefs,
  rackItemSO,
  itemsOf,
  rackStatusOf,
  pluralItems,
  dateShort,
  dateTimeShort,
  movementLook,
  movementRackText,
} from "./shared";
import { Pill, SectionLabel, Notice } from "./atoms";

type Filter = "ALL" | RackStatus;
const PAGE = 40;

export function RacksTab({
  racks,
  summary,
  loading,
  canStockIn,
  canStockOut,
  onScanRack,
  onRackQr,
  onStockIn,
  onStockOut,
}: {
  racks: Rack[];
  summary?: WarehouseSummary;
  loading: boolean;
  canStockIn: boolean;
  canStockOut: boolean;
  onScanRack: () => void;
  onRackQr: (r: Rack) => void;
  onStockIn: (r: Rack) => void;
  onStockOut: (r: Rack) => void;
}) {
  const [q, setQ] = useState("");
  const term = useDebounced(q).trim();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { OCCUPIED: 0, EMPTY: 0, RESERVED: 0 };
    for (const r of racks) c[rackStatusOf(r)]++;
    return c;
  }, [racks]);
  const pieces = useMemo(() => racks.reduce((n, r) => n + itemsOf(r).length, 0), [racks]);
  const total = summary?.total ?? racks.length;
  const occupied = summary?.occupied ?? counts.OCCUPIED;
  const reserved = summary?.reserved ?? counts.RESERVED;
  const empty = summary?.empty ?? counts.EMPTY;
  const rate = summary?.occupancyRate ?? (total > 0 ? Math.round((occupied / total) * 100) : 0);

  const shown = useMemo(
    () => (filter === "ALL" ? racks : racks.filter((r) => rackStatusOf(r) === filter)),
    [racks, filter],
  );
  const openRack = racks.find((r) => r.id === openId) ?? null;

  // Typing: pieces (server search, read-gated) + racks whose NAME matches.
  const searching = term.length >= 2;
  const url = searching ? `/api/warehouse/locate?q=${encodeURIComponent(term)}` : null;
  // Short TTL: a location is exactly the thing that changes under you.
  const { data: hitResp, loading: hitLoading, error: hitError } = useCachedJson<LocateResp>(url, 10);
  const hits = searching ? (hitResp?.data ?? []) : [];
  const nameMatches = useMemo(
    () => (searching ? racks.filter((r) => rackLabel(r).toLowerCase().includes(term.toLowerCase())) : []),
    [racks, term, searching],
  );

  const pick = (f: Filter) => {
    setFilter(f);
    setLimit(PAGE);
  };

  return (
    <>
      {/* Search + scan rack (replaces the old Find tab and Scan Rack button). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 48,
          padding: "0 4px 0 14px",
          background: M.card,
          border: `1px solid ${M.hairline}`,
          borderRadius: 14,
        }}
      >
        <Search size={18} strokeWidth={1.75} color={M.faint} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find SO, PO, customer, item"
          aria-label="Find SO, PO, customer or item"
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 15, color: M.raisin, fontFamily: "inherit", padding: "0 8px" }}
        />
        <button
          type="button"
          onClick={onScanRack}
          aria-label="Scan rack QR"
          style={{ width: 44, height: 44, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none", WebkitTapHighlightColor: "transparent" }}
        >
          <ScanLine size={20} strokeWidth={1.9} color={M.taupe} />
        </button>
      </div>

      {searching ? (
        <SearchResults
          racks={racks}
          nameMatches={nameMatches}
          hits={hits}
          loading={hitLoading}
          error={!!hitError}
          onOpen={setOpenId}
        />
      ) : (
        <>
          <OccupancyCard rate={rate} pieces={pieces} total={total} occupied={occupied} reserved={reserved} empty={empty} />

          <div role="group" aria-label="Rack status" className={CHIP_ROW_CLASS} style={{ ...CHIP_ROW, padding: "12px 0 4px" }}>
            {(
              [
                ["ALL", "All", total, null],
                ["OCCUPIED", "Occupied", counts.OCCUPIED, STATUS_DOT.OCCUPIED],
                ["EMPTY", "Empty", counts.EMPTY, STATUS_DOT.EMPTY],
                ["RESERVED", "Reserved", counts.RESERVED, STATUS_DOT.RESERVED],
              ] as [Filter, string, number, string | null][]
            ).map(([key, label, n, dot]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => pick(key)} style={chipStyle(filter === key)}>
                {dot ? <span aria-hidden style={chipDot(dot)} /> : null}
                {label}
                <span style={CHIP_COUNT}>{n}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <MobileCard radius={16} style={{ padding: 20, marginTop: 10 }}>
              <div style={{ color: M.muted, fontSize: 13, textAlign: "center" }}>
                {loading ? "Loading racks…" : filter === "ALL" ? "No racks configured." : `No ${STATUS_LABEL[filter].toLowerCase()} racks.`}
              </div>
            </MobileCard>
          ) : (
            <>
              <RackGrid racks={shown.slice(0, limit)} onOpen={setOpenId} />
              {shown.length > limit ? (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE)}
                  style={{ width: "100%", height: 46, marginTop: 12, border: `1px solid ${M.hairline}`, borderRadius: 12, background: M.card, color: M.taupe, fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
                >
                  Show more · {shown.length - limit} left
                </button>
              ) : null}
            </>
          )}
        </>
      )}

      <RackSheet
        rack={openRack}
        racks={racks}
        canStockIn={canStockIn}
        canStockOut={canStockOut}
        onClose={() => setOpenId(null)}
        onRackQr={(r) => {
          setOpenId(null);
          onRackQr(r);
        }}
        onStockIn={(r) => {
          setOpenId(null);
          onStockIn(r);
        }}
        onStockOut={(r) => {
          setOpenId(null);
          onStockOut(r);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
function OccupancyCard({
  rate,
  pieces,
  total,
  occupied,
  reserved,
  empty,
}: {
  rate: number;
  pieces: number;
  total: number;
  occupied: number;
  reserved: number;
  empty: number;
}) {
  const w = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  return (
    <MobileCard radius={18} style={{ marginTop: 12, padding: "15px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 30, fontWeight: 800, color: M.raisin, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{rate}%</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: M.muted }}>occupied</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
          {pieces} pieces · {total} racks
        </span>
      </div>
      <div
        role="img"
        aria-label={`${occupied} occupied, ${reserved} reserved, ${empty} empty of ${total} racks`}
        style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: M.divider, marginTop: 12 }}
      >
        <span style={{ width: w(occupied), background: STATUS_DOT.OCCUPIED }} />
        <span style={{ width: w(reserved), background: STATUS_DOT.RESERVED }} />
        <span style={{ width: w(empty), background: STATUS_DOT.EMPTY }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 11 }}>
        {(
          [
            ["OCCUPIED", occupied],
            ["RESERVED", reserved],
            ["EMPTY", empty],
          ] as [RackStatus, number][]
        ).map(([k, n]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: M.ink, fontWeight: 600 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[k] }} />
            {STATUS_LABEL[k]} <span style={{ fontVariantNumeric: "tabular-nums", color: M.raisin, fontWeight: 700 }}>{n}</span>
          </span>
        ))}
      </div>
    </MobileCard>
  );
}

// ---------------------------------------------------------------------------
function RackGrid({ racks, onOpen }: { racks: Rack[]; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, alignItems: "start", marginTop: 8 }}>
      {racks.map((r) => (
        <RackTile key={r.id} rack={r} onOpen={() => onOpen(r.id)} />
      ))}
    </div>
  );
}

const SHOWN_ITEMS = 2;

function RackTile({ rack, onOpen }: { rack: Rack; onOpen: () => void }) {
  const status = rackStatusOf(rack);
  const t = TILE[status];
  const items = itemsOf(rack);
  const label = rackLabel(rack);
  const extra = items.length - SHOWN_ITEMS;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}, ${status === "OCCUPIED" ? pluralItems(items.length) : STATUS_LABEL[status]}`}
      style={{
        display: "block",
        width: "100%",
        minWidth: 0,
        textAlign: "left",
        border: "none",
        borderRadius: 14,
        padding: "12px 12px 10px",
        background: t.bg,
        color: t.fg,
        boxShadow: t.shadow,
        fontFamily: "inherit",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, flex: "none" }}>
          {status === "OCCUPIED" ? pluralItems(items.length) : STATUS_LABEL[status]}
        </span>
      </div>
      {status === "OCCUPIED" && items.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {items.slice(0, SHOWN_ITEMS).map((it, i) => (
            <TileItem key={i} it={it} />
          ))}
          {extra > 0 ? (
            <div style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,.18)" }}>
              + {extra} more
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function TileItem({ it }: { it: RackItem }) {
  const refs = rackItemRefs(it);
  const line = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
  return (
    <div style={{ padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.18)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{rackItemDescription(it)}</div>
      {it.customerName ? <div style={{ ...line, fontSize: 11.5, marginTop: 2 }}>{it.customerName}</div> : null}
      {refs ? <div style={{ ...line, fontSize: 11, opacity: 0.75, marginTop: 1 }}>{refs}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
function SearchResults({
  racks,
  nameMatches,
  hits,
  loading,
  error,
  onOpen,
}: {
  racks: Rack[];
  nameMatches: Rack[];
  hits: LocateHit[];
  loading: boolean;
  error: boolean;
  onOpen: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(racks.map((r) => [r.id, r])), [racks]);
  return (
    <>
      {nameMatches.length > 0 ? (
        <>
          <SectionLabel>Racks</SectionLabel>
          <RackGrid racks={nameMatches.slice(0, 12)} onOpen={onOpen} />
        </>
      ) : null}
      <SectionLabel>Pieces</SectionLabel>
      {error ? (
        <Notice tone="err">Couldn’t search pieces. You may not have access to warehouse search.</Notice>
      ) : loading && hits.length === 0 ? (
        <div style={{ color: M.muted, fontSize: 13, padding: "6px 2px" }}>Searching…</div>
      ) : hits.length === 0 ? (
        <MobileCard radius={14} style={{ padding: 18 }}>
          <div style={{ color: M.muted, fontSize: 13, textAlign: "center" }}>No pieces match your search.</div>
        </MobileCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hits.map((h) => {
            const rec = h as unknown as Record<string, unknown>;
            const id = str(rec, "rackLocationId", "rack_location_id");
            const rack = byId.get(id);
            const label = rack ? rackLabel(rack) : str(rec, "rackLabel", "rack_label");
            const refs = [str(rec, "customerPO", "customer_po"), str(rec, "salesOrderNo", "sales_order_no")].filter(Boolean).join(" · ");
            return (
              <MobileCard key={str(rec, "rackItemId", "rack_item_id") || `${id}-${str(rec, "description")}`} radius={14} onClick={() => onOpen(id)} style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ flex: "none", maxWidth: 110, padding: "6px 10px", borderRadius: 10, background: TILE.OCCUPIED.bg, color: "#fff", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label || "—"}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{str(rec, "description") || "Item"}</div>
                    {str(rec, "customerName", "customer_name") ? (
                      <div style={{ fontSize: 12, color: M.ink, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{str(rec, "customerName", "customer_name")}</div>
                    ) : null}
                    {refs ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{refs}</div> : null}
                  </div>
                </div>
              </MobileCard>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rack bottom sheet. Contents open, move history collapsed. Actions follow the
// status, exactly like the desktop popups: Occupied → QR + Stock Out; Empty →
// QR + Stock in here; Reserved → QR only (desktop has no popup for Reserved).
function RackSheet({
  rack,
  racks,
  canStockIn,
  canStockOut,
  onClose,
  onRackQr,
  onStockIn,
  onStockOut,
}: {
  rack: Rack | null;
  racks: Rack[];
  canStockIn: boolean;
  canStockOut: boolean;
  onClose: () => void;
  onRackQr: (r: Rack) => void;
  onStockIn: (r: Rack) => void;
  onStockOut: (r: Rack) => void;
}) {
  const [histOpen, setHistOpen] = useState(false);
  const { data, loading } = useCachedJson<RackDetailsResp>(rack ? `/api/warehouse/${encodeURIComponent(rack.id)}/details` : null, 10);
  const nameById = useMemo(() => new Map(racks.map((r) => [r.id, rackLabel(r)])), [racks]);
  if (!rack) return null;

  const status = rackStatusOf(rack);
  // The grid already carries the items; the details fetch only adds history.
  const contents = data?.data?.contents ?? itemsOf(rack);
  const moves: Movement[] = data?.data?.movements ?? [];
  const label = rackLabel(rack);

  const action = (text: string, icon: React.ReactNode, onClick: () => void, primary = false) => (
    <button
      key={text}
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        height: 48,
        borderRadius: 13,
        border: primary ? "none" : `1px solid ${M.hairline}`,
        background: primary ? (text === "Stock Out" ? "#9A3A2D" : "#4F7C3A") : M.card,
        color: primary ? "#fff" : M.ink,
        fontSize: 14,
        fontWeight: 700,
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: "pointer",
      }}
    >
      {icon}
      {text}
    </button>
  );

  return (
    <Sheet open onClose={onClose} title={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Pill bg={TILE[status].bg} fg={status === "OCCUPIED" ? "#fff" : TILE[status].fg}>
          {STATUS_LABEL[status].toUpperCase()}
        </Pill>
        <span style={{ fontSize: 12.5, color: M.muted, fontWeight: 600 }}>
          {status === "OCCUPIED" ? `${contents.length} piece${contents.length === 1 ? "" : "s"}` : status === "EMPTY" ? "Nothing stored" : "Held for use"}
        </span>
      </div>

      {status === "OCCUPIED" ? (
        <>
          <SectionLabel>Contents</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {contents.map((it, i) => {
              const refs = rackItemRefs(it);
              const note = (it.notes || "").trim();
              return (
                <MobileCard key={i} radius={14} style={{ padding: "11px 13px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{rackItemDescription(it)}</div>
                  {it.customerName ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>{it.customerName}</div> : null}
                  {refs ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{refs}</div> : null}
                  <div style={{ fontSize: 11, color: M.muted, marginTop: 5, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                    {rackItemSO(it) ? <span>SO {rackItemSO(it)}</span> : null}
                    {it.stockedInDate ? <span>Stocked in {dateShort(it.stockedInDate)}</span> : null}
                  </div>
                  {note && !/^SO\s+\S+$/i.test(note) ? <div style={{ fontSize: 11.5, color: M.ink, marginTop: 4 }}>{note}</div> : null}
                </MobileCard>
              );
            })}
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setHistOpen((v) => !v)}
        aria-expanded={histOpen}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 44, margin: "10px 0 0", padding: 0, border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", color: M.taupe, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}
      >
        {histOpen ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
        Move history{data?.data?.movements ? ` · ${moves.length}` : ""}
      </button>
      {histOpen ? (
        moves.length === 0 ? (
          <div style={{ fontSize: 12.5, color: M.muted, padding: "2px 2px 6px" }}>{loading ? "Loading…" : "No movements for this rack."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {moves.map((m) => {
              const look = movementLook(m);
              return (
                <div key={m.id} style={{ borderLeft: `4px solid ${look.rail}`, background: M.card, borderRadius: 10, padding: "9px 12px", border: `1px solid ${M.border}`, borderLeftWidth: 4, borderLeftColor: look.rail }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <Pill bg={look.bg} fg={look.fg}>{look.tag}</Pill>
                    <span style={{ fontSize: 11, color: M.muted, fontWeight: 600 }}>{dateTimeShort(m.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: M.raisin, marginTop: 6, overflowWrap: "anywhere" }}>{str(m, "productName", "productCode") || "Movement"}</div>
                  <div style={{ fontSize: 11, color: M.muted, marginTop: 2 }}>
                    {[movementRackText(m, nameById), str(m, "docRef"), str(m, "performedBy") ? `by ${str(m, "performedBy")}` : ""].filter(Boolean).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        {action("Rack QR", <QrCode size={17} strokeWidth={1.75} color={M.taupe} />, () => onRackQr(rack))}
        {status === "OCCUPIED" && canStockOut ? action("Stock Out", <ArrowUpFromLine size={17} strokeWidth={1.9} color="#fff" />, () => onStockOut(rack), true) : null}
        {status === "EMPTY" && canStockIn ? action("Stock in here", <ArrowDownToLine size={17} strokeWidth={1.9} color="#fff" />, () => onStockIn(rack), true) : null}
      </div>
    </Sheet>
  );
}
