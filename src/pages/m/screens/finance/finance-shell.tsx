// ---------------------------------------------------------------------------
// Shared pieces of the phone's Finance screens (finance v2 mobile): the header
// that backs out to the Finance menu, the "No access" state, a section label,
// and the loading / error / empty notes. Inline
// styles from the /m theme, like the rest of the phone app.
// ---------------------------------------------------------------------------
import { type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
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

/** The period stepper under the header: ‹ label / note › with 44px targets. */
export function FinanceStepper({
  label,
  note,
  onPrev,
  onNext,
}: {
  label: string;
  note?: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const btn = (enabled: boolean): CSSProperties => ({
    width: 44,
    height: 44,
    borderRadius: 12,
    border: `1px solid ${M.border}`,
    background: M.card,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: enabled ? M.raisin : M.faint,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.5,
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" aria-label="Previous" disabled={!onPrev} onClick={onPrev} style={btn(!!onPrev)}>
        <ChevronLeft size={18} />
      </button>
      <div style={{ flex: 1, minHeight: 44, borderRadius: 12, border: `1px solid ${M.border}`, background: M.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4px 8px" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>{label}</span>
        {note && <span style={{ fontSize: 11, color: M.muted }}>{note}</span>}
      </div>
      <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext} style={btn(!!onNext)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

/** A joined switch (Overall / Sofa / Bedframe, 3 / 6 / 12 months). */
export function FinanceSwitch<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", border: `1px solid ${M.border}`, borderRadius: 12, overflow: "hidden", background: M.card }}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            style={{ flex: 1, minHeight: 44, border: "none", borderLeft: i ? `1px solid ${M.border}` : "none", background: on ? "#1F1D1B" : "transparent", color: on ? "#FFFFFF" : M.raisin, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
