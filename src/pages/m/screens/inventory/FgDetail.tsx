// ===========================================================================
// Finished-good detail — /m/inventory/fg.<productId> ("Stock breakdown").
//
//   list figures   GET /api/products + /api/inventory/fg-stock (same as the card)
//   breakdown      GET /api/stock/breakdown?type=FG&itemId=<productId>
//
// Owner I-1: "Pieces on hand" is the breakdown's piece count (fg_units — a bed
// is several pieces, the qtyNote says so); Available / On draft DO are the
// list's own figures. The breakdown's SO-claimed count is never labelled
// "On draft DO". Pieces show their real status, DO and claiming SO.
// ===========================================================================
import { useState } from "react";
import { ListTree } from "lucide-react";
import type { FgLot, StockMovement } from "@/lib/stock-breakdown";
import { ageLabel, ageTone, dateLabel, fgActive, fgOnHand, fgSub, fgTone, q2, titleCase } from "../../lib/inventory-lib";
import { useFgList, useBreakdown } from "./inv-data";
import { BreakdownGate, DetailFrame, ServerNotices } from "./inv-detail";
import { DocCard, Expander, Hero, Label, Notice, StateLine, Tiles, type BadgeSpec } from "./inv-kit";
import { TONE, X } from "./inv-style";

const newestFirst = (a: StockMovement, b: StockMovement) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

export function FgDetail({ id }: { id: string }) {
  const fg = useFgList(true);
  const row = fg.rows.find((r) => r.id === id) ?? null;
  const b = useBreakdown("FG", id);
  const [pieces, setPieces] = useState(false);
  const h = b.data?.header ?? null;

  const code = row?.code ?? h?.itemCode ?? "";
  const name = row?.name ?? h?.itemName ?? "";
  const badges: BadgeSpec[] = [];
  if (row) {
    const [l, t] = fgTone(row);
    badges.push({ l, tone: t }, { l: fgActive(row) ? "Active" : titleCase(row.status), tone: fgActive(row) ? "br" : "neu" });
  }

  // Still loading both reads and nothing to show yet.
  if (!row && !h && (fg.loading || b.loading)) {
    return (
      <DetailFrame head="Stock breakdown">
        <BreakdownGate b={{ ...b, failure: null, loading: true }} />
      </DetailFrame>
    );
  }

  const gate = b.data ? null : <BreakdownGate b={b} />;
  const moves = b.data?.movements ?? [];
  const ins = moves.filter((m) => m.direction === "IN").sort(newestFirst);
  const outs = moves.filter((m) => m.direction === "OUT").sort(newestFirst);
  const lots = (b.data?.lots ?? []).filter((l): l is FgLot => l.kind === "FG_UNIT");
  const oldest = h?.oldestAgeDays ?? null;
  const onHand = row ? fgOnHand(row) : null;

  return (
    <DetailFrame head="Stock breakdown">
      <Hero code={code || "—"} badges={badges} title={name || "—"} sub={row ? fgSub(row) : undefined} />
      {fg.failed && !row ? (
        <StateLine tone={fg.denied ? "lock" : "bad"} retry={fg.denied ? undefined : fg.refresh}>
          {fg.denied ? "Your role can't read finished-goods stock." : `Couldn't load the stock figures. ${fg.error}`}
        </StateLine>
      ) : null}
      {row && onHand === 0 ? <Notice tone="info">No stock on hand. New completions from production show here.</Notice> : null}
      {row && onHand !== null && onHand > 0 && row.stockQty <= 0 ? <Notice tone="info">All stock on hand is on draft DOs. Nothing is free for new orders.</Notice> : null}
      <ServerNotices b={b} />

      <Label t="STOCK" />
      <Tiles
        tiles={[
          { l: "Pieces on hand", v: h?.totalQty == null ? "—" : `${q2(h.totalQty)} pcs` },
          { l: "Available", v: row ? `${q2(row.stockQty)} pcs` : "—", c: row ? (row.stockQty <= 0 ? X.bad : X.ok) : X.mut },
          { l: "On draft DO", v: row ? `${q2(row.reservedQty)} pcs` : "—", c: row ? X.ink : X.mut },
          { l: "FIFO age", v: ageLabel(oldest), c: ageTone(oldest) === "neu" ? X.ink : TONE[ageTone(oldest)].c, s: h?.oldestLayerDate ? `Oldest piece made ${dateLabel(h.oldestLayerDate)}` : undefined },
        ]}
      />

      {gate ?? (
        <>
          <Label t="MOVEMENTS IN" r={`${ins.length} completion${ins.length === 1 ? "" : "s"}`} />
          {ins.length ? (
            ins.map((m) => (
              <DocCard
                key={m.id}
                code={m.docNo ?? m.productionOrderNo ?? "—"}
                st="Completed"
                tone="ok"
                date={dateLabel(m.date)}
                title={`${q2(m.qty)} pcs completed`}
                sub={[m.department, m.takenByName ? `by ${m.takenByName}` : ""].filter(Boolean).join(" · ") || undefined}
                rail={X.ok}
              />
            ))
          ) : (
            <StateLine>No inbound movements.</StateLine>
          )}

          <Label t="MOVEMENTS OUT" r={`${outs.length} dispatch${outs.length === 1 ? "" : "es"}`} />
          {outs.length ? (
            outs.map((m) => {
              const serials = m.unitSerials ?? [];
              return (
                <DocCard
                  key={m.id}
                  code={m.docNo ?? "—"}
                  st={m.docType === "DELIVERY_ORDER" ? "Dispatched" : titleCase(m.type)}
                  tone="info"
                  date={dateLabel(m.date)}
                  title={m.customerName || "—"}
                  sub={serials.length ? `${serials.length} serial${serials.length === 1 ? "" : "s"}: ${serials.join(", ")}` : undefined}
                  amts={[{ k: "Qty", v: `−${q2(Math.abs(m.qty))} pcs`, c: X.bad }]}
                  rail={X.info}
                />
              );
            })
          ) : (
            <StateLine>No outbound movements.</StateLine>
          )}

          <Expander
            title="Pieces on hand"
            sub={lots.length ? `${lots.length} piece${lots.length === 1 ? "" : "s"} · serial, age and status` : "No pieces on hand"}
            icon={ListTree}
            open={pieces}
            onToggle={() => setPieces((v) => !v)}
          />
          {pieces
            ? lots.length
              ? lots.map((p) => {
                  const onDo = !!p.deliveryOrderNo;
                  const extra = [
                    p.mfdDate ? `Made ${dateLabel(p.mfdDate)}` : "",
                    p.productionOrderNo ?? "",
                    onDo ? `On DO ${p.deliveryOrderNo}` : "",
                    p.claimedBySoNo ? `Claimed by ${p.claimedBySoNo}` : "",
                    p.customerName ?? "",
                  ].filter(Boolean);
                  return (
                    <DocCard
                      key={p.id}
                      code={p.serial || p.shortCode || "—"}
                      st={p.status ? titleCase(p.status) : undefined}
                      tone={onDo ? "warn" : "neu"}
                      date={ageLabel(p.ageDays)}
                      title={p.attributes || name || "—"}
                      sub={extra.join(" · ") || undefined}
                      rail={onDo ? X.warn : X.ok}
                    />
                  );
                })
              : <StateLine>No pieces of this product are on hand.</StateLine>
            : null}
        </>
      )}
    </DetailFrame>
  );
}
