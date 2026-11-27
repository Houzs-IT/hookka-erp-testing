// The body of the bulk "Convert to GRN" confirmation (BUG-2026-11-27-592):
// every PO, every line and the quantity that will be received AND posted to
// stock, so nothing is posted until the operator has seen it and pressed
// Confirm. Rendered inside the shared confirm dialog (desktop and /m).
import type { BulkGrnPlanPo } from "@/lib/po-bulk-grn";

export function BulkGrnConfirmBody({ plan }: { plan: BulkGrnPlanPo[] }) {
  const lineCount = plan.reduce((n, p) => n + p.lines.length, 0);
  return (
    <div className="space-y-2" data-testid="bulk-grn-confirm">
      <p>
        {plan.length} GRN{plan.length === 1 ? "" : "s"} ({lineCount} line{lineCount === 1 ? "" : "s"}) will be
        created and <strong>posted to stock now</strong>, with every quantity accepted and the
        POs&apos; In Transit entries cleared. There is no separate arrival or QC step.
      </p>
      <div className="max-h-[50vh] overflow-y-auto rounded-md border border-[#E2DDD8]">
        {plan.map((p) => (
          <div key={p.poId} className="border-b border-[#E2DDD8] last:border-b-0 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-[#1F1D1B]">{p.poNo}</span>
              {p.supplierName && (
                <span className="truncate text-xs text-[#6B7280]">{p.supplierName}</span>
              )}
            </div>
            <ul className="mt-1 space-y-1">
              {p.lines.map((l) => (
                <li key={l.poItemIndex} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 break-words text-[#374151]">
                    {l.materialCode ? `${l.materialCode} — ` : ""}
                    {l.materialName || "(no description)"}
                    {l.alreadyReceived > 0 && (
                      <span className="text-[#9CA3AF]">
                        {" "}
                        (ordered {l.ordered}, {l.alreadyReceived} already received)
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-[#1F1D1B]">
                    {l.receive} {l.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
