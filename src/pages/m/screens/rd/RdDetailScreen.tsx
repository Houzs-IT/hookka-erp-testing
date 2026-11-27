// ===========================================================================
// RdDetailScreen — /m/rd/:id, the R&D project workspace (Final Batch 5,
// Claude Design "R&D Projects"). Full screen on phones; the right pane of the
// split view on tablets (no back arrow there).
//
//   project     GET /api/rd-projects/:id            (labourCost summary lives here only)
//   issuances   GET /api/rd-projects/:id/issuances  (read-only on mobile: no Issue / Remove)
//   labour      GET + POST /api/rd-projects/:id/labour-hours (no delete on mobile)
//   files       GET /api/files?resourceType=RD_PROJECT · POST /api/files (files:create)
//   history     GET /api/audit-events?resource=rd-projects (rd-projects:read)
//   lifecycle   dock + More: rd-actions.tsx
//   milestones  target date + add photo: PUT {milestones} built from a fresh read
//   prototypes  add / edit: PUT {prototypes:[one row]} (upsert by id)
// No Edit sheet, no status dropdown, no cover upload, no pricing targets /
// margin (owner decisions). Every action is hidden unless the role holds the
// API's own permission.
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  CalendarClock, Camera, Check, CircleDot, CloudOff, Ellipsis, FileText, FlaskConical, FolderOpen, History, ImageOff, ImagePlus, Lock, Package,
  Plus, Timer, Upload,
} from "lucide-react";
import { compressImage } from "@/lib/image-compress";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { MobileHeader } from "../../components";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";
import { useContainerLayout, useResponsiveLayout } from "../../lib/responsive-layout";
import { DashedButton, Spinner, StateCard, TplSheet, TplStyles, type SheetRow } from "../threepl/tpl-kit";
import { ROUND_BTN } from "../threepl/tpl-style";
import { LIFECYCLE_ICON, useRdLifecycle } from "./rd-actions";
import { FormStack, type Frame } from "./rd-forms";
import { Badge, Bar, DocCard, InlineState, Label, Note, PhotoViewer, RdSheet, Rows, Skeleton, Tiles, type RowSpec } from "./rd-kit";
import {
  auditChip, auditLines, barTone, CATEGORY_LABEL, costBreakdown, dockAction, fileDownloadUrl, FILE_RESOURCE, fileSize, filesUrl, fmtDate,
  fmtDateTime, historyUrl, hrs, invalidateRd, issuancesUrl, labourUrl, listOf, milestoneChip, milestonePhotoPayload,
  milestonesByStage, moreActions, nextStage, oneOfEnv, pct1, PROTO_LABEL, protosOf, projectUrl, qtyText, readFresh, rm, roleLabel,
  scheduleChip, send, STAGE_COLOR, STAGES, stageIndex, stageLabels, STATUS_LABEL, STATUS_TONE, toAudit, toFile, toIssuance, toLabour, toProject,
  TYPE_LABEL, versionNum, type Envelope, type FileRow, type Milestone, type ProtoType, type Stage,
} from "./rd-lib";
import { useRdPerms } from "./rd-perms";
import { CARD, R, TONE } from "./rd-style";
import { useRdToast } from "./rd-toast";

type Res = { data: Envelope | null; loading: boolean; error: string | null; failure: { status: number } | null; refresh: () => void };
type SheetState = null | { t: "mile"; stage: Stage } | { t: "more" } | { t: "upload" };
/** Base64 data URL ceiling for one milestone photo after compression (photos live in the project row). */
const MAX_PHOTO_CHARS = 900_000;
const DOC_ACCEPT =
  "image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function RdDetailScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pane } = useContainerLayout();
  const layout = useResponsiveLayout();
  const inPane = pane === "detail";
  const phone = layout.mode === "phone";
  const perms = useRdPerms();
  const today = todayYmdMY();

  const projRes = useCachedJson<Envelope>(id ? projectUrl(id) : null);
  const issRes = useCachedJson<Envelope>(id ? issuancesUrl(id) : null);
  const labRes = useCachedJson<Envelope>(id ? labourUrl(id) : null);
  const filesRes = useCachedJson<Envelope>(id ? filesUrl(id) : null);
  const histRes = useCachedJson<Envelope>(id ? historyUrl(id) : null);

  const row = oneOfEnv(projRes.data);
  const p = useMemo(() => (row ? toProject(row) : null), [row]);
  const issuances = useMemo(() => (issRes.data ? listOf(issRes.data, toIssuance) : null), [issRes.data]);
  const labour = useMemo(() => listOf(labRes.data, toLabour), [labRes.data]);
  const files = useMemo(() => listOf(filesRes.data, toFile), [filesRes.data]);
  const history = useMemo(() => listOf(histRes.data, toAudit).sort((a, b) => b.ts.localeCompare(a.ts)), [histRes.data]);

  const dock = p && perms.update ? dockAction(p) : null;
  const toast = useRdToast(!!dock);
  const life = useRdLifecycle(toast.show);
  const location = useLocation();
  const flash = (location.state as { rdToast?: string } | null)?.rdToast;
  const showToast = toast.show;
  useEffect(() => {
    if (flash) showToast(flash);
    // Shown once per navigation (the list that raised it may have unmounted on a phone).
  }, [flash, location.key, showToast]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [viewer, setViewer] = useState<{ src: string; title: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const camInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/m/rd");
  };
  const ctx = {
    toast: toast.show,
    pop: () => setFrames((s) => s.slice(0, -1)),
    onMileSaved: (stage: Stage) => setSheet({ t: "mile", stage }),
  };
  const push = (f: Frame) => {
    setSheet(null);
    setFrames((s) => [...s, f]);
  };

  const header = (title: string, more: boolean) => (
    <MobileHeader
      title={title}
      onBack={inPane ? undefined : back}
      trailing={more ? (
        <button type="button" aria-label="More actions" onClick={() => setSheet({ t: "more" })} style={ROUND_BTN}>
          <Ellipsis size={19} strokeWidth={2} />
        </button>
      ) : null}
    />
  );

  if (!p) {
    // "Not found" only when the server answered 404; a timeout / network failure is an
    // unknown outcome and gets "Couldn't load" + Try again (tests/record-load-failure-class).
    const notFound = !projRes.loading && projRes.failure?.kind === "notFound";
    const denied = !projRes.loading && projRes.failure?.status === 403;
    return (
      <>
        <TplStyles />
        {header("R&D project", false)}
        {projRes.loading || (!projRes.error && !projRes.data) ? (
          <div aria-busy="true" aria-label="Loading project" style={{ padding: "12px 16px", display: "grid", gap: 12 }}>
            <Skeleton h={120} r={20} />
            <Skeleton h={180} r={20} />
            <Skeleton h={220} r={20} />
          </div>
        ) : denied ? (
          <StateCard icon={Lock} title="You can't see this project" sub="Your role doesn't include R&D access. Ask an admin." />
        ) : notFound || projRes.data ? (
          <StateCard icon={FlaskConical} title="Project not found" sub="It may have been deleted." btn="Back to projects" onTap={() => navigate("/m/rd")} />
        ) : (
          <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load this project" sub={projRes.error || "The R&D service didn't answer."} btn="Try again" onTap={() => projRes.refresh()} />
        )}
        {toast.node}
      </>
    );
  }

  const L = stageLabels(p.projectType);
  const done = p.status === "COMPLETED";
  const cur = stageIndex(p.currentStage);
  const sched = scheduleChip(p, today);
  const cost = costBreakdown(p, issuances);
  const ms = milestonesByStage(p);
  const more = perms.update ? moreActions(p) : [];

  // ---- photo add (milestone) ----
  const addPhoto = async (file: File, stage: Stage) => {
    setPhotoBusy(true);
    let dataUrl = "";
    try {
      dataUrl = await compressImage(file, { maxDim: 1280, quality: 0.8 });
      if (dataUrl.length > MAX_PHOTO_CHARS) dataUrl = await compressImage(file, { maxDim: 960, quality: 0.7 });
    } catch {
      setPhotoBusy(false);
      toast.show("Couldn't read that photo. Try another one.", "err");
      return;
    }
    if (dataUrl.length > MAX_PHOTO_CHARS) {
      setPhotoBusy(false);
      toast.show("That photo is too large even after compressing. Try a smaller one.", "err");
      return;
    }
    const fresh = await readFresh(p.id);
    if (!fresh.ok) {
      setPhotoBusy(false);
      toast.show(fresh.error, "err");
      return;
    }
    const r = await send(projectUrl(p.id), "PUT", milestonePhotoPayload(fresh.p, stage, dataUrl));
    setPhotoBusy(false);
    if (!r.ok) {
      toast.show(r.error, "err");
      return;
    }
    invalidateRd();
    toast.show("Photo added");
  };

  // ---- file upload ----
  const upload = async (f: File) => {
    setSheet(null);
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("resourceType", FILE_RESOURCE);
    fd.append("resourceId", p.id);
    const r = await send("/api/files", "POST", fd);
    setUploading(false);
    if (!r.ok) {
      toast.show(r.error || "Upload failed", "err");
      return;
    }
    invalidateRd();
    toast.show("File uploaded");
  };
  const openFile = (f: FileRow) => {
    toast.show(`Opening ${f.filename}`, "neu");
    window.open(fileDownloadUrl(f.id), "_blank", "noopener,noreferrer");
  };

  const sub = (r: Res, what: string): ReactNode =>
    r.error && !r.data ? (
      r.failure?.status === 403 ? (
        <InlineState icon={Lock} tone="neu" t={`You don't have access to ${what}.`} />
      ) : (
        <InlineState icon={CloudOff} tone="bad" role="alert" t={`Couldn't load ${what}. ${r.error}`} btn="Try again" onTap={() => r.refresh()} />
      )
    ) : !r.data ? (
      <div aria-busy="true" style={{ ...CARD, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 0", fontSize: 12.5, color: R.mut }}>
        <Spinner light={false} /> Loading {what}…
      </div>
    ) : null;

  const infoRows: RowSpec[] = [
    { k: "Description", v: p.description || "—", muted: !p.description },
    ...(p.projectType === "IMPROVEMENT" ? [{ k: "Service reference", v: p.serviceId || "—", muted: !p.serviceId }] : []),
    ...(p.projectType !== "CLONE" && p.sourceBrand ? [{ k: "Brand / supplier", v: p.sourceBrand }] : []),
    { k: "Target launch", v: p.targetLaunchDate ? fmtDate(p.targetLaunchDate) : "Not set", muted: !p.targetLaunchDate },
    { k: "Current stage", v: done ? "Completed" : L[p.currentStage] },
    { k: "Team", v: p.assignedTeam.join(", ") || "No team yet", muted: !p.assignedTeam.length },
  ];

  const mileSheet = sheet?.t === "mile" ? ms.find((m) => m.stage === sheet.stage) ?? null : null;
  const totalHours = labour.reduce((a, h) => a + h.hours, 0);
  const pad = dock ? (phone ? 120 : 96) : 32;
  const moreRows: SheetRow[] = more.map((k) => ({
    key: k,
    l: k === "hold" ? "Hold" : "Move to Drafts",
    s: k === "hold" ? "Pause this project" : "Take it out of Projects",
    icon: LIFECYCLE_ICON[k],
    tone: k === "move-to-draft" ? ("bad" as const) : undefined,
    onTap: () => {
      setSheet(null);
      life.ask(p, k);
    },
  }));

  return (
    <>
      <TplStyles />
      {header(p.code, more.length > 0)}
      <div className="tpl-anim" style={{ padding: `4px 16px ${pad}px`, display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gap: 10, color: R.ink, animation: inPane ? "none" : "tpl-page .2s ease-out", maxWidth: inPane ? 760 : undefined }}>
        {/* Hero */}
        <section style={{ ...CARD, borderRadius: 20, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: R.br }}>{p.code}</span>
            <Badge size="sm" c={{ l: STATUS_LABEL[p.status], t: STATUS_TONE[p.status] }} />
            <Badge size="sm" c={{ l: TYPE_LABEL[p.projectType], t: "br" }} />
            {sched ? <Badge size="sm" c={sched} /> : null}
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 21, fontWeight: 800, lineHeight: 1.25, letterSpacing: -0.2, overflowWrap: "anywhere" }}>{p.name || "Untitled project"}</h1>
          <div style={{ marginTop: 3, fontSize: 13, color: R.sub }}>{CATEGORY_LABEL[p.productCategory]} · {TYPE_LABEL[p.projectType]}</div>
        </section>

        {/* Cover (view only) */}
        {p.coverPhotoUrl ? (
          <button type="button" onClick={() => setViewer({ src: p.coverPhotoUrl, title: `${p.name} — cover` })} aria-label="View cover photo" style={{ ...CARD, borderRadius: 20, padding: 0, border: "none", overflow: "hidden", height: 190, cursor: "pointer", display: "block" }}>
            <img src={p.coverPhotoUrl} alt="Cover photo" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
        ) : (
          <div role="img" aria-label="No cover photo" style={{ borderRadius: 20, height: 120, background: R.tint, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: R.br, fontSize: 12.5, fontWeight: 600 }}>
            <ImageOff size={26} strokeWidth={1.7} aria-hidden />
            No cover photo
          </div>
        )}

        <Rows rows={infoRows} />

        {/* Stage timeline */}
        <Label t="STAGE TIMELINE" pad="8px 4px 0" />
        <section style={{ ...CARD, padding: "4px 16px" }}>
          {STAGES.map((s, k) => {
            const isDone = done || k < cur;
            const isCur = !done && k === cur;
            const reach = (j: number) => done || j <= cur;
            return (
              <div key={s} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
                {k > 0 ? <span aria-hidden style={{ position: "absolute", left: 13, top: 0, height: "50%", width: 2, background: reach(k) ? STAGE_COLOR[STAGES[k - 1]] : R.ln }} /> : null}
                {k < 5 ? <span aria-hidden style={{ position: "absolute", left: 13, bottom: 0, height: "50%", width: 2, background: reach(k + 1) ? STAGE_COLOR[s] : R.ln }} /> : null}
                <span
                  aria-hidden
                  style={{
                    position: "relative", zIndex: 1, width: 28, height: 28, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: isDone || isCur ? STAGE_COLOR[s] : R.card, boxShadow: isCur ? `0 0 0 4px ${R.tint}` : isDone ? "none" : `inset 0 0 0 2px ${STAGE_COLOR[s]}`, color: "#FFFFFF",
                  }}
                >
                  {isDone ? <Check size={15} strokeWidth={3} /> : isCur ? <CircleDot size={15} strokeWidth={2.6} /> : null}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: isCur ? 800 : 600, color: isDone || isCur ? R.ink : R.mut }}>{L[s]}</span>
                {isDone || isCur ? <span style={{ fontSize: 11.5, fontWeight: 700, color: isCur ? R.warn : R.info }}>{isDone ? "Done" : "Current"}</span> : null}
              </div>
            );
          })}
        </section>

        {/* Budget & cost (no pricing targets / margin on mobile) */}
        <Label t="BUDGET & COST" pad="8px 4px 0" />
        <Tiles
          tiles={[
            { l: "Total Budget", v: rm(cost.budget) },
            { l: "Actual Cost", v: rm(cost.actual) },
            { l: cost.over ? "Over Budget" : "Remaining Budget", v: rm(Math.abs(cost.remaining)), vc: cost.over ? R.bad : R.ok },
            { l: "Budget Utilization", v: pct1(cost.pct), vc: TONE[barTone(cost.pct)][0] },
          ]}
        />
        <Bar l="Budget used" r={pct1(cost.pct)} pct={cost.pct} color={TONE[barTone(cost.pct)][0]} />
        <Rows
          rows={[
            { k: "Material Cost", v: rm(cost.material) },
            { k: "Labour Cost", v: rm(cost.labour), tag: cost.manual ? <Badge size="sm" c={{ l: "Manual", t: "warn" }} /> : undefined },
            ...(cost.pt > 0 ? [{ k: "Part-time Fixed Cost", v: rm(cost.pt) }] : []),
            { k: "Total R&D Cost", v: rm(cost.total), strong: true },
          ]}
        />
        <Note>
          Actual Cost is material spend only. Total R&D Cost adds labour.{cost.manual ? " Labour cost is a manual figure set on desktop." : ""}
        </Note>

        {/* Clone source */}
        {p.projectType === "CLONE" ? (
          <>
            <Label t="CLONE SOURCE" pad="8px 4px 0" />
            <Rows
              rows={[
                { k: "Source product", v: p.sourceProductName || "—", muted: !p.sourceProductName },
                { k: "Brand / supplier", v: p.sourceBrand || "—", muted: !p.sourceBrand },
                { k: "Purchase reference", v: p.sourcePurchaseRef || "—", muted: !p.sourcePurchaseRef },
                ...(p.sourcePriceSen > 0 ? [{ k: "Purchase price", v: rm(p.sourcePriceSen) }] : []),
                { k: "Notes", v: p.sourceNotes || "—", muted: !p.sourceNotes },
              ]}
            />
          </>
        ) : null}

        {/* Milestones */}
        <Label t="MILESTONES" r="6 stages" pad="8px 4px 0" />
        {ms.map((m) => {
          const c = milestoneChip(m, today);
          return (
            <DocCard
              key={m.stage}
              d={{
                code: L[m.stage],
                badges: c ? [c] : [],
                date: m.targetDate ? fmtDate(m.targetDate) : "",
                title: m.targetDate ? `Target ${fmtDate(m.targetDate)}` : "Target not set",
                sub: `Actual ${m.actualDate ? fmtDate(m.actualDate) : "—"} · Approved by ${m.approvedBy || "—"} · ${m.photos.length} photo${m.photos.length === 1 ? "" : "s"}`,
                rail: c ? TONE[c.t][0] : R.ln,
                onTap: () => setSheet({ t: "mile", stage: m.stage }),
                aria: `${L[m.stage]} milestone`,
              }}
            />
          );
        })}

        {/* Prototypes */}
        {(["FABRIC_SEWING", "FRAMING"] as ProtoType[]).map((t) => {
          const list = protosOf(p, t);
          return (
            <div key={t} style={{ display: "grid", gap: 10 }}>
              <Label t={`PROTOTYPES — ${PROTO_LABEL[t].toUpperCase()}`} r={String(list.length)} pad="8px 4px 0" />
              {list.length ? list.map((x) => (
                <DocCard
                  key={x.id}
                  d={{
                    code: x.version || "—",
                    date: x.createdDate ? fmtDate(x.createdDate) : "",
                    title: x.description || "No description",
                    sub: `${hrs(x.labourHours)} labour`,
                    lines: [
                      ...(versionNum(x.version) > 1 ? [{ k: "Improvements", v: x.improvements || "—" }] : []),
                      { k: "Defects", v: x.defects || "—" },
                      { k: "Test results", v: x.testResults || "—" },
                      { k: "Feedback", v: x.feedback || "—" },
                    ],
                    onTap: perms.update ? () => push({ kind: "proto", project: p, type: t, proto: x }) : null,
                    aria: `Edit prototype ${x.version}`,
                  }}
                />
              )) : <InlineState t={`No ${PROTO_LABEL[t].toLowerCase()} prototypes yet.`} />}
              {perms.update ? <DashedButton icon={Plus} label={`Add ${PROTO_LABEL[t]} prototype`} onTap={() => push({ kind: "proto", project: p, type: t, proto: null })} /> : null}
            </div>
          );
        })}

        {/* Material issuance — read-only */}
        <Label t="MATERIAL ISSUANCE" r="Read-only" pad="8px 4px 0" />
        {sub(issRes as Res, "material issuances") ?? (issuances && issuances.length ? (
          <>
            {issuances.map((x) => (
              <DocCard
                key={x.id}
                d={{
                  code: x.materialCode || "—",
                  date: x.issuedAt ? fmtDate(x.issuedAt) : "",
                  title: x.materialName || "Material",
                  amts: [{ k: "Qty", v: `${qtyText(x.qty)} ${x.unit}`.trim() }, { k: "Unit cost", v: rm(x.unitCostSen) }, { k: "Total", v: rm(x.totalCostSen) }],
                  lines: [{ k: "Issued by", v: x.issuedBy || "—" }, { k: "Notes", v: x.notes || "—" }],
                }}
              />
            ))}
            <Rows rows={[{ k: "Total material issuance", v: rm(cost.material), strong: true }]} />
          </>
        ) : <InlineState icon={Package} tone="neu" t="No materials issued yet." />)}

        {/* Labour hours */}
        <Label t="LABOUR HOURS" r={labRes.data ? `${hrs(totalHours)} total` : ""} pad="8px 4px 0" />
        {sub(labRes as Res, "labour hours") ?? (labour.length ? labour.map((h) => (
          <DocCard
            key={h.id}
            d={{
              code: h.memberName || "Team member",
              badges: [h.employmentType === "PART_TIME" ? { l: "Part-time", t: "br" } : { l: "Full-time", t: "info" }],
              date: h.workDate ? fmtDate(h.workDate) : "",
              title: hrs(h.hours),
              amts: [{ k: "Labour cost", v: h.employmentType === "PART_TIME" ? "Part-time fixed" : rm(h.autoCostSen) }],
              lines: h.notes ? [{ k: "Notes", v: h.notes }] : null,
            }}
          />
        )) : <InlineState icon={Timer} tone="neu" t="No hours logged yet." />)}
        {perms.logHours && labRes.data ? <DashedButton icon={Timer} label="Add hours" onTap={() => push({ kind: "hours", project: p })} /> : null}

        {/* Files */}
        <Label t="FILES" r={filesRes.data ? String(files.length) : ""} pad="8px 4px 0" />
        {sub(filesRes as Res, "files") ?? (files.length ? files.map((f) => (
          <DocCard
            key={f.id}
            d={{ code: f.filename, sub: [fileSize(f.sizeBytes), f.uploadedAt ? `added ${fmtDate(f.uploadedAt.slice(0, 10))}` : ""].filter(Boolean).join(" · "), onTap: () => openFile(f), aria: `Open ${f.filename}` }}
          />
        )) : <InlineState icon={FolderOpen} tone="neu" t="No files yet. Cover and milestone photos are kept separately." />)}
        {perms.fileUpload && filesRes.data ? (
          uploading ? (
            <div aria-busy="true" style={{ height: 44, borderRadius: 12, border: `1.5px dashed ${R.ln}`, background: R.tint, color: R.br, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Spinner light={false} /> Uploading…
            </div>
          ) : (
            <DashedButton icon={Upload} label="Upload file" onTap={() => setSheet({ t: "upload" })} />
          )
        ) : null}

        {/* History */}
        <Label t="HISTORY" r={histRes.data ? `${history.length} event${history.length === 1 ? "" : "s"}` : ""} pad="8px 4px 0" />
        {sub(histRes as Res, "this project's history") ?? (history.length ? history.map((e) => {
          const c = auditChip(e.action);
          const lines = auditLines(e, p.projectType);
          return (
            <DocCard
              key={e.id}
              d={{
                code: e.actorUserName || "System",
                badges: [c],
                date: fmtDateTime(e.ts),
                sub: roleLabel(e.actorRole),
                lines: lines.length ? lines : [{ k: "", v: "No tracked field changes" }],
                rail: TONE[c.t][0],
              }}
            />
          );
        }) : <InlineState icon={History} tone="neu" t="No history yet." />)}
      </div>

      {/* Action dock */}
      {dock ? (
        <ResponsiveActionDock scope="auto" phoneBottom={56} zIndex={30}>
          <div style={{ pointerEvents: "auto", width: "100%", maxWidth: phone ? 480 : 760, boxSizing: "border-box", padding: "10px 16px 12px", background: R.bg, boxShadow: `0 -1px 0 ${R.ln}` }}>
            {dock === "advance" ? <div style={{ fontSize: 11.5, color: R.mut, textAlign: "center", marginBottom: 6 }}>Complete unlocks at Production Ready</div> : null}
            <DockButton k={dock} label={dock === "advance" ? `Advance to ${L[nextStage(p.currentStage) ?? p.currentStage]}` : DOCK_LABEL[dock]} onTap={() => life.ask(p, dock)} />
          </div>
        </ResponsiveActionDock>
      ) : null}

      <TplSheet open={sheet?.t === "more"} title={p.name} sub="Project actions" onClose={() => setSheet(null)} groups={[{ rows: moreRows }]} />
      <TplSheet
        open={sheet?.t === "upload"}
        title="Upload file"
        sub={p.code}
        onClose={() => setSheet(null)}
        groups={[{
          rows: [
            { key: "cam", l: "Take photo", s: "Use the camera", icon: Camera, onTap: () => camInput.current?.click() },
            { key: "file", l: "Choose file", s: "Photo, PDF, Word or Excel", icon: FileText, onTap: () => docInput.current?.click() },
          ],
        }]}
      />
      <input ref={camInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <input ref={docInput} type="file" accept={DOC_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />

      <MilestoneSheet
        m={mileSheet}
        label={mileSheet ? L[mileSheet.stage] : ""}
        projectLine={`${p.code} · ${p.name}`}
        today={today}
        canEdit={perms.update}
        busy={photoBusy}
        onClose={() => setSheet(null)}
        onView={(src, i) => setViewer({ src, title: `${mileSheet ? L[mileSheet.stage] : ""} — photo ${i + 1}` })}
        onChangeTarget={() => mileSheet && push({ kind: "mile", project: p, m: mileSheet })}
        onAddPhoto={() => photoInput.current?.click()}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && mileSheet) void addPhoto(f, mileSheet.stage);
        }}
      />
      <PhotoViewer src={viewer?.src ?? null} title={viewer?.title ?? ""} onClose={() => setViewer(null)} />
      {life.node}
      <FormStack frames={frames} ctx={ctx} />
      {toast.node}
    </>
  );
}

const DOCK_LABEL: Record<string, string> = { start: "Start Project", complete: "Complete project", resume: "Resume", reopen: "Reopen" };

function DockButton({ k, label, onTap }: { k: ReturnType<typeof dockAction> & string; label: string; onTap: () => void }) {
  const Icon = LIFECYCLE_ICON[k];
  return (
    <button type="button" onClick={onTap} style={{ width: "100%", height: 50, borderRadius: 14, border: "none", background: R.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
      <Icon size={17} strokeWidth={2.3} aria-hidden />
      {label}
    </button>
  );
}

function MilestoneSheet({ m, label, projectLine, today, canEdit, busy, onClose, onView, onChangeTarget, onAddPhoto }: {
  m: Milestone | null; label: string; projectLine: string; today: string; canEdit: boolean; busy: boolean; onClose: () => void;
  onView: (src: string, i: number) => void; onChangeTarget: () => void; onAddPhoto: () => void;
}) {
  const c = m ? milestoneChip(m, today) : null;
  const kv = (k: string, v: string, color?: string) => ({ k, v: v || "—", color: color ?? (v ? R.ink : R.mut) });
  const rows = m
    ? [
        kv("Stage", `${STAGES.indexOf(m.stage) + 1} of 6`),
        kv("Target date", m.targetDate ? fmtDate(m.targetDate) : "Not set", m.targetDate ? undefined : R.mut),
        kv("Actual date", m.actualDate ? fmtDate(m.actualDate) : ""),
        kv("Status", c ? c.l : m.targetDate ? "" : "No target date", c ? TONE[c.t][0] : R.mut),
        kv("Approved by", m.approvedBy),
        kv("Photos", String(m.photos.length)),
      ]
    : [];
  const btn = { flex: 1, minWidth: 0, height: 46, borderRadius: 12, border: "none", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" } as const;
  return (
    <RdSheet open={!!m} title={`${label} milestone`} sub={projectLine} badges={c ? [c] : []} onClose={onClose}>
      <div style={{ borderRadius: 14, background: R.card, boxShadow: `0 0 0 1px ${R.ln}`, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid ${R.ln}` : "none", fontSize: 13 }}>
            <span style={{ color: R.mut }}>{r.k}</span>
            <span style={{ fontWeight: 700, color: r.color, textAlign: "right", overflowWrap: "anywhere" }}>{r.v}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: R.br }}>PHOTOS · {m?.photos.length ?? 0}</div>
      {m && m.photos.length ? (
        <div className="tpl-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {m.photos.map((src, i) => (
            <button key={i} type="button" aria-label={`Photo ${i + 1}`} onClick={() => onView(src, i)} style={{ flex: "none", width: 92, height: 92, padding: 0, border: "none", borderRadius: 12, overflow: "hidden", cursor: "pointer", background: R.tint }}>
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: R.mut }}>No photos for this stage yet.</div>
      )}
      {canEdit ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onChangeTarget} disabled={busy} style={{ ...btn, background: R.card, color: R.br, boxShadow: `0 0 0 1px ${R.ln}` }}>
            <CalendarClock size={16} strokeWidth={2.1} />
            Change target
          </button>
          <button type="button" onClick={onAddPhoto} disabled={busy} aria-busy={busy} style={{ ...btn, background: R.grad, color: "#FFFFFF", opacity: busy ? 0.75 : 1 }}>
            {busy ? <Spinner /> : <ImagePlus size={16} strokeWidth={2.1} />}
            {busy ? "Saving photo…" : "Add photo"}
          </button>
        </div>
      ) : null}
    </RdSheet>
  );
}
