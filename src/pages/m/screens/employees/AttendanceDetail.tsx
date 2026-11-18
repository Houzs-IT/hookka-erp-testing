// AttendanceDetail — the read-only punch detail card for one worker on one date (HK-0125 Phase 2). Opens when a
// Attendance row (its name or the row) is tapped; the In / Out photo buttons on the row keep working on their own.
// Frame = the HTML's detail sheet: fields "Clock in / Clock out / Location …", a primary "View photos" button and the note
// "Attendance is read-only, as on desktop." The HTML's "Distance" is its sample text there; here it is worked out from the
// punch's real GPS with the same fence maths as the badge (`rowDistance`).
import DetailSheet from "./DetailSheet";
import { LOC_LABEL, rowDistance, rowLocation } from "./attendance-location";
import type { AttRow } from "./attendance-model";
import { dayHeading } from "./employees-format";
import { TONE } from "./employees-styles";

const PILL = { factory: TONE.green, offsite: TONE.red, nogps: TONE.grey } as const;

export default function AttendanceDetail({
  row,
  onClose,
  onViewPhotos,
}: {
  row: AttRow | null;
  onClose: () => void;
  onViewPhotos: (which: "in" | "out") => void;
}) {
  const loc = row ? rowLocation(row) : "nogps";
  const hasIn = !!row?.hasClockInPhoto;
  const hasOut = !!row?.hasClockOutPhoto;
  return (
    <DetailSheet
      open={!!row}
      onClose={onClose}
      title={row?.employeeName || row?.employeeId || ""}
      sub={row ? dayHeading(row.date) : undefined}
      pill={row ? { label: LOC_LABEL[loc], bg: PILL[loc].bg, fg: PILL[loc].fg } : undefined}
      fields={
        row
          ? [
              ["Clock in", row.clockIn ?? "—"],
              ["Clock out", row.clockOut ?? "—"],
              ["Location", LOC_LABEL[loc]],
              ["Distance", rowDistance(row)],
              ["Photos", hasIn && hasOut ? "In · Out (tap to view)" : hasIn ? "In only" : hasOut ? "Out only" : "None"],
            ]
          : []
      }
      acts={hasIn || hasOut ? [{ label: "View photos", onTap: () => onViewPhotos(hasIn ? "in" : "out") }] : []}
      note="Attendance is read-only, as on desktop."
    />
  );
}
