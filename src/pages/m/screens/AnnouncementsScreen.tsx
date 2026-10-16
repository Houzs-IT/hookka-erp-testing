// ===========================================================================
// AnnouncementsScreen — L1 Announcements list.
//
// Owner 2026-07-02 (v20 `MobileAnnouncements.tsx`): a bespoke card — pin + a
// category eyebrow on top, an unread dot on the right, a 2-line body preview,
// and a date · author footer — NOT the generic code/badge card. Rebuilt to that
// look with REAL fields (category/title/body/createdAt/createdBy/isActive).
//
// Chips: All / Pinned. (v20 also has "Unread", but the list rows carry no
// per-user acknowledged flag, so that chip is omitted rather than faked.)
// Detail stays on the existing generic screen (already renders the body card +
// read-receipt roster).
//
// ADDITIVE: replaces ONLY the /m/announcements L1 view (CUSTOM_L1).
//
// 2026-10-13 (mobile Updates): the body is split out so /m/updates renders the
// SAME list under its Announcements view — `AnnouncementsList` (search, chips,
// cards), `NewAnnouncementButton`, and `useNewAnnouncementSheet` (the + create
// sheet, lib/use-new-announcement-sheet.tsx). This screen composes them exactly as before. Nothing here marks an
// announcement read or touches worker acknowledgements.
//
// 2026-10-16 (owner, Updates.dc.html):
//   • "Pinned" → "Live": there is no pinned field; the chip has always
//     filtered on `isActive`, so it now says what it does (phone + tablet).
//     On phone, "Live" also follows the desktop expiry rule
//     (lib/announcement-live.ts); tablet keeps its isActive-only chip.
//   • The author is no longer shown: `createdBy` is a raw user id, and no
//     name comes back from the API (phone + tablet; no new lookup added).
//   • Phone only: borderless shadow card with a "Live" pill, a chevron and a
//     calendar date strip; the Sales phone search box and shadow chips (each
//     in a 44px tap target); the round 42px gradient + button. Tablet keeps
//     its card, search, chips and + as before.
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronRight, Search, Plus, Pin } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader } from "../components";
import { M, M_ACCENT } from "../theme";
import { announcementsConfig } from "../config/modules";
import { str, dateOnly, shortDate } from "../config/helpers";
import { useDebounced } from "../lib/use-debounced";
import { useNewAnnouncementSheet } from "../lib/use-new-announcement-sheet";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { isLiveAnnouncement } from "../lib/announcement-live";

// Phone shadows — the same values as the phone Sales Orders / Products screens.
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 30px -14px rgba(31,29,27,.24)";
const SHADOW_CHIP = "0 1px 2px rgba(31,29,27,.06),0 3px 8px -4px rgba(31,29,27,.10)";
const SHADOW_CHIP_ON = "0 4px 12px -6px rgba(107,92,50,.45)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65),inset 0 1px 0 rgba(255,255,255,.18)";

const CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
];

export function AnnouncementsScreen() {
  const navigate = useNavigate();
  const create = useNewAnnouncementSheet();

  return (
    <>
      <MobileHeader
        title="Announcements"
        onBack={() => navigate(-1)}
        menu
        trailing={<NewAnnouncementButton onClick={create.open} />}
      />

      <AnnouncementsList />

      {create.sheet}
    </>
  );
}

export function NewAnnouncementButton({ onClick }: { onClick: () => void }) {
  const phone = useResponsiveLayout().mode === "phone";
  if (phone) {
    // The phone Sales + : a 42px gradient circle in a 44px tap target.
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="New announcement"
        style={{
          width: 44,
          height: 44,
          flex: "none",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            width: 42,
            height: 42,
            borderRadius: 999,
            background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
            color: M.paper,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: SHADOW_PRIMARY,
          }}
        >
          <Plus size={20} strokeWidth={2.2} />
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      aria-label="New announcement"
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        border: "none",
        backgroundColor: M.taupe,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Plus size={20} strokeWidth={2.2} />
    </button>
  );
}

/** Search + All/Live chips + announcement cards (tap → /m/announcements/:id). */
export function AnnouncementsList() {
  const navigate = useNavigate();
  const phone = useResponsiveLayout().mode === "phone";
  const source = announcementsConfig.sources[0];
  const { data, loading, error } = useCachedJson<unknown>(source.url);
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("all");

  const allRows = useMemo(() => (data ? source.select(data) : []), [data, source]);

  const dq = useDebounced(q);
  const rows = useMemo(() => {
    const n = dq.trim().toLowerCase();
    return allRows.filter((r) => {
      if (chip === "live" && (phone ? !isLiveAnnouncement(r) : r.isActive !== true)) return false;
      if (
        n &&
        !`${str(r, "title")} ${str(r, "body", "description", "content")} ${str(r, "category")}`
          .toLowerCase()
          .includes(n)
      )
        return false;
      return true;
    });
  }, [allRows, chip, dq, phone]);

  return (
    <>
      <div style={{ padding: phone ? "14px 18px 4px" : "12px 18px 4px" }}>
        <div
          style={
            phone
              ? {
                  // The phone Sales search box.
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  height: 44,
                  boxSizing: "border-box",
                  padding: "0 13px",
                  backgroundColor: M.card,
                  borderRadius: 14,
                  boxShadow: SHADOW_CONTROL,
                }
              : {
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "11px 13px",
                  backgroundColor: M.card,
                  border: `1px solid ${M.hairline}`,
                  borderRadius: 12,
                }
          }
        >
          <Search size={18} strokeWidth={1.75} color={M.faint} aria-hidden />
          <input
            value={q}
            placeholder="Search title · body"
            aria-label="Search announcements"
            onChange={(e) => setQ(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              // Phone: 16px, as iOS Safari zooms into any input under 16px.
              fontSize: phone ? 16 : 14,
              ...(phone ? { height: "100%", padding: 0, fontFamily: "inherit" } : null),
              color: M.raisin,
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: phone ? 0 : 7, padding: phone ? "3px 14.5px 0" : "10px 18px 4px" }}>
        {CHIPS.map((c) => {
          const on = chip === c.key;
          if (phone) {
            // Sales phone chip (borderless, soft shadow) in a 44px tap target.
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setChip(c.key)}
                style={{
                  height: 44,
                  padding: "0 3.5px",
                  border: "none",
                  background: "transparent",
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span
                  style={{
                    height: 30,
                    boxSizing: "border-box",
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 13px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: on ? M_ACCENT.gold.bg : M.card,
                    color: on ? M.taupe : M.muted,
                    boxShadow: on ? SHADOW_CHIP_ON : SHADOW_CHIP,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => setChip(c.key)}
              style={{
                height: 30,
                padding: "0 13px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${on ? M.taupe : M.hairline}`,
                background: on ? M_ACCENT.gold.bg : M.card,
                color: on ? M.taupe : M.muted,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <Msg text="Loading…" />
      ) : error && !data ? (
        <Msg text="Couldn’t load announcements." />
      ) : rows.length === 0 ? (
        <Msg text={q || chip !== "all" ? "No matching announcements." : "No announcements."} />
      ) : (
        <div style={{ padding: "8px 18px 120px" }}>
          {rows.map((r) => {
            const live = r.isActive === true;
            const liveNow = isLiveAnnouncement(r);
            const body = str(r, "body", "description", "content");
            const open = () => navigate(`/m/announcements/${encodeURIComponent(str(r, "id"))}`);
            if (phone) return <PhoneAnnouncementCard key={str(r, "id")} r={r} live={liveNow} body={body} onOpen={open} />;
            return (
              <div
                key={str(r, "id")}
                onClick={() => navigate(`/m/announcements/${encodeURIComponent(str(r, "id"))}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/m/announcements/${encodeURIComponent(str(r, "id"))}`);
                  }
                }}
                style={{
                  background: M.card,
                  border: `1px solid ${M.border}`,
                  borderRadius: 16,
                  padding: "13px 15px",
                  marginBottom: 11,
                  cursor: "pointer",
                  boxShadow: "0 1px 0 rgba(31,29,27,.03),0 6px 20px -12px rgba(31,29,27,.14)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {live ? <Pin size={13} color="#C9A961" fill="#C9A961" strokeWidth={1.5} /> : null}
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px", textTransform: "uppercase", color: M.taupe }}>
                      {str(r, "category") || "Notice"}
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 7, letterSpacing: "-0.2px" }}>
                  {str(r, "title") || "—"}
                </div>
                {body ? (
                  <div style={{ fontSize: 12.5, color: M.muted, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {body}
                  </div>
                ) : null}
                {/* Date only: `createdBy` is a raw user id, never shown. */}
                <div style={{ display: "flex", gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${M.divider}`, fontSize: 11, color: M.faint }}>
                  <span>{shortDate(dateOnly(r, "createdAt")) || "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Phone card (Updates.dc.html): borderless with the Sales card shadow; a
 *  "Live" pill (the desktop rule: shown and not expired — there is no
 *  pinned field) beside the category
 *  eyebrow, a chevron (it opens the detail), title, 2-line body, and a date
 *  strip. No author: `createdBy` is a raw user id. */
function PhoneAnnouncementCard({
  r,
  live,
  body,
  onOpen,
}: {
  r: Record<string, unknown>;
  live: boolean;
  body: string;
  onOpen: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        background: M.card,
        borderRadius: 16,
        padding: "14px 15px 13px",
        marginBottom: 11,
        cursor: "pointer",
        boxShadow: SHADOW_CARD,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {live ? (
            <span
              style={{
                flex: "none",
                height: 20,
                boxSizing: "border-box",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 7px",
                borderRadius: 999,
                backgroundColor: M_ACCENT.gold.bg,
                color: M.taupe,
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              Live
            </span>
          ) : null}
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".4px",
              textTransform: "uppercase",
              color: M.taupe,
            }}
          >
            {str(r, "category") || "Notice"}
          </span>
        </span>
        <ChevronRight size={16} strokeWidth={1.75} color={M.muted} aria-hidden style={{ flex: "none" }} />
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: M.raisin,
          marginTop: 8,
          letterSpacing: "-0.2px",
          lineHeight: 1.4,
          wordBreak: "break-word",
        }}
      >
        {str(r, "title") || "—"}
      </div>
      {body ? (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.45,
            color: M.body,
            marginTop: 4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {body}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginTop: 11,
          padding: "8px 10px",
          backgroundColor: M.paper,
          borderRadius: 10,
          fontSize: 11,
          color: M.body,
          whiteSpace: "nowrap",
        }}
      >
        <Calendar size={12} strokeWidth={1.9} color={M.taupe} aria-hidden style={{ flex: "none" }} />
        {shortDate(dateOnly(r, "createdAt")) || "—"}
      </div>
    </div>
  );
}

function Msg({ text }: { text: string }) {
  return <div style={{ padding: "40px 18px", textAlign: "center", color: M.muted, fontSize: 14 }}>{text}</div>;
}
