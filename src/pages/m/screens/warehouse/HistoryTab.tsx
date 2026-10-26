// History tab — the desktop Movement History: type filter + From/To date filter.
// One GET /api/warehouse/movements?from&to (the server caps it at the newest 500
// rows); the type chips filter that result client-side so every chip can show a
// count without extra requests.
import { useMemo, useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { str, num } from "../../config/helpers";
import { CHIP_ROW, CHIP_ROW_CLASS, CHIP_COUNT, chip as chipStyle } from "../../lib/control-styles";
import {
  type Movement,
  type MovementsResp,
  dateTimeShort,
  movementLook,
  movementRackText,
  movedFrom,
  FIELD_INPUT,
} from "./shared";
import { Pill, FieldLabel } from "./atoms";

type TypeFilter = "ALL" | "STOCK_IN" | "STOCK_OUT" | "TRANSFER";
const CHIPS: { key: TypeFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "STOCK_IN", label: "Stock In" },
  { key: "STOCK_OUT", label: "Stock Out" },
  { key: "TRANSFER", label: "Transfer" },
];
const SERVER_CAP = 500;

export function HistoryTab({ nameById }: { nameById: Map<string, string> }) {
  const [type, setType] = useState<TypeFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const qs = p.toString();
    return `/api/warehouse/movements${qs ? `?${qs}` : ""}`;
  }, [from, to]);
  const { data, loading } = useCachedJson<MovementsResp>(url);
  const all = useMemo(() => data?.data ?? [], [data]);

  const counts = useMemo(() => {
    const c: Record<TypeFilter, number> = { ALL: all.length, STOCK_IN: 0, STOCK_OUT: 0, TRANSFER: 0 };
    for (const m of all) if (m.type === "STOCK_IN" || m.type === "STOCK_OUT" || m.type === "TRANSFER") c[m.type]++;
    return c;
  }, [all]);
  const moves = type === "ALL" ? all : all.filter((m) => m.type === type);
  const badRange = !!from && !!to && from > to;

  return (
    <>
      <div role="group" aria-label="Movement type" className={CHIP_ROW_CLASS} style={{ ...CHIP_ROW, padding: "0 0 4px" }}>
        {CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={type === c.key} onClick={() => setType(c.key)} style={chipStyle(type === c.key)}>
            {c.label}
            <span style={CHIP_COUNT}>{counts[c.key]}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
        <div>
          <FieldLabel>From</FieldLabel>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" style={FIELD_INPUT} />
        </div>
        <div>
          <FieldLabel>To</FieldLabel>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" style={FIELD_INPUT} />
        </div>
      </div>
      {from || to ? (
        <button
          type="button"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
          style={{ minHeight: 44, padding: 0, border: "none", background: "none", color: M.taupe, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
        >
          Clear dates
        </button>
      ) : null}

      <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 600, margin: "10px 2px" }}>
        {loading && all.length === 0 ? "Loading…" : `${moves.length} movement${moves.length === 1 ? "" : "s"}`}
        {all.length >= SERVER_CAP ? ` · latest ${SERVER_CAP} only — narrow the dates for older ones` : ""}
        {badRange ? " · “From” is after “To”" : ""}
      </div>

      {moves.length === 0 ? (
        <MobileCard radius={14} style={{ padding: 18 }}>
          <div style={{ color: M.muted, fontSize: 13, textAlign: "center" }}>No movement history.</div>
        </MobileCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {moves.map((m) => (
            <MovementCard key={m.id} m={m} nameById={nameById} />
          ))}
        </div>
      )}
    </>
  );
}

function Meta({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: M.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: color ?? M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function MovementCard({ m, nameById }: { m: Movement; nameById: Map<string, string> }) {
  const look = movementLook(m);
  const from = movedFrom(m);
  const note = [from ? "" : str(m, "reason"), str(m, "performedBy") ? `By ${str(m, "performedBy")}` : ""].filter(Boolean).join(" · ");
  return (
    <div style={{ background: M.card, border: `1px solid ${M.border}`, borderLeft: `4px solid ${look.rail}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Pill bg={look.bg} fg={look.fg}>{look.tag}</Pill>
        <span style={{ fontSize: 11, color: M.muted, fontWeight: 600 }}>{dateTimeShort(m.createdAt)}</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, marginTop: 8, overflowWrap: "anywhere" }}>{str(m, "productName", "productCode") || "Movement"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) auto", gap: 12, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${M.divider}` }}>
        <Meta label="Rack" value={movementRackText(m, nameById) || "—"} />
        <Meta label="Document" value={str(m, "docRef") || "—"} color={M.taupe} />
        <div style={{ textAlign: "right" }}>
          <Meta label="Qty" value={`×${num(m, "quantity") || 1}`} />
        </div>
      </div>
      {note ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 8, overflowWrap: "anywhere" }}>{note}</div> : null}
    </div>
  );
}
