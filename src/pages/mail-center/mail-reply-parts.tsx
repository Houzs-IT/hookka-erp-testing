// Reply box pieces kept out of detail.tsx (Houzs parity rows 20 + 21; the
// Houzs original is pages/MailCenter/mail-reply-parts.tsx): who else is
// writing a reply right now, a reply someone sent while you were typing, and
// the Delivered / Bounced chip on an outbound message. Rules:
// mail-reply-rules.ts; heartbeat: use-replying-heartbeat.ts.
import { AlertTriangle, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { deliveryLabel, deliveryTone, type DeliveryStatus } from "./mail-delivery";
import { agoLabel, joinNames, type AlreadyReplied, type ReplyingPerson } from "./mail-reply-rules";

export function ReplyingNowBanner({ people }: { people: ReplyingPerson[] }) {
  if (people.length === 0) return null;
  const names = people.map((p) => p.name);
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>{joinNames(names)}</b> {names.length === 1 ? "is" : "are"} writing a reply to this conversation now. Check
        with them before you reply too.
      </span>
    </div>
  );
}

export function AlreadyRepliedBox({
  hit,
  now,
  busy,
  onSendAnyway,
  onDiscard,
}: {
  hit: AlreadyReplied;
  now: number;
  busy: boolean;
  onSendAnyway: () => void;
  onDiscard: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-md border border-red-300 bg-red-50 px-3 py-2.5">
      <p className="flex items-start gap-2 text-[12.5px] text-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        <span>
          <b>{hit.by}</b> replied {agoLabel(hit.at, now)}, while you were writing. Their reply is shown above.{" "}
          <b>Yours has not been sent.</b>
        </span>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className="rounded-md border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-foreground/80 hover:text-foreground disabled:opacity-50"
        >
          Discard mine
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSendAnyway}
          className="rounded-md bg-[#6B5C32] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#5a4d2a] disabled:opacity-50"
        >
          Send mine too
        </button>
      </div>
    </div>
  );
}

/** Queued / Not delivered / Delivered / Bounced on an outbound message. */
export function DeliveryChip({ status }: { status: DeliveryStatus | undefined }) {
  const label = deliveryLabel(status);
  if (!label) return null;
  const tone = deliveryTone(status);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        tone === "good" && "bg-emerald-50 text-emerald-700",
        tone === "bad" && "bg-red-50 text-red-700",
        tone === "waiting" && "bg-amber-50 text-amber-800",
      )}
    >
      {label}
    </span>
  );
}
