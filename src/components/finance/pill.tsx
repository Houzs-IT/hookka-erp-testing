// A status pill in the finance v2 tones (owner 2026-10-16; README status
// tokens). The tone comes from src/lib/finance-daily.ts (pvStatus, …).
import type { ReactNode } from "react";
import type { FinTone } from "@/lib/finance-daily";

const FIN_TONE_CLASS: Record<FinTone, string> = {
  ok: "bg-[#E7F0E3] text-[#27500A]",
  warn: "bg-[#FBF3E4] text-[#7A5B12]",
  err: "bg-[#F3E8E5] text-[#9A3A2D]",
  neutral: "bg-[#EEF1F4] text-[#4B5563]",
  info: "bg-[#EEF2FB] text-[#2C4170]",
  faint: "bg-[#F4F4F2] text-[#9CA3AF]",
};

export function FinPill({ tone, title, children }: { tone: FinTone; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${FIN_TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
