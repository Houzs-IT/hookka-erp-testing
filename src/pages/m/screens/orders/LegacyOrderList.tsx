// ===========================================================================
// LegacyOrderList — body of the Legacy Repair Orders family (table service_orders,
// GET /api/service-orders, LIMIT 500). Rendered BELOW the family switch of the Service
// Orders page: search, status chips with counts, banner, count/cap line and cards.
// No header and NO create button — repair orders are created from a Service Case.
// Search + chip live in the page's URL (?lq=, ?lchip=) so they survive opening an order
// and coming back; every other param (family switch etc.) is left untouched.
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CircleHelp, CloudOff, Info, Lock, Route, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { M } from "../../theme";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { CC, SH_CARD } from "../cases/case-style";
import { Btn, Card, Chip, Msg, Pill, SearchField } from "../cases/case-ui";
import { LEGACY_LIST_CAP, LEGACY_MODE_LABEL, LEGACY_STATUS_LABEL, fmtDM, legacyTone } from "./order-model";
import { LEGACY_CHIPS, chipCounts, legacyDetailHref, filterLegacy, legacyUnits, normalizeChip, normalizeLegacyOrder, type LegacyOrder } from "./legacy-logic";

type CaseLite = { id?: string; caseNo?: string };

export function LegacyOrderList() {
  const navigate = useNavigate();
  const { mode } = useResponsiveLayout();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("lq") ?? "";
  const chip = normalizeChip(params.get("lchip"));
  const [q, setQ] = useState(urlQ);
  // Browser back/forward changes the URL; keep the field in step.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the field to the URL param
  useEffect(() => setQ(urlQ), [urlQ]);

  const setParam = (key: string, value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });

  const { data, loading, failure, refresh } = useCachedJson<{ data?: Record<string, unknown>[] }>("/api/service-orders");
  // The list rows carry only caseId; the case number comes from the (cached) case list.
  const { data: caseData } = useCachedJson<{ data?: CaseLite[] }>("/api/service-cases");
  const caseNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of caseData?.data ?? []) if (c.id && c.caseNo) m.set(c.id, c.caseNo);
    return m;
  }, [caseData]);
  const caseNoOf = (o: LegacyOrder) => caseNoById.get(o.caseId) ?? "";

  const all = useMemo(() => (data?.data ?? []).map(normalizeLegacyOrder), [data]);
  const { searched, rows } = useMemo(
    () => filterLegacy(all, q, chip, (o) => caseNoById.get(o.caseId) ?? ""),
    [all, q, chip, caseNoById],
  );
  const counts = useMemo(() => chipCounts(searched), [searched]);

  const showLoading = loading && !data;
  const showError = !data && !!failure;
  const capped = all.length >= LEGACY_LIST_CAP;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "14px 18px 4px" }}>
        <SearchField
          value={q}
          onChange={(v) => { setQ(v); setParam("lq", v); }}
          placeholder="Search order, customer, case, source"
          label="Search repair orders"
          trailing={q ? <button type="button" aria-label="Clear search" onClick={() => { setQ(""); setParam("lq", ""); }} style={{ flex: "none", width: 36, height: 44, border: "none", background: "none", color: M.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><span style={{ width: 22, height: 22, borderRadius: 999, background: "#F2EEE6", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} strokeWidth={2.4} /></span></button> : null}
        />
      </div>

      <div role="tablist" aria-label="Repair order status" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 4px", scrollbarWidth: "none" }}>
        {LEGACY_CHIPS.map((k) => (
          <Chip
            key={k}
            role="tab"
            label={k === "ALL" ? "All" : LEGACY_STATUS_LABEL[k]}
            on={chip === k}
            count={showLoading ? undefined : counts[k] ?? 0}
            dot={k === "ALL" ? undefined : legacyTone(k).rail}
            onClick={() => setParam("lchip", k === "ALL" ? "" : k)}
          />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px 4px" }}>
        <span aria-live="polite" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", textTransform: "uppercase" }}>
          {rows.length} repair order{rows.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1, minWidth: 8, height: 1, background: "#E6E0D9" }} />
        {all.length ? <span style={{ fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>{capped ? `Latest ${LEGACY_LIST_CAP} loaded` : `${all.length} loaded`}</span> : null}
      </div>
      <div style={{ margin: "4px 18px 0", display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", borderRadius: 12, background: CC.tile, fontSize: 12, lineHeight: 1.45, color: M.ink }}>
        <Info size={14} strokeWidth={2} color={CC.brown} style={{ flex: "none", marginTop: 2 }} />
        <span>Older records with their own statuses. New repair orders are created from a Service Case.</span>
      </div>

      {showError ? (
        <Msg
          icon={failure?.status === 403 ? Lock : CloudOff}
          tone="danger"
          text="Couldn’t load repair orders"
          sub={failure?.status === 403 ? "Your role can’t open this list." : failure?.message || "This is a load failure, not an empty list. Check your connection and try again."}
          action={<Btn onClick={refresh}>Try again</Btn>}
        />
      ) : showLoading ? (
        <div aria-busy="true" aria-label="Loading repair orders" style={{ padding: "12px 18px 0", display: "grid", gap: 11 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ height: 132, borderRadius: 16, background: CC.sep }} />)}
        </div>
      ) : rows.length === 0 ? (
        <div role="status" style={{ margin: "14px 18px 0", background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "26px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>{all.length ? "No repair orders match" : "No legacy repair orders"}</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>{all.length ? "Try a different search or status." : "New ones are created from a Service Case."}</div>
        </div>
      ) : (
        <div role="list" aria-label="Repair orders" style={{ padding: "12px 18px 120px", display: "grid", gridTemplateColumns: mode === "phone" ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 11 }}>
          {rows.map((o) => (
            <div role="listitem" key={o.id} style={{ minWidth: 0 }}>
              <OrderCard o={o} caseNo={caseNoOf(o)} onOpen={() => navigate(legacyDetailHref(o.id))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ o, caseNo, onOpen }: { o: LegacyOrder; caseNo: string; onOpen: () => void }) {
  const tone = legacyTone(o.status);
  const label = LEGACY_STATUS_LABEL[o.status] ?? o.status;
  const created = fmtDM(o.createdAt);
  const metrics: [string, number][] = [["LINES", o.lines.length], ["UNITS", legacyUnits(o)], ["RETURNS", o.returns.length]];
  const chipS = { height: 24, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px", borderRadius: 7, background: CC.tile, fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" as const, fontVariantNumeric: "tabular-nums" as const };
  const ModeIcon = o.mode ? Route : CircleHelp;
  return (
    <Card onClick={onOpen} style={{ position: "relative", overflow: "hidden", padding: "13px 12px 12px 17px", height: "100%", boxSizing: "border-box" }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone.rail }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.no}</span>
        <Pill label={label} tone={tone} dot={tone.rail} />
        <span style={{ flex: 1 }} />
        <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{created || "—"}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: M.raisin, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{o.customerName || "—"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
        <span style={{ ...chipS, fontWeight: 700, background: o.mode ? CC.tile : CC.warnBg, color: o.mode ? M.ink : CC.warnFg }}>
          <ModeIcon size={12} strokeWidth={2.2} />{o.mode ? LEGACY_MODE_LABEL[o.mode] ?? o.mode : "Mode pending"}
        </span>
        {caseNo ? <span style={chipS}><span style={{ color: "#6B6252" }}>Case</span><b style={{ color: M.raisin }}>{caseNo}</b></span> : null}
        {o.sourceType ? <span style={chipS}><span style={{ color: "#6B6252" }}>{o.sourceType === "EXTERNAL" ? "External" : o.sourceType}</span><b style={{ color: M.raisin }}>{o.sourceNo || "—"}</b></span> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginTop: 11, paddingTop: 10, borderTop: `1px solid ${CC.sep}` }}>
        {metrics.map(([k, v], i) => (
          <div key={k} style={{ minWidth: 0, paddingLeft: i ? 9 : 0, borderLeft: i ? `1px solid ${CC.sep}` : "none" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".5px", color: CC.brown, whiteSpace: "nowrap" }}>{k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
