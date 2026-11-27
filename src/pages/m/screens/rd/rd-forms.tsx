// ===========================================================================
// R&D Projects — the prototype's full-page forms: New project, Add / Edit
// prototype, Add hours and Change target date. Each save calls the existing
// endpoint once (double-submit guarded); the server's error text is shown
// as-is. Cancel on a changed form asks "Discard changes?".
// Read-modify-write saves (milestones) re-read the project first.
// ===========================================================================
import { useMemo, useState } from "react";
import { Trash2, Users } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { AreaField, HeadRow, NoteBox, TextField, TplDialog, TplPage, type DialogSpec } from "../threepl/tpl-kit";
import { ChipPick, DateField, InlineState, Seg, Stepper } from "./rd-kit";
import {
  createErrors, createPayload, editPrototypePayload, hrs, invalidateRd, isHours, LIST_URL, listOf, milestoneDatePayload, newPrototypePayload,
  nextVersion, PROTO_LABEL, projectUrl, readFresh, send, labourUrl, stageLabels, TEAM_URL, toMember, versionNum,
  type CreateDraft, type Envelope, type Milestone, type Project, type ProtoDraft, type ProtoType, type Prototype, type Stage,
} from "./rd-lib";
import type { RdToastTone } from "./rd-toast";

export type Frame =
  | { kind: "new" }
  | { kind: "proto"; project: Project; type: ProtoType; proto: Prototype | null }
  | { kind: "hours"; project: Project }
  | { kind: "mile"; project: Project; m: Milestone };

export type FormCtx = {
  toast: (m: string, tone?: RdToastTone) => void;
  pop: () => void;
  onCreated?: (id: string) => void;
  /** After a milestone date save: back to that milestone's sheet. */
  onMileSaved?: (stage: Stage) => void;
};

export function FormStack({ frames, ctx }: { frames: Frame[]; ctx: FormCtx }) {
  return (
    <>
      {frames.map((f, i) => {
        const active = i === frames.length - 1;
        const key = `${i}-${f.kind}`;
        if (f.kind === "new") return <CreateForm key={key} active={active} ctx={ctx} />;
        if (f.kind === "proto") return <PrototypeForm key={key} f={f} active={active} ctx={ctx} />;
        if (f.kind === "hours") return <HoursForm key={key} project={f.project} active={active} ctx={ctx} />;
        return <MilestoneDateForm key={key} project={f.project} m={f.m} active={active} ctx={ctx} />;
      })}
    </>
  );
}

// ---- shared draft state ------------------------------------------------------------------
function useDraft<T extends Record<string, unknown>>(init: T) {
  const [base] = useState(() => JSON.stringify(init));
  const [v, setV] = useState(init);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dlg, setDlg] = useState<DialogSpec | null>(null);
  const dirty = JSON.stringify(v) !== base;
  const set = (o: Partial<T>) => setV((x) => ({ ...x, ...o }));
  const cancel = (pop: () => void) => () => {
    if (busy) return;
    if (dirty) setDlg({ title: "Discard changes?", body: "What you've entered won't be saved.", okL: "Discard", danger: true, icon: Trash2, onOk: pop });
    else pop();
  };
  return { v, set, dirty, tried, setTried, busy, setBusy, err, setErr, dlg, setDlg, cancel };
}
type Draft = ReturnType<typeof useDraft>;

function DiscardDialog({ d }: { d: Pick<Draft, "dlg" | "setDlg"> }) {
  return (
    <TplDialog
      spec={d.dlg}
      onCancel={() => d.setDlg(null)}
      onOk={() => {
        const fn = d.dlg?.onOk;
        d.setDlg(null);
        void fn?.();
      }}
    />
  );
}
const CHECK = "Check the highlighted fields.";

function useTeam(enabled: boolean) {
  const res = useCachedJson<Envelope>(enabled ? TEAM_URL : null);
  const members = useMemo(() => listOf(res.data, toMember).filter((m) => m.active), [res.data]);
  const denied = res.failure?.status === 403 || /forbidden|permission/i.test(res.error ?? "");
  return { res, members, denied };
}

// ---- New project ---------------------------------------------------------------------------
function CreateForm({ active, ctx }: { active: boolean; ctx: FormCtx }) {
  const init: CreateDraft = {
    name: "", projectType: "DEVELOPMENT", productCategory: "", serviceId: "", sourceProductName: "", sourceBrand: "", sourcePurchaseRef: "",
    sourcePrice: "", sourceNotes: "", description: "", targetLaunchDate: "", budget: "", team: [],
  };
  const d = useDraft(init);
  const v = d.v as CreateDraft;
  const team = useTeam(true);
  const E = createErrors(v);
  const e = (k: string) => (d.tried ? E[k] : undefined);
  const save = async () => {
    if (d.busy) return;
    if (Object.keys(E).length) {
      d.setTried(true);
      d.setErr(CHECK);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    const r = await send(LIST_URL, "POST", createPayload(v));
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidateRd();
    ctx.pop();
    const id = typeof r.data?.id === "string" ? r.data.id : "";
    // The new project's workspace shows the toast (on a phone this list unmounts).
    if (id && ctx.onCreated) ctx.onCreated(id);
    else ctx.toast("Project created as a draft");
  };
  return (
    <TplPage title="New project" dirty={d.dirty} err={d.err} active={active} onCancel={d.cancel(ctx.pop)} saveL="Create project" busy={d.busy} onSave={() => void save()}>
      <NoteBox>New projects start as Draft at the Concept stage.</NoteBox>
      <TextField l="Project name *" v={v.name} on={(x) => d.set({ name: x })} ph="e.g. Aria III Bedframe" err={e("name")} maxLength={200} />
      <Seg l="Project type" v={v.projectType} on={(x) => d.set({ projectType: x })} opts={[{ k: "DEVELOPMENT", l: "Research" }, { k: "IMPROVEMENT", l: "Improvement" }, { k: "CLONE", l: "Clone" }]} />
      <Seg l="Category *" v={v.productCategory} on={(x) => d.set({ productCategory: x })} err={e("cat")} opts={[{ k: "SOFA", l: "Sofa" }, { k: "BEDFRAME", l: "Bedframe" }, { k: "ACCESSORY", l: "Accessory" }]} />
      {v.projectType === "IMPROVEMENT" ? <TextField l="Service ID" v={v.serviceId} on={(x) => d.set({ serviceId: x })} ph="e.g. SC-2611-0019" /> : null}
      {v.projectType === "CLONE" ? (
        <>
          <HeadRow>CLONE SOURCE</HeadRow>
          <TextField l="Source product / model" v={v.sourceProductName} on={(x) => d.set({ sourceProductName: x })} ph="Product you're cloning" />
          <TextField l="Source brand / supplier" v={v.sourceBrand} on={(x) => d.set({ sourceBrand: x })} />
          <TextField l="Purchase reference" v={v.sourcePurchaseRef} on={(x) => d.set({ sourcePurchaseRef: x })} ph="e.g. PO number" />
          <TextField l="Purchase price" v={v.sourcePrice} on={(x) => d.set({ sourcePrice: x })} mode="decimal" pre="RM" ph="0.00" err={e("price")} />
          <AreaField l="Source notes" v={v.sourceNotes} on={(x) => d.set({ sourceNotes: x })} ph="Optional" />
        </>
      ) : null}
      <HeadRow>DETAILS</HeadRow>
      <AreaField l="Description" v={v.description} on={(x) => d.set({ description: x })} ph="What is this project for?" />
      <DateField l="Target launch date" v={v.targetLaunchDate} on={(x) => d.set({ targetLaunchDate: x })} clearable help="Optional. Milestone target dates are set later, stage by stage." />
      <TextField l="Budget" v={v.budget} on={(x) => d.set({ budget: x })} mode="decimal" pre="RM" ph="0.00" err={e("budget")} />
      {team.denied ? (
        <InlineState icon={Users} tone="neu" t="You can't see the R&D team list, so no team members can be picked here." />
      ) : team.res.error && !team.res.data ? (
        <InlineState icon={Users} tone="bad" role="alert" t={`Couldn't load the R&D team. ${team.res.error}`} btn="Try again" onTap={() => team.res.refresh()} />
      ) : (
        <ChipPick
          l="Team members"
          empty={team.res.data ? "No active R&D team members. Add them in R&D Maintenance on desktop." : "Loading team…"}
          opts={team.members.map((m) => {
            const on = v.team.includes(m.name);
            return { k: m.id, l: m.name, on, tap: () => d.set({ team: on ? v.team.filter((x) => x !== m.name) : [...v.team, m.name] }) };
          })}
        />
      )}
      <DiscardDialog d={d} />
    </TplPage>
  );
}

// ---- Prototype add / edit ------------------------------------------------------------------
function PrototypeForm({ f, active, ctx }: { f: Extract<Frame, { kind: "proto" }>; active: boolean; ctx: FormCtx }) {
  const x = f.proto;
  const init: ProtoDraft = x
    ? { createdDate: x.createdDate, description: x.description, labourHours: x.labourHours ? String(x.labourHours) : "", improvements: x.improvements, defects: x.defects, testResults: x.testResults, feedback: x.feedback }
    : { createdDate: todayYmdMY(), description: "", labourHours: "", improvements: "", defects: "", testResults: "", feedback: "" };
  const d = useDraft(init);
  const v = d.v as ProtoDraft;
  const version = x ? x.version : nextVersion(f.project, f.type);
  const E: Record<string, string> = {};
  if (!v.description.trim()) E.desc = "Describe this prototype.";
  if (!isHours(v.labourHours)) E.hours = "Enter hours like 4.5.";
  const e = (k: string) => (d.tried ? E[k] : undefined);
  const save = async () => {
    if (d.busy) return;
    if (Object.keys(E).length) {
      d.setTried(true);
      d.setErr(CHECK);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    let body;
    let label = version;
    if (x) body = editPrototypePayload(x, v);
    else {
      // Fresh read so a prototype added meanwhile (desktop) does not get the same version.
      const fresh = await readFresh(f.project.id);
      if (!fresh.ok) {
        d.setBusy(false);
        d.setErr(fresh.error);
        return;
      }
      body = newPrototypePayload(fresh.p, f.type, v, Date.now(), todayYmdMY());
      label = body.prototypes[0].version;
    }
    const r = await send(projectUrl(f.project.id), "PUT", body);
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidateRd();
    ctx.toast(x ? "Prototype updated" : `Prototype ${label} added`);
    ctx.pop();
  };
  return (
    <TplPage
      title={`${x ? "Edit" : "Add"} ${PROTO_LABEL[f.type]} prototype`}
      sub={`${f.project.code} · ${version}`}
      dirty={d.dirty}
      err={d.err}
      active={active}
      onCancel={d.cancel(ctx.pop)}
      saveL={x ? "Save changes" : "Add prototype"}
      busy={d.busy}
      onSave={() => void save()}
    >
      <NoteBox>{x ? `This is version ${version}. The version number stays as it is.` : `This is version ${version}. Versions are numbered automatically.`}</NoteBox>
      <DateField l="Date" v={v.createdDate} on={(y) => d.set({ createdDate: y })} />
      <div>
        <AreaField l="Description *" v={v.description} on={(y) => d.set({ description: y })} ph="What was built?" />
        {e("desc") ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: "var(--xo-bad)" }}>{e("desc")}</span> : null}
      </div>
      <TextField l="Labour hours" v={v.labourHours} on={(y) => d.set({ labourHours: y })} mode="decimal" ph="0.0" suf="h" err={e("hours")} />
      {versionNum(version) > 1 ? <AreaField l="Improvements" v={v.improvements} on={(y) => d.set({ improvements: y })} ph="What changed from the last version?" /> : null}
      <AreaField l="Defects" v={v.defects} on={(y) => d.set({ defects: y })} ph="Optional" />
      <AreaField l="Test results" v={v.testResults} on={(y) => d.set({ testResults: y })} ph="Optional" />
      <AreaField l="Feedback" v={v.feedback} on={(y) => d.set({ feedback: y })} ph="Optional" />
      <DiscardDialog d={d} />
    </TplPage>
  );
}

// ---- Add hours -------------------------------------------------------------------------------
function HoursForm({ project, active, ctx }: { project: Project; active: boolean; ctx: FormCtx }) {
  const team = useTeam(true);
  const d = useDraft({ by: "", date: todayYmdMY(), h: 1, notes: "" });
  const v = d.v as { by: string; date: string; h: number; notes: string };
  const by = v.by || (team.members.length === 1 ? team.members[0].id : "");
  const member = team.members.find((m) => m.id === by);
  const E: Record<string, string> = {};
  if (!by) E.by = "Pick a team member.";
  if (!v.date) E.date = "Pick a date.";
  const e = (k: string) => (d.tried ? E[k] : undefined);
  const noTeam = !!team.res.data && !team.members.length;
  const blocked = team.denied || noTeam || !team.res.data;
  const save = async () => {
    if (d.busy || blocked) return;
    if (Object.keys(E).length) {
      d.setTried(true);
      d.setErr(CHECK);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    const r = await send(labourUrl(project.id), "POST", { teamMemberId: by, workDate: v.date, hours: v.h, notes: v.notes.trim() || null });
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidateRd();
    ctx.toast(`${hrs(v.h)} logged`);
    ctx.pop();
  };
  return (
    <TplPage title="Add hours" sub={project.code} dirty={d.dirty} err={d.err} active={active} onCancel={d.cancel(ctx.pop)} saveL="Save hours" busy={d.busy} disabled={blocked} onSave={() => void save()}>
      {team.denied ? (
        <InlineState icon={Users} tone="neu" h="No access to the R&D team" t="Your role can't see the R&D team list, so hours can't be logged here." />
      ) : team.res.error && !team.res.data ? (
        <InlineState icon={Users} tone="bad" role="alert" t={`Couldn't load the R&D team. ${team.res.error}`} btn="Try again" onTap={() => team.res.refresh()} />
      ) : !team.res.data ? (
        <InlineState t="Loading team…" />
      ) : noTeam ? (
        <InlineState icon={Users} tone="neu" h="No active team members" t="No active R&D team members. Add them in R&D Maintenance on desktop." />
      ) : (
        <>
          <ChipPick
            l="Team member"
            err={e("by")}
            opts={team.members.map((m) => ({ k: m.id, l: `${m.name} · ${m.employmentType === "PART_TIME" ? "Part-time" : "Full-time"}`, on: by === m.id, tap: () => d.set({ by: m.id }) }))}
          />
          <DateField l="Date" v={v.date} on={(x) => d.set({ date: x })} err={e("date")} />
          <Stepper
            l="Hours"
            v={hrs(v.h)}
            decDisabled={v.h <= 0.5}
            onDec={() => d.set({ h: Math.max(0.5, Math.round((v.h - 0.5) * 2) / 2) })}
            onInc={() => d.set({ h: Math.round((v.h + 0.5) * 2) / 2 })}
            help={member?.employmentType === "PART_TIME" ? "Part-time hours use the fixed part-time cost." : "Steps of 0.5 h. Labour cost is calculated automatically."}
          />
          <AreaField l="Notes" v={v.notes} on={(x) => d.set({ notes: x })} ph="Optional" />
        </>
      )}
      <DiscardDialog d={d} />
    </TplPage>
  );
}

// ---- Change target date ----------------------------------------------------------------------
function MilestoneDateForm({ project, m, active, ctx }: { project: Project; m: Milestone; active: boolean; ctx: FormCtx }) {
  const d = useDraft({ date: m.targetDate });
  const v = d.v as { date: string };
  const label = stageLabels(project.projectType)[m.stage];
  const save = async () => {
    if (d.busy) return;
    if (!d.dirty) {
      ctx.pop();
      ctx.onMileSaved?.(m.stage);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    // Whole milestones array: rebuilt from a fresh read so a concurrent change is not overwritten.
    const fresh = await readFresh(project.id);
    if (!fresh.ok) {
      d.setBusy(false);
      d.setErr(fresh.error);
      return;
    }
    const r = await send(projectUrl(project.id), "PUT", milestoneDatePayload(fresh.p, m.stage, v.date));
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidateRd();
    ctx.toast(v.date ? "Target date updated" : "Target date cleared");
    ctx.pop();
    ctx.onMileSaved?.(m.stage);
  };
  return (
    <TplPage title="Change target date" sub={`${project.code} · ${label}`} dirty={d.dirty} err={d.err} active={active} onCancel={d.cancel(ctx.pop)} saveL="Save date" busy={d.busy} onSave={() => void save()}>
      <DateField l="Target date" v={v.date} on={(x) => d.set({ date: x })} clearable help="Leave it blank to clear the target date. A blank date shows no schedule chip." />
      <DiscardDialog d={d} />
    </TplPage>
  );
}
