// ---------------------------------------------------------------------------
// doc-import-dialog — the ONE import screen for every document (HK-0002).
// Grew out of the invoice "Import prices" modal; same three states, and the
// middle one is still the point:
//
//   pick a file  →  SEE THE PLAN  →  apply
//
// There is no path from the file picker to a write. The plan comes from the
// SERVER (POST /api/doc-import/:docType, a dry run that exercises the real
// apply inside a rolled-back transaction) — nothing about what will change is
// decided here. Apply sends the same sheet with ?execute=1: all-or-nothing.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { X, Upload, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type Change = { key: string; header: string; kind: string; from: string | number | null; to: string | number };
type DocResult = {
  docNo: string | null;
  action: "create" | "update";
  rows: number[];
  headerChanges: Change[];
  lines: Array<{ row: number; lineId: string | null; action: "create" | "update"; changes: Change[] }>;
  result?: { id: string; docNo: string };
};
type Issue = { row: number; docNo?: string; message: string };
type Result = {
  success: boolean;
  mode: "dry-run" | "executed";
  docs: DocResult[];
  errors: Issue[];
  warnings: Issue[];
  error?: string;
};

const fmt = (v: string | number | null, kind: string) =>
  v === null || v === undefined ? "—" : kind === "money" ? (Number(v) / 100).toFixed(2) : String(v);

export function DocImportDialog({
  open,
  onClose,
  onApplied,
  docType,
  title,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  /** URL key of the adapter: "si", "di", … (src/api/routes/doc-import.ts). */
  docType: string;
  title: string;
  /** One line on what this import can do for this document. */
  hint?: string;
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [plan, setPlan] = useState<Result | null>(null);
  const [applied, setApplied] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const post = async (aoa: unknown[][], execute: boolean): Promise<Result> => {
    const res = await fetch(`/api/doc-import/${encodeURIComponent(docType)}${execute ? "?execute=1" : ""}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: aoa }),
    });
    const j = (await res.json().catch(() => ({}))) as Result;
    if (!j.docs) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  };

  const pickFile = async (file: File) => {
    setFileName(file.name);
    setRows(null);
    setPlan(null);
    setApplied(null);
    setError("");
    setBusy(true);
    try {
      // Dynamic-imported: xlsx is large and only importers should pay for it.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      // `defval: ""` keeps empty cells in place — blank must stay blank all the
      // way to the planner, where it means "keep the stored value".
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true }) as unknown[][];
      setRows(aoa);
      setPlan(await post(aoa, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    setError("");
    try {
      const r = await post(rows, true);
      if (!r.success) setPlan(r);
      else {
        setApplied(r);
        onApplied();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const creates = plan?.docs.filter((d) => d.action === "create").length ?? 0;
  const changed =
    plan?.docs.filter(
      (d) => d.action === "update" && (d.headerChanges.length || d.lines.some((l) => l.changes.length || l.action === "create")),
    ).length ?? 0;
  const diffRows =
    plan?.docs.flatMap((d) => [
      ...d.headerChanges.map((ch) => ({ doc: d.docNo ?? "(new)", row: d.rows[0], line: "header", ch })),
      ...d.lines.flatMap((l) => l.changes.map((ch) => ({ doc: d.docNo ?? "(new)", row: l.row, line: l.lineId ?? "new", ch }))),
    ]) ?? [];
  const canApply = !!plan && plan.success && plan.errors.length === 0 && creates + changed > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E2DDD8] px-5 py-3">
          <h2 className="text-base font-semibold text-[#1F1D1B]">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-[#6B7280] hover:bg-[#F0ECE9]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!applied && (
            <div className="mb-4">
              <label className="flex cursor-pointer items-center gap-3 rounded border border-dashed border-[#C9C2BB] px-4 py-3 hover:bg-[#FAF8F6]">
                <Upload className="h-4 w-4 text-[#6B7280]" />
                <span className="text-sm text-[#4B5563]">{fileName || "Choose the edited Detail Listing (.xlsx or .csv)"}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pickFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="mt-2 text-[11px] leading-relaxed text-[#9CA3AF]">
                Start from the Detail Listing export. Existing Doc No. = edit (lines match on Line ID); blank or
                NEW-1, NEW-2… = create. A <strong>blank cell keeps</strong> the stored value; a typed value — even 0 —
                replaces it. {hint}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 flex gap-2 rounded border border-[#E7C3BC] bg-[#FBF0EE] px-3 py-2 text-sm text-[#9B3221]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {busy && <p className="text-sm text-[#6B7280]">Working…</p>}

          {applied && (
            <div className="rounded border border-[#BFE0CD] bg-[#EFF7F2] px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#1F6B4F]">
                <Check className="h-4 w-4" /> Imported
              </p>
              <ul className="mt-2 text-sm text-[#4B5563]">
                {applied.docs
                  .filter((d) => d.result)
                  .map((d) => (
                    <li key={d.result!.id} className="font-mono">
                      {d.action === "create" ? "created" : "updated"} {d.result!.docNo}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {plan && !applied && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded border border-[#E2DDD8] bg-[#E2DDD8]">
                {[
                  ["Create", creates, "text-[#1F6B4F]"],
                  ["Edit", changed, "text-[#1F6B4F]"],
                  ["Errors", plan.errors.length, plan.errors.length ? "text-[#9B3221]" : "text-[#6B7280]"],
                ].map(([label, value, tone]) => (
                  <div key={String(label)} className="bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</p>
                    <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>

              {plan.errors.length > 0 && (
                <IssueTable
                  tone="error"
                  title={`${plan.errors.length} problem(s) — nothing will be imported until they are fixed`}
                  issues={plan.errors}
                />
              )}
              {plan.warnings.length > 0 && <IssueTable tone="warn" title="Warnings (import still allowed)" issues={plan.warnings} />}

              {creates > 0 && (
                <p className="mb-2 text-sm text-[#1F1D1B]">
                  New:{" "}
                  {plan.docs
                    .filter((d) => d.action === "create")
                    .map((d) => `${d.docNo ?? "(number assigned on save)"} — ${d.lines.length} line(s)`)
                    .join("; ")}
                </p>
              )}
              {diffRows.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded border border-[#E2DDD8]">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-[#F5F3F1]">
                      <tr className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                        <th className="px-2 py-1.5 text-left">Row</th>
                        <th className="px-2 py-1.5 text-left">Doc</th>
                        <th className="px-2 py-1.5 text-left">Line</th>
                        <th className="px-2 py-1.5 text-left">Field</th>
                        <th className="px-2 py-1.5 text-right">Now</th>
                        <th className="px-2 py-1.5 text-right">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows.map((r, i) => (
                        <tr key={i} className="border-b border-[#F0ECE9] last:border-0">
                          <td className="px-2 py-1.5 font-mono text-[#6B7280]">{r.row}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[#4B5563]">{r.doc}</td>
                          <td className="px-2 py-1.5 font-mono text-[#9CA3AF]">{r.line}</td>
                          <td className="px-2 py-1.5 text-[#4B5563]">{r.ch.header}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{fmt(r.ch.from, r.ch.kind)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[#1F6B4F]">{fmt(r.ch.to, r.ch.kind)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.errors.length === 0 && creates + changed === 0 && (
                <p className="text-sm text-[#6B7280]">The file matches what is stored — nothing to import.</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#E2DDD8] px-5 py-3">
          <p className="text-[11px] text-[#9CA3AF]">
            {applied ? "Done." : "Nothing is written until you press Apply — and then all of it or none."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {applied ? "Close" : "Cancel"}
            </Button>
            {!applied && (
              <Button onClick={() => void apply()} disabled={!canApply}>
                Apply
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueTable({ tone, title, issues }: { tone: "error" | "warn"; title: string; issues: Issue[] }) {
  const color = tone === "error" ? "text-[#9B3221]" : "text-[#8A6D1F]";
  return (
    <div className="mb-4">
      <p className={`mb-1 text-sm font-semibold ${color}`}>{title}</p>
      <div className="max-h-48 overflow-y-auto rounded border border-[#E2DDD8]">
        <table className="w-full text-[12px]">
          <tbody>
            {issues.map((r, i) => (
              <tr key={i} className="border-b border-[#F0ECE9] last:border-0">
                <td className={`whitespace-nowrap px-2 py-1.5 font-mono ${color}`}>row {r.row}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[#6B7280]">{r.docNo ?? ""}</td>
                <td className="px-2 py-1.5 text-[#4B5563]">{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
