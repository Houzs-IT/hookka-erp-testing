// ===========================================================================
// WIP detail — /m/inventory/wip.<id> ("Work in progress").
//
//   the row        GET /api/inventory/wip (there is no per-id WIP endpoint)
//   breakdown      GET /api/stock/breakdown?type=WIP&itemId=<wipCode>
//
// Job cards are the breakdown's lots (no worker is recorded on them). The
// movement history is the labour-minute ledger — minutes, never pieces. A
// negative row has no age (desktop shows "—").
// ===========================================================================
import { CloudOff, Lock, PackageOpen } from "lucide-react";
import type { StockMovement, WipLot } from "@/lib/stock-breakdown";
import {
  ageLabel, ageTone, dateLabel, deptLabel, plainQty, q2, titleCase, wipAge, wipTitle,
} from "../../lib/inventory-lib";
import { StateCard } from "../threepl/tpl-kit";
import { useWipList, useBreakdown } from "./inv-data";
import { BreakdownGate, DetailFrame, ServerNotices } from "./inv-detail";
import { DocCard, Hero, Label, Notice, Skeletons, StateLine, Tiles, type BadgeSpec } from "./inv-kit";
import { TONE, X } from "./inv-style";

const newestFirst = (a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

export function WipDetail({ id }: { id: string }) {
  const wip = useWipList(true);
  const row = wip.rows.find((w) => w.id === id) ?? null;
  const b = useBreakdown("WIP", row ? row.wipCode : null);

  if (!row) {
    return (
      <DetailFrame head="Work in progress">
        {wip.loading ? (
          <Skeletons n={3} h={96} pad="0" />
        ) : wip.denied ? (
          <StateCard icon={Lock} title="No access" sub="Your role can't read work in progress. Ask an admin." />
        ) : wip.failed ? (
          <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load this WIP item" sub={wip.error || "The inventory service didn't answer."} btn="Try again" onTap={wip.refresh} />
        ) : (
          <StateCard icon={PackageOpen} title="No longer in work in progress" sub="This WIP item has no stock now. It may have moved on to the next department." />
        )}
      </DetailFrame>
    );
  }

  const neg = row.totalQty < 0;
  const age = wipAge(row);
  const at = ageTone(age);
  const badges: BadgeSpec[] = [...(neg ? [{ l: "Negative qty", tone: "bad" as const }] : []), ...(age != null ? [{ l: `${ageLabel(age)} old`, tone: at }] : [])];
  const gate = b.data ? null : <BreakdownGate b={b} />;
  const lots = (b.data?.lots ?? []).filter((l): l is WipLot => l.kind === "WIP_LOT");
  const moves: StockMovement[] = [...(b.data?.movements ?? [])].sort(newestFirst);
  const dept = deptLabel(row.completedBy);

  return (
    <DetailFrame head="Work in progress">
      <Hero code={row.wipCode || "—"} badges={badges} title={wipTitle(row)} sub={[row.wipType, row.category ? titleCase(row.category) : "", dept].filter(Boolean).join(" · ")} />
      {neg ? (
        <Notice tone="bad">
          {`Negative quantity is valid here. A downstream department completed ${q2(Math.abs(row.totalQty))} before the upstream department scanned theirs. It evens out once the earlier step is scanned.`}
        </Notice>
      ) : null}
      <Tiles
        tiles={[
          { l: "Total qty", v: `${plainQty(row.totalQty)} pcs`, c: neg ? X.bad : X.ink },
          { l: "Department", v: dept },
          { l: "Source POs", v: String(row.sources.length) },
          { l: "Oldest age", v: ageLabel(age), c: at === "neu" ? X.ink : TONE[at].c },
        ]}
      />

      <Label t="SOURCE PRODUCTION ORDERS" r={String(row.sources.length)} />
      {row.sources.length ? (
        row.sources.map((s, i) => {
          const st = ageTone(s.ageDays);
          return (
            <DocCard
              key={`${s.poCode}-${s.jobCardId}-${i}`}
              code={s.poCode || "—"}
              date={ageLabel(s.ageDays)}
              title={`${plainQty(s.quantity)} pcs`}
              sub={[s.completedDate ? `Completed ${dateLabel(s.completedDate)}` : "", s.jobCardId ? `Job card ${s.jobCardId.slice(0, 8)}` : ""].filter(Boolean).join(" · ") || undefined}
              rail={s.quantity < 0 ? X.bad : st === "neu" ? X.chev : TONE[st].c}
            />
          );
        })
      ) : (
        <StateLine>No source production orders.</StateLine>
      )}

      <ServerNotices b={b} />
      {gate ?? (
        <>
          <Label t="JOB CARDS" r="Produced this WIP" />
          {lots.length ? (
            lots.map((l) => (
              <DocCard
                key={l.id}
                code={l.productionOrderNo || "—"}
                st={l.status ? titleCase(l.status) : undefined}
                tone={/COMPLETED|TRANSFERRED/i.test(l.status ?? "") ? "ok" : "neu"}
                date={l.completedDate ? dateLabel(l.completedDate) : ageLabel(l.ageDays)}
                title={`${plainQty(l.qty)} pcs · ${l.department ? deptLabel(l.department) : "—"}`}
                sub={[
                  l.jobCardNo ? `Step ${deptLabel(l.jobCardNo)}` : "",
                  l.salesOrderNo ?? "",
                  l.laborMinutes != null ? `${q2(l.laborMinutes)} min logged` : "",
                ].filter(Boolean).join(" · ") || undefined}
              />
            ))
          ) : (
            <StateLine>No job cards have produced this WIP item.</StateLine>
          )}

          <Label t="MOVEMENT HISTORY" />
          {moves.length ? (
            moves.map((m) => (
              <DocCard
                key={m.id}
                code={m.department || m.docNo || "—"}
                st="Minutes"
                tone="info"
                date={dateLabel(m.date)}
                title={`${q2(m.qty)} min`}
                sub={[m.takenByName ?? "", m.productionOrderNo ?? "", m.notes ?? ""].filter(Boolean).join(" · ") || undefined}
                rail={X.info}
              />
            ))
          ) : (
            <StateLine>No movements recorded.</StateLine>
          )}
          <Notice tone="info">Minute entries are labour time logged on job cards. They aren't counted as pieces.</Notice>
        </>
      )}
    </DetailFrame>
  );
}
