// useNewAnnouncementSheet — the + New announcement create sheet, shared by
// /m/announcements and the Announcements view of /m/updates (2026-10-13).
// `open()` shows it; render `sheet` once, OUTSIDE the sticky header (the sheet
// is position:fixed without a portal, so inside the header it would sit in the
// header's stacking context, under the bottom tab bar).
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FormSheet } from "../components";
import { newAnnouncementSpec } from "../config/forms";
import { type FormSpec } from "../config/form-types";

export function useNewAnnouncementSheet(): { open: () => void; sheet: ReactNode } {
  const navigate = useNavigate();
  const [createSpec, setCreateSpec] = useState<FormSpec | null>(null);
  return {
    open: () => setCreateSpec(newAnnouncementSpec()),
    sheet: (
      <FormSheet
        open={createSpec != null}
        onClose={() => setCreateSpec(null)}
        spec={createSpec}
        onSaved={(to) => {
          setCreateSpec(null);
          if (to) navigate(to);
        }}
      />
    ),
  };
}
