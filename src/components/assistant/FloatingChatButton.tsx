// ---------------------------------------------------------------------------
// Edge-peek tab that opens the Hookka AI slide-over panel.
//
// Behaviour:
//   - Renders for any logged-in user (see gate note below).
//   - Docked flush to the right edge, vertically centred, as a slim 24px
//     tab so right-aligned table actions stay clickable. Hover / keyboard
//     focus widens it to show the full HK badge.
//   - z-30 keeps it under drawers and modals; the panel itself (z-50) covers
//     it while open, so closing is the panel's own X button or Escape.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { HookkaAILogo } from "./HookkaAILogo";
import { AssistantSlideOver } from "./AssistantSlideOver";

export function FloatingChatButton() {
  const user = getCurrentUser();
  const [open, setOpen] = useState(false);

  // Open to any logged-in staff (owner 2026-07-28 "开放命令/教 agent 给全部员工").
  // Non-super-admins get a restricted chat — only the agent command/teach tools;
  // data / SQL / financial tools stay owner-only, enforced server-side in
  // /api/assistant/chat (schema filter + dispatch guard). This UI gate only
  // hides the button from logged-out users.
  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close HK Assistant" : "Open HK Assistant"}
        aria-expanded={open}
        title="HK Assistant"
        className="group fixed right-0 top-1/2 -translate-y-1/2 z-30 flex w-6 items-center justify-center overflow-hidden rounded-l-xl border-y border-l border-zinc-200 bg-zinc-900/85 py-3 text-white shadow-md backdrop-blur-sm transition-all duration-200 ease-out hover:w-12 hover:bg-zinc-900 focus:outline-none focus-visible:w-12 focus-visible:ring-2 focus-visible:ring-[#6B5C32] dark:border-zinc-800"
      >
        <span className="flex flex-col items-center gap-1 group-hover:hidden group-focus-visible:hidden">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <HookkaAILogo variant="sparkle-only" size={12} />
        </span>
        <span className="hidden group-hover:block group-focus-visible:block">
          <HookkaAILogo size={28} />
        </span>
      </button>
      <AssistantSlideOver open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default FloatingChatButton;
