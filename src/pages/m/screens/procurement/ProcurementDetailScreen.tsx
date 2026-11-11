// ===========================================================================
// ProcurementDetailScreen — L2 /m/procurement/:id, phone AND tablet.
// Same id-prefix dispatch the generic config used (modules.ts
// pickProcurementDetail): grn-… → Goods Receipt, pi-… → Purchase Invoice,
// anything else → Purchase Order. Every existing /m/procurement/:id link
// (Home, supplier detail, related documents) keeps working.
// ===========================================================================
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CloudOff } from "lucide-react";
import { MobileHeader } from "../../components";
import { M } from "../../theme";
import type { CachedFetchFailure } from "@/lib/cached-fetch";
import { SHADOW_BLOCK, T, pill } from "../delivery/ui-tokens";
import { DetailColumn, HeaderMore } from "./parts";
import { PoDetail } from "./PoDetail";
import { GrnDetail } from "./GrnDetail";
import { PiDetail } from "./PiDetail";

export function ProcurementDetailScreen() {
  const { id = "" } = useParams();
  // Keyed by id: in the tablet split view, opening another document must not
  // carry over the previous one's busy flag, sheets or in-flight follow-ups.
  if (id.startsWith("grn-")) return <GrnDetail key={id} id={id} />;
  if (id.startsWith("pi-")) return <PiDetail key={id} id={id} />;
  return <PoDetail key={id} id={id} />;
}

/** Header + the load / not-found / error states every detail shares. */
export function DetailFrame({
  noun,
  code,
  loading,
  failure,
  error,
  hasDoc,
  onRetry,
  onMore,
  children,
}: {
  noun: string;
  code: string;
  loading: boolean;
  failure: CachedFetchFailure | null | undefined;
  error: unknown;
  hasDoc: boolean;
  onRetry: () => void;
  onMore?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const header = (title: string, more: boolean) => (
    <MobileHeader title={title} onBack={() => navigate(-1)} trailing={more && onMore ? <HeaderMore label="More actions" onClick={onMore} /> : null} />
  );
  if (loading && !hasDoc) {
    return (
      <>
        {header(noun, false)}
        <DetailColumn>
          <div aria-busy="true" aria-label={`Loading ${noun.toLowerCase()}`}>
            {[90, 200, 150, 120].map((h, i) => (
              <div key={i} style={{ height: h, borderRadius: 20, background: M.card, boxShadow: SHADOW_BLOCK, marginTop: i ? 12 : 14, opacity: 0.7 }} />
            ))}
          </div>
        </DetailColumn>
      </>
    );
  }
  // Only a 404 licenses "not found" (BUG class C15): a timeout or 5xx is a load failure.
  if (!hasDoc && failure?.kind === "notFound") {
    return (
      <>
        {header(noun, false)}
        <div style={{ padding: "60px 18px", textAlign: "center", color: M.muted, ...T.body }}>{noun} not found.</div>
      </>
    );
  }
  if (!hasDoc) {
    const c = pill("danger");
    return (
      <>
        {header(noun, false)}
        <div role="alert" style={{ padding: "56px 24px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", background: c.bg }}>
            <CloudOff size={22} strokeWidth={1.9} color={c.fg} />
          </div>
          <div style={{ ...T.cardTitle, color: M.raisin, marginTop: 14 }}>{error ? `Couldn’t load this ${noun.toLowerCase()}` : `This ${noun.toLowerCase()} could not be shown.`}</div>
          <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>Check your connection and try again.</div>
          <button
            type="button"
            onClick={onRetry}
            style={{ marginTop: 16, height: 44, padding: "0 22px", borderRadius: 9999, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      {header(code, true)}
      {children}
    </>
  );
}
