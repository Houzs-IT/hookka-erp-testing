// IT Support v3 — icons per urgency / file kind / event (the prototype's).
import {
  Ban, ChevronDown, ChevronUp, ChevronsUp, CircleCheck, FileArchive, FileText, Film, FlaskConical, Hourglass, Image as ImageIcon, Lock, Pause,
  Send, Siren, UserCheck, UserMinus, Wrench, type LucideIcon,
} from "lucide-react";
import type { FileKind } from "../comms-files";
import type { Priority, Status } from "./it-lib";

export const PRIORITY_ICON: Record<Priority, LucideIcon> = { urgent: Siren, high: ChevronsUp, medium: ChevronUp, low: ChevronDown };

export const FILE_ICON: Record<FileKind, LucideIcon> = { image: ImageIcon, video: Film, pdf: FileText, zip: FileArchive, file: FileText };

const STATUS_EVENT_ICON: Record<Status, LucideIcon> = {
  open: Send,
  in_progress: Wrench,
  on_hold: Pause,
  testing: FlaskConical,
  waiting_reporter: Hourglass,
  resolved: CircleCheck,
  closed: Lock,
  rejected: Ban,
};

/** Icon for a one-line timeline event. */
export function eventIcon(kind: string, to: string | null): LucideIcon {
  if (kind === "created") return Send;
  if (kind === "assign") return to ? UserCheck : UserMinus;
  if (kind === "status" && to && to in STATUS_EVENT_ICON) return STATUS_EVENT_ICON[to as Status];
  return Wrench;
}
