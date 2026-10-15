// "Send Notification" dialog for the Production Overview (HK-0025).
//
// Overview -> tick order(s) -> Send Notification -> pick priority -> pick
// individuals / departments / everyone -> Send. Each ticked order becomes ONE
// announcement via POST /api/announcements (so targeting, the worker-phone feed,
// Web Push and read-receipts are the existing announcement machinery); the
// notice text is built by src/lib/order-notification.ts.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ORDER_PRIORITIES,
  ORDER_PRIORITY_LABEL,
  buildOrderNotice,
  type OrderPriority,
} from "@/lib/order-notification";
import type { ProductionOrder } from "../types";
import { isOverduePO } from "../utils";

type Dept = { code: string; name: string };
type Person = { id: string; name: string; empNo: string; departmentCode: string };
type Audience = "ALL" | "DEPTS" | "WORKERS";

// One announcement (and one translation call) per order, sent one after the
// other - so a "select all" of hundreds of rows must not become hundreds of
// phone alerts. Raise only if the floor asks for it.
const MAX_ORDERS = 10;

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Mounted only while open (the caller renders it conditionally), so every
// open starts from fresh defaults.
export function SendOrderNotificationDialog({
  orders,
  onClose,
  onSent,
}: {
  orders: ProductionOrder[];
  onClose: () => void;
  onSent: (count: number) => void;
}) {
  // Overdue orders default to OVERDUE, the rest to URGENT.
  const [priority, setPriority] = useState<OrderPriority>(() => {
    const t = localToday();
    return orders.length > 0 && orders.every((o) => isOverduePO(o, t)) ? "OVERDUE" : "URGENT";
  });
  const [audience, setAudience] = useState<Audience>("DEPTS");
  const [depts, setDepts] = useState<Dept[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selDepts, setSelDepts] = useState<Set<string>>(new Set());
  const [selPeople, setSelPeople] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (depts.length > 0) return;
    let alive = true;
    (async () => {
      try {
        const [d, w] = await Promise.all([fetch("/api/departments"), fetch("/api/workers")]);
        if (d.ok) {
          const j = (await d.json()) as { data?: Dept[] };
          if (alive && Array.isArray(j.data)) setDepts(j.data.map((x) => ({ code: x.code, name: x.name })));
        }
        if (w.ok) {
          const j = (await w.json()) as { data?: Array<Person & { status?: string }> };
          if (alive && Array.isArray(j.data)) {
            setPeople(
              j.data
                .filter((x) => (x.status ?? "ACTIVE") === "ACTIVE")
                .map((x) => ({ id: x.id, name: x.name, empNo: x.empNo, departmentCode: x.departmentCode })),
            );
          }
        }
      } catch {
        /* pickers stay empty; "Everyone" still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, [depts.length]);

  const shownPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? people.filter((p) => p.name.toLowerCase().includes(q) || p.empNo.toLowerCase().includes(q))
      : people;
  }, [people, search]);

  const flip = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const tooMany = orders.length > MAX_ORDERS;
  const noRecipient =
    (audience === "DEPTS" && selDepts.size === 0) || (audience === "WORKERS" && selPeople.size === 0);

  async function send() {
    setBusy(true);
    setError(null);
    let sent = 0;
    try {
      for (const o of orders) {
        const { title, body } = buildOrderNotice({
          priority,
          poNo: o.poNo,
          model: o.productName || o.productCode,
          requiredDate: o.hookkaExpectedDD || o.targetEndDate,
          status: o.status,
          note,
        });
        const res = await fetch("/api/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body,
            priority,
            orderNo: o.poNo,
            orderId: o.id,
            targetDeptCodes: audience === "DEPTS" ? [...selDepts] : [],
            targetWorkerIds: audience === "WORKERS" ? [...selPeople] : [],
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(`${o.poNo}: ${j.error ?? `error ${res.status}`}. ${sent} of ${orders.length} sent.`);
          return;
        }
        sent++;
      }
      onSent(sent);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
      <div className="max-h-[90vh] w-[520px] max-w-full overflow-y-auto rounded-md border border-[#E6E0D9] bg-white p-4 shadow-lg">
        <h3 className="mb-1 text-[14px] font-semibold text-[#3A2E22]">Send Notification</h3>
        <p className="mb-3 text-[12px] text-[#6B5E50]">
          {orders.length === 1
            ? `Order ${orders[0].poNo}`
            : `${orders.length} orders - one notification each`}
          . Workers get it on their phone and must acknowledge it.
        </p>

        <label className="mb-1 block text-[12px] font-semibold text-[#3A2E22]">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as OrderPriority)}
          className="mb-3 h-8 w-full rounded border border-[#D4CFC7] bg-white px-2 text-[12px]"
        >
          {ORDER_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {ORDER_PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-[12px] font-semibold text-[#3A2E22]">Send to</label>
        <div className="mb-2 flex gap-3 text-[12px]">
          {(
            [
              ["DEPTS", "Departments"],
              ["WORKERS", "Individual workers"],
              ["ALL", "All workers"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-1">
              <input type="radio" name="hk25-audience" checked={audience === v} onChange={() => setAudience(v)} />
              {label}
            </label>
          ))}
        </div>

        {audience === "DEPTS" && (
          <div className="mb-3 grid grid-cols-2 gap-1 text-[12px]">
            {depts.map((d) => (
              <label key={d.code} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selDepts.has(d.code)}
                  onChange={() => setSelDepts((s) => flip(s, d.code))}
                />
                {d.name}
              </label>
            ))}
          </div>
        )}
        {audience === "WORKERS" && (
          <div className="mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or employee no."
              className="mb-1 h-8 w-full rounded border border-[#D4CFC7] px-2 text-[12px]"
            />
            <div className="max-h-40 overflow-y-auto rounded border border-[#E6E0D9] p-1 text-[12px]">
              {shownPeople.map((p) => (
                <label key={p.id} className="flex items-center gap-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={selPeople.has(p.id)}
                    onChange={() => setSelPeople((s) => flip(s, p.id))}
                  />
                  {p.name} <span className="text-[#9A918A]">{p.empNo}</span>
                </label>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-[#8A7F73]">{selPeople.size} selected</div>
          </div>
        )}

        <label className="mb-1 block text-[12px] font-semibold text-[#3A2E22]">Message (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="A short note added under the order details"
          className="mb-3 w-full rounded border border-[#D4CFC7] px-2 py-1 text-[12px]"
        />

        {tooMany && (
          <p className="mb-2 text-[12px] text-red-700">
            Select at most {MAX_ORDERS} orders per notification ({orders.length} selected).
          </p>
        )}
        {error && <p className="mb-2 text-[12px] text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={send} disabled={busy || noRecipient || tooMany || orders.length === 0}>
            {busy ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
