import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page header used by every route-level page.
 *
 * Replaces the recurring pattern:
 *   <div className="flex items-center justify-between">
 *     <div>
 *       <h1 className="text-2xl font-bold text-[#1F1D1B]">...</h1>
 *       <p className="text-sm text-[#6B7280]">...</p>
 *     </div>
 *     <Button>...</Button>
 *   </div>
 *
 * Keeps chrome consistent: heading weight, subtitle colour, spacing,
 * responsive wrap behaviour when action row is long.
 */
export interface PageHeaderProps {
  /** Page title — displayed as <h1>. Required. */
  title: string;
  /** Optional one-line description below the title. */
  subtitle?: React.ReactNode;
  /** Action area on the right (buttons, links, export controls). */
  actions?: React.ReactNode;
  /**
   * Optional breadcrumb-style path shown above the title
   * (e.g. ["Sales", "SO-001"]). Rendered small and muted.
   */
  breadcrumbs?: string[];
  /** Extra className appended to the outer wrapper. */
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        // flex-wrap, not a fixed row: between phone and desktop widths a
        // long action row used to stay on one line (sm:flex-nowrap) and
        // squeeze the title down to an ellipsis. Now the actions drop under
        // the title as soon as they do not fit beside it.
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3 max-md:gap-y-2",
        className,
      )}
    >
      <div className="min-w-0 flex-[1_1_16rem]">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className="mb-1 flex items-center gap-1.5 text-xs text-[#8A7F73]"
          >
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-[#C4BDB5]">/</span>}
                <span className={i === breadcrumbs.length - 1 ? "text-[#6B5C32]" : ""}>
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-bold text-[#1F1D1B] break-words max-[360px]:text-xl">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-[#6B7280]">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 max-md:w-full max-md:justify-start">
          {actions}
        </div>
      )}
    </div>
  );
}
