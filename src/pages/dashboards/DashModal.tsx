import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

// Layer 2 of the merged dashboard (owner 2026-10-17): layer 1 stays simple,
// the detail opens here. Same look as the Command Center's drill popups.
// Closes on the backdrop, the X, or Escape.
export function DashModal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className={`my-8 w-full rounded-xl bg-white shadow-xl ${wide ? "max-w-5xl" : "max-w-3xl"}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-start justify-between border-b border-[#E2DDD8] px-6 py-4 max-md:px-4">
          <div>
            <h3 className="text-base font-bold text-[#1F1D1B]">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-[#9CA3AF]">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#5A5550] hover:bg-[#F5F2ED]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-4 max-md:px-4">{children}</div>
      </div>
    </div>
  );
}
