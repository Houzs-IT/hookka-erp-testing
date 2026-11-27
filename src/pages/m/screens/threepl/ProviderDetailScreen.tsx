// ===========================================================================
// ProviderDetailScreen — /m/logistics/:id, the 3PL provider detail (Batch 4,
// the prototype's detail design): info card, States Covered (rate card),
// Fleet, Drivers & Contacts, Attachments; Edit + More (Edit provider / Edit
// rate card / Deactivate–Reactivate). In the tablet split view it is the
// right pane (no back arrow), the list stays on the left.
//
//   provider     GET /api/drivers/:id
//   rate card    GET /api/three-pl-state-rates?providerId=   (lazily seeds 0/0 rows, as desktop)
//   fleet        GET /api/three-pl-vehicles?providerId=
//   drivers      GET /api/three-pl-drivers?providerId=
//   attachments  GET/POST /api/files (THREE_PL_PROVIDER) · DELETE /api/files/:id
// Every action is hidden unless the role holds the API's own permission.
// ===========================================================================
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronDown, ChevronRight, CirclePause, CirclePlay, CloudOff, Ellipsis, ExternalLink, FileText, IdCard, Info, Lock, MapPinned, Paperclip,
  Pencil, Phone, Plus, StickyNote, Trash2, Truck, Upload, UserRound, type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader } from "../../components";
import { useContainerLayout } from "../../lib/responsive-layout";
import { FormStack, type Frame } from "./tpl-forms";
import { Banner, DashedButton, Spinner, StateCard, StatusPill, TplDialog, TplSheet, TplStyles, type DialogSpec, type SheetRow } from "./tpl-kit";
import {
  driversUrl, FILE_RESOURCE, fileDownloadUrl, fileKind, fileSize, filesUrl, fmt2, invalidate3pl, listOf, plural, providerUrl, ratesUrl, rm,
  send, served, toDriver, toFile, toProvider, toRates, toVehicle, vehiclesUrl, type Envelope, type FileRow, type Provider,
} from "./tpl-lib";
import { useTplPerms } from "./tpl-perms";
import { ROUND_BTN, SH_SECTION, X } from "./tpl-style";
import { useTplToast } from "./tpl-toast";

type SecKey = "rates" | "fleet" | "drivers" | "atts";
type Res = { data: Envelope | null; loading: boolean; error: string | null; refresh: () => void };

export function ProviderDetailScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pane } = useContainerLayout();
  const inPane = pane === "detail";
  const perms = useTplPerms();
  const toast = useTplToast();

  const provRes = useCachedJson<{ success?: boolean; data?: Record<string, unknown> }>(id ? providerUrl(id) : null);
  const ratesRes = useCachedJson<Envelope>(id ? ratesUrl(id) : null);
  const vehRes = useCachedJson<Envelope>(id ? vehiclesUrl(id) : null);
  const drvRes = useCachedJson<Envelope>(id ? driversUrl(id) : null);
  const filesRes = useCachedJson<Envelope>(id ? filesUrl(id) : null);

  const p: Provider | null = useMemo(() => (provRes.data?.data ? toProvider(provRes.data.data) : null), [provRes.data]);
  const rates = useMemo(() => (ratesRes.data ? toRates(ratesRes.data.data).filter(served) : []), [ratesRes.data]);
  const vehicles = useMemo(() => listOf(vehRes.data, toVehicle), [vehRes.data]);
  const drivers = useMemo(() => listOf(drvRes.data, toDriver), [drvRes.data]);
  const files = useMemo(() => listOf(filesRes.data, toFile), [filesRes.data]);

  const [openSec, setOpenSec] = useState<Record<SecKey, boolean>>({ rates: true, fleet: true, drivers: true, atts: false });
  const [frames, setFrames] = useState<Frame[]>([]);
  const [sheet, setSheet] = useState<null | { t: "more" } | { t: "att"; f: FileRow }>(null);
  const [dlg, setDlg] = useState<{ spec: DialogSpec; busy: boolean; err: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/m/logistics");
  };
  const ctx = {
    perms,
    toast: toast.show,
    push: (f: Frame) => {
      setSheet(null);
      setFrames((s) => [...s, f]);
    },
    pop: () => setFrames((s) => s.slice(0, -1)),
  };
  const viewOnly = () => toast.show("View only", "neu");

  const runDlg = (spec: Omit<DialogSpec, "onOk">, action: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    setDlg({
      busy: false,
      err: "",
      spec: {
        ...spec,
        onOk: async () => {
          setDlg((d) => (d ? { ...d, busy: true, err: "" } : d));
          const r = await action();
          if (!r.ok) {
            setDlg((d) => (d ? { ...d, busy: false, err: r.error ?? "Something went wrong." } : d));
            return;
          }
          setDlg(null);
          invalidate3pl();
          toast.show(done);
        },
      },
    });

  const setStatus = async (status: "ACTIVE" | "INACTIVE") => {
    if (!p) return { ok: false, error: "" };
    const r = await send(providerUrl(p.id), "PUT", { status });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };

  const upload = async (f: File) => {
    if (!p) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("resourceType", FILE_RESOURCE);
    fd.append("resourceId", p.id);
    const r = await send("/api/files", "POST", fd);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!r.ok) {
      toast.show(r.error || "Upload failed", "err");
      return;
    }
    invalidate3pl();
    setOpenSec((s) => ({ ...s, atts: true }));
    toast.show("File added");
  };

  // ---- header + whole-page states ----
  const header = (title: string, actions: boolean) => (
    <MobileHeader
      title={title}
      onBack={inPane ? undefined : back}
      trailing={actions ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" aria-label="Edit provider" onClick={() => p && ctx.push({ kind: "prov", provider: p })} style={ROUND_BTN}>
            <Pencil size={17} strokeWidth={2} />
          </button>
          <button type="button" aria-label="More actions" onClick={() => setSheet({ t: "more" })} style={ROUND_BTN}>
            <Ellipsis size={19} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    />
  );

  if (!p) {
    // "Not found" only when the server answered 404; a timeout / network failure is an
    // unknown outcome and gets "Couldn't load" + Try again (tests/record-load-failure-class).
    const notFound = !provRes.loading && provRes.failure?.kind === "notFound";
    return (
      <>
        <TplStyles />
        {header("3PL provider", false)}
        {provRes.loading || (!provRes.error && !provRes.data) ? (
          <div aria-busy="true" style={{ padding: "12px 16px", display: "grid", gap: 12 }}>
            {[150, 120, 120].map((h, i) => <div key={i} className="tpl-anim" style={{ height: h, borderRadius: 20, background: X.card, animation: "tpl-pulse 1.2s ease-in-out infinite" }} />)}
          </div>
        ) : notFound || provRes.data ? (
          <StateCard icon={Truck} title="Provider not found" sub="It may have been deleted." btn="Back to providers" onTap={() => navigate("/m/logistics")} />
        ) : (
          <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load this provider" sub={provRes.error || "The delivery service didn't answer."} btn="Try again" onTap={() => provRes.refresh()} />
        )}
        {toast.node}
      </>
    );
  }

  const canEdit = perms.provUpdate;
  const activeVeh = vehicles.filter((v) => v.status === "ACTIVE").length;
  const toggle = (k: SecKey) => setOpenSec((s) => ({ ...s, [k]: !s[k] }));
  const loadErr = (r: Res, what: string) =>
    r.error && !r.data ? (
      <div style={{ display: "grid", gap: 8 }}>
        <Banner icon={CloudOff} tone="bad">Couldn't load {what}. {r.error}</Banner>
        <button type="button" onClick={() => r.refresh()} style={{ height: 40, borderRadius: 999, border: "none", background: X.tint, color: X.br, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Try again</button>
      </div>
    ) : !r.data ? (
      // No data and no error yet = still loading (never flash an empty section mid-load).
      <div aria-busy="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 0", fontSize: 12.5, color: X.mut }}>
        <Spinner light={false} /> Loading {what}…
      </div>
    ) : null;

  const moreRows: SheetRow[] = [
    { key: "edit", l: "Edit provider", icon: Pencil, onTap: () => ctx.push({ kind: "prov", provider: p }) },
    ...(perms.rates ? [{ key: "rates", l: "Edit rate card", icon: MapPinned, onTap: () => ctx.push({ kind: "rates", provider: p }) }] : []),
    ...(p.status !== "ACTIVE"
      ? [{
          key: "react", l: "Reactivate provider", s: "Can be picked for new deliveries again.", icon: CirclePlay, tone: "ok" as const,
          onTap: async () => {
            setSheet(null);
            const r = await setStatus("ACTIVE");
            if (!r.ok) toast.show(r.error || "Couldn't reactivate", "err");
            else {
              invalidate3pl();
              toast.show("Provider reactivated");
            }
          },
        }]
      : []),
    ...(p.status !== "INACTIVE"
      ? [{
          key: "deact", l: "Deactivate provider", s: "Hidden from new deliveries. Nothing is deleted.", icon: CirclePause, tone: "bad" as const,
          onTap: () => {
            setSheet(null);
            runDlg(
              { title: `Deactivate ${p.name}?`, body: "It won't be offered for new deliveries. Its vehicles, drivers, rates and past deliveries stay as they are.", okL: "Deactivate", danger: true, icon: CirclePause },
              () => setStatus("INACTIVE"),
              "Provider deactivated",
            );
          },
        }]
      : []),
  ];
  const att = sheet?.t === "att" ? sheet.f : null;

  return (
    <>
      <TplStyles />
      {header(p.name, canEdit)}
      <div className="tpl-anim" style={{ padding: "2px 16px 32px", display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gap: 12, color: X.ink, animation: inPane ? "none" : "tpl-page .2s ease-out", maxWidth: inPane ? 760 : undefined }}>
        {!perms.loading && !canEdit ? <Banner icon={Lock} tone="neu">View only. You don't have permission to change 3PL providers.</Banner> : null}
        {p.status !== "ACTIVE" ? (
          <Banner icon={CirclePause} tone="neu">
            This provider is {p.status === "ON_LEAVE" ? "on leave" : "inactive"}. It can't be picked for new deliveries.
          </Banner>
        ) : null}

        <section style={{ borderRadius: 20, padding: 14, background: X.card, boxShadow: SH_SECTION }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: X.grad, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Truck size={18} strokeWidth={2} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.2, overflowWrap: "anywhere" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: X.mut, marginTop: 1 }}>3PL provider</div>
            </div>
            <StatusPill status={p.status} size="lg" />
          </div>
          <div style={{ height: 1, background: X.ln, margin: "12px 0 4px" }} />
          <InfoRow icon={UserRound} k="Contact" v={p.contactPerson || "—"} first />
          <InfoRow icon={Phone} k="Phone" v={p.phone || "—"} call={p.phone ? `tel:${p.phone.replace(/[^\d+]/g, "")}` : ""} />
          <InfoRow icon={StickyNote} k="Remarks" v={p.remarks || "—"} />
        </section>

        <Section icon={MapPinned} t="States Covered" sub={ratesRes.data ? (rates.length ? `${rates.length} of 16 states priced` : "No states priced yet") : "Rate card"} open={openSec.rates} onToggle={() => toggle("rates")}>
          <div style={{ marginBottom: 10 }}>
            <Banner icon={Info} tone="warn">State rates don't price Delivery Orders yet.</Banner>
          </div>
          {loadErr(ratesRes, "the rate card") ?? (rates.length ? (
            <div style={{ borderRadius: 14, boxShadow: `inset 0 0 0 1px ${X.ln}`, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px 92px", gap: 6, padding: "8px 12px", background: X.tint, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: X.br, textTransform: "uppercase" }}>
                <span>State</span><span style={{ textAlign: "right" }}>Per trip</span><span style={{ textAlign: "right" }}>Extra drop</span>
              </div>
              {rates.map((r) => (
                <div key={r.state} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px 92px", gap: 6, alignItems: "center", padding: "9px 12px", borderTop: `1px solid ${X.ln}`, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                  <span style={{ textAlign: "right", fontWeight: 700 }}>{r.tripSen ? rm(r.tripSen) : "—"}</span>
                  <span style={{ textAlign: "right", color: X.sub }}>{r.dropSen ? rm(r.dropSen) : "—"}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No state rates yet.</Empty>)}
          {perms.rates && ratesRes.data ? <div style={{ marginTop: 10 }}><DashedButton icon={Pencil} label={rates.length ? "Edit rate card" : "Set up rate card"} onTap={() => ctx.push({ kind: "rates", provider: p })} /></div> : null}
        </Section>

        <Section icon={Truck} t="Fleet" sub={vehRes.data ? `${plural(vehicles.length, "vehicle")} · ${activeVeh} active` : "Vehicles"} open={openSec.fleet} onToggle={() => toggle("fleet")}>
          {loadErr(vehRes, "vehicles") ?? (vehicles.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {vehicles.map((v) => (
                <Item
                  key={v.id}
                  icon={Truck}
                  t={v.plateNo}
                  s={v.vehicleType || "Type not set"}
                  status={v.status}
                  tags={[
                    { k: "Box", v: v.boxLengthFt && v.boxWidthFt && v.boxHeightFt ? `${fmt2(v.boxLengthFt)} × ${fmt2(v.boxWidthFt)} × ${fmt2(v.boxHeightFt)} ft` : "—" },
                    { k: "Cap", v: v.capacityM3 ? `${fmt2(v.capacityM3)} m³` : "—" },
                    { k: "Trip", v: v.ratePerTripSen ? rm(v.ratePerTripSen) : "—" },
                    { k: "Extra drop", v: v.ratePerExtraDropSen ? rm(v.ratePerExtraDropSen) : "—" },
                  ]}
                  onTap={() => (perms.vehUpdate ? ctx.push({ kind: "veh", provider: p, vehicle: v }) : viewOnly())}
                />
              ))}
            </div>
          ) : <Empty>No vehicles yet.</Empty>)}
          {perms.vehCreate && vehRes.data ? <div style={{ marginTop: 10 }}><DashedButton icon={Plus} label="Add vehicle" onTap={() => ctx.push({ kind: "veh", provider: p, vehicle: null })} /></div> : null}
        </Section>

        <Section icon={IdCard} t="Drivers & Contacts" sub={drvRes.data ? plural(drivers.length, "driver") : "Drivers"} open={openSec.drivers} onToggle={() => toggle("drivers")}>
          {loadErr(drvRes, "drivers") ?? (drivers.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {drivers.map((d) => (
                <Item key={d.id} icon={UserRound} t={d.name} s={d.phone || "No phone"} status={d.status} onTap={() => (perms.drvUpdate ? ctx.push({ kind: "drv", provider: p, driver: d }) : viewOnly())} />
              ))}
            </div>
          ) : <Empty>No drivers yet.</Empty>)}
          {perms.drvCreate && drvRes.data ? <div style={{ marginTop: 10 }}><DashedButton icon={Plus} label="Add driver" onTap={() => ctx.push({ kind: "drv", provider: p, driver: null })} /></div> : null}
        </Section>

        <Section icon={Paperclip} t="Attachments" sub={filesRes.data ? (files.length ? plural(files.length, "file") : "None") : "Files"} open={openSec.atts} onToggle={() => toggle("atts")}>
          {loadErr(filesRes, "attachments") ?? (files.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {files.map((f) => (
                <Item key={f.id} icon={FileText} t={f.filename} s={[fileKind(f), fileSize(f.sizeBytes), f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : ""].filter(Boolean).join(" · ")} viewTag onTap={() => setSheet({ t: "att", f })} />
              ))}
            </div>
          ) : <Empty>No attachments.</Empty>)}
          {perms.fileCreate && filesRes.data ? (
            <div style={{ marginTop: 10 }}>
              {uploading ? (
                <div aria-busy="true" style={{ height: 44, borderRadius: 12, border: `1.5px dashed ${X.ln}`, background: X.tint, color: X.br, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Spinner light={false} /> Uploading…
                </div>
              ) : (
                <DashedButton icon={Upload} label="Add file" onTap={() => fileInput.current?.click()} />
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </div>
          ) : null}
        </Section>
      </div>

      <TplSheet
        open={sheet?.t === "more"}
        title={p.name}
        sub="Provider actions"
        onClose={() => setSheet(null)}
        groups={[{ rows: moreRows.map((r) => ({ ...r, onTap: () => void r.onTap() })) }]}
      />
      <TplSheet
        open={!!att}
        title={att?.filename ?? ""}
        sub={att ? [fileKind(att), fileSize(att.sizeBytes)].filter(Boolean).join(" · ") : ""}
        onClose={() => setSheet(null)}
        groups={att ? [{
          rows: [
            { key: "open", l: "Open file", icon: ExternalLink, onTap: () => { setSheet(null); window.open(fileDownloadUrl(att.id), "_blank", "noopener,noreferrer"); } },
            ...(perms.fileDelete ? [{
              key: "rm", l: "Remove file", icon: Trash2, tone: "bad" as const,
              onTap: () => {
                setSheet(null);
                runDlg(
                  { title: "Remove this file?", body: `${att.filename} is taken off the provider.`, okL: "Remove", danger: true, icon: Trash2 },
                  async () => {
                    const r = await send(`/api/files/${encodeURIComponent(att.id)}`, "DELETE");
                    return r.ok ? { ok: true } : { ok: false, error: r.error };
                  },
                  "File removed",
                );
              },
            }] : []),
          ],
        }] : []}
      />
      <TplDialog spec={dlg?.spec ?? null} busy={dlg?.busy} err={dlg?.err} onCancel={() => setDlg(null)} onOk={() => void dlg?.spec.onOk()} />
      <FormStack frames={frames} ctx={ctx} />
      {toast.node}
    </>
  );
}

// ---- pieces ------------------------------------------------------------------------------
function InfoRow({ icon: Icon, k, v, call, first }: { icon: LucideIcon; k: string; v: string; call?: string; first?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: first ? "none" : `1px solid ${X.ln}` }}>
      <span style={{ width: 28, height: 28, flex: "none", borderRadius: 8, background: X.tint, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={14} strokeWidth={2} color={X.br} />
      </span>
      <span style={{ width: 92, flex: "none", fontSize: 12, color: X.mut, paddingTop: 6 }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, paddingTop: 5, lineHeight: 1.4, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{v}</span>
      {call ? (
        <a href={call} aria-label={`Call ${v}`} style={{ width: 36, height: 36, flex: "none", borderRadius: "50%", background: X.prit, color: X.pri, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Phone size={15} strokeWidth={2.2} />
        </a>
      ) : null}
    </div>
  );
}

function Section({ icon: Icon, t, sub, open, onToggle, children }: { icon: LucideIcon; t: string; sub: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section style={{ borderRadius: 20, background: X.card, boxShadow: SH_SECTION, overflow: "hidden" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 14, border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink }}>
        <span style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: X.gradIcon, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} strokeWidth={2} color="#FFFFFF" />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>{t}</span>
          <span style={{ display: "block", fontSize: 12, color: X.mut, marginTop: 1 }}>{sub}</span>
        </span>
        <span style={{ display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <ChevronDown size={18} strokeWidth={2} color={X.gold} />
        </span>
      </button>
      {open ? <div style={{ padding: "0 14px 14px" }}>{children}</div> : null}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "16px 8px", textAlign: "center", fontSize: 12.5, color: X.mut, lineHeight: 1.45 }}>{children}</div>;
}

function Item({ icon: Icon, t, s, status, tags, viewTag, onTap }: {
  icon: LucideIcon; t: string; s: string; status?: "ACTIVE" | "INACTIVE"; tags?: { k: string; v: string }[]; viewTag?: boolean; onTap: () => void;
}) {
  const rail = status === "INACTIVE" ? X.neu : status === "ACTIVE" ? X.ok : X.pri;
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        position: "relative", overflow: "hidden", padding: "11px 12px 10px 15px", borderRadius: 14, background: X.bg, boxShadow: `inset 0 0 0 1px ${X.ln}`,
        cursor: "pointer", opacity: status === "INACTIVE" ? 0.7 : 1, border: "none", fontFamily: "inherit", textAlign: "left", color: X.ink, width: "100%", display: "block",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: rail }} />
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={15} strokeWidth={2} color={X.br} style={{ flex: "none" }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</span>
        {status ? <StatusPill status={status} size="sm" /> : null}
        {viewTag ? <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: X.prit, color: X.pri, fontSize: 10.5, fontWeight: 700 }}>View</span> : null}
        <ChevronRight size={16} strokeWidth={2} color={X.chev} style={{ flex: "none" }} />
      </span>
      {s ? <span style={{ display: "block", fontSize: 12, color: X.sub, marginTop: 3, overflowWrap: "anywhere" }}>{s}</span> : null}
      {tags ? (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
          {tags.map((g) => (
            <span key={g.k} style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7, background: X.tint, fontSize: 11, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: X.mut }}>{g.k}</span>
              <span style={{ fontWeight: 700 }}>{g.v}</span>
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}
