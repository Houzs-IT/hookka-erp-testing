// ---------------------------------------------------------------------------
// FinancePageTitle — a finance page's title row (finance v2, owner 2026-10-16):
// the title at 22px/700, an (i) beside it that opens what the page is for (in
// place of a grey sub-line), and the page's buttons on the same line.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { useEscapeClose } from "@/lib/escape-stack";

export function FinancePageTitle({
  title,
  explain,
  icon,
  actions,
}: {
  title: string;
  explain?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  useEscapeClose(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h1 className="truncate text-[22px] font-bold leading-tight text-[#1F1D1B]">{title}</h1>
        {explain && (
          <span ref={boxRef} className="relative inline-flex">
            <button
              type="button"
              aria-label="About this page"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#9CA3AF] transition-colors hover:bg-[#F0ECE9] hover:text-[#6B5C32]"
            >
              <Info className="h-4 w-4" />
            </button>
            {open && (
              <span
                role="note"
                className="absolute left-0 top-7 z-40 w-72 rounded-[10px] border border-[#E2DDD8] bg-white px-3 py-2 text-[12.5px] font-normal leading-snug text-[#374151] shadow-[0_14px_34px_rgba(31,29,27,.18)]"
              >
                {explain}
              </span>
            )}
          </span>
        )}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
