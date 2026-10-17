// ---------------------------------------------------------------------------
// Shared pieces of the phone's Finance screens (finance v2 mobile): the header
// that backs out to the Finance menu, the "No access" state, a section label,
// and the loading / error / empty notes. Inline
// styles from the /m theme, like the rest of the phone app.
// ---------------------------------------------------------------------------
import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { MobileHeader } from "../../components";
import { M } from "../../theme";

/** The header every Finance screen shares: back goes to the Finance menu. */
export function FinanceHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const navigate = useNavigate();
  return <MobileHeader title={title} onBack={() => navigate("/m/finance")} trailing={trailing} />;
}

/** A Finance screen the role may not open (the API would refuse it too). */
export function FinanceNoAccess({ title, note }: { title: string; note?: string }) {
  return (
    <>
      <FinanceHeader title={title} />
      <div style={{ padding: "64px 24px", textAlign: "center", color: M.muted, fontSize: 14 }}>
        <Lock size={28} style={{ margin: "0 auto 10px", display: "block", color: M.faint }} />
        {note ?? "No access — this needs the same permission as the desktop page."}
      </div>
    </>
  );
}

/** Small uppercase section label, as on the More screen. */
export function FinanceSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#A89F8D", margin: "14px 4px 9px" }}>
      {children}
    </div>
  );
}

/** Loading, a failed read, or nothing to show — said in words, never zeros. */
export function FinanceNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div style={{ padding: "40px 16px", textAlign: "center", fontSize: 14, color: tone === "error" ? "#9A3A2D" : M.muted }}>{children}</div>
  );
}
