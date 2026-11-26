// ---------------------------------------------------------------------------
// Mail Center list view state (folder, mailbox, label, category, search,
// reading pane). Module-level so the list keeps its place while a
// conversation is open — on a phone the thread is its own route, on a tablet
// the list pane re-mounts beside it. Kept for this tab (sessionStorage);
// the reading-pane choice is kept on this device (localStorage).
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";
import type { MailCategory } from "@/pages/mail-center/mail-prefs";
import { isFolder, type Folder, type MailboxFilter } from "./mail-lib";

export type ListState = {
  folder: Folder | null; // null = the default (My inbox when I own a mailbox, else Inbox)
  mailbox: MailboxFilter;
  label: string | null;
  cat: MailCategory;
  q: string;
  outboxFilter: "" | "SENT" | "FAILED" | "PENDING";
};
const KEY = "hookka-m-mail-view:v1";
const PANE_KEY = "hookka-m-mail-pane:v1";
const DEFAULT: ListState = { folder: null, mailbox: { kind: "all" }, label: null, cat: "all", q: "", outboxFilter: "" };

function load(): ListState {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<ListState>;
    return {
      ...DEFAULT,
      folder: isFolder(p.folder) ? p.folder : null,
      mailbox: p.mailbox && (p.mailbox.kind === "all" || typeof (p.mailbox as { value?: unknown }).value === "string") ? p.mailbox : { kind: "all" },
      label: typeof p.label === "string" ? p.label : null,
      cat: p.cat === "primary" || p.cat === "notifications" ? p.cat : "all",
      q: typeof p.q === "string" ? p.q : "",
    };
  } catch {
    return { ...DEFAULT };
  }
}

let state: ListState = load();
const subs = new Set<() => void>();
export function setList(patch: Partial<ListState>) {
  state = { ...state, ...patch };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: keep it in memory */
  }
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export function useListState(): ListState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// Reading pane on a tablet: "split" = the shell's list | conversation side by
// side (default); "full" = the conversation opens full width (desktop's "No split").
export type Pane = "split" | "full";
let pane: Pane = (() => {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(PANE_KEY) === "full" ? "full" : "split";
  } catch {
    return "split";
  }
})();
const paneSubs = new Set<() => void>();
export function setPane(p: Pane) {
  pane = p;
  try {
    localStorage.setItem(PANE_KEY, p);
  } catch {
    /* ignore */
  }
  paneSubs.forEach((f) => f());
}
export function usePane(): Pane {
  return useSyncExternalStore((f) => { paneSubs.add(f); return () => { paneSubs.delete(f); }; }, () => pane, () => pane);
}

// A message to show on the next screen (e.g. "Email sent." after the composer
// hands over to the conversation it created).
let flash = "";
export function setFlash(msg: string) {
  flash = msg;
}
export function takeFlash(): string {
  const m = flash;
  flash = "";
  return m;
}
