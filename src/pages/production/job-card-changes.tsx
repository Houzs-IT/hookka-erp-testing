// The job cards a WIP time save would change, shown before anything is saved:
// a confirm pop-up for the single and multi-row edits, and the same list inside
// the Excel import confirm. The server works the list out (PUT /api/wip-times
// with dryRun) by the same rules the real save uses.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export type CardDetail = {
  jcId: string;
  soNo: string;
  poNo: string;
  customerName: string;
  productCode: string;
  deptCode: string;
  deptName: string;
  wipLabel: string;
  wipQty: number;
  status: string;
  dueDate: string;
  workers: string;
  oldMinutes: number;
  newMinutes?: number;
  reason?: string;
};
export type CardPreview = { willChange: CardDetail[]; keep: CardDetail[] };

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Waiting",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  COMPLETED: "Finished this month",
};
const KEEP_LABEL: Record<string, string> = {
  outOfDate: "already had a different time from the old BOM",
  sofaFabCutMerge: "sofa fabric cutting shared by several lines of the order",
  specialOrder: "headboard-only or partial repair line",
  noMatch: "its step is no longer in the BOM",
  duplicateDept: "old card overlapping another card in the same department",
  bomZero: "the new BOM time is blank (0)",
};

// Fabric cutting cards already hold the total for the whole set.
const cardTotal = (c: CardDetail, m: number) => (c.deptCode === "FAB_CUT" ? m : m * Math.max(1, c.wipQty));
const fmtDate = (d: string) => (d ? formatDate(d) : "—");

// Several previews (one per row of a multi-row edit) into one.
export function mergePreviews(list: CardPreview[]): CardPreview {
  const seen = new Set<string>();
  const pick = (cards: CardDetail[]) =>
    cards.filter((c) => {
      if (seen.has(c.jcId)) return false;
      seen.add(c.jcId);
      return true;
    });
  // A card that changes for one row is not also listed as kept for another.
  const willChange = pick(list.flatMap((p) => p.willChange));
  const keep = pick(list.flatMap((p) => p.keep));
  return { willChange, keep };
}

export function JobCardChangesList({ preview }: { preview: CardPreview }) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showKeep, setShowKeep] = useState(false);
  const { willChange, keep } = preview;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return willChange;
    return willChange.filter((c) =>
      [c.soNo, c.poNo, c.productCode, c.customerName, c.wipLabel, c.workers].some((v) => v.toLowerCase().includes(q)),
    );
  }, [willChange, search]);
  const groups = useMemo(() => {
    const m = new Map<string, CardDetail[]>();
    for (const c of [...visible].sort((a, b) => a.soNo.localeCompare(b.soNo) || a.poNo.localeCompare(b.poNo))) {
      const k = c.soNo || "(no SO)";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [visible]);

  const orders = new Set(willChange.map((c) => c.soNo || c.poNo)).size;
  const totalOld = willChange.reduce((s, c) => s + cardTotal(c, c.oldMinutes), 0);
  const totalNew = willChange.reduce((s, c) => s + cardTotal(c, c.newMinutes ?? c.oldMinutes), 0);
  const toggle = (so: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(so)) next.delete(so);
      else next.add(so);
      return next;
    });
  const minutes = (c: CardDetail) => (
    <span className="tabular-nums whitespace-nowrap">
      <span className="text-[#8A8680] line-through">{c.oldMinutes}</span>
      <span className="mx-1 text-[#8A8680]">to</span>
      <span className="font-semibold text-[#1F1D1B]">{c.newMinutes}</span>
      <span className="text-[#8A8680]"> min</span>
    </span>
  );

  return (
    <div className="space-y-3 text-sm">
      {willChange.length === 0 ? (
        <p className="bg-[#FAF8F5] p-3 rounded text-[#374151]">No job card will change.</p>
      ) : (
        <>
          <p className="bg-[#EEF3E4] p-3 rounded text-[#374151]">
            <span className="font-semibold">{willChange.length}</span> job card
            {willChange.length === 1 ? "" : "s"} on <span className="font-semibold">{orders}</span> sales order
            {orders === 1 ? "" : "s"} will change. Total minutes go from{" "}
            <span className="font-semibold tabular-nums">{totalOld.toLocaleString()}</span> to{" "}
            <span className="font-semibold tabular-nums">{totalNew.toLocaleString()}</span>. Due dates stay the same.
          </p>
          {willChange.length > 5 && (
            <input
              id="job-card-changes-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SO, PO, product, worker…"
              className="h-9 w-full rounded-md border border-[#E2DDD8] px-3"
            />
          )}
          <div className="space-y-2">
            {groups.map(([so, list]) => {
              const open = !collapsed.has(so);
              return (
                <div key={so} className="border border-[#E2DDD8] rounded-md">
                  <button
                    type="button"
                    onClick={() => toggle(so)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-[#FAF8F5] rounded-t-md text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="font-semibold text-[#1F1D1B] shrink-0">{so}</span>
                    <span className="text-xs text-[#8A8680] truncate min-w-0">{list[0].customerName}</span>
                    <span className="ml-auto text-xs text-[#8A8680] shrink-0">
                      {list.length} card{list.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {open && (
                    <>
                      <table className="w-full text-xs max-lg:hidden">
                        <thead className="text-[#6B7280]">
                          <tr className="border-b border-[#E2DDD8]">
                            <th className="text-left font-medium px-2 py-1.5">PO</th>
                            <th className="text-left font-medium px-2 py-1.5">Product</th>
                            <th className="text-left font-medium px-2 py-1.5">Department</th>
                            <th className="text-left font-medium px-2 py-1.5">WIP</th>
                            <th className="text-left font-medium px-2 py-1.5">Status</th>
                            <th className="text-left font-medium px-2 py-1.5">Due date</th>
                            <th className="text-left font-medium px-2 py-1.5">Worker</th>
                            <th className="text-right font-medium px-2 py-1.5">Minutes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((c) => (
                            <tr key={c.jcId} className="border-b border-[#F0ECE9] last:border-0">
                              <td className="px-2 py-1.5 whitespace-nowrap">{c.poNo}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{c.productCode}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{c.deptName}</td>
                              <td className="px-2 py-1.5 max-w-[16rem] truncate" title={c.wipLabel}>
                                {c.wipLabel}
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{STATUS_LABEL[c.status] ?? c.status}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(c.dueDate)}</td>
                              <td className="px-2 py-1.5 max-w-[10rem] truncate" title={c.workers}>
                                {c.workers || "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right">{minutes(c)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="lg:hidden divide-y divide-[#F0ECE9]">
                        {list.map((c) => (
                          <div key={c.jcId} className="p-3 space-y-0.5">
                            <div className="flex flex-wrap justify-between gap-x-2">
                              <span className="font-semibold">{c.poNo}</span>
                              {minutes(c)}
                            </div>
                            <div className="text-[#5A5550] break-words">
                              {c.productCode} · {c.deptName}
                            </div>
                            <div className="text-[#8A8680] break-words">{c.wipLabel}</div>
                            <div className="text-[#8A8680]">
                              {STATUS_LABEL[c.status] ?? c.status} · Due {fmtDate(c.dueDate)}
                              {c.workers ? ` · ${c.workers}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {visible.length === 0 && <p className="text-[#6B7280]">No cards match the search.</p>}
          </div>
        </>
      )}

      {keep.length > 0 && (
        <div className="bg-[#FAEFCB] rounded text-xs text-[#9C6F1E]">
          <button
            type="button"
            onClick={() => setShowKeep((v) => !v)}
            className="w-full flex items-center gap-1 p-3 text-left font-semibold"
          >
            {showKeep ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {keep.length} card{keep.length === 1 ? " keeps its" : "s keep their"} time
          </button>
          {showKeep && (
            <ul className="px-3 pb-3 space-y-1.5 max-h-60 overflow-y-auto">
              {keep.map((k) => (
                <li key={k.jcId} className="break-words">
                  <span className="font-semibold">
                    {k.soNo || "—"} · {k.poNo} · {k.deptName}
                  </span>{" "}
                  ({k.oldMinutes} min): {KEEP_LABEL[k.reason ?? ""] ?? k.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function ConfirmJobCardChanges({
  preview,
  saving,
  error,
  onConfirm,
  onCancel,
}: {
  preview: CardPreview;
  saving: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4 max-sm:p-2"
      onClick={() => !saving && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-card-changes-title"
        className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-white rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b border-[#E2DDD8]">
          <div className="min-w-0">
            <h2 id="job-card-changes-title" className="font-semibold text-[#1F1D1B]">
              Confirm job card changes
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Nothing is saved until you confirm. Cards finished before this month are not touched.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 overflow-y-auto min-h-0 space-y-3">
          {error && <p className="text-sm text-[#9A3A2D] bg-[#F9E1DA] p-3 rounded">{error}</p>}
          <JobCardChangesList preview={preview} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-[#E2DDD8]">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={saving}>
            {saving ? "Saving…" : "Confirm and save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
