// ---------------------------------------------------------------------------
// /m/announcements — Announcements v3 (Batch 2, approved Claude Design
// prototype "Announcements (standalone)", 2026-11-26). Phone, tablet and
// foldable; light and dark.
//
//   /m/announcements            the list (search, All / Live, category filter)
//   /m/announcements?new=1      the composer (AnnouncementComposer)
//   /m/announcements?posted=ID  "Announcement posted"
//   /m/announcements/:id        the detail (AnnouncementDetail, CUSTOM_L2; on
//                               a tablet the shell shows it beside this list)
//
// Data and rules are the ERP's (src/pages/announcements.tsx,
// src/api/routes/announcements.ts); nothing from the prototype's demo data.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Check, CloudOff, Megaphone, Paperclip, RotateCw, SearchX, Users } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import {
  BTN, C, CardGrid, Chip, Column, CommsHeader, CommsScreen, CommsSheet, CountLine, FilterButton, GhostButton, NUM, Pill, PrimaryButton,
  RoundPlus, SearchField, SheetFooter, Skeletons, StateCard, fmtDate, useToast,
} from "../comms-kit";
import { CATEGORY_LABEL, STATUS_LABEL, annStatus, countLabel, filterAnns, orderChip, readReceipts, recipientLabel, type Ann, type AnnCategory } from "./ann-lib";
import { CAT_UI, STATUS_UI, useAnnList, useAnnPerms, usePeople } from "./ann-ui";
import { AnnouncementComposer } from "./AnnouncementComposer";

export function AnnouncementsScreen() {
  const [params] = useSearchParams();
  if (params.get("new") === "1") return <AnnouncementComposer />;
  const posted = params.get("posted");
  if (posted) return <PostedPage id={posted} />;
  return <AnnouncementList />;
}

const CATS: AnnCategory[] = ["GENERAL", "WARNING", "SOP", "LEARNING"];

function AnnouncementList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { canCreate } = useAnnPerms();
  const { list, loading, error, refresh } = useAnnList();
  const { deptName } = usePeople();
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<"all" | "live">("all");
  const [cats, setCats] = useState<AnnCategory[]>([]);
  const [draft, setDraft] = useState<AnnCategory[] | null>(null);
  const [toast, showToast] = useToast();

  // A toast handed over by the detail page (e.g. after Delete).
  const handed = (location.state as { toast?: string } | null)?.toast;
  useEffect(() => {
    if (handed) {
      showToast(handed);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [handed, showToast, navigate, location.pathname, location.search]);

  const all = list ?? [];
  const liveN = useMemo(() => all.filter((a) => annStatus(a) === "live").length, [all]);
  const shown = useMemo(() => filterAnns(all, { q, chip, cats }), [all, q, chip, cats]);
  const filtering = !!q.trim() || chip !== "all" || cats.length > 0;
  const draftN = draft ? filterAnns(all, { q: "", chip, cats: draft }).length : 0;

  return (
    <CommsScreen>
      <CommsHeader title="Announcements" trailing={canCreate ? <RoundPlus label="New announcement" onClick={() => navigate("/m/announcements?new=1")} /> : null} />
      <Column>
        <div style={{ padding: "10px 18px 0" }}>
          <SearchField value={q} onChange={setQ} placeholder="Search title, message, category" label="Search announcements" />
        </div>
        <div className="c-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 4px" }}>
          <Chip on={chip === "all"} label="All" count={list ? all.length : undefined} onClick={() => setChip("all")} />
          <Chip on={chip === "live"} label="Live" count={list ? liveN : undefined} dot="var(--c-green)" onClick={() => setChip("live")} />
        </div>
        <CountLine
          label={list ? countLabel(shown.length, all.length, filtering) : "ANNOUNCEMENTS"}
          right={<FilterButton count={cats.length} onClick={() => setDraft(cats.slice())} />}
          style={{ padding: "10px 18px 6px 20px" }}
        />

        <div style={{ padding: "0 16px 32px" }}>
          {loading && !list ? (
            <Skeletons label="Loading announcements" h={128} />
          ) : !list && error ? (
            <StateCard
              icon={CloudOff}
              tone="red"
              role="alert"
              title="Couldn't load announcements"
              text="Check your connection and try again."
              action={<PrimaryButton height={44} icon={RotateCw} onClick={() => refresh()} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5 }}>Try again</PrimaryButton>}
            />
          ) : shown.length === 0 ? (
            <StateCard
              icon={all.length ? SearchX : Megaphone}
              text={all.length ? "No announcements match." : "No announcements yet."}
              action={q ? <GhostButton onClick={() => setQ("")} height={40}>Clear search</GhostButton> : cats.length ? <GhostButton onClick={() => setCats([])} height={40}>Clear filter</GhostButton> : null}
            />
          ) : (
            <CardGrid>
              {shown.map((a) => (
                <AnnCard key={a.id} a={a} to={recipientLabel(a, deptName)} onOpen={() => navigate(`/m/announcements/${encodeURIComponent(a.id)}`)} />
              ))}
            </CardGrid>
          )}
        </div>
      </Column>

      <CommsSheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title="Filter announcements"
        footer={draft ? <SheetFooter onReset={() => setDraft([])} onApply={() => { setCats(draft); setDraft(null); }} applyLabel={draftN === 1 ? "Show 1 announcement" : `Show ${draftN} announcements`} /> : null}
      >
        <div style={{ padding: "4px 16px 0" }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Category</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CATS.map((k) => {
              const on = !!draft?.includes(k);
              return (
                <Chip key={k} role="checkbox" on={on} label={CATEGORY_LABEL[k]} dot={CAT_UI[k].dot} onClick={() => setDraft((d) => (d ? (on ? d.filter((x) => x !== k) : [...d, k]) : d))} />
              );
            })}
          </div>
        </div>
      </CommsSheet>
      {toast}
    </CommsScreen>
  );
}

function AnnCard({ a, to, onOpen }: { a: Ann; to: string; onOpen: () => void }) {
  const st = annStatus(a);
  const cat = CAT_UI[a.category];
  const CatIcon = cat.icon;
  const order = orderChip(a);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${a.title}, ${STATUS_LABEL[st]}`}
      className="c-press"
      style={{ ...BTN, position: "relative", overflow: "hidden", width: "100%", textAlign: "left", background: C.card, color: C.ink, borderRadius: 18, padding: "13px 14px 12px 17px", boxShadow: "var(--c-sh-card)", opacity: st === "live" ? 1 : 0.82, display: "block" }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: cat.fg }} />
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Pill label={CATEGORY_LABEL[a.category]} fg={cat.fg} bg={cat.bg} icon={CatIcon} />
        {order ? <span style={{ minWidth: 0, overflow: "hidden" }}><Pill label={order} fg={C.gold} bg={C.cream} dot={false} /></span> : null}
        <span style={{ flex: 1 }} />
        <Pill label={STATUS_LABEL[st]} fg={STATUS_UI[st].fg} bg={STATUS_UI[st].bg} />
      </span>
      <span style={{ display: "block", marginTop: 8, fontSize: 15, fontWeight: 700, letterSpacing: "-.2px", lineHeight: 1.35, color: C.ink, wordBreak: "break-word" }}>{a.title || "—"}</span>
      {a.body ? (
        <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 3, fontSize: 12.5, lineHeight: 1.45, color: C.muted, wordBreak: "break-word" }}>{a.body}</span>
      ) : null}
      <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.track}`, fontSize: 11.5, color: C.muted, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          <Users size={12} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{to}</span>
        </span>
        {a.attachments.length ? (
          <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 3, ...NUM }}>
            <Paperclip size={12} strokeWidth={2} color="var(--c-gold-mid)" />
            {a.attachments.length}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <span style={{ flex: "none", whiteSpace: "nowrap" }}>{fmtDate(a.createdAt)}</span>
      </span>
      {a.createdByName ? <span style={{ display: "block", marginTop: 3, fontSize: 11.5, color: C.faint, textAlign: "right" }}>by {a.createdByName}</span> : null}
    </button>
  );
}

/** "Announcement posted" — the audience size comes from the acks endpoint. */
function PostedPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const acks = useCachedJson<unknown>(`/api/announcements/${encodeURIComponent(id)}/acks`, 30);
  const r = acks.data ? readReceipts(acks.data) : null;
  const sub = r
    ? `Sent to ${r.total} ${r.total === 1 ? "worker" : "workers"}. It shows in their app the next time they open it.`
    : "It shows in workers' app the next time they open it.";
  return (
    <CommsScreen>
      <Column max={480}>
        <div role="status" aria-label="Announcement posted" className="c-anim" style={{ minHeight: "calc(100dvh - 160px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 28px 60px", textAlign: "center", animation: "c-pop .22s ease-out", boxSizing: "border-box" }}>
          <span style={{ width: 72, height: 72, borderRadius: 24, background: C.gradOk, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 18px 30px -14px rgba(79,124,58,.7)" }}>
            <Check size={34} strokeWidth={2.6} color="#FFFFFF" />
          </span>
          <div style={{ marginTop: 18, fontSize: 20, fontWeight: 700, letterSpacing: "-.3px" }}>Announcement posted</div>
          <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5, color: C.body }}>{sub}</div>
          <PrimaryButton style={{ marginTop: 24 }} onClick={() => navigate(`/m/announcements/${encodeURIComponent(id)}?tab=pending`, { replace: true })}>View announcement</PrimaryButton>
          <button type="button" onClick={() => navigate("/m/announcements", { replace: true })} style={{ ...BTN, marginTop: 10, width: "100%", height: 46, borderRadius: 14, background: "transparent", color: C.gold, fontSize: 14, fontWeight: 700 }}>
            Back to announcements
          </button>
        </div>
      </Column>
    </CommsScreen>
  );
}
