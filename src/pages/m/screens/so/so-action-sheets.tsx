// The small sheets behind the Sales Order status actions (desktop: the Hold modal, the Override-lock
// modal and the two "blocked" lists). Reuses the Delivery screens' sheet pieces so they look like the
// rest of the phone app. The requests live in lib/use-so-actions.ts.
import { useState } from "react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { INPUT, sem } from "../delivery/ui-tokens";
import { FieldLabel, SheetFooter, SheetSub } from "../delivery/ui";
import type { SoInfo } from "../../lib/use-so-actions";

const area = { ...INPUT, height: 96, padding: "10px 13px", resize: "none" as const, lineHeight: 1.4 };

/** Put On Hold: a reason is REQUIRED (the server rejects a blank one). */
export function HoldSheet({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Put On Hold">
      <SheetSub>Production will be paused until the order is resumed. A reason is required and is recorded on the order.</SheetSub>
      <FieldLabel required>Reason</FieldLabel>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Hold reason" style={area} />
      <SheetFooter onCancel={onClose} onConfirm={() => onSubmit(reason)} confirmLabel="Put On Hold" busy={busy} disabled={reason.trim().length === 0} />
    </Sheet>
  );
}

/** Admin override of a production-window edit lock: a reason of at least 5 characters, then one edit token. */
export function OverrideSheet({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Override Edit Lock">
      <SheetSub>This order is inside its production window. An override is recorded in the audit trail with your reason.</SheetSub>
      <FieldLabel required>Reason (at least 5 characters)</FieldLabel>
      <textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} aria-label="Override reason" style={area} />
      {err ? <div role="alert" style={{ fontSize: 12.5, color: sem("danger"), marginTop: 8 }}>{err}</div> : null}
      <SheetFooter
        onCancel={onClose}
        onConfirm={async () => { setErr(await onSubmit(reason)); }}
        confirmLabel="Override and Edit"
        busy={busy}
        disabled={reason.trim().length < 5}
      />
    </Sheet>
  );
}

/** BOM incomplete (confirm) and completed-work-blocks-cancel: a read-only list with the way forward. */
export function InfoSheet({ info, onClose }: { info: SoInfo | null; onClose: () => void }) {
  return (
    <Sheet open={!!info} onClose={onClose} title={info?.title}>
      {info ? (
        <>
          <SheetSub>{info.intro}</SheetSub>
          <ul style={{ listStyle: "none", margin: 0, padding: "10px 12px", background: M.card, borderRadius: 12, maxHeight: 260, overflowY: "auto", fontSize: 13, lineHeight: 1.5, color: sem("danger") }}>
            {info.items.map((t, i) => <li key={i} style={{ padding: "3px 0", overflowWrap: "anywhere" }}>{t}</li>)}
          </ul>
          {info.foot ? <div style={{ fontSize: 12, color: M.ink, marginTop: 10, lineHeight: 1.45 }}>{info.foot}</div> : null}
          <SheetFooter onCancel={onClose} onConfirm={onClose} confirmLabel="OK" />
        </>
      ) : null}
    </Sheet>
  );
}
