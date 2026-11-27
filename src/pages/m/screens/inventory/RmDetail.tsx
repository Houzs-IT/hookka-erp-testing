// ===========================================================================
// Raw-material detail — /m/inventory/<rm id> ("Raw material"). The RM keeps
// its own id in the route so every existing link (Home alerts, notifications,
// the old generic screen) still opens it.
//
//   material     GET /api/raw-materials/:id
//   breakdown    GET /api/stock/breakdown?type=RM&itemId=<id>   (lots + movements + notices)
//   used in      GET /api/raw-materials/:id/used-in
//   suppliers    GET /api/supplier-materials?materialCode=<ITEM CODE>   (bindings are keyed by code)
//   reduce       POST /api/stock-adjustments (inventory:create) — ReduceStockSheet
//
// No money: lot costs, values and supplier prices are not shown (owner S-2).
// ===========================================================================
import { useMemo, useState } from "react";
import { CloudOff, Lock, PackageMinus, PackageOpen } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import type { RmLot } from "@/lib/stock-breakdown";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import {
  ageLabel, dataRows, dateLabel, minStockLabel, num, rmMoveLabel, rmTone, round2, rowsOf, signed, str, toRm, URLS, withUom,
  type Raw,
} from "../../lib/inventory-lib";
import { StateCard } from "../threepl/tpl-kit";
import { useBreakdown, useInvPerms } from "./inv-data";
import { BreakdownGate, DetailFrame, ServerNotices } from "./inv-detail";
import { DocCard, Hero, Label, MoreButton, Rows, Skeletons, StateLine, Tiles } from "./inv-kit";
import { TONE, X } from "./inv-style";
import { useInvToast } from "./inv-toast";
import { ReduceStockSheet } from "./ReduceStockSheet";

const MOVES_PAGE = 20;

export function RmDetail({ id }: { id: string }) {
  const perms = useInvPerms();
  const phone = useResponsiveLayout().mode === "phone";
  const doc = useCachedJson<{ success?: boolean; data?: Raw }>(URLS.rmOne(id));
  const rm = useMemo(() => (doc.data?.data ? toRm(doc.data.data) : null), [doc.data]);
  const b = useBreakdown("RM", id);
  const usedRes = useCachedJson<{ data?: { products?: unknown } }>(rm ? URLS.usedIn(id) : null);
  const supRes = useCachedJson<unknown>(rm && rm.itemCode !== "—" ? URLS.suppliers(rm.itemCode) : null);
  const [movesShown, setMovesShown] = useState(MOVES_PAGE);
  const [reducing, setReducing] = useState(false);
  const showDock = !!rm && !perms.loading && perms.module;
  const toast = useInvToast(showDock);

  if (!rm) {
    return (
      <DetailFrame head="Raw material">
        {doc.loading && !doc.failure ? (
          <Skeletons n={3} h={96} pad="0" />
        ) : doc.failure?.kind === "notFound" ? (
          <StateCard icon={PackageOpen} title="This material isn't in the list" sub="It may have been deleted, or the link is out of date." />
        ) : doc.failure?.status === 403 ? (
          <StateCard icon={Lock} title="No access" sub="Your role can't read raw materials. Ask an admin." />
        ) : (
          <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load this material" sub={doc.failure?.message || "The inventory service didn't answer."} btn="Try again" onTap={doc.refresh} />
        )}
      </DetailFrame>
    );
  }

  const [l, t] = rmTone(rm);
  const lots = (b.data?.lots ?? []).filter((x): x is RmLot => x.kind === "RM_LOT");
  const openLots = lots.filter((x) => (x.qty ?? 0) > 0);
  const inLots = b.data ? (b.data.header.totalQty ?? round2(lots.reduce((a, x) => a + (x.qty ?? 0), 0))) : null;
  const diff = inLots == null ? null : round2(rm.balanceQty - inLots);
  const lotsOldest = [...lots].sort((a, c) => ((a.receivedDate ?? "") < (c.receivedDate ?? "") ? -1 : (a.receivedDate ?? "") > (c.receivedDate ?? "") ? 1 : 0));
  const moves = [...(b.data?.movements ?? [])].sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0));
  const usedIn = rowsOf((usedRes.data?.data as { products?: unknown } | undefined)?.products);
  const sups = [...dataRows(supRes.data)].sort((a, c) => Number(c.isMainSupplier === true) - Number(a.isMainSupplier === true));
  const gate = b.data ? null : <BreakdownGate b={b} />;

  return (
    <DetailFrame head="Raw material" dockPad={showDock}>
      <Hero code={rm.itemCode} badges={[{ l, tone: t }]} title={rm.description || "—"} sub={rm.itemGroup || undefined} />
      <Tiles
        tiles={[
          { l: "Balance", v: withUom(rm.balanceQty, rm.baseUOM), c: t === "ok" ? X.ink : TONE[t].c },
          { l: "Min stock", v: minStockLabel(rm), c: rm.minStock > 0 ? X.ink : X.mut },
          { l: "Base unit", v: rm.baseUOM || "—" },
          { l: "Receipt lots", v: b.data ? String(openLots.length) : "—" },
        ]}
      />
      <ServerNotices b={b} />

      <Label t="STOCK BREAKDOWN" />
      {gate ?? (
        <Rows
          rows={[
            { k: "Balance", v: withUom(rm.balanceQty, rm.baseUOM) },
            { k: "Remaining in lots", v: inLots == null ? "" : withUom(inLots, rm.baseUOM) },
            { k: "Difference", v: diff == null ? "" : diff ? `${signed(diff)} ${rm.baseUOM}`.trim() : "None", c: diff ? X.warn : X.ok },
          ]}
        />
      )}

      {b.data ? (
        <>
          <Label t="RECEIPTS & LOTS" r="Oldest first" />
          {lotsOldest.length ? (
            lotsOldest.map((g) => (
              <DocCard
                key={g.id}
                code={g.grnNo || "—"}
                date={g.receivedDate ? dateLabel(g.receivedDate) : ""}
                title={g.supplierName || "—"}
                sub={[g.purchaseOrderNo ?? "", g.ageDays != null ? ageLabel(g.ageDays) : ""].filter(Boolean).join(" · ") || undefined}
                amts={[
                  { k: "Original", v: withUom(g.originalQty, rm.baseUOM) },
                  { k: "Remaining", v: g.qty == null ? "—" : withUom(g.qty, rm.baseUOM), c: g.qty ? X.ink : X.mut },
                ]}
              />
            ))
          ) : (
            <StateLine>No receipts for this material.</StateLine>
          )}

          <Label t="MOVEMENTS" r={moves.length ? String(moves.length) : undefined} />
          {moves.length ? (
            <>
              {moves.slice(0, movesShown).map((m) => {
                const qty = m.direction === "IN" ? Math.abs(m.qty) : -Math.abs(m.qty);
                const inbound = qty > 0;
                return (
                  <DocCard
                    key={m.id}
                    code={m.docNo || "—"}
                    st={rmMoveLabel(m)}
                    tone={inbound ? "ok" : "bad"}
                    date={dateLabel(m.date)}
                    title={`${signed(qty)} ${rm.baseUOM}`.trim()}
                    rail={inbound ? X.ok : X.bad}
                  />
                );
              })}
              {moves.length > movesShown ? <MoreButton left={moves.length - movesShown} onTap={() => setMovesShown((v) => v + MOVES_PAGE)} /> : null}
            </>
          ) : (
            <StateLine>No movements recorded.</StateLine>
          )}
        </>
      ) : null}

      {usedIn.length ? (
        <>
          <Label t="USED IN PRODUCTS" r={String(usedIn.length)} />
          <Rows rows={usedIn.map((p) => ({ k: str(p, "productCode", "product_code"), v: str(p, "productName", "product_name") }))} />
        </>
      ) : usedRes.failure && usedRes.failure.status !== 403 ? (
        <>
          <Label t="USED IN PRODUCTS" />
          <StateLine tone="bad" retry={usedRes.refresh}>{`Couldn't load the products using this material. ${usedRes.failure.message}`}</StateLine>
        </>
      ) : null}

      {sups.length ? (
        <>
          <Label t="SUPPLIERS" />
          {sups.map((p, i) => {
            const main = p.isMainSupplier === true || p.isMainSupplier === 1;
            const lead = num(p, "leadTimeDays", "lead_time_days");
            const moq = num(p, "moq");
            return (
              <DocCard
                key={str(p, "id") || String(i)}
                code={str(p, "supplierName", "supplierCode") || "—"}
                st={main ? "Main supplier" : undefined}
                tone="br"
                title={str(p, "supplierSku", "supplier_sku") ? `Supplier SKU ${str(p, "supplierSku", "supplier_sku")}` : "No supplier SKU"}
                amts={[
                  { k: "Lead time", v: lead > 0 ? ageLabel(lead) : "—", c: lead > 0 ? X.ink : X.mut },
                  { k: "MOQ", v: moq > 0 ? withUom(moq, rm.baseUOM) : "—", c: moq > 0 ? X.ink : X.mut },
                ]}
                rail={main ? X.gold : X.chev}
              />
            );
          })}
        </>
      ) : supRes.failure && supRes.failure.status !== 403 ? (
        <>
          <Label t="SUPPLIERS" />
          <StateLine tone="bad" retry={supRes.refresh}>{`Couldn't load the suppliers. ${supRes.failure.message}`}</StateLine>
        </>
      ) : null}

      {showDock ? (
        <ResponsiveActionDock scope="auto" phoneBottom={phone ? 56 : 0} zIndex={30}>
          <div style={{ pointerEvents: "auto", width: "100%", maxWidth: phone ? 414 : 760, boxSizing: "border-box", padding: "10px 16px", background: X.nav, boxShadow: `0 -1px 0 ${X.ln}` }}>
            {perms.reduce ? (
              <button
                type="button"
                disabled={rm.balanceQty <= 0}
                onClick={() => setReducing(true)}
                style={{
                  width: "100%", height: 50, borderRadius: 14, border: "none", fontFamily: "inherit", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  background: rm.balanceQty > 0 ? X.grad : X.chip, color: rm.balanceQty > 0 ? "#FFFFFF" : X.mut, cursor: rm.balanceQty > 0 ? "pointer" : "default",
                }}
              >
                <PackageMinus size={18} strokeWidth={2} />
                {rm.balanceQty > 0 ? "Reduce stock" : "No stock to reduce"}
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, background: X.neub, color: X.sub, fontSize: 13, fontWeight: 600, padding: "0 12px", textAlign: "center" }}>
                <Lock size={15} strokeWidth={2} style={{ flex: "none" }} />
                Reducing stock needs inventory edit access
              </div>
            )}
          </div>
        </ResponsiveActionDock>
      ) : null}

      {reducing ? (
        <ReduceStockSheet
          rm={rm}
          onClose={() => setReducing(false)}
          onSaved={(msg) => {
            setReducing(false);
            toast.show(msg);
          }}
        />
      ) : null}
      {toast.node}
    </DetailFrame>
  );
}
