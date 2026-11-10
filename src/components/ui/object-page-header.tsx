// ---------------------------------------------------------------------------
// ObjectPageHeader — record detail page header (SAP Object Page pattern,
// Odoo "form view" header, Oracle Fusion record page).
//
// Shape:
//   ┌──────────────────────────────────────────────────────────┐
//   │ ←   <Title>   <Badges...>          <Actions...>          │
//   │     <Subtitle>                                           │
//   └──────────────────────────────────────────────────────────┘
//
// Adoption pattern:
//   <ObjectPageHeader
//     backTo="/sales"
//     title={order.companySOId}
//     subtitle={`${order.customerName} · ${order.customerState}`}
//     badges={<Badge variant="status" status={order.status} />}
//     actions={
//       <>
//         <Button onClick={pdf}>PDF</Button>
//         <Button onClick={edit}>Edit</Button>
//       </>
//     }
//   />
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { openerFor, openerIsPreviousEntry, openerLabel } from "@/lib/return-to";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ObjectPageHeader({
  backTo,
  onBack,
  title,
  subtitle,
  badges,
  actions,
  pager,
}: {
  /** URL the back arrow navigates to. Pass `onBack` instead for custom logic. */
  backTo?: string;
  /** Custom back handler. Wins over `backTo` if both are provided. */
  onBack?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Status chips, lock indicators, etc. — rendered next to the title. */
  badges?: ReactNode;
  /** Buttons — rendered on the right edge. */
  actions?: ReactNode;
  /** Optional <RecordPager /> rendered between subtitle and actions. */
  pager?: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const handleBack = onBack ?? (backTo ? () => navigate(backTo) : undefined);
  // Review H2-9: opened from another page (a report, a map, another document)?
  // Offer "Back to <that page>" — same spot — next to the usual list Back.
  // Pages with their own onBack keep it alone.
  const opener = onBack ? null : openerFor(`${location.pathname}${location.search}`, backTo);
  const backToOpener = opener
    ? () => {
        const idx = (window.history.state as { idx?: number } | null)?.idx;
        if (openerIsPreviousEntry(opener, typeof idx === "number" ? idx : null)) {
          navigate(-1); // POP: ScrollRestoration puts the page back where it was
          return;
        }
        navigate(opener.href);
        const y = opener.scrollY;
        if (y > 0) window.setTimeout(() => window.scrollTo(0, y), 300);
      }
    : undefined;

  return (
    // flex-wrap at every width: on a narrow desktop/tablet a long action row
    // used to squeeze the title to an ellipsis instead of wrapping under it.
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-md:gap-2">
      {backToOpener && opener ? (
        <Button variant="outline" size="sm" onClick={backToOpener} aria-label={openerLabel(opener)} title={openerLabel(opener)}>
          <ArrowLeft className="h-4 w-4" /> {openerLabel(opener)}
        </Button>
      ) : null}
      {handleBack && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label={opener ? "Back to the list" : "Back"}
          title={opener ? "Back to the list" : undefined}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-[#1F1D1B] doc-number truncate">{title}</h1>
          {badges}
        </div>
        {subtitle && (
          <p className="text-xs text-[#6B7280] mt-0.5">{subtitle}</p>
        )}
      </div>
      {pager && <div className="flex items-center max-md:order-last max-md:w-full">{pager}</div>}
      {actions && (
        <div className="flex max-w-full items-center gap-2 flex-wrap justify-end max-md:w-full max-md:justify-start">
          {actions}
        </div>
      )}
    </div>
  );
}
