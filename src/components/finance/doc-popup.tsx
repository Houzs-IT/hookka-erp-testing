// ---------------------------------------------------------------------------
// doc-popup.tsx — the finance document popup for lists outside the accounting
// page (owner 2026-09-22 「其他的类似 payment voucher, receipt 这些都要双击点开」:
// every document list opens its record on double-click). The same v2 frame as
// the accounting page's DocDetailModal: white header and action bar, a light
// body whose blocks read as white cards ([data-fin-modal-body] in
// finance-v2.css, under the page's data-fin-ui); Esc or a click outside
// closes it.
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";
import { useEscapeClose } from "@/lib/escape-stack";

export function DocPopup({ title, badges, onClose, children, actions }: {
  title: string; badges?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode;
}) {
  useEscapeClose(onClose);
  return (
    <div data-fin-backdrop="" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,29,27,0.42)] p-4" onClick={onClose}>
      <div data-fin-pop="" className="flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] bg-[#F7F5F2] shadow-[0_24px_60px_rgba(31,29,27,0.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[#E2DDD8] bg-white px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-[#1F1D1B]">{title}</h2>
            {badges}
          </div>
          <button onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-[#9CA3AF] hover:bg-[#F0ECE9] hover:text-[#6B7280]" title="Close (Esc)">✕</button>
        </div>
        <div data-fin-modal-body className="flex-1 space-y-3 overflow-y-auto p-5 text-sm">
          {children}
        </div>
        {actions && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E2DDD8] bg-white px-5 py-3">{actions}</div>}
      </div>
    </div>
  );
}

export function PopupField({ label, children, span }: { label: string; children: ReactNode; span?: 2 | 4 }) {
  return (
    <div className={span === 2 ? "col-span-2" : span === 4 ? "col-span-2 sm:col-span-4" : undefined}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p className="mt-0.5 font-medium text-[#1F1D1B]">{children}</p>
    </div>
  );
}
