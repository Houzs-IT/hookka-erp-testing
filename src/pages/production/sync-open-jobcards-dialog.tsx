// "Sync open job cards" preview for the WIP Production Times page. Lists every
// unfinished job card whose minutes differ from the current BOM, lets the user
// untick cards, then applies. The server recomputes on apply; finished cards
// and due dates are never changed.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, ChevronDown, ChevronRight, Download, X } from "lucide-react";
import { humanizeError } from "@/lib/humanize-error";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { formatDate } from "@/lib/utils";

const SYNC_URL = "/api/production/sync-jobcards-from-bom/refresh-open-minutes";

type Change = {
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
  newMinutes: number;
};
type Skip = Omit<Change, "newMinutes"> & { reason: string };
type Preview = { scanned: number; unchanged: number; changes: Change[]; skipped: Skip[] };
type ApplyResult = { updated: number; leftAlone: number };

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Waiting",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
};
const SKIP_LABEL: Record<string, string> = {
  sofaFabCutMerge: "Sofa fabric cutting is shared by several lines of the order, so it can't be recalculated from one product.",
  specialOrder: "Headboard-only or partial repair line: its fabric cutting total can't be recalculated safely.",
  noMatch: "This card's step is no longer in the product's BOM.",
  duplicateDept: "Old card that overlaps another card in the same department.",
  bomZero: "The BOM time for this step is blank (0), so the card keeps its minutes.",
};

// Fabric cutting cards already hold the total for the whole set.
const cardTotal = (c: Change, m: number) => (c.deptCode === "FAB_CUT" ? m : m * Math.max(1, c.wipQty));
const fmtDate = (d: string) => (d ? formatDate(d) : "—");

export function SyncOpenJobCardsDialog({
  scope,
  scopeLabel,
  onClose,
}: {
  scope: { deptCode: string; productCodes: string[] }[];
  scopeLabel: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(SYNC_URL, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true, scope }),
        });
        const json = (await res.json()) as { success: boolean; error?: string } & Preview;
        if (!alive) return;
        if (!res.ok || !json.success) {
          setError(humanizeError({ status: res.status, message: json.error }, "Couldn't load the preview. Please try again."));
          return;
        }
        setPreview(json);
        setTicked(new Set(json.changes.map((c) => c.jcId)));
      } catch (err) {
        if (alive) setError(humanizeError(err, "Couldn't load the preview. Please try again."));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [scope]);

  const changes = useMemo(() => preview?.changes ?? [], [preview]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return changes.filter(
      (c) =>
        (!deptFilter || c.deptCode === deptFilter) &&
        (!statusFilter || c.status === statusFilter) &&
        (!q || [c.soNo, c.poNo, c.productCode, c.customerName, c.wipLabel].some((v) => v.toLowerCase().includes(q))),
    );
  }, [changes, deptFilter, statusFilter, search]);
  const groups = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of [...visible].sort((a, b) => a.soNo.localeCompare(b.soNo) || a.poNo.localeCompare(b.poNo))) {
      const k = c.soNo || "(no SO)";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [visible]);
  const deptOptions = useMemo(
    () => [...new Map(changes.map((c) => [c.deptCode, c.deptName])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [changes],
  );

  const selected = changes.filter((c) => ticked.has(c.jcId));
  const orders = new Set(selected.map((c) => c.poNo)).size;
  const totalOld = selected.reduce((s, c) => s + cardTotal(c, c.oldMinutes), 0);
  const totalNew = selected.reduce((s, c) => s + cardTotal(c, c.newMinutes), 0);

  const setMany = (ids: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const toggleGroup = (so: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(so)) next.delete(so);
      else next.add(so);
      return next;
    });
  const allVisibleTicked = visible.length > 0 && visible.every((c) => ticked.has(c.jcId));

  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(
      visible.map((c) => ({
        Update: ticked.has(c.jcId) ? "Yes" : "No",
        SO: c.soNo,
        PO: c.poNo,
        Customer: c.customerName,
        Product: c.productCode,
        Department: c.deptName,
        WIP: c.wipLabel,
        Qty: c.wipQty,
        Status: STATUS_LABEL[c.status] ?? c.status,
        "Due date": c.dueDate,
        Worker: c.workers,
        "Old minutes": c.oldMinutes,
        "New minutes": c.newMinutes,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Job cards");
    XLSX.writeFile(wb, "job-card-time-changes.xlsx");
  };

  const handleApply = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(SYNC_URL, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, jcIds: selected.map((c) => c.jcId) }),
      });
      const json = (await res.json()) as { success: boolean; error?: string } & ApplyResult;
      if (!res.ok || !json.success) {
        setError(humanizeError({ status: res.status, message: json.error }, "Update failed. Nothing was changed."));
        return;
      }
      setResult(json);
      invalidateCachePrefix("/api/production");
      invalidateCachePrefix("/api/job-cards");
    } catch (err) {
      setError(humanizeError(err, "Update failed. Please refresh to check what changed."));
    } finally {
      setBusy(false);
    }
  };

  const minutesCell = (c: Change) => (
    <span className="tabular-nums whitespace-nowrap">
      <span className="text-[#8A8680] line-through">{c.oldMinutes}</span>
      <span className="mx-1 text-[#8A8680]">to</span>
      <span className="font-semibold text-[#1F1D1B]">{c.newMinutes}</span>
      <span className="text-[#8A8680]"> min</span>
    </span>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 max-sm:p-2" onClick={onClose}>
      <div
        className="w-full max-w-6xl max-h-[92vh] flex flex-col bg-white rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b border-[#E2DDD8]">
          <div className="min-w-0">
            <h2 className="font-semibold text-[#1F1D1B]">
              {result ? "Job cards updated" : "Sync open job cards to BOM times"}
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {scopeLabel}. Only unfinished cards change. Finished cards and due dates stay as they are.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-3 text-sm overflow-y-auto min-h-0">
          {error && <p className="text-[#9A3A2D] bg-[#F9E1DA] p-3 rounded">{error}</p>}
          {busy && !preview && <p className="text-[#6B7280]">Checking job cards…</p>}

          {result && (
            <div className="space-y-2">
              <p className="text-[#4F7C3A] bg-[#EEF3E4] p-3 rounded flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                Updated {result.updated} job card{result.updated === 1 ? "" : "s"}.
              </p>
              {result.leftAlone > 0 && (
                <p className="bg-[#FAEFCB] p-3 rounded text-xs text-[#9C6F1E]">
                  {result.leftAlone} card{result.leftAlone === 1 ? " was" : "s were"} left alone because{" "}
                  {result.leftAlone === 1 ? "it was" : "they were"} finished or changed after the preview.
                </p>
              )}
            </div>
          )}

          {preview && !result && (
            <>
              {changes.length === 0 ? (
                <p className="bg-[#FAF8F5] p-3 rounded text-[#374151]">
                  Every unfinished job card in this selection already matches the BOM. Nothing to update.
                </p>
              ) : (
                <>
                  <p className="bg-[#EEF3E4] p-3 rounded text-[#374151]">
                    <span className="font-semibold">{selected.length}</span> job card{selected.length === 1 ? "" : "s"} on{" "}
                    <span className="font-semibold">{orders}</span> order{orders === 1 ? "" : "s"} will change. Total minutes
                    go from <span className="font-semibold tabular-nums">{totalOld.toLocaleString()}</span> to{" "}
                    <span className="font-semibold tabular-nums">{totalNew.toLocaleString()}</span>.
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search SO, PO, product…"
                      className="h-9 flex-1 min-w-[10rem] rounded-md border border-[#E2DDD8] px-3"
                    />
                    <select
                      value={deptFilter}
                      onChange={(e) => setDeptFilter(e.target.value)}
                      className="h-9 rounded-md border border-[#E2DDD8] px-2 bg-white max-sm:flex-1"
                    >
                      <option value="">All departments</option>
                      {deptOptions.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="h-9 rounded-md border border-[#E2DDD8] px-2 bg-white max-sm:flex-1"
                    >
                      <option value="">All statuses</option>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={visible.length === 0}>
                      <Download className="h-4 w-4 mr-1.5" />
                      Export Excel
                    </Button>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-[#5A5550]">
                    <input
                      type="checkbox"
                      checked={allVisibleTicked}
                      onChange={(e) => setMany(visible.map((c) => c.jcId), e.target.checked)}
                    />
                    Tick all shown ({visible.length})
                  </label>

                  <div className="space-y-2">
                    {groups.map(([so, list]) => {
                      const open = !collapsed.has(so);
                      const groupTicked = list.every((c) => ticked.has(c.jcId));
                      return (
                        <div key={so} className="border border-[#E2DDD8] rounded-md">
                          <div className="flex items-center gap-2 px-3 py-2 bg-[#FAF8F5] rounded-t-md">
                            <input
                              type="checkbox"
                              checked={groupTicked}
                              onChange={(e) => setMany(list.map((c) => c.jcId), e.target.checked)}
                              aria-label={`Tick all cards of ${so}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggleGroup(so)}
                              className="flex items-center gap-1 shrink-0 text-left font-semibold text-[#1F1D1B]"
                            >
                              {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                              <span>{so}</span>
                            </button>
                            <span className="text-xs text-[#8A8680] truncate min-w-0">{list[0].customerName}</span>
                            <span className="ml-auto text-xs text-[#8A8680] shrink-0">
                              {list.length} card{list.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          {open && (
                            <>
                              <table className="w-full text-xs max-lg:hidden">
                                <thead className="text-[#6B7280]">
                                  <tr className="border-b border-[#E2DDD8]">
                                    <th className="w-8" />
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
                                      <td className="px-2 py-1.5 text-center">
                                        <input
                                          type="checkbox"
                                          checked={ticked.has(c.jcId)}
                                          onChange={(e) => setMany([c.jcId], e.target.checked)}
                                          aria-label={`Update ${c.poNo} ${c.deptName}`}
                                        />
                                      </td>
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
                                      <td className="px-2 py-1.5 text-right">{minutesCell(c)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="lg:hidden divide-y divide-[#F0ECE9]">
                                {list.map((c) => (
                                  <label key={c.jcId} className="flex gap-3 p-3">
                                    <input
                                      type="checkbox"
                                      className="mt-1 shrink-0"
                                      checked={ticked.has(c.jcId)}
                                      onChange={(e) => setMany([c.jcId], e.target.checked)}
                                    />
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                      <div className="flex flex-wrap justify-between gap-x-2">
                                        <span className="font-semibold">{c.poNo}</span>
                                        {minutesCell(c)}
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
                                  </label>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {visible.length === 0 && <p className="text-[#6B7280]">No cards match the filters.</p>}
                  </div>
                </>
              )}

              {preview.skipped.length > 0 && (
                <div className="bg-[#FAEFCB] rounded text-xs text-[#9C6F1E]">
                  <button
                    type="button"
                    onClick={() => setShowSkipped((v) => !v)}
                    className="w-full flex items-center gap-1 p-3 text-left font-semibold"
                  >
                    {showSkipped ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {preview.skipped.length} card{preview.skipped.length === 1 ? "" : "s"} can't be updated
                    automatically
                  </button>
                  {showSkipped && (
                    <ul className="px-3 pb-3 space-y-1.5 max-h-60 overflow-y-auto">
                      {preview.skipped.map((s) => (
                        <li key={s.jcId} className="break-words">
                          <span className="font-semibold">
                            {s.soNo} · {s.poNo} · {s.deptName}
                          </span>{" "}
                          ({s.oldMinutes} min): {SKIP_LABEL[s.reason] ?? s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-[#E2DDD8]">
          {preview && !result && changes.length > 0 ? (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleApply} disabled={busy || selected.length === 0}>
                {busy ? "Updating…" : `Update ${selected.length} job card${selected.length === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
