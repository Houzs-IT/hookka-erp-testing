// The reply box heartbeat (Houzs parity row 21): "I am writing a reply",
// every 20 s while the box has text. Server side: routes/mail-reply-guard.ts.
import { useEffect, useRef, useState } from "react";
import type { ReplyingPerson } from "./mail-reply-rules";

export type Beat = { replying: ReplyingPerson[]; latestMessageId: string | null };

/**
 * Tells the others "I am writing a reply" every 20 s while the box has text.
 * Each beat answers with who else is writing and the thread's newest message
 * id, so the page can pull in a colleague's reply while I type.
 */
export function useReplyingHeartbeat(threadId: string | null, drafting: boolean): Beat {
  const sent = useRef(false);
  const [beat, setBeat] = useState<Beat>({ replying: [], latestMessageId: null });
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const send = (on: boolean) => {
      sent.current = on;
      // Best effort: a missed beat only hides the "is writing" note for a moment.
      fetch(`/api/mail-center/threads/${encodeURIComponent(threadId)}/replying`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drafting: on }),
      })
        .then((res) => (res.ok ? (res.json() as Promise<Partial<Beat>>) : null))
        .then((b: Partial<Beat> | null) => {
          if (!alive || !b) return;
          setBeat({ replying: on ? (b.replying ?? []) : [], latestMessageId: b.latestMessageId ?? null });
        })
        .catch((e: unknown) => console.warn("[mail] replying heartbeat failed", e));
    };
    if (!drafting) {
      if (sent.current) send(false);
      return () => {
        alive = false;
      };
    }
    send(true);
    // eslint-disable-next-line no-restricted-syntax -- the heartbeat IS a timer: one per open reply box, cleared on unmount / when the box empties
    const t = window.setInterval(() => send(true), 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [threadId, drafting]);
  return beat;
}
