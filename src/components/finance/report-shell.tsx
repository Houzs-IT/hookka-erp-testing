// ---------------------------------------------------------------------------
// report-shell.tsx — the v2 report frame (owner 2026-10-16; plan
// 2026-10-16-finance-v2-reports Task 2). One toolbar on the title row (period
// stepper, Edit Layout, DETAIL L1–Ln, one download icon), a check strip where
// the report balances, and the framed report with its centred head. The table
// inside is a plain <table data-fin-report> styled by finance-v2.css from
// data-row / data-cell, so each report keeps its own rows and engine.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { useEscapeClose } from "@/lib/escape-stack";
import { todayYmdMY } from "@/lib/utils";
import { periodKind, periodLabel, stepPeriod, type PeriodKind } from "@/lib/finance-reports";

// A popover that closes on Esc and on a click outside its box.
function usePopover() {
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
  return { open, setOpen, boxRef };
}

const CTRL = "h-8 rounded-lg border border-[#D9D3CA] bg-white text-[12.5px] font-semibold text-[#1F1D1B]";

/** A 1×22px divider between toolbar groups. */
export function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-[22px] w-px bg-[#E2DDD8]" />;
}

const KIND_TAB: { kind: PeriodKind; label: string }[] = [
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Full Year" },
];

/** ‹ [📅 Oct 2026 · so far] › — the arrows step within the period's kind and
 *  only to a period the report offers; the label opens the picker. */
export function PeriodStepper({
  value,
  options,
  onChange,
  today,
}: {
  value: string;
  /** Every period key the report reads (months, and where it reads them,
   *  calendar quarters and years). */
  options: string[];
  onChange: (key: string) => void;
  today?: string;
}) {
  const now = today ?? todayYmdMY();
  const { open, setOpen, boxRef } = usePopover();
  const [tab, setTab] = useState<PeriodKind | null>(null);
  const prev = stepPeriod(value, -1);
  const next = stepPeriod(value, 1);
  const canPrev = options.includes(prev);
  const canNext = options.includes(next);
  const kinds = KIND_TAB.filter((t) => options.some((o) => periodKind(o) === t.kind));
  const shown = tab ?? periodKind(value) ?? "month";
  const pick = (k: string) => { setOpen(false); setTab(null); onChange(k); };
  const ofKind = options.filter((o) => periodKind(o) === shown);
  const years = [...new Set(ofKind.map((o) => o.slice(0, 4)))].sort().reverse();
  const nowLabel = (k: string) => periodLabel(k, now).endsWith("· so far");
  const chip = (k: string) => {
    const on = k === value;
    return `rounded-[7px] border text-[12.5px] font-semibold ${on ? "border-[#1F1D1B] bg-[#1F1D1B] text-white" : nowLabel(k) ? "border-[#7A6E5E] bg-white text-[#1F1D1B] hover:bg-[#F4F6F8]" : "border-[#E7E1D8] bg-white text-[#1F1D1B] hover:bg-[#F4F6F8]"}`;
  };
  const short = (k: string) => (shown === "month" ? periodLabel(k, "0000-00-00").slice(0, 3) : shown === "quarter" ? k.slice(5) : periodLabel(k, "0000-00-00"));

  return (
    <span ref={boxRef} className={`relative inline-flex items-center ${CTRL}`}>
      <button
        type="button"
        aria-label="Previous period"
        title="Previous"
        disabled={!canPrev}
        onClick={() => canPrev && onChange(prev)}
        className={`inline-flex h-full w-[30px] items-center justify-center rounded-l-lg text-[#374151] hover:bg-[#F4F6F8] ${canPrev ? "" : "cursor-default opacity-[.35]"}`}
      >
        ‹
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setTab(null); setOpen((v) => !v); }}
        className="inline-flex h-full items-center gap-2 whitespace-nowrap border-x border-[#E7E1D8] px-3 hover:bg-[#F4F6F8]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span data-fin-period>{periodLabel(value, now)}</span>
      </button>
      <button
        type="button"
        aria-label="Next period"
        title="Next"
        disabled={!canNext}
        onClick={() => canNext && onChange(next)}
        className={`inline-flex h-full w-[30px] items-center justify-center rounded-r-lg text-[#374151] hover:bg-[#F4F6F8] ${canNext ? "" : "cursor-default opacity-[.35]"}`}
      >
        ›
      </button>
      {open && (
        <span
          role="dialog"
          aria-label="Pick a period"
          className="absolute left-1/2 top-10 z-[61] flex w-[300px] -translate-x-1/2 flex-col gap-3 rounded-xl border border-[#DCD6CC] bg-white p-3 shadow-[0_16px_36px_rgba(31,29,27,.18)]"
        >
          {kinds.length > 1 && (
            <span className="flex h-[30px] overflow-hidden rounded-lg border border-[#D9D3CA]">
              {kinds.map((t, i) => (
                <button
                  key={t.kind}
                  type="button"
                  onClick={() => setTab(t.kind)}
                  className={`flex-1 whitespace-nowrap text-[12px] font-semibold ${i ? "border-l border-[#D9D3CA]" : ""} ${shown === t.kind ? "bg-[#1F1D1B] text-white" : "bg-white text-[#374151]"}`}
                >
                  {t.label}
                </button>
              ))}
            </span>
          )}
          {shown === "year" ? (
            <span className="flex flex-col gap-1.5">
              {ofKind.map((k) => (
                <button key={k} type="button" onClick={() => pick(k)} className={`h-9 px-3 text-left ${chip(k)}`}>
                  {periodLabel(k, now)}
                </button>
              ))}
            </span>
          ) : (
            years.map((y) => (
              <span key={y} className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-bold tracking-[.05em] text-[#6B7280]">{y}</span>
                <span className={`grid gap-1.5 ${shown === "month" ? "grid-cols-4" : "grid-cols-2"}`}>
                  {ofKind
                    .filter((k) => k.startsWith(y))
                    .sort()
                    .map((k) => (
                      <button key={k} type="button" onClick={() => pick(k)} className={`h-[30px] ${chip(k)}`}>
                        {short(k)}
                      </button>
                    ))}
                </span>
              </span>
            ))
          )}
        </span>
      )}
    </span>
  );
}

/** DETAIL [L1|L2|…] — how deep the report opens. */
export function DetailLevels({
  levels,
  value,
  onChange,
  tips,
}: {
  levels: number[];
  value: number;
  onChange: (level: number) => void;
  tips?: Record<number, string>;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="text-[11px] font-bold tracking-[.04em] text-[#9CA3AF]">DETAIL</span>
      <span className={`inline-flex overflow-hidden ${CTRL}`} role="tablist" aria-label="Detail level">
        {levels.map((L, i) => (
          <button
            key={L}
            type="button"
            role="tab"
            aria-selected={value === L}
            title={tips?.[L]}
            onClick={() => onChange(L)}
            className={`whitespace-nowrap px-3 transition-colors ${i ? "border-l border-[#D9D3CA]" : ""} ${value === L ? "bg-[#1F1D1B] text-white" : "text-[#374151] hover:bg-[#F4F6F8]"}`}
          >
            L{L}
          </button>
        ))}
      </span>
    </span>
  );
}

/** Edit Layout ⇄ Done — where a report lets lines be dragged between groups. */
export function EditLayoutToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`${CTRL} px-3 ${on ? "border-[#1F1D1B] bg-[#1F1D1B] text-white hover:bg-black" : "hover:bg-[#F4F6F8]"}`}
    >
      {on ? "Done" : "Edit Layout"}
    </button>
  );
}

/** One download icon; its menu lists the report's exports. */
export function DownloadMenu({ items }: { items: { label: string; onSelect: () => void }[] }) {
  const { open, setOpen, boxRef } = usePopover();
  return (
    <span ref={boxRef} className="relative inline-flex">
      <button
        type="button"
        aria-label="Export / print"
        title="Export / print"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex w-8 items-center justify-center text-[#4B5563] hover:bg-[#F4F6F8] hover:text-[#1F1D1B] ${CTRL}`}
      >
        <Download className="h-4 w-4" />
      </button>
      {open && (
        <span role="menu" className="absolute right-0 top-[38px] z-[61] flex w-[180px] flex-col rounded-[10px] border border-[#DCD6CC] bg-white p-[5px] text-[13px] shadow-[0_14px_34px_rgba(31,29,27,.18)]">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className="flex h-[30px] w-full items-center rounded-[7px] px-2.5 text-left text-[#1F2937] hover:bg-[#F1EEE8]"
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** The toolbar on a report's title row; groups split by ToolbarDivider. */
export function ReportToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2.5">{children}</div>;
}

/** The strip under the title: what was checked on the left, the verdict on
 *  the right — green when it balances, red when it does not. */
export function CheckStrip({ ok, label, children }: { ok: boolean; label: string; children?: ReactNode }) {
  return (
    <div
      data-fin-check={ok ? "ok" : "bad"}
      className={`flex flex-wrap items-center gap-x-[18px] gap-y-2.5 rounded-[10px] px-4 py-2.5 text-[13px] text-[#1F1D1B] ${ok ? "bg-[#EEF5E9]" : "bg-[#FBEDEC]"}`}
    >
      {children}
      <span className={`ml-auto font-bold ${ok ? "text-[#27500A]" : "text-[#9A3A2D]"}`}>{label}</span>
    </div>
  );
}

/** The framed report: centred company / report / note, then the table. A
 *  `maxHeight` keeps a long report scrolling inside the frame so its header
 *  stays in view. */
export function ReportFrame({
  company,
  title,
  note,
  maxHeight,
  children,
}: {
  company: string;
  title: ReactNode;
  note?: ReactNode;
  maxHeight?: string;
  children: ReactNode;
}) {
  return (
    <div data-fin-frame className="overflow-hidden rounded-[10px] border-[1.5px] border-[#7A6E5E] bg-white">
      <div className="border-b-[1.5px] border-[#7A6E5E] px-4 pb-3 pt-3.5 text-center">
        <div className="text-[15px] font-bold tracking-[.02em] text-[#1F1D1B]">{company}</div>
        <div className="mt-0.5 text-[13px] text-[#4B5563]">{title}</div>
        {note && <div className="mt-0.5 text-[12px] text-[#9CA3AF]">{note}</div>}
      </div>
      <div data-fin-report-scroll className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </div>
    </div>
  );
}

/** The dashed banner shown while Edit Layout is on. */
export function EditLayoutBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-[#7A6E5E] bg-[#FBFAF7] px-3.5 py-2.5 text-[12.5px] text-[#4B5563]">
      <span className="font-bold text-[#1F1D1B]">Edit layout</span>
      <span>{children}</span>
    </div>
  );
}
