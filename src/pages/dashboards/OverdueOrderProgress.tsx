import { Link } from "react-router-dom";
import { useCachedJson } from "@/lib/cached-fetch";
import { Badge } from "@/components/ui/badge";
import { deptName } from "./ops-floor-lib";

export interface OrderLineProgress {
  id: string;
  poNo: string;
  productName: string;
  productCode: string;
  quantity: number;
  status: string;
  progress: number;
  currentDepartment: string;
  deliveryDoNo?: string;
  deliveryStatus?: string;
}

interface SalesOrderDetailResponse {
  success?: boolean;
  linkedPOs?: OrderLineProgress[];
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Pending Dispatch",
  LOADED: "Dispatched",
  IN_TRANSIT: "In Transit",
};

const DELIVERED_STATUSES = new Set(["DELIVERED", "INVOICED"]);

function isStillToDeliver(line: OrderLineProgress): boolean {
  return line.status !== "CANCELLED" && !DELIVERED_STATUSES.has(line.deliveryStatus ?? "");
}

function describeWhere(line: OrderLineProgress): string {
  if (line.status === "COMPLETED" || line.status === "TRANSFERRED") return "Production done";
  return line.currentDepartment ? `At ${deptName(line.currentDepartment).replace(/_/g, " ")}` : "Not started";
}

function describeDelivery(line: OrderLineProgress): string {
  if (!line.deliveryDoNo) return "Not on a DO";
  const statusLabel = DELIVERY_STATUS_LABEL[line.deliveryStatus ?? ""] ?? line.deliveryStatus ?? "";
  return `${line.deliveryDoNo}${statusLabel ? ` · ${statusLabel}` : ""}`;
}

function LineRow({ line }: { line: OrderLineProgress }) {
  const progressPercent = Math.max(0, Math.min(100, Math.round(line.progress || 0)));
  return (
    <li className="grid gap-x-4 gap-y-1.5 py-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_auto_minmax(0,1fr)] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium text-[#1F1D1B]">
          {line.productName || line.productCode} <span className="font-normal text-[#6B7280]">× {line.quantity}</span>
        </p>
        <p className="truncate text-[11px] text-[#9CA3AF]">{line.poNo}</p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-28 shrink-0 truncate text-[#4B5563] sm:w-auto sm:max-w-[9rem]">{describeWhere(line)}</span>
        <div
          className="h-2 min-w-[3rem] flex-1 rounded-full bg-[#E2DDD8]"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${line.productName} progress`}
        >
          <div className="h-2 rounded-full bg-[#6B5C32]" style={{ width: `${progressPercent}%` }} />
        </div>
        <span className="w-9 shrink-0 text-right tabular-nums text-[#6B7280]">{progressPercent}%</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:contents">
        <Badge variant="status" status={line.status} className="w-fit" />
        <span className={line.deliveryDoNo ? "text-[#1F1D1B]" : "text-[#9CA3AF]"}>{describeDelivery(line)}</span>
      </div>
    </li>
  );
}

export function OverdueOrderProgress({ soId, soNo }: { soId: string; soNo: string | null }) {
  const { data, loading, error } = useCachedJson<SalesOrderDetailResponse>(`/api/sales-orders/${encodeURIComponent(soId)}`);
  const allLines = data?.linkedPOs ?? [];
  const lines = allLines.filter(isStillToDeliver);

  const body = (() => {
    if (data?.success) {
      return lines.length === 0
        ? <p className="py-2 text-[#6B7280]">{allLines.length === 0 ? "No production orders yet for this sales order." : "Every production order here is delivered or cancelled."}</p>
        : <ul className="divide-y divide-[#EFEBE5]">{lines.map((line) => <LineRow key={line.id} line={line} />)}</ul>;
    }
    if (loading) return <p className="py-2 text-[#6B7280]">Loading progress…</p>;
    return <p className="py-2 text-[#9A3A2D]">Progress could not be loaded.{error ? ` ${error}` : ""}</p>;
  })();

  return (
    <div className="rounded-lg border border-[#E2DDD8] bg-white px-3 py-1 text-xs">
      {body}
      <Link
        to={`/sales/${soId}`}
        className="inline-flex min-h-11 items-center font-medium text-[#6B5C32] underline-offset-2 hover:underline sm:min-h-8"
      >
        Open {soNo ?? "sales order"}
      </Link>
    </div>
  );
}
