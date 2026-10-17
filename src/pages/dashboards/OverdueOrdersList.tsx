import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { fmtN } from "./dashboard-shared-lib";
import { DEPT_FLOOR, deptName } from "./ops-floor-lib";

// The production orders behind "Production orders overdue" (owner 2026-10-17:
// "具体是哪 68 个？"): open orders already past the customer's delivery date
// (the feed's risk = critical), worst first, filterable by the department each
// one is waiting at. Every production department is offered, even at zero.
export type OverdueOrder = {
  poNo: string | null;
  customer: string | null;
  productName: string | null;
  currentDept: string | null;
  daysToDD: number | null;
  stagesDone: number;
  stagesTotal: number;
  risk?: string;
};

export function OverdueOrdersList({ orders }: { orders: OverdueOrder[] }) {
  const [dept, setDept] = useState("ALL");
  const [search, setSearch] = useState("");
  const overdue = useMemo(
    () => orders.filter((o) => o.risk === "critical").sort((a, b) => (a.daysToDD ?? 0) - (b.daysToDD ?? 0)),
    [orders],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overdue) m.set(o.currentDept || "(no dept)", (m.get(o.currentDept || "(no dept)") ?? 0) + 1);
    return m;
  }, [overdue]);
  const tabs: TabItem<string>[] = useMemo(() => {
    const codes = [...DEPT_FLOOR.map(([c]) => c as string), ...[...counts.keys()].filter((c) => !DEPT_FLOOR.some(([k]) => k === c))];
    return [{ key: "ALL", label: `All · ${fmtN(overdue.length)}` }, ...codes.map((c) => ({ key: c, label: `${deptName(c)} · ${fmtN(counts.get(c) ?? 0)}` }))];
  }, [counts, overdue.length]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return overdue
      .filter((o) => dept === "ALL" || (o.currentDept || "(no dept)") === dept)
      .filter((o) => !q || [o.poNo, o.customer, o.productName].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [overdue, dept, search]);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle>Overdue production orders · {fmtN(overdue.length)}</CardTitle>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">Past the customer's delivery date and not finished · most late first · department = where it is waiting now</p>
        </div>
        <div className="relative w-full max-w-[220px] max-md:max-w-none">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO, customer, product…" className="h-8 max-md:h-10 pl-8 text-xs max-md:text-sm" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 pb-3">
          <Tabs tabs={tabs} value={dept} onChange={setDept} variant="pill" scrollable />
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="*:sticky *:top-0 *:z-10 *:bg-white *:shadow-[inset_0_1px_0_#E2DDD8,inset_0_-1px_0_#E2DDD8]">
                {["PO Number", "Customer", "Product Description", "Waiting at", "Stages done", "Days late"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold uppercase text-[10.5px] tracking-wide text-[#6B7280]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={o.poNo ?? i} className="border-b border-[#E2DDD8]">
                  <td className="px-3 py-2 font-mono text-[#1F1D1B] whitespace-nowrap">{o.poNo ?? "—"}</td>
                  <td className="px-3 py-2 text-[#1F1D1B]">{o.customer ?? "—"}</td>
                  <td className="px-3 py-2 text-[#6B7280]">{o.productName ?? "—"}</td>
                  <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">{o.currentDept ? deptName(o.currentDept) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-[#6B7280] whitespace-nowrap">{o.stagesDone} / {o.stagesTotal}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center rounded-full bg-[#FBE7E3] px-2 py-0.5 text-[11px] font-semibold text-[#9A3A2D]">
                      {o.daysToDD == null ? "—" : `${-o.daysToDD} d`}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-[#6B7280]">Nothing overdue here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
