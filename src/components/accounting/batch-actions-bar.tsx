import { Printer, FileSpreadsheet, X } from "lucide-react";
import { exportReportXlsx } from "@/lib/export-report";

export function BatchActionsBar(props: {
  count: number;
  onClear?: () => void;
  onPrint?: () => void;
  /** A second print: each ticked document followed by its attachments, in
   *  one print job (Payment Vouchers, owner 2026-10-21). Absent = no button. */
  onPrintFiles?: () => void;
  printFilesBusy?: boolean;
  exportName: string; // base filename, no extension
  exportAoa: () => (string | number)[][]; // header row + selected body rows
}) {
  if (props.count === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-[#E2DDD8] bg-[#FAF8F5] px-3 py-2 text-sm mb-2">
      <span className="font-medium text-[#1F1D1B]">{props.count} selected</span>
      <div className="flex-1" />
      {props.onPrint && (
        <button
          onClick={props.onPrint}
          className="inline-flex items-center gap-1 rounded-md border border-[#E2DDD8] bg-white px-2.5 py-1 text-[#6B5C32] hover:text-[#1F1D1B]"
        >
          <Printer className="h-3.5 w-3.5" /> Print / PDF
        </button>
      )}
      {props.onPrintFiles && (
        <button
          onClick={props.onPrintFiles}
          disabled={props.printFilesBusy}
          className="inline-flex items-center gap-1 rounded-md border border-[#E2DDD8] bg-white px-2.5 py-1 text-[#6B5C32] hover:text-[#1F1D1B] disabled:opacity-60"
        >
          <Printer className="h-3.5 w-3.5" /> {props.printFilesBusy ? "Preparing…" : "Print + files"}
        </button>
      )}
      <button
        onClick={() => void exportReportXlsx(`${props.exportName}.xlsx`, props.exportName.slice(0, 31), props.exportAoa())}
        className="inline-flex items-center gap-1 rounded-md border border-[#E2DDD8] bg-white px-2.5 py-1 text-[#27500A] hover:text-[#1F1D1B]"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </button>
      {props.onClear && (
        <button onClick={props.onClear} className="inline-flex items-center gap-1 text-[#6B7280] hover:text-[#1F1D1B]">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
