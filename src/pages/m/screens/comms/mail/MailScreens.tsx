// ---------------------------------------------------------------------------
// /m/mail-center — Mail Center v3 (Batch 2, approved Claude Design prototype
// "Mail Centre (standalone)", revised). Phone, tablet and foldable; light and dark.
//
// Routes and views (pages in the flow, no full-screen layers):
//   /m/mail-center                      the list (MailCenterScreen, CUSTOM_L1)
//     ?folder=<folder>                  open on a folder (e.g. autosent)
//     ?compose=1[&draft=<id>]           New email (or a draft saved on this device)
//     ?outbox=<id>                      one auto-sent email (beside the list on a tablet)
//     ?thread=<id>[&reply=…]            a conversation full width on a tablet set to "No split"
//   /m/mail-center/:id                  a conversation (MailThreadScreen, CUSTOM_L2;
//                                       the shell shows list | conversation on a tablet)
//     ?reply=reply|reply_all|forward    the reply / forward page
// ---------------------------------------------------------------------------
import { useParams, useSearchParams } from "react-router-dom";
import { useResponsiveLayout } from "../../../lib/responsive-layout";
import { CommsSplit } from "../comms-kit";
import { MailComposer, type ComposeMode, type MailPrefill } from "./MailComposer";
import { MailList } from "./MailList";
import { MailOutboxDetail } from "./MailOutbox";
import { MailThread } from "./MailThread";
import { useMailNav } from "./mail-ui";

export { MailComposer, type MailPrefill };

const REPLY_MODES: ComposeMode[] = ["reply", "reply_all", "forward"];

/** The conversation, or its reply / forward page when ?reply= is set. */
function ThreadOrReply({ id }: { id: string }) {
  const [params] = useSearchParams();
  const nav = useMailNav();
  const reply = params.get("reply") as ComposeMode | null;
  if (reply && REPLY_MODES.includes(reply)) {
    return (
      <MailComposer key={`${id}-${reply}`} mode={reply} threadId={id} onClose={nav.closeReply}
        onSent={(newId) => (reply === "forward" && newId && newId !== id ? nav.openThread(newId, true) : nav.closeReply())} />
    );
  }
  return <MailThread key={id} id={id} onBack={nav.toList} onReply={nav.reply} />;
}

export function MailCenterScreen() {
  const [params] = useSearchParams();
  const nav = useMailNav();
  const { id: routeId } = useParams<{ id: string }>();
  const layout = useResponsiveLayout();

  // Inside the shell's split view (route /:id) this is the left pane: only the list.
  if (routeId) return <MailList selectedId={routeId} />;

  if (params.get("compose") === "1") {
    const draft = params.get("draft") ?? undefined;
    return <MailComposer key={draft ?? "new"} mode="new" draftId={draft} onClose={nav.toList} onSent={(threadId) => (threadId ? nav.openThread(threadId, true) : nav.toList())} />;
  }
  const thread = params.get("thread");
  if (thread) return <ThreadOrReply id={thread} />;
  const outbox = params.get("outbox");
  if (outbox) {
    const detail = <MailOutboxDetail key={outbox} id={outbox} onBack={nav.toList} />;
    return layout.canSplitDetail ? <CommsSplit left={<MailList />} right={detail} /> : detail;
  }
  return <MailList />;
}

export function MailThreadScreen() {
  const { id = "" } = useParams<{ id: string }>();
  return <ThreadOrReply id={id} />;
}
