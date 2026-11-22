import { Suspense, lazy } from "react";
import { MobileHeader } from "./components";
import { M } from "./theme";

// /m/meetings: the desktop Meetings page in its compact, full-height form.
const MeetingsPage = lazy(() => import("@/pages/meetings").then((m) => ({ default: m.Meetings })));

export default function MeetingsRoute() {
  return (
    <>
      <MobileHeader title="Meetings" menu />
      <div className="bg-[#FAF8F4]" style={{ height: "calc(100dvh - 56px)" }}>
        <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
          <MeetingsPage erpName="Hookka ERP" embedded />
        </Suspense>
      </div>
    </>
  );
}
