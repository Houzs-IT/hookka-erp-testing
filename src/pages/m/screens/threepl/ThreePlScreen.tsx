// ===========================================================================
// ThreePlScreen — the 3PL provider list (Batch 4, Claude Design "3PL Providers").
//
// Routed at /m/logistics, and rendered as Delivery's "3PL Providers" tab
// (DeliveryScreen passes `onDeliveries` so its own section switch keeps
// working there). Same header + Deliveries | 3PL Providers switch either way.
//
//   read     GET /api/drivers (vehicleCount / driverCount / ratedStates[])
//   tap      → /m/logistics/:id (the provider detail; split view on tablets)
//   +        New provider (drivers:create)
//   card     Edit (drivers:update) · Delete (drivers:delete, cascade copy)
//   search   name / contact / phone · chips by status · sort + "Unpriced only"
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDownUp, CloudOff, IdCard, MapPin, Pencil, Phone, Plus, Search, SearchX, Trash2, Truck, UserRound, X as XIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader, ResponsiveGrid } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { SEGMENT_WRAP } from "../../lib/control-styles";
import { SectionSwitch } from "../delivery/ui";
import { FormStack, type Frame } from "./tpl-forms";
import { SectionLabel, StateCard, StatusPill, TplDialog, TplSheet, TplStyles, type DialogSpec } from "./tpl-kit";
import { invalidate3pl, listOf, plural, providerUrl, PROVIDERS_URL, send, toProvider, type Envelope, type Provider, type ProviderStatus } from "./tpl-lib";
import { useTplPerms } from "./tpl-perms";
import { CHIP_BTN, PLUS_BTN, SH_CARD, SH_CARD_ON, SH_CONTROL, ST, X } from "./tpl-style";
import { useTplToast } from "./tpl-toast";

const PAGE = 6;
type Sort = "name" | "nameD" | "veh" | "states";
const SORTS: { k: Sort; l: string }[] = [
  { k: "name", l: "Name A–Z" },
  { k: "nameD", l: "Name Z–A" },
  { k: "veh", l: "Most vehicles" },
  { k: "states", l: "Most states priced" },
];
type Chip = "all" | ProviderStatus;
const CHIPS: { k: Chip; l: string }[] = [
  { k: "all", l: "All" },
  { k: "ACTIVE", l: "Active" },
  { k: "INACTIVE", l: "Inactive" },
  { k: "ON_LEAVE", l: "On Leave" },
];

export function ThreePlScreen({ onDeliveries }: { onDeliveries?: () => void } = {}) {
  const navigate = useNavigate();
  const { id: openId } = useParams();
  const embedded = !!onDeliveries;
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const inPane = !embedded && layout.canSplitDetail && !!openId;
  const gridMaxColumns = tablet && !inPane ? undefined : 1;
  const perms = useTplPerms();
  const toast = useTplToast();

  const res = useCachedJson<Envelope>(PROVIDERS_URL);
  const all = useMemo(() => listOf(res.data, toProvider), [res.data]);

  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [unpriced, setUnpriced] = useState(false);
  const [page, setPage] = useState(PAGE);
  const [draft, setDraft] = useState<{ sort: Sort; unpriced: boolean } | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [dlg, setDlg] = useState<{ spec: DialogSpec; busy: boolean; err: string } | null>(null);

  const qn = q.trim().toLowerCase();
  const list = useMemo(() => {
    const L = all.filter(
      (p) =>
        (chip === "all" || p.status === chip) &&
        (!unpriced || !p.ratedStates.length) &&
        (!qn || `${p.name} ${p.contactPerson} ${p.phone}`.toLowerCase().includes(qn)),
    );
    return [...L].sort((a, b) =>
      sort === "nameD" ? b.name.localeCompare(a.name)
        : sort === "veh" ? b.vehicleCount - a.vehicleCount || a.name.localeCompare(b.name)
          : sort === "states" ? b.ratedStates.length - a.ratedStates.length || a.name.localeCompare(b.name)
            : a.name.localeCompare(b.name),
    );
  }, [all, chip, unpriced, qn, sort]);
  const shown = list.slice(0, page);
  const count = (k: Chip) => (k === "all" ? all.length : all.filter((p) => p.status === k).length);
  const fN = (sort !== "name" ? 1 : 0) + (unpriced ? 1 : 0);

  const loading = res.loading && !res.data;
  const failed = !!res.error && !res.data;

  // Tablet split (prototype): the first provider opens beside the list.
  const first = list[0]?.id;
  useEffect(() => {
    if (!embedded && layout.canSplitDetail && !openId && first) navigate(`/m/logistics/${encodeURIComponent(first)}`, { replace: true });
  }, [embedded, layout.canSplitDetail, openId, first, navigate]);

  const open = (p: Provider) => navigate(`/m/logistics/${encodeURIComponent(p.id)}`);
  const goDeliveries = () => (onDeliveries ? onDeliveries() : navigate("/m/delivery"));
  const clearFilters = () => {
    setQ("");
    setChip("all");
    setUnpriced(false);
    setPage(PAGE);
  };

  const askDelete = (p: Provider) =>
    setDlg({
      busy: false,
      err: "",
      spec: {
        title: `Delete ${p.name}?`,
        body: "The provider, its rate card, vehicles and drivers are removed. Past deliveries keep their details.",
        okL: "Delete",
        danger: true,
        icon: Trash2,
        onOk: async () => {
          setDlg((d) => (d ? { ...d, busy: true, err: "" } : d));
          const r = await send(providerUrl(p.id), "DELETE");
          if (!r.ok) {
            setDlg((d) => (d ? { ...d, busy: false, err: r.error } : d));
            return;
          }
          setDlg(null);
          invalidate3pl();
          toast.show("Provider deleted");
          if (openId === p.id) navigate("/m/logistics", { replace: true });
        },
      },
    });

  const ctx = {
    perms,
    toast: toast.show,
    push: (f: Frame) => setFrames((s) => [...s, f]),
    pop: () => setFrames((s) => s.slice(0, -1)),
    onCreated: (id: string) => navigate(`/m/logistics/${encodeURIComponent(id)}`),
  };

  return (
    <>
      <TplStyles />
      <MobileHeader
        title="Delivery"
        onBack={() => navigate(-1)}
        menu
        trailing={perms.provCreate ? (
          <button type="button" aria-label="New provider" onClick={() => ctx.push({ kind: "prov", provider: null })} style={PLUS_BTN}>
            <Plus size={20} strokeWidth={2.2} />
          </button>
        ) : null}
      />
      <div style={SEGMENT_WRAP}>
        <SectionSwitch value="3pl" onChange={(k) => (k === "deliveries" ? goDeliveries() : undefined)} />
      </div>

      {!failed && (all.length > 0 || loading) ? (
        <>
          <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
            <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: X.card, borderRadius: 14, boxShadow: SH_CONTROL }}>
              <Search size={18} strokeWidth={1.75} color={X.ph} style={{ flex: "none" }} aria-hidden />
              <input
                className="tpl-in"
                type="text"
                inputMode="search"
                enterKeyHint="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(PAGE);
                }}
                placeholder="Search name, contact or phone"
                aria-label="Search providers"
                style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: X.ink, padding: 0, textOverflow: "ellipsis" }}
              />
              {q ? (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 36, height: 36, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.mut, flex: "none" }}>
                  <XIcon size={15} strokeWidth={2.2} />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => setDraft({ sort, unpriced })}
              aria-label={fN ? `Sort and filter, ${fN} on` : "Sort and filter"}
              style={{ position: "relative", width: 44, height: 44, flex: "none", borderRadius: "50%", border: "none", background: X.card, color: X.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: SH_CONTROL }}
            >
              <ArrowDownUp size={17} strokeWidth={1.9} />
              {fN ? (
                <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: X.grad, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{fN}</span>
              ) : null}
            </button>
          </div>
          <div className="tpl-scroll" role="group" aria-label="Provider status" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 4px", scrollbarWidth: "none" }}>
            {CHIPS.map((c) => {
              const on = chip === c.k;
              return (
                <button key={c.k} type="button" aria-pressed={on} onClick={() => { setChip(c.k); setPage(PAGE); }} style={CHIP_BTN(on)}>
                  {c.k !== "all" ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: ST[c.k].c }} /> : null}
                  {c.l}
                  {!loading ? <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>{count(c.k)}</span> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {loading ? (
        <div aria-busy="true" aria-label="Loading providers" style={{ padding: "12px 16px" }}>
          <ResponsiveGrid maxColumns={gridMaxColumns} gap={8}>
            {[1, 2, 3, 4].map((k) => <div key={k} className="tpl-anim" style={{ height: 112, borderRadius: 16, background: X.card, animation: "tpl-pulse 1.2s ease-in-out infinite" }} />)}
          </ResponsiveGrid>
        </div>
      ) : failed ? (
        <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load providers" sub={res.error || "The delivery service didn't answer."} btn="Try again" onTap={() => res.refresh()} />
      ) : !all.length ? (
        <StateCard
          icon={Truck}
          title="No 3PL providers yet"
          sub={perms.provCreate ? "Add the transport companies you use for deliveries." : "No providers have been added."}
          btn={perms.provCreate ? "New provider" : undefined}
          onTap={() => ctx.push({ kind: "prov", provider: null })}
        />
      ) : !list.length ? (
        <StateCard icon={SearchX} title="No providers match" sub="Try another name, chip or filter." btn="Clear filters" onTap={clearFilters} />
      ) : (
        <>
          <SectionLabel>{`${list.length} PROVIDER${list.length === 1 ? "" : "S"}`}</SectionLabel>
          <div style={{ padding: "0 16px" }}>
            <ResponsiveGrid maxColumns={gridMaxColumns} gap={8}>
              {shown.map((p) => (
                <ProviderCard
                  key={p.id}
                  p={p}
                  current={inPane && p.id === openId}
                  onOpen={() => open(p)}
                  onEdit={perms.provUpdate ? () => ctx.push({ kind: "prov", provider: p }) : undefined}
                  onDelete={perms.provDelete ? () => askDelete(p) : undefined}
                />
              ))}
            </ResponsiveGrid>
          </div>
          {list.length > shown.length ? (
            <div style={{ padding: "10px 16px 0" }}>
              <button type="button" onClick={() => setPage(shown.length + PAGE)} style={{ width: "100%", height: 44, borderRadius: 999, border: "none", background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 6px 14px -8px ${X.shd}`, color: X.pri, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Show more · {list.length - shown.length} left
              </button>
            </div>
          ) : null}
        </>
      )}
      <div style={{ height: 24 }} />

      <TplSheet
        open={!!draft}
        title="Sort and filter"
        onClose={() => setDraft(null)}
        groups={draft ? [
          { t: "Sort by", rows: SORTS.map((s) => ({ key: s.k, l: s.l, check: draft.sort === s.k, pressed: draft.sort === s.k, onTap: () => setDraft({ ...draft, sort: s.k }) })) },
          { t: "Show", rows: [{ key: "unpriced", l: "Unpriced only", s: "Providers with no state rates", check: draft.unpriced, pressed: draft.unpriced, onTap: () => setDraft({ ...draft, unpriced: !draft.unpriced }) }] },
        ] : []}
        foot={draft ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 8 }}>
            <button type="button" onClick={() => setDraft({ sort: "name", unpriced: false })} style={{ height: 48, borderRadius: 14, border: "none", background: X.card, color: X.sub, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: `0 0 0 1px ${X.ln}` }}>Reset</button>
            <button type="button" onClick={() => { setSort(draft.sort); setUnpriced(draft.unpriced); setPage(PAGE); setDraft(null); }} style={{ height: 48, borderRadius: 14, border: "none", background: X.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Show results</button>
          </div>
        ) : null}
      />
      <TplDialog
        spec={dlg?.spec ?? null}
        busy={dlg?.busy}
        err={dlg?.err}
        onCancel={() => setDlg(null)}
        onOk={() => void dlg?.spec.onOk()}
      />
      <FormStack frames={frames} ctx={ctx} />
      {toast.node}
    </>
  );
}

function ProviderCard({ p, current, onOpen, onEdit, onDelete }: { p: Provider; current: boolean; onOpen: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const s = ST[p.status];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${p.name}, ${s.l}`}
      aria-current={current ? "true" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        position: "relative", overflow: "hidden", background: X.card, color: X.ink, borderRadius: 16, padding: "13px 14px 12px 17px",
        boxShadow: current ? SH_CARD_ON : SH_CARD, opacity: p.status === "INACTIVE" ? 0.72 : 1, cursor: "pointer", WebkitTapHighlightColor: "transparent", minWidth: 0,
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: s.c }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name || "—"}</span>
        <StatusPill status={p.status} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", marginTop: 6, fontSize: 12.5, color: X.sub, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflowWrap: "anywhere" }}>
          <UserRound size={13} strokeWidth={2} color={X.gold} style={{ flex: "none" }} />
          {p.contactPerson || "No contact"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
          <Phone size={13} strokeWidth={2} color={X.gold} style={{ flex: "none" }} />
          {p.phone || "—"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${X.ln}` }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
          <MapPin size={13} strokeWidth={2} color={X.gold} style={{ flex: "none" }} />
          {p.ratedStates.length ? (
            p.ratedStates.map((c) => (
              <span key={c} style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 6, background: X.tint, boxShadow: `inset 0 0 0 1px ${X.ln}`, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: X.sub }}>{c}</span>
            ))
          ) : (
            <span style={{ fontSize: 12, color: X.mut }}>No states set</span>
          )}
        </div>
        <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, fontSize: 11.5, fontWeight: 600, color: X.sub, fontVariantNumeric: "tabular-nums" }}>
          <span title="Vehicles" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Truck size={14} strokeWidth={2} color={X.gold} />
            {plural(p.vehicleCount, "vehicle")}
          </span>
          <span title="Drivers" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IdCard size={14} strokeWidth={2} color={X.gold} />
            {plural(p.driverCount, "driver")}
          </span>
        </div>
      </div>
      {onEdit || onDelete ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, paddingTop: 9, borderTop: `1px solid ${X.ln}` }}>
          {onEdit ? (
            <button type="button" aria-label={`Edit ${p.name}`} onClick={(e) => { e.stopPropagation(); onEdit(); }} style={{ height: 36, padding: "0 13px", borderRadius: 999, border: "none", background: X.tint, color: X.br, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Pencil size={14} strokeWidth={2} />
              Edit
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" aria-label={`Delete ${p.name}`} onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: X.badb, color: X.bad, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Trash2 size={15} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
