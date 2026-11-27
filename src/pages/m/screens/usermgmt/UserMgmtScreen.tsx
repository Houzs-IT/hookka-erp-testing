// ===========================================================================
// UserMgmtScreen — /m/usermgmt (Final Batch 5, Claude Design "User Management").
// SUPER_ADMIN only, as desktop /settings/users. Anyone else gets the Lock card
// and nothing is fetched.
//
//   Members           GET /api/users (useCachedJson) → card → /m/usermgmt/:id
//                     (the account detail; the right pane on tablets)
//   Pending Invites   GET /api/users/invites (plain fetch, memory only) → card →
//                     bottom sheet (no route change): Resend / Revoke
//   +                 Invite user (invite-only, owner U-1)
//   ⋯                 Refresh
//   search · status chips · sort / role / department filters (client-side)
//
// Invitation tokens never reach a route, the DOM, a log or browser storage:
// the list holds Invite objects with no token, and the secret for a resend /
// revoke fetch comes from useInvites().secretOf(key) at the moment of the call.
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowDownUp, Ban, CircleX, CloudOff, Ellipsis, Lock, MailOpen, MailPlus, MailX, RefreshCw, Search, SearchX, Send, UserPlus, Users, X as XIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader, ResponsiveGrid } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import {
  baseMembers, departmentsOf, expiryText, fmtDateTime, isExpired, matchesInvite, MEMBER_SORTS, resendUrl, revokeUrl, roleChip,
  roleFilterCodes, rowsOf, statusCounts, toAccount, UNKNOWN_RESEND, UNKNOWN_REVOKE, USERS_URL, visibleMembers,
  type Invite, type MemberSort, type StatusChip,
} from "../../lib/usermgmt-lib";
import { StateCard, TplDialog, TplSheet, TplStyles, type DialogSpec } from "../threepl/tpl-kit";
import { CHIP_BTN, PLUS_BTN, ROUND_BTN, SEG_BTN, SH_CONTROL } from "../threepl/tpl-style";
import { InviteForm, type InviteOutcome } from "./InviteForm";
import { send, useInvites, useUserMgmtAccess } from "./um-api";
import { Badge, InfoRows, InviteCard, ListLabel, MemberCard, Skeleton } from "./um-kit";
import { U } from "./um-style";
import { useUmToast } from "./um-toast";

const PAGE = 8;
type Tab = "members" | "invites";
type Dlg = { spec: DialogSpec; busy: boolean; err: string };
const CHIPS: { k: StatusChip; l: string }[] = [
  { k: "all", l: "All" },
  { k: "active", l: "Active" },
  { k: "disabled", l: "Disabled" },
];

export function UserMgmtScreen() {
  const navigate = useNavigate();
  const { id: openId } = useParams();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const inPane = layout.canSplitDetail && !!openId;
  const access = useUserMgmtAccess();
  const allowed = access.isSuperAdmin;
  const toast = useUmToast();

  // Nothing is requested until the server says this is a Super Admin.
  const res = useCachedJson<{ success?: boolean; data?: unknown }>(allowed ? USERS_URL : null);
  const invites = useInvites(allowed);
  const accounts = useMemo(() => rowsOf(res.data?.data).map(toAccount), [res.data]);

  const [tab, setTab] = useState<Tab>("members");
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<StatusChip>("all");
  const [fRole, setFRole] = useState("all");
  const [fDept, setFDept] = useState("all");
  const [sort, setSort] = useState<MemberSort>("name");
  const [page, setPage] = useState(PAGE);
  const [sheet, setSheet] = useState<null | "more" | "sort">(null);
  const [inviteKey, setInviteKey] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [spin, setSpin] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const filter = { q, role: fRole, dept: fDept };
  const counts = statusCounts(baseMembers(accounts, filter));
  const members = visibleMembers(accounts, filter, chip, sort);
  const shown = members.slice(0, page);
  const invList = invites.list.filter((x) => (fRole === "all" || x.role === fRole) && matchesInvite(x, q));
  const notSent = invList.filter((x) => !x.emailSentAt).length;
  const depts = departmentsOf(accounts);
  const roleCodes = roleFilterCodes(tab === "members" ? accounts.map((a) => a.role) : invites.list.map((x) => x.role));
  const fN = (tab === "members" && sort !== "name" ? 1 : 0) + (fRole !== "all" ? 1 : 0) + (tab === "members" && fDept !== "all" ? 1 : 0);
  const openInvite = inviteKey ? invites.list.find((x) => x.key === inviteKey) ?? null : null;

  const usersLoading = res.loading && !res.data;
  const usersFailed = !!res.error && !res.data;
  const invLoading = !invites.loaded && !invites.error;
  const invFailed = !!invites.error && !invites.loaded;

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/m/more");
  };
  const switchTab = (t: Tab) => {
    setTab(t);
    setQ("");
    setFRole("all");
    setPage(PAGE);
    if (t === "invites" && openId) navigate("/m/usermgmt", { replace: true });
  };
  const clearFilters = () => {
    setQ("");
    setChip("all");
    setFRole("all");
    setFDept("all");
    setPage(PAGE);
  };
  const reloadInvites = async () => {
    await invites.reload();
    setNowMs(Date.now());
  };
  const refreshAll = async () => {
    setSheet(null);
    setSpin(true);
    res.refresh();
    await reloadInvites();
    setSpin(false);
    toast.show("Updated just now");
  };

  // ---- invite outcomes / actions ----
  const closeDlg = () => setDlg(null);
  const fatal = (title: string, body: string) =>
    setDlg({ busy: false, err: "", spec: { title, body, okL: "OK", icon: CircleX, onOk: closeDlg } });

  const onSent = (o: InviteOutcome) => {
    setFormOpen(false);
    switchTab("invites");
    void reloadInvites();
    if (o.emailSent) {
      toast.show("Invitation sent");
      return;
    }
    setDlg({
      busy: false,
      err: "",
      spec: {
        title: "Invitation created — email not sent",
        body: `We couldn't email ${o.email}. Resend it from Pending Invites.${o.emailError ? ` Reason: ${o.emailError.replace(/\.?$/, ".")}` : ""}`,
        okL: "Go to Pending Invites",
        icon: MailX,
        onOk: closeDlg,
      },
    });
  };

  const askResend = (key: string, email: string, expiresAt: string) => {
    const title = "Resend invitation?";
    const run = async () => {
      setDlg((d) => (d ? { ...d, busy: true, err: "" } : d));
      const secret = invites.secretOf(key);
      if (!secret) {
        fatal(title, "This invite is no longer in the list. Refresh and try again.");
        return;
      }
      const r = await send(resendUrl(secret), "POST");
      if (!r.ok) {
        if (r.status === 0) {
          setDlg((d) => (d ? { ...d, busy: false, err: UNKNOWN_RESEND, spec: { ...d.spec, okL: "Try again" } } : d));
          return;
        }
        // 404 / 409 (accepted) / 410 (expired) / 403: the server's words, then a fresh list.
        void reloadInvites();
        fatal(title, r.error);
        return;
      }
      void reloadInvites();
      if (r.data?.emailSent === true) {
        closeDlg();
        toast.show("Invitation email sent");
        return;
      }
      const why = typeof r.data?.emailError === "string" && r.data.emailError ? r.data.emailError : "the mail service didn't accept it.";
      setDlg((d) => (d ? { ...d, busy: false, err: `Email not sent: ${why}`, spec: { ...d.spec, okL: "Try again" } } : d));
    };
    setDlg({
      busy: false,
      err: "",
      spec: { title, body: `We'll email ${email} again. The link still expires on ${fmtDateTime(expiresAt)}.`, okL: "Resend", icon: Send, onOk: run },
    });
  };

  const askRevoke = (key: string, email: string) => {
    const title = "Revoke invitation?";
    const run = async () => {
      setDlg((d) => (d ? { ...d, busy: true, err: "" } : d));
      const secret = invites.secretOf(key);
      if (!secret) {
        fatal(title, "This invite is no longer in the list. Refresh and try again.");
        return;
      }
      const r = await send(revokeUrl(secret), "DELETE");
      if (!r.ok) {
        if (r.status === 0) {
          setDlg((d) => (d ? { ...d, busy: false, err: UNKNOWN_REVOKE, spec: { ...d.spec, okL: "Try again" } } : d));
          return;
        }
        void reloadInvites();
        fatal(title, r.error);
        return;
      }
      closeDlg();
      setInviteKey(null);
      await reloadInvites();
      toast.show("Invitation revoked");
    };
    setDlg({
      busy: false,
      err: "",
      spec: { title, body: `The invitation link sent to ${email} will stop working.`, okL: "Revoke", danger: true, icon: Ban, onOk: run },
    });
  };

  // ---- header ----
  const header = (
    <MobileHeader
      title="User Management"
      onBack={back}
      trailing={allowed ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" aria-label="Options" onClick={() => setSheet("more")} style={ROUND_BTN}>
            {spin ? (
              <RefreshCw size={18} strokeWidth={2} className="tpl-anim" style={{ animation: "tpl-spin .8s linear infinite" }} />
            ) : (
              <Ellipsis size={19} strokeWidth={2} />
            )}
          </button>
          <button type="button" aria-label="Invite user" onClick={() => setFormOpen(true)} style={PLUS_BTN}>
            <UserPlus size={19} strokeWidth={2.1} />
          </button>
        </div>
      ) : null}
    />
  );

  if (access.loading) {
    return (
      <>
        <TplStyles />
        {header}
        <div aria-busy="true" aria-label="Loading" style={{ padding: "16px", display: "grid", gap: 8 }}>
          <Skeleton h={34} r={12} />
          {[1, 2, 3].map((k) => <Skeleton key={k} h={112} />)}
        </div>
      </>
    );
  }
  if (!allowed) {
    return (
      <>
        <TplStyles />
        {header}
        <StateCard icon={Lock} title="User Management is for Super Admins." sub="Ask a Super Admin if you need an account changed." />
      </>
    );
  }

  const subtitle = usersLoading || usersFailed ? "" : `${accounts.length} account${accounts.length === 1 ? "" : "s"}`;
  const showSearch = tab === "members" ? !usersLoading && !usersFailed && accounts.length > 0 : !invLoading && !invFailed && invites.list.length > 0;
  const gridMax = tablet && !inPane ? 2 : 1;

  return (
    <>
      <TplStyles />
      {header}
      <div style={{ color: U.ink }}>
        {subtitle ? <div style={{ padding: "8px 20px 0", fontSize: 12.5, color: U.mut }}>{subtitle}</div> : null}

        <div style={{ padding: "8px 16px 0" }}>
          <div role="tablist" aria-label="User Management sections" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, height: 46, boxSizing: "border-box", padding: 4, borderRadius: 14, background: U.chip }}>
            {([["members", "Members", Users], ["invites", "Pending Invites", MailPlus]] as const).map(([k, l, Icon]) => {
              const on = tab === k;
              const n = k === "invites" && invites.loaded && invites.list.length ? String(invites.list.length) : "";
              return (
                <button key={k} type="button" role="tab" aria-selected={on} onClick={() => switchTab(k)} style={SEG_BTN(on)}>
                  <Icon size={15} strokeWidth={2} aria-hidden />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l}</span>
                  {n ? <span style={{ minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: U.warnb, color: U.warn, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        {showSearch ? (
          <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
            <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: U.card, borderRadius: 14, boxShadow: SH_CONTROL }}>
              <Search size={18} strokeWidth={1.75} color={U.ph} style={{ flex: "none" }} aria-hidden />
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
                placeholder={tab === "members" ? "Name, email, role, department" : "Email, name or role"}
                aria-label={tab === "members" ? "Search accounts" : "Search invites"}
                style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: U.ink, padding: 0, textOverflow: "ellipsis" }}
              />
              {q ? (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 36, height: 36, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: U.mut, flex: "none" }}>
                  <XIcon size={15} strokeWidth={2.2} />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => setSheet("sort")}
              aria-label={fN ? `Sort and filter, ${fN} on` : "Sort and filter"}
              style={{ position: "relative", width: 44, height: 44, flex: "none", borderRadius: "50%", border: "none", background: U.card, color: U.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: SH_CONTROL }}
            >
              <ArrowDownUp size={17} strokeWidth={1.9} />
              {fN ? (
                <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: U.grad, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{fN}</span>
              ) : null}
            </button>
          </div>
        ) : null}

        {tab === "members" ? (
          usersLoading ? (
            <div aria-busy="true" aria-label="Loading accounts" style={{ padding: "12px 16px", display: "grid", gap: 8 }}>
              <Skeleton h={34} r={12} />
              <ResponsiveGrid maxColumns={gridMax} gap={8}>{[1, 2, 3].map((k) => <Skeleton key={k} h={112} />)}</ResponsiveGrid>
            </div>
          ) : usersFailed ? (
            <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load accounts" sub={res.error || "Check your connection and try again."} btn="Retry" onTap={() => res.refresh()} />
          ) : !accounts.length ? (
            <StateCard icon={Users} title="No users yet" sub="Invite people to give them an ERP login." btn="Invite user" onTap={() => setFormOpen(true)} />
          ) : (
            <>
              <div className="tpl-scroll" role="group" aria-label="Account status" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 2px", scrollbarWidth: "none" }}>
                {CHIPS.map((c) => {
                  const on = chip === c.k;
                  return (
                    <button key={c.k} type="button" aria-pressed={on} onClick={() => { setChip(c.k); setPage(PAGE); }} style={CHIP_BTN(on)}>
                      {c.l}
                      <span style={{ minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: on ? "rgba(255,255,255,.24)" : U.chip, color: on ? "#FFFFFF" : U.sub, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>
                        {counts[c.k]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!members.length ? (
                <StateCard icon={SearchX} title="No accounts match your search" sub="Try another name, email, role or filter." btn="Clear filters" onTap={clearFilters} />
              ) : (
                <>
                  <ListLabel t={`${members.length} ACCOUNT${members.length === 1 ? "" : "S"}`} r={MEMBER_SORTS.find((s) => s.k === sort)?.l} />
                  <div style={{ padding: "0 16px" }}>
                    <ResponsiveGrid maxColumns={gridMax} gap={8}>
                      {shown.map((a) => (
                        <MemberCard key={a.id} a={a} me={a.id === access.myId} current={inPane && a.id === openId} onOpen={() => navigate(`/m/usermgmt/${encodeURIComponent(a.id)}`)} />
                      ))}
                    </ResponsiveGrid>
                  </div>
                  {members.length > shown.length ? (
                    <div style={{ padding: "10px 16px 0" }}>
                      <button type="button" onClick={() => setPage(shown.length + PAGE)} style={{ width: "100%", height: 44, borderRadius: 999, border: "none", background: U.card, boxShadow: `0 0 0 1px ${U.ring},0 6px 14px -8px ${U.shd}`, color: U.pri, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                        Show more · {members.length - shown.length} left
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )
        ) : invLoading ? (
          <div aria-busy="true" aria-label="Loading invites" style={{ padding: "12px 16px", display: "grid", gap: 8 }}>
            <ResponsiveGrid maxColumns={gridMax} gap={8}>{[1, 2, 3].map((k) => <Skeleton key={k} h={112} />)}</ResponsiveGrid>
          </div>
        ) : invFailed ? (
          <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load invites" sub={invites.error || "Check your connection and try again."} btn="Retry" onTap={() => void reloadInvites()} />
        ) : !invites.list.length ? (
          <StateCard icon={MailOpen} title="No pending invites" sub="Invitations you send show here until they're accepted." btn="Invite user" onTap={() => setFormOpen(true)} />
        ) : !invList.length ? (
          <StateCard icon={SearchX} title="No invites match your search" sub="Try another email, name or role." btn="Clear filters" onTap={clearFilters} />
        ) : (
          <>
            <ListLabel t={`${invList.length} PENDING`} r={notSent ? `${notSent} email${notSent === 1 ? "" : "s"} not sent` : ""} rTone="warn" />
            <div style={{ padding: "0 16px" }}>
              <ResponsiveGrid maxColumns={gridMax} gap={8}>
                {invList.map((x) => <InviteCard key={x.key} x={x} nowMs={nowMs} onOpen={() => setInviteKey(x.key)} />)}
              </ResponsiveGrid>
            </div>
          </>
        )}
        <div style={{ height: 24 }} />
      </div>

      {/* ⋯ Options */}
      <TplSheet
        open={sheet === "more"}
        title="Options"
        onClose={() => setSheet(null)}
        groups={[{ rows: [{ key: "refresh", l: "Refresh", s: "Reload accounts and invites", icon: RefreshCw, onTap: () => void refreshAll() }] }]}
      />

      {/* Sort and filter */}
      <TplSheet
        open={sheet === "sort"}
        title={tab === "members" ? "Sort and filter" : "Filter invites"}
        onClose={() => setSheet(null)}
        groups={[
          ...(tab === "members"
            ? [{ t: "SORT BY", rows: MEMBER_SORTS.map((s) => ({ key: s.k, l: s.l, check: sort === s.k, pressed: sort === s.k, onTap: () => { setSort(s.k); setPage(PAGE); setSheet(null); } })) }]
            : []),
          {
            t: "ROLE",
            rows: [["all", "All roles"], ...roleCodes.map((c) => [c, roleChip(c)])].map(([k, l]) => ({
              key: k, l, check: fRole === k, pressed: fRole === k, onTap: () => { setFRole(k); setPage(PAGE); setSheet(null); },
            })),
          },
          ...(tab === "members"
            ? [{
                t: "DEPARTMENT",
                rows: [["all", "All departments"], ...depts.map((d) => [d, d])].map(([k, l]) => ({
                  key: `d-${k}`, l, check: fDept === k, pressed: fDept === k, onTap: () => { setFDept(k); setPage(PAGE); setSheet(null); },
                })),
              }]
            : []),
        ]}
      />

      {/* Invite detail — a sheet over the list, never a route. */}
      <TplSheet
        open={!!openInvite}
        title={openInvite?.email ?? ""}
        sub={openInvite ? openInvite.displayName || "No display name" : ""}
        onClose={() => setInviteKey(null)}
        groups={[]}
        foot={openInvite ? <InviteSheetBody x={openInvite} nowMs={nowMs} onResend={askResend} onRevoke={askRevoke} /> : null}
      />

      {formOpen ? <InviteForm accounts={accounts} invites={invites.list} onClose={() => setFormOpen(false)} onSent={onSent} /> : null}

      <TplDialog spec={dlg?.spec ?? null} busy={dlg?.busy} err={dlg?.err} onCancel={closeDlg} onOk={() => void dlg?.spec.onOk()} />
      {toast.node}
    </>
  );
}

function InviteSheetBody({ x, nowMs, onResend, onRevoke }: {
  x: Invite; nowMs: number;
  onResend: (key: string, email: string, expiresAt: string) => void; onRevoke: (key: string, email: string) => void;
}) {
  const expired = isExpired(x.expiresAt, nowMs);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Badge l={roleChip(x.role)} tone="brand" />
        <Badge l={expired ? "Expired" : "Pending"} tone={expired ? "neu" : "warn"} />
      </div>
      <InfoRows
        rows={[
          { k: "Email", v: x.email },
          { k: "Display name", v: x.displayName },
          { k: "Role", v: roleChip(x.role) },
          { k: "Invited by", v: x.inviterName },
          { k: "Sent", v: x.emailSentAt ? fmtDateTime(x.emailSentAt) : "Email not sent", warn: !x.emailSentAt },
          { k: "Expires", v: fmtDateTime(x.expiresAt) },
          { k: "Expiry", v: expiryText(x.expiresAt, nowMs) },
        ]}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
        <button
          type="button"
          disabled={expired}
          onClick={() => onResend(x.key, x.email, x.expiresAt)}
          style={{ height: 48, borderRadius: 14, border: "none", background: U.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: expired ? "default" : "pointer", opacity: expired ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
        >
          <Send size={16} strokeWidth={2.1} />
          Resend email
        </button>
        <button
          type="button"
          onClick={() => onRevoke(x.key, x.email)}
          style={{ height: 48, borderRadius: 14, border: "none", background: U.badb, color: U.bad, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
        >
          <Ban size={16} strokeWidth={2.1} />
          Revoke invite
        </button>
      </div>
      <div style={{ fontSize: 12, color: U.mut, textAlign: "center" }}>
        {expired ? "This invite has expired. Revoke it, then invite again." : "Resending doesn't change the expiry date."}
      </div>
    </div>
  );
}
