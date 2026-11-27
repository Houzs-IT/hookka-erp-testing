// HK-0036 "Export cut list" (Production → Fab Cut tab).
//
// Export new cards → a batch (Excel downloads at once; Print opens the same
// rows as a PDF print view). Recent exports can be re-opened and re-exported.
// Bedframe batch markers (.plt from ETMark) are uploaded per group of a batch,
// metres read from the "NNMTR" at the end of the file name (editable).
// ERP never sends anything to the cutter: the operator presses Send in xiao.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { exportReportPdf, exportReportXlsx } from "@/lib/export-report";
import { cutGroupLabel, cutListSheet, type CutListPayload } from "@/lib/cut-list-sheet";

type Batch = { id: string; exportedAt: string; cardCount: number; changeCount: number };

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const fileStem = (b: Batch) => `cut-list-${b.exportedAt.slice(0, 16).replace(/[:T]/g, "")}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  return body.data as T;
}

async function downloadExcel(p: CutListPayload) {
  await exportReportXlsx(`${fileStem(p.batch)}.xlsx`, "Cut list", cutListSheet(p).aoa);
}
async function printView(p: CutListPayload) {
  const { aoa, kinds } = cutListSheet(p);
  await exportReportPdf(`${fileStem(p.batch)}.pdf`, "CNC cut list", `Exported ${stamp(p.batch.exportedAt)}`, aoa, {
    print: true,
    formatNumbers: false,
    rowKind: (_r, i) => kinds[i],
    leftCols: [1, 2, 3, 4, 6, 7, 8],
  });
}

export function CutListButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} title="Cut list for the ETMark operator, grouped by colour code">
        Export cut list
      </Button>
      {open && <CutListDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function CutListDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [current, setCurrent] = useState<CutListPayload | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBatches = () =>
    api<Batch[]>("/api/cnc-cut-list/batches").then(setBatches).catch((e) => toast.error(String(e.message ?? e)));
  const openBatch = (id: string) =>
    api<CutListPayload>(`/api/cnc-cut-list/batches/${encodeURIComponent(id)}`).then(setCurrent);
  useEffect(() => {
    void loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportNew = () =>
    run(async () => {
      const data = await api<CutListPayload | null>("/api/cnc-cut-list/export", { method: "POST" });
      if (!data) return toast.success("Nothing new since the last export.");
      setCurrent(data);
      await downloadExcel(data);
      void loadBatches();
    });

  const uploadMarker = (groupKey: string, file: File) =>
    run(async () => {
      if (!current) return;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("groupKey", groupKey);
      await api(`/api/cnc-cut-list/batches/${encodeURIComponent(current.batch.id)}/markers`, { method: "POST", body: fd });
      await openBatch(current.batch.id);
    });
  const saveMetres = (id: string, value: string) =>
    run(() =>
      api(`/api/cnc-cut-list/markers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metres: value.trim() === "" ? null : Number(value) }),
      }).then(() => current && openBatch(current.batch.id)),
    );
  const deleteMarker = (id: string) =>
    run(() =>
      api(`/api/cnc-cut-list/markers/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
        () => current && openBatch(current.batch.id),
      ),
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3" onClick={onClose}>
      <div
        className="max-h-[90vh] w-[720px] max-w-full overflow-y-auto rounded-md border border-[#E6E0D9] bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center">
          <h3 className="text-[14px] font-semibold text-[#3A2E22]">Export cut list</h3>
          <button type="button" className="ml-auto text-[12px] text-[#6B5E50] hover:underline" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mb-3 text-[12px] text-[#6B5E50]">
          Open Fab Cut cards not exported yet, grouped by colour code (bedframe) or model + colour (sofa), earliest due
          first. ERP does not send anything to the cutter.
        </p>
        <Button size="sm" onClick={exportNew} disabled={busy}>
          {busy ? "Working…" : "Export new cards"}
        </Button>

        {current && (
          <div className="mt-4 rounded-md border border-[#E6E0D9] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-[#3A2E22]">
              <span className="font-semibold">Batch {stamp(current.batch.exportedAt)}</span>
              <span>
                {current.batch.cardCount} card{current.batch.cardCount === 1 ? "" : "s"}
              </span>
              <span className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => run(() => downloadExcel(current))}>
                  Download Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => run(() => printView(current))}>
                  Print
                </Button>
              </span>
            </div>
            {current.changed.length > 0 && (
              <div className="mb-2 rounded border border-[#E7C9C4] bg-[#FBEEEC] p-2 text-[12px] text-[#B4453A]">
                <div className="font-semibold">Changed since export, check before cutting</div>
                {current.changed.map((c) => (
                  <div key={c.jobCardId}>
                    {c.poNo} {c.productCode} {c.wipLabel}: {c.note} (exported {c.exportedAt.slice(0, 10)})
                  </div>
                ))}
              </div>
            )}
            {current.groups.map((g) => (
              <div key={g.key} className="border-t border-[#F0ECE7] py-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#3A2E22]">{cutGroupLabel(g)}</span>
                  <span className="text-[#6B5E50]">
                    {g.rows.length} card{g.rows.length === 1 ? "" : "s"}
                  </span>
                  {g.category !== "SOFA" && (
                    <label className="ml-auto cursor-pointer text-[#3E6570] hover:underline">
                      Upload marker (.plt)
                      <input
                        type="file"
                        accept=".plt"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) uploadMarker(g.key, f);
                        }}
                      />
                    </label>
                  )}
                </div>
                {g.category === "SOFA" &&
                  [...new Map(g.rows.map((r) => [r.sizeLabel, r.layout] as const))].map(([size, lay]) => (
                    <div key={size} className="text-[#6B5E50]">
                      {size || "(no size)"}:{" "}
                      {lay ? `layout ${lay.name}${lay.metres != null ? ` - ${lay.metres} m` : ""}` : "no .plt layout in the CNC template library"}
                    </div>
                  ))}
                {current.markers
                  .filter((m) => m.groupKey === g.key)
                  .map((m) => (
                    <div key={m.id} className="mt-1 flex items-center gap-2">
                      <a className="text-[#3E6570] hover:underline" href={`/api/cnc-cut-list/markers/${m.id}/file`}>
                        {m.fileName}
                      </a>
                      <input
                        aria-label={`Metres for ${m.fileName}`}
                        defaultValue={m.metres ?? ""}
                        placeholder="metres"
                        inputMode="decimal"
                        className="w-16 rounded border border-[#E2DDD8] px-1 py-0.5 text-right"
                        onBlur={(e) => {
                          if (e.target.value !== String(m.metres ?? "")) saveMetres(m.id, e.target.value);
                        }}
                      />
                      <span className="text-[#6B5E50]">m</span>
                      <button type="button" className="text-[#B4453A] hover:underline" onClick={() => deleteMarker(m.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-[12px]">
          <div className="mb-1 font-semibold text-[#3A2E22]">Recent exports (re-export)</div>
          {batches.length === 0 ? (
            <div className="text-[#9A918A]">None yet.</div>
          ) : (
            batches.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`block w-full rounded px-2 py-1 text-left hover:bg-[#F3F0EA] ${current?.batch.id === b.id ? "bg-[#F3F0EA]" : ""}`}
                onClick={() => run(() => openBatch(b.id))}
              >
                {stamp(b.exportedAt)} · {b.cardCount} card{b.cardCount === 1 ? "" : "s"}
                {b.changeCount ? ` · ${b.changeCount} changed` : ""}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
