// ===========================================================================
// Invite user — full-page form (prototype "Invite user"). Invite-only on
// mobile (owner U-1): there is no direct account creation and no password
// field anywhere in this module.
//
//   POST /api/users/invite  { email, role, displayName? }   (users:create + Super Admin)
//   → { emailSent, emailError? }. The response's token and inviteUrl are never
//   read: only emailSent / emailError leave this function.
// ===========================================================================
import { useRef, useState } from "react";
import { Info, ShieldAlert, Trash2 } from "lucide-react";
import { TplDialog, TplPage } from "../threepl/tpl-kit";
import {
  duplicateOf, INVITE_POST_URL, invitePayload, isFullAccessRole, roleChip, UNKNOWN_INVITE, validateInvite,
  type Account, type Invite, type InviteDraft,
} from "../../lib/usermgmt-lib";
import { send } from "./um-api";
import { InputField, Note, RoleChips } from "./um-kit";

export type InviteOutcome = { email: string; emailSent: boolean; emailError: string };

const EMPTY: InviteDraft = { email: "", displayName: "", role: "" };

export function InviteForm({ accounts, invites, onClose, onSent }: {
  accounts: Account[]; invites: Invite[]; onClose: () => void; onSent: (o: InviteOutcome) => void;
}) {
  const [v, setV] = useState<InviteDraft>(EMPTY);
  const [tried, setTried] = useState(false);
  const [dup, setDup] = useState<"user" | "invite" | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [discard, setDiscard] = useState(false);
  const inflight = useRef(false);

  const errs = validateInvite(v);
  const nErr = Object.keys(errs).length;
  const dirty = v.email !== "" || v.displayName !== "" || v.role !== "";
  const set = (o: Partial<InviteDraft>) => {
    setV((s) => ({ ...s, ...o }));
    setDup(null);
  };
  const emailErr =
    (tried && errs.email) ||
    (dup === "user" ? "An account with this email already exists." : dup === "invite" ? "There's already a pending invite for this email." : "");

  const cancel = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };

  const save = async () => {
    if (inflight.current) return;
    if (nErr) {
      setTried(true);
      return;
    }
    const d = duplicateOf(v.email, accounts, invites);
    if (d) {
      setDup(d);
      return;
    }
    inflight.current = true;
    setBusy(true);
    setFail("");
    const payload = invitePayload(v);
    const r = await send(INVITE_POST_URL, "POST", payload);
    inflight.current = false;
    setBusy(false);
    if (!r.ok) {
      // A 4xx reads the server's own words (409 duplicate, 403, 400). No answer at
      // all is an unknown outcome: the invite may exist.
      setFail(r.status === 0 ? UNKNOWN_INVITE : r.error);
      return;
    }
    const emailSent = r.data?.emailSent === true;
    const emailError = typeof r.data?.emailError === "string" ? r.data.emailError : "";
    onSent({ email: payload.email, emailSent, emailError });
  };

  const err = fail || (tried && nErr ? "Check the highlighted fields." : "");

  return (
    <>
      <TplPage
        title="Invite user"
        dirty={dirty}
        err={err}
        active={!discard}
        onCancel={cancel}
        saveL="Send invite"
        busy={busy}
        onSave={() => void save()}
      >
        <InputField l="Email *" type="email" v={v.email} on={(email) => set({ email })} ph="name@company.com" err={emailErr} />
        <InputField l="Display name" hint="Optional" v={v.displayName} on={(displayName) => set({ displayName })} ph="Optional" />
        <RoleChips v={v.role} on={(role) => set({ role })} err={tried ? errs.role : undefined} />
        {isFullAccessRole(v.role) ? (
          <Note tone="warn" icon={ShieldAlert}>{roleChip(v.role)} has full access to every module.</Note>
        ) : null}
        <Note tone="neu" icon={Info}>They'll get an invitation email with a link that's valid for 72 hours.</Note>
      </TplPage>
      <TplDialog
        spec={discard ? { title: "Discard this invite?", body: "What you've entered won't be saved.", okL: "Discard", danger: true, icon: Trash2, onOk: () => undefined } : null}
        onCancel={() => setDiscard(false)}
        onOk={() => {
          setDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
