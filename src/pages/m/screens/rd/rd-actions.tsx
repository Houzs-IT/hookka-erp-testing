// ===========================================================================
// R&D Projects — lifecycle actions with their confirm dialogs, shared by the
// list (Start Project on a draft card) and the workspace (action dock + More).
//
//   start / hold / resume / move-to-draft / complete / reopen
//       POST /api/rd-projects/:id/<action>  (rd-projects:update); the server
//       checks the source status and its error text is shown verbatim.
//   advance
//       PUT /api/rd-projects/:id {currentStage, milestones} — the server PUT
//       accepts ANY stage, so the client re-reads the project, refuses unless
//       it is ACTIVE below Production Ready and still at the stage the user saw,
//       stamps only the current stage's milestone (desktop rule) and confirms
//       the write with verifiedSave's read-back (desktop detail.tsx).
// ===========================================================================
import { useState, type ReactNode } from "react";
import { ArrowRight, CircleCheck, FilePen, Pause, Play, RotateCcw, type LucideIcon } from "lucide-react";
import { formatMismatchError, verifiedSave } from "@/lib/verified-save";
import { todayYmdMY } from "@/lib/utils";
import { TplDialog, type DialogSpec } from "../threepl/tpl-kit";
import {
  advancePayload, errorFromBody, invalidateRd, lifecycleCopy, lifecycleUrl, NETWORK_ERROR, projectUrl, readFresh, send, stageLabels,
  STATUS_LABEL, type Lifecycle, type Project, type RawRow,
} from "./rd-lib";
import type { RdToastTone } from "./rd-toast";

export const LIFECYCLE_ICON: Record<Lifecycle, LucideIcon> = {
  start: Play, advance: ArrowRight, complete: CircleCheck, hold: Pause, resume: Play, "move-to-draft": FilePen, reopen: RotateCcw,
};

type DlgState = { spec: DialogSpec; busy: boolean; err: string };

async function runAdvance(p: Project): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const fresh = await readFresh(p.id);
  if (!fresh.ok) return { ok: false, error: fresh.error };
  const f = fresh.p;
  const L = stageLabels(f.projectType);
  if (f.status !== "ACTIVE" || f.currentStage === "PRODUCTION_READY") {
    invalidateRd();
    return { ok: false, error: `This project is ${STATUS_LABEL[f.status]} at ${L[f.currentStage]} now, so it can't advance from here. The screen has been refreshed.` };
  }
  if (f.currentStage !== p.currentStage) {
    invalidateRd();
    return { ok: false, error: `This project moved to ${L[f.currentStage]} since you opened it. Nothing was changed — the screen has been refreshed.` };
  }
  const body = advancePayload(f, todayYmdMY());
  if (!body) return { ok: false, error: "This project can't advance from here." };
  const result = await verifiedSave<RawRow>({
    endpoint: projectUrl(p.id),
    method: "PUT",
    body,
    readback: async () => {
      const r = await fetch(`${projectUrl(p.id)}?_v=${Date.now()}`, { credentials: "include", cache: "no-store" });
      if (!r.ok) return null;
      const j = (await r.json()) as { data?: RawRow };
      return j?.data ?? null;
    },
    expect: { currentStage: body.currentStage },
  });
  if (result.ok) return { ok: true, label: L[body.currentStage] };
  if (result.reason === "mismatch") return { ok: false, error: formatMismatchError(result.diffs) };
  if (result.reason === "http") return { ok: false, error: errorFromBody(result.status, result.body) };
  if (result.reason === "unverified") return { ok: true, label: L[body.currentStage] };
  return { ok: false, error: NETWORK_ERROR };
}

export function useRdLifecycle(toast: (m: string, tone?: RdToastTone) => void): { ask: (p: Project, k: Lifecycle) => void; node: ReactNode } {
  const [dlg, setDlg] = useState<DlgState | null>(null);
  const ask = (p: Project, k: Lifecycle) => {
    const c = lifecycleCopy(p, k);
    setDlg({
      busy: false,
      err: "",
      spec: {
        title: c.title,
        body: c.body,
        okL: c.okL,
        danger: c.danger,
        icon: LIFECYCLE_ICON[k],
        onOk: async () => {
          setDlg((d) => (d ? { ...d, busy: true, err: "" } : d));
          let r: { ok: true; label?: string } | { ok: false; error: string };
          if (k === "advance") r = await runAdvance(p);
          else {
            const s = await send(lifecycleUrl(p.id, k), "POST");
            r = s.ok ? { ok: true } : { ok: false, error: s.error };
          }
          if (!r.ok) {
            const error = r.error;
            setDlg((d) => (d ? { ...d, busy: false, err: error, spec: { ...d.spec, okL: "Try again" } } : d));
            return;
          }
          setDlg(null);
          invalidateRd();
          toast(k === "advance" && r.label ? `Moved to ${r.label}` : c.done);
        },
      },
    });
  };
  const node = (
    <TplDialog
      spec={dlg ? { ...dlg.spec, okL: dlg.busy ? "Saving…" : dlg.spec.okL } : null}
      busy={dlg?.busy}
      err={dlg?.err}
      onCancel={() => setDlg(null)}
      onOk={() => void dlg?.spec.onOk()}
    />
  );
  return { ask, node };
}
