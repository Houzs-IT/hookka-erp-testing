// CopySheet — Working Hours → "..." → Copy yesterday / Copy from another date (HK-0125). Step 1: pick the source (and the target when
// no single work date is selected). Step 2: review the copied DRAFTS — untick rows, edit hours and notes — then Save. Nothing is
// written until Save. Rules and calls: working-hours-copy.ts.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { MIN_DATE } from "./employees-dates";
import { dayHeading } from "./employees-format";
import { buildCopyDrafts, copyTarget, fetchDay, saveDraft, toSave, yesterdayOf, type CopyDraft, type CopyResult } from "./working-hours-copy";

const FIELD: CSSProperties = { width: "100%", height: 42, boxSizing: "border-box", padding: "0 12px", border: "1px solid #E6E0D9", borderRadius: 10, background: "#FFFFFF", fontFamily: "inherit", fontSize: 15, color: M.raisin };
const LABEL: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "#6B5C32", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const BTN = (primary: boolean, disabled = false): CSSProperties => ({ flex: "1 1 0", height: 46, border: primary ? "none" : "1px solid #E6E0D9", borderRadius: 12, background: primary ? M.taupe : M.card, color: primary ? "#FFFFFF" : M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 });

/** Read both days and build the drafts (desktop's order of checks). */
async function loadDrafts(targetDate: string, sourceDate: string): Promise<CopyResult> {
  if (!sourceDate) return { ok: false, message: "Pick a source date first" };
  if (sourceDate === targetDate) return { ok: false, message: "Source date can't equal target date" };
  const [src, onTarget] = await Promise.all([fetchDay(sourceDate, (u, i) => fetch(u, i)), fetchDay(targetDate, (u, i) => fetch(u, i))]);
  if (src === null || onTarget === null) return { ok: false, message: "Copy failed" };
  return buildCopyDrafts({ source: src, onTarget, sourceDate, targetDate });
}

type Props = {
  open: boolean;
  mode: "yesterday" | "from";
  /** The selected work date when the list is narrowed to one day, else "". */
  selectedDate: string;
  today: string;
  nameOf: (workerId: string) => string;
  deptName: (code: string) => string;
  onClose: () => void;
};

export default function CopySheet({ open, mode, selectedDate, today, nameOf, deptName, onClose }: Props) {
  const fixedTarget = copyTarget(selectedDate, today);
  const [target, setTarget] = useState(fixedTarget.date);
  const [source, setSource] = useState(yesterdayOf(fixedTarget.date));
  const [drafts, setDrafts] = useState<CopyDraft[] | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(mode === "yesterday" && fixedTarget.fixed);
  const [saving, setSaving] = useState(false);
  const running = useRef(false); // set synchronously: two taps in one tick must not post the rows twice

  // The parent mounts this sheet only while it is open, so the state above starts fresh every time. Copy yesterday with a known target
  // goes straight to the preview (the load runs after an await, so no state is set synchronously in the effect).
  const auto = mode === "yesterday" && fixedTarget.fixed;
  useEffect(() => {
    if (!auto) return;
    let alive = true;
    void (async () => {
      const r = await loadDrafts(fixedTarget.date, yesterdayOf(fixedTarget.date));
      if (!alive) return;
      setLoading(false);
      if (r.ok) setDrafts(r.drafts);
      else setMessage(r.message);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function load(targetDate: string, sourceDate: string) {
    setMessage("");
    setLoading(true);
    const r = await loadDrafts(targetDate, sourceDate);
    setLoading(false);
    if (r.ok) setDrafts(r.drafts);
    else setMessage(r.message);
  }

  const patch = (key: string, p: Partial<CopyDraft>) => setDrafts((prev) => (prev ? prev.map((d) => (d.key === key ? { ...d, ...p } : d)) : prev));

  async function save() {
    if (!drafts || running.current) return; // one run at a time: a double tap must not post twice
    running.current = true;
    setSaving(true);
    for (const d of toSave(drafts)) {
      patch(d.key, { state: "saving", error: undefined });
      const done = await saveDraft(d, target, (u, i) => fetch(u, i) as never);
      setDrafts((prev) => (prev ? prev.map((x) => (x.key === d.key ? done : x)) : prev));
    }
    // New entries (and the attendance row the server may auto-create) exist now: drop the cached lists so the screen shows them.
    invalidateCachePrefix("/api/working-hour-entries");
    invalidateCachePrefix("/api/attendance");
    running.current = false;
    setSaving(false);
  }

  const kept = drafts ? toSave(drafts).length : 0;
  const failed = drafts ? drafts.filter((d) => d.keep && d.state === "failed").length : 0;
  const saved = drafts ? drafts.filter((d) => d.state === "saved").length : 0;
  const finished = !!drafts && !saving && kept === 0 && saved > 0;
  const title = mode === "yesterday" ? "Copy yesterday" : "Copy from another date";

  return (
    <Sheet open={open} onClose={saving ? () => undefined : onClose} title={title}>
      {!drafts ? (
        <div style={{ display: "grid", gap: 12 }}>
          {!fixedTarget.fixed ? (
            <div>
              <div style={LABEL}>Copy to (working date)</div>
              <input type="date" aria-label="Copy to" value={target} min={MIN_DATE} max={today} onChange={(e) => { setTarget(e.target.value); if (mode === "yesterday") setSource(yesterdayOf(e.target.value)); }} style={FIELD} />
            </div>
          ) : (
            <div style={{ fontSize: 13, color: M.ink }}>Copy to <b style={{ color: M.raisin }}>{dayHeading(target)}</b> (the selected date)</div>
          )}
          <div>
            <div style={LABEL}>{mode === "yesterday" ? "Copy from (yesterday)" : "Copy from"}</div>
            <input type="date" aria-label="Copy from" value={source} min={MIN_DATE} max={today} disabled={mode === "yesterday"} onChange={(e) => setSource(e.target.value)} style={{ ...FIELD, opacity: mode === "yesterday" ? 0.7 : 1 }} />
          </div>
          {message ? <div role="alert" style={{ fontSize: 12.5, color: "#9A3A2D" }}>{message}</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={BTN(false)}>Cancel</button>
            <button type="button" onClick={() => void load(target, source)} disabled={loading} style={BTN(true, loading)}>{loading ? "Loading…" : "Preview drafts"}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink }}>
            {drafts.length} draft{drafts.length === 1 ? "" : "s"} from {dayHeading(source)} for <b style={{ color: M.raisin }}>{dayHeading(target)}</b>. Untick a row to leave it out; edit hours or notes before saving. Nothing is saved until you tap Save.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {drafts.map((d) => (
              <div key={d.key} style={{ background: M.card, borderRadius: 12, padding: "10px 12px", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 8px 20px -14px rgba(31,29,27,.22)", opacity: d.keep ? 1 : 0.55 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={d.keep} disabled={saving || d.state === "saved"} onChange={(e) => patch(d.key, { keep: e.target.checked })} aria-label={`Keep ${nameOf(d.workerId)}`} style={{ width: 20, height: 20 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{nameOf(d.workerId)}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink }}>{deptName(d.deptCode)}{d.category ? ` · ${d.category.charAt(0) + d.category.slice(1).toLowerCase()}` : ""}</span>
                  </span>
                  {d.state === "saved" ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#2F6B3E" }}>Saved</span> : null}
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input inputMode="decimal" aria-label={`Hours for ${nameOf(d.workerId)}`} value={d.hours} disabled={saving || d.state === "saved" || !d.keep} onChange={(e) => patch(d.key, { hours: e.target.value, state: d.state === "failed" ? "idle" : d.state })} style={{ ...FIELD, width: 84, height: 38, fontSize: 14 }} />
                  <input aria-label={`Notes for ${nameOf(d.workerId)}`} placeholder="Notes" value={d.notes} disabled={saving || d.state === "saved" || !d.keep} onChange={(e) => patch(d.key, { notes: e.target.value })} style={{ ...FIELD, flex: 1, minWidth: 0, height: 38, fontSize: 14 }} />
                </div>
                {d.state === "failed" && d.error ? <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#9A3A2D" }}>{d.error}</div> : null}
              </div>
            ))}
          </div>
          {saved > 0 || failed > 0 ? <div role="status" style={{ fontSize: 12.5, color: failed ? "#9A3A2D" : "#2F6B3E" }}>{saved} saved{failed ? `, ${failed} failed — fix or untick, then Save again` : ""}.</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={saving} style={BTN(false, saving)}>{finished ? "Done" : "Cancel"}</button>
            {!finished ? <button type="button" onClick={() => void save()} disabled={saving || kept === 0} style={BTN(true, saving || kept === 0)}>{saving ? "Saving…" : kept === 0 ? "Nothing to save" : `Save ${kept} ${kept === 1 ? "entry" : "entries"}`}</button> : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}
