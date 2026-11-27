// ===========================================================================
// AccountDetailScreen — /m/usermgmt/:id, one account (Final Batch 5, the
// prototype's account detail). Full page on phones; the right pane beside the
// list on tablets (no back arrow there). SUPER_ADMIN only — anyone else gets the
// Lock card and nothing is fetched.
//
//   account   GET /api/users/:id                   (publicUser; 404 "User not found")
//   access    GET /api/user-permissions/:id        (read-only summary: locked / customized / role)
//   dock      PUT /api/users/:id { isActive }      Disable / Enable — never on your own account.
//             The server is the authority on the self and last-Super-Admin guards;
//             its 400 text is shown as written.
// Not on mobile: change role, reset password, delete, edit profile, permission
// matrix, mailbox access, org chart.
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CircleX, CloudOff, Link2Off, Lock, Shield, ShieldCheck, SlidersHorizontal, UserCheck, UserRound, UserX } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader } from "../../components";
import { useContainerLayout } from "../../lib/responsive-layout";
import {
  accessUrl, disableErrorText, fmtDateTime, nameOf, roleChip, toAccess, toAccount, UNKNOWN_ACCOUNT, userUrl, type RawRow,
} from "../../lib/usermgmt-lib";
import { StateCard, TplDialog, TplStyles, type DialogSpec } from "../threepl/tpl-kit";
import { invalidateAccounts, send, useUserMgmtAccess } from "./um-api";
import { AccountBadges, ActionDock, Avatar, InfoRows, Note, SectionTitle, Skeleton } from "./um-kit";
import { SECTION, U } from "./um-style";
import { useUmToast } from "./um-toast";

type Dlg = { spec: DialogSpec; busy: boolean; err: string };
type One = { success?: boolean; data?: RawRow };

export function AccountDetailScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pane } = useContainerLayout();
  const inPane = pane === "detail";
  const access = useUserMgmtAccess();
  // Old mobile invite links (/m/usermgmt/invite-…) carried a secret in the path.
  // Never send it anywhere: no fetch for them at all.
  const legacyInvite = id.startsWith("invite-");
  const canRead = access.isSuperAdmin && !!id && !legacyInvite;

  const res = useCachedJson<One>(canRead ? userUrl(id) : null);
  const accRes = useCachedJson<One>(canRead ? accessUrl(id) : null);
  const a = useMemo(() => (res.data?.data ? toAccount(res.data.data) : null), [res.data]);
  const summary = useMemo(() => toAccess(accRes.data?.data), [accRes.data]);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  // The toast rises above the Disable / Enable bar whenever that bar shows.
  const toast = useUmToast(!!a && a.id !== access.myId);

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/m/usermgmt");
  };
  const header = (title: string) => <MobileHeader title={title} onBack={inPane ? undefined : back} />;

  if (access.loading) {
    return (
      <>
        <TplStyles />
        {header("Account")}
        <div aria-busy="true" style={{ padding: "12px 16px", display: "grid", gap: 12 }}>
          {[120, 110, 110].map((h, i) => <Skeleton key={i} h={h} r={20} />)}
        </div>
      </>
    );
  }
  if (!access.isSuperAdmin) {
    return (
      <>
        <TplStyles />
        {header("Account")}
        <StateCard icon={Lock} title="User Management is for Super Admins." sub="Ask a Super Admin if you need an account changed." />
      </>
    );
  }
  if (legacyInvite) {
    return (
      <>
        <TplStyles />
        {header("Invite")}
        <StateCard icon={Link2Off} title="This link is no longer used" sub="Invites open from Pending Invites in User Management." btn="Open User Management" onTap={() => navigate("/m/usermgmt", { replace: true })} />
      </>
    );
  }

  if (!a) {
    // "User not found" only when the server answered 404; a timeout / network
    // failure is an unknown outcome (tests/record-load-failure-class).
    const notFound = !res.loading && res.failure?.kind === "notFound";
    return (
      <>
        <TplStyles />
        {header("Account")}
        {notFound ? (
          <StateCard icon={UserRound} title="User not found" sub="This account may have been removed. Go back and refresh the list." btn={inPane ? undefined : "Back to accounts"} onTap={() => navigate("/m/usermgmt")} />
        ) : res.error && !res.loading ? (
          <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load this account" sub={res.error || "Check your connection and try again."} btn="Try again" onTap={() => res.refresh()} />
        ) : (
          <div aria-busy="true" aria-label="Loading account" style={{ padding: "12px 16px", display: "grid", gap: 12 }}>
            {[120, 110, 110].map((h, i) => <Skeleton key={i} h={h} r={20} />)}
          </div>
        )}
        {toast.node}
      </>
    );
  }

  const me = a.id === access.myId;
  const name = nameOf(a);

  const setActive = (next: boolean) => {
    const title = next ? `Enable ${name}?` : `Disable ${name}?`;
    const run = async () => {
      setDlg((d) => (d ? { ...d, busy: true, err: "" } : d));
      // isActive ONLY — no role, no profile fields.
      const r = await send(userUrl(a.id), "PUT", { isActive: next });
      if (!r.ok) {
        if (r.status === 0) {
          // Unknown outcome: the PUT may have landed. A retry of isActive is safe.
          setDlg((d) => (d ? { ...d, busy: false, err: UNKNOWN_ACCOUNT, spec: { ...d.spec, okL: "Try again" } } : d));
          return;
        }
        invalidateAccounts();
        setDlg({ busy: false, err: "", spec: { title, body: r.status === 400 ? disableErrorText(r.error) : r.error, okL: "OK", icon: CircleX, onOk: () => setDlg(null) } });
        return;
      }
      setDlg(null);
      invalidateAccounts();
      toast.show(next ? "Account enabled" : "Account disabled");
    };
    setDlg({
      busy: false,
      err: "",
      spec: next
        ? { title, body: `${name} can sign in again with their existing password. Their personal mailbox will reopen.`, okL: "Enable", icon: UserCheck, onOk: run }
        : { title, body: `${name} will be signed out everywhere and can't sign in until enabled. Their personal mailbox will be closed.`, okL: "Disable", danger: true, icon: UserX, onOk: run },
    });
  };

  const accessBlock = !accRes.data && !accRes.error ? (
    <Skeleton h={58} r={14} />
  ) : !summary ? (
    <div style={{ ...SECTION, padding: "14px", fontSize: 13, color: U.mut, textAlign: "center" }}>Access summary is unavailable right now. Try again later.</div>
  ) : summary.kind === "full" ? (
    <Note tone="ok" icon={ShieldCheck}>Full access (always).</Note>
  ) : summary.kind === "custom" ? (
    <Note tone="info" icon={SlidersHorizontal}>Custom access — This account has its own permission list. Edit it on desktop.</Note>
  ) : (
    <Note tone="neu" icon={Shield}>Follows the {roleChip(summary.role || a.role)} role.</Note>
  );

  return (
    <>
      <TplStyles />
      {header(name)}
      <div
        className="tpl-anim"
        style={{
          padding: `12px 16px ${me ? 32 : 110}px`, display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gap: 12, color: U.ink,
          animation: inPane ? "none" : "tpl-page .2s ease-out", maxWidth: inPane ? 760 : undefined,
        }}
      >
        <section style={{ ...SECTION, padding: 16, display: "flex", gap: 14, alignItems: "center" }}>
          <Avatar seed={name} size={58} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: "anywhere" }}>{name}</div>
            {a.displayName ? <div style={{ fontSize: 13, color: U.mut, marginTop: 2, overflowWrap: "anywhere" }}>{a.email}</div> : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
              <AccountBadges a={a} me={me} />
            </div>
          </div>
        </section>

        <SectionTitle>PROFILE</SectionTitle>
        <InfoRows rows={[{ k: "Department", v: a.department }, { k: "Position", v: a.position }]} />

        <SectionTitle>SIGN-IN</SectionTitle>
        <InfoRows
          rows={[
            { k: "Last login", v: a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : "Never signed in", warn: !a.lastLoginAt },
            { k: "Created", v: fmtDateTime(a.createdAt) },
          ]}
        />

        <SectionTitle>ACCESS SUMMARY</SectionTitle>
        {accessBlock}

        {me ? <Note tone="neu" icon={Lock}>You can't disable your own account.</Note> : null}
      </div>

      {!me ? (
        a.isActive ? (
          <ActionDock l="Disable account" icon={UserX} danger onTap={() => setActive(false)} />
        ) : (
          <ActionDock l="Enable account" icon={UserCheck} danger={false} onTap={() => setActive(true)} />
        )
      ) : null}

      <TplDialog spec={dlg?.spec ?? null} busy={dlg?.busy} err={dlg?.err} onCancel={() => setDlg(null)} onOk={() => void dlg?.spec.onOk()} />
      {toast.node}
    </>
  );
}
