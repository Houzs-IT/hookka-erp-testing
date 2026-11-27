// Settings › AI Connector (docs/plans/mcp-connector.md; owner approved the design
// 2026-11-25). Everyone: whether they may connect, how to connect Claude /
// ChatGPT, their connected apps and what the AI looked up for them, Request
// access, Disconnect. Super Admin: approvals, who is connected, every question,
// give / remove access. Backed by /api/mcp-admin.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

type Conn = { tokenId: string; userId: string; name: string; role: string; app: string; connectedAt: string; lastUsedAt: string | null; callsWeek?: number };
type Call = { at: string; userId: string; name: string; app: string; tool: string; target: string; ok: boolean; status: number; note: string };
type Limits = { perMinute: number; perDay: number };
type Latency = { tool: string; calls: number; p50: number; p95: number; max: number; cached: number };
type WriteActions = { mail_reply?: boolean; note?: boolean; po_approval?: boolean };
const WRITE_ACTION_ROWS: { key: keyof WriteActions; label: string; help: string }[] = [
  { key: "mail_reply", label: "Reply to Mail Center threads", help: "Drafts a reply in an existing thread from the person's own mailbox; not sent if a colleague replies first. Needs Mail Center send permission." },
  { key: "note", label: "Add notes to purchase orders and service cases", help: "Adds one dated note with the person's name (PO notes, case “Action taken”). Needs edit permission on that document." },
  { key: "po_approval", label: "Approve purchase orders", help: "Marks a sent PO Confirmed, like “Mark Confirmed” on the PO page. Needs the PO approve permission." },
];
type Me = { allowed: boolean; isSuperAdmin: boolean; actionsEnabled?: boolean; writeActions?: WriteActions; limits?: Limits; connectorUrl: string; connections: Conn[]; calls: Call[]; pendingRequestAt: string | null };
type Overview = {
  connectorUrl: string;
  actionsEnabled?: boolean;
  writeActions?: WriteActions;
  limits?: Limits;
  latency?: { last24h: Latency[]; previous7d: Latency[] };
  stats: { allowed: number; connectedPeople: number; connectedApps: Record<string, number>; callsToday: number; refusedToday: number };
  connections: Conn[];
  allowed: { userId: string; name: string; role: string; approvedAt: string }[];
  requests: { id: string; userId: string; name: string; role: string; reason: string; at: string }[];
  calls: Call[];
};
type UserOpt = { id: string; name: string };

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32] focus-visible:ring-offset-1";
const CARD = "rounded-xl border border-[#E6E1D6] bg-white";
const BTN = `inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold ${FOCUS}`;
const PRIMARY = `${BTN} bg-[#6B5C32] text-white hover:bg-[#574A27] disabled:opacity-50`;
const SECONDARY = `${BTN} border border-[#D9D4C7] bg-white text-[#1F1D1A] hover:bg-[#FAF8F3]`;
const DANGER = `inline-flex h-9 items-center rounded-lg border border-[#F1C7C2] bg-white px-3 text-[13px] font-semibold text-[#B42318] hover:bg-[#FDECEA] ${FOCUS}`;
const TH = "px-3 py-2.5 text-left text-xs font-semibold text-[#55534E]";
const TD = "px-3 py-3 align-top";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
}
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
}

/** The quick answers, in words (round 3 added inventory → daily brief). */
const TOOL_WORDS: Record<string, string> = {
  sales_summary: "Sales summary",
  production_summary: "Production summary",
  order_backlog: "Order backlog",
  receivables_summary: "Who owes us (receivables)",
  material_shortages: "Material shortages",
  inventory_summary: "Low / negative stock",
  purchasing_summary: "Purchasing summary",
  payables_summary: "What we owe suppliers",
  so_overdue: "Overdue sales orders",
  deliveries_due: "Deliveries due",
  production_late: "Late production orders",
  attendance_today: "Who is away today",
  daily_brief: "Daily brief",
};

/** What the AI looked up, in words. */
function lookedUp(c: Call): string {
  if (c.tool === "whoami") return "Checked who it is connected as";
  if (c.tool === "list_modules") return "Listed the modules it may read";
  if (c.tool === "list_endpoints") return `Listed endpoints in ${c.target}`;
  if (c.tool === "search") return `Searched ${c.target.replace(/^\/api\/search\?q=/, "“").replace(/$/, "”")}`;
  if (c.tool === "get_pdf") return `PDF ${c.target.replace(/^pdf:/, "").replace(":", " ")}`;
  if (c.tool === "erp_link") return `Link to ${c.target.replace(":", " ")}`;
  if (c.tool === "document_flow") return `Document flow of ${c.target.replace(/^flow:/, "")}`;
  // AI actions (meetings, email): the log names who / what about, never an email body.
  if (c.tool === "propose_meeting" || c.tool === "propose_email") return `Proposed ${c.target.replace(/^propose:/, "")}`;
  if (c.tool === "confirm_action") return `Confirmed ${c.target.replace(/^confirm:/, "")}`;
  if (c.tool === "cancel_action") return "Cancelled a proposal";
  if (c.target === "rate-limited") return `${TOOL_WORDS[c.tool] ?? c.tool} (over the limit)`;
  if (c.tool === "export_excel") return `Excel export of ${c.target.replace(/^export:/, "").replace(/ rows=(d+)/, " ($1 rows)")}`;
  if (TOOL_WORDS[c.tool]) return TOOL_WORDS[c.tool];
  return c.target || c.tool;
}
function result(c: Call): { label: string; cls: string } {
  if (c.ok && c.tool === "confirm_action") return { label: "Done", cls: "bg-[#E7F3EC] text-[#1E6B3F]" };
  if (c.ok && (c.tool === "propose_meeting" || c.tool === "propose_email")) return { label: "Waiting for yes", cls: "bg-[#F3EEDF] text-[#6B5A2E]" };
  const hidden = c.note.split(",").some((x) => x && x !== "cached");
  if (c.ok) return { label: hidden ? "Answered (fields hidden)" : "Answered", cls: "bg-[#E7F3EC] text-[#1E6B3F]" };
  if (c.status === 403) return { label: "No permission", cls: "bg-[#FDECEA] text-[#B42318]" };
  if (c.status === 429) return { label: "Over the limit", cls: "bg-[#F3EEDF] text-[#6B5A2E]" };
  return { label: "Failed", cls: "bg-[#F3F4F6] text-[#55534E]" };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const j = (await r.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!r.ok || !j || j.success === false) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data as T;
}

function CallsTable({ calls, showWho }: { calls: Call[]; showWho: boolean }) {
  if (calls.length === 0) return <p className="px-5 py-6 text-sm text-[#6B6B66]">Nothing looked up yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-[#FAF8F3]">
            <th className={TH}>Time</th>
            {showWho && <th className={TH}>Person</th>}
            <th className={TH}>App</th>
            <th className={TH}>What the AI looked up</th>
            <th className={`${TH} text-right`}>Result</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => {
            const r = result(c);
            return (
              <tr key={i} className="border-t border-[#EFEBE2]">
                <td className={`${TD} whitespace-nowrap text-[#55534E] tabular-nums`}>{clock(c.at)}</td>
                {showWho && <td className={`${TD} whitespace-nowrap font-semibold`}>{c.name || c.userId}</td>}
                <td className={`${TD} text-[#55534E]`}>{c.app}</td>
                <td className={`${TD} break-all`}>{lookedUp(c)}</td>
                <td className={`${TD} text-right`}>
                  <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold ${r.cls}`}>{r.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HowTo({ url }: { url: string }) {
  const [app, setApp] = useState<"claude" | "chatgpt">("claude");
  const steps =
    app === "claude"
      ? [
          ["Open Claude settings", "In Claude (web, desktop or phone): Settings › Connectors. On a company plan the admin may already have added “Hookka ERP”."],
          ["Add the connector (if it is not listed)", "Click “Add custom connector”, name it Hookka ERP and paste the connector URL above."],
          ["Click Connect and sign in", "A Hookka ERP page opens. Sign in with YOUR ERP username and password (Claude never sees them)."],
          ["Press Allow", "The page shows the AI may only read Hookka ERP as you. Press Allow — you return to Claude."],
          ["Ask in your own words", "In a new chat, switch Hookka ERP on in the tools menu, then ask — Chinese, Malay or English."],
        ]
      : [
          ["Open ChatGPT settings", "In ChatGPT: Settings › Connectors (on some plans: Apps). On a company plan the admin may already have added “Hookka ERP”."],
          ["Create the connector", "Choose Create / Add custom connector, name it Hookka ERP, authentication OAuth, and paste the connector URL above."],
          ["Sign in", "A Hookka ERP page opens. Sign in with YOUR ERP username and password (ChatGPT never sees them)."],
          ["Press Allow", "The page shows the AI may only read Hookka ERP as you. Press Allow — you return to ChatGPT."],
          ["Ask in your own words", "In a new chat, pick Hookka ERP from the tools / connectors menu, then ask."],
        ];
  return (
    <section className={`${CARD} p-5`} aria-labelledby="howto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="howto" className="text-base font-bold">How to connect</h2>
        <div role="tablist" aria-label="AI app" className="inline-flex gap-[3px] rounded-[10px] border border-[#E5E1D6] bg-[#EFEBE2] p-[3px]">
          {(["claude", "chatgpt"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={app === k}
              onClick={() => setApp(k)}
              className={`h-9 rounded-lg px-4 text-sm font-semibold ${FOCUS} ${app === k ? "bg-white shadow-[0_1px_2px_rgba(17,24,39,.10),0_0_0_1px_rgba(17,24,39,.06)]" : ""}`}
            >
              {k === "claude" ? "Claude" : "ChatGPT"}
            </button>
          ))}
        </div>
      </div>
      <ol className="mt-4 space-y-3">
        {steps.map(([t, b], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6B5C32] text-sm font-bold text-white">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t}</div>
              <div className="text-sm text-[#55534E]">{b}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-[#6B6B66] break-all">Connector URL: {url}</p>
    </section>
  );
}


/** Super Admin: how fast each tool answers — the last 24 h against the 7 days before (from the question log). */
function LatencyCard({ latency }: { latency: { last24h: Latency[]; previous7d: Latency[] } }) {
  const prev = new Map(latency.previous7d.map((r) => [r.tool, r]));
  const tools = [...new Set([...latency.last24h.map((r) => r.tool), ...latency.previous7d.map((r) => r.tool)])];
  const s = (ms: number | undefined) => (ms === undefined ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="speed">
      <div className="border-b border-[#EFEBE2] px-5 py-4">
        <h2 id="speed" className="text-base font-bold">Answer speed</h2>
        <p className="text-[13px] text-[#55534E]">Typical (median) and slow (95th percentile) time per tool: the last 24 hours against the 7 days before. Repeat questions within 30 seconds are answered from a short cache.</p>
      </div>
      {tools.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[#6B6B66]">No questions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#FAF8F3]">
                <th className={TH}>Tool</th>
                <th className={`${TH} text-right`}>Questions (24 h)</th>
                <th className={`${TH} text-right`}>Typical (24 h)</th>
                <th className={`${TH} text-right`}>Slow (24 h)</th>
                <th className={`${TH} text-right`}>Typical (7 days before)</th>
                <th className={`${TH} text-right`}>Slow (7 days before)</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => {
                const now = latency.last24h.find((r) => r.tool === t);
                const before = prev.get(t);
                return (
                  <tr key={t} className="border-t border-[#EFEBE2]">
                    <td className={TD}>{TOOL_WORDS[t] ?? t}</td>
                    <td className={`${TD} text-right tabular-nums`}>{now?.calls ?? 0}</td>
                    <td className={`${TD} text-right tabular-nums`}>{s(now?.p50)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{s(now?.p95)}</td>
                    <td className={`${TD} text-right tabular-nums text-[#55534E]`}>{s(before?.p50)}</td>
                    <td className={`${TD} text-right tabular-nums text-[#55534E]`}>{s(before?.p95)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type LeakRow = { path: string; outcome: "opened" | "refused" | "error"; status: string; hidden: string[]; kept: string[]; keptExpected: boolean };

/** Super Admin: run the AI's read path as one approved account, field names only. */
function LeakCheck({ people }: { people: { userId: string; name: string; role: string }[] }) {
  const [who, setWho] = useState("");
  const [rows, setRows] = useState<LeakRow[]>([]);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const staff = people.filter((p) => !["SUPER_ADMIN", "ADMIN"].includes((p.role || "").toUpperCase()));

  const run = async () => {
    setRunning(true);
    setErr(null);
    setRows([]);
    setProg(null);
    try {
      let offset = 0;
      const all: LeakRow[] = [];
      for (let guard = 0; guard < 200; guard++) {
        const d = await api<{ total: number; next: number; done: boolean; rows: LeakRow[] }>("/api/mcp-admin/admin/leak-check", {
          method: "POST",
          body: JSON.stringify({ userId: who, offset }),
        });
        all.push(...d.rows);
        setRows([...all]);
        setProg({ done: d.next, total: d.total });
        if (d.done) break;
        offset = d.next;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const opened = rows.filter((r) => r.outcome === "opened");
  const refused = rows.filter((r) => r.outcome === "refused").length;
  const errors = rows.filter((r) => r.outcome === "error").length;
  const review = opened.filter((r) => r.kept.length > 0 && !r.keptExpected);

  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="leak">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEBE2] px-5 py-4">
        <div>
          <h2 id="leak" className="text-base font-bold">Leak check</h2>
          <p className="text-[13px] text-[#55534E]">Runs what the AI would read as this person over every module. Shows field names only, never values.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="leakwho" className="sr-only">Account</label>
          <select id="leakwho" value={who} onChange={(e) => setWho(e.target.value)} className={`h-9 rounded-lg border border-[#D9D4C7] bg-white px-2 text-sm ${FOCUS}`}>
            <option value="">Choose an approved staff account…</option>
            {staff.map((p) => (
              <option key={p.userId} value={p.userId}>{p.name} · {p.role}</option>
            ))}
          </select>
          <button type="button" className={PRIMARY} disabled={!who || running} onClick={() => void run()}>
            {running ? "Checking…" : "Run check"}
          </button>
        </div>
      </div>
      {err && <p className="px-5 py-3 text-sm text-[#B42318]">{err}</p>}
      {prog && (
        <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
          {[
            ["Checked", `${prog.done} / ${prog.total}`, ""],
            ["Opened", String(opened.length), ""],
            ["Refused", String(refused), "no permission — correct"],
            ["To review", String(review.length), "money / people fields kept outside a money module"],
          ].map(([l, v, sub]) => (
            <div key={l} className="rounded-lg border border-[#EFEBE2] bg-[#FAF8F3] p-3">
              <div className="text-xs text-[#6B6B66]">{l}</div>
              <div className={`text-xl font-bold ${l === "To review" && v !== "0" ? "text-[#B42318]" : ""}`}>{v}</div>
              {sub && <div className="text-[11px] text-[#6B6B66]">{sub}</div>}
            </div>
          ))}
          {errors > 0 && <div className="col-span-full text-xs text-[#6B6B66]">{errors} endpoint(s) answered with an error (usually a missing filter) — not a leak.</div>}
        </div>
      )}
      {opened.length > 0 && (
        <div className="overflow-x-auto border-t border-[#EFEBE2]">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#FAF8F3]">
                <th className={TH}>Endpoint (opened)</th>
                <th className={TH}>Hidden from this person</th>
                <th className={TH}>Money / people fields still shown</th>
              </tr>
            </thead>
            <tbody>
              {opened.map((r) => (
                <tr key={r.path} className="border-t border-[#EFEBE2]">
                  <td className={`${TD} font-mono text-[12px]`}>{r.path}</td>
                  <td className={`${TD} text-[#55534E]`}>{r.hidden.join(", ") || "—"}</td>
                  <td className={TD}>
                    {r.kept.length === 0 ? (
                      <span className="text-[#6B6B66]">—</span>
                    ) : (
                      <span className={r.keptExpected ? "text-[#55534E]" : "font-semibold text-[#B42318]"}>
                        {r.kept.join(", ")}
                        {r.keptExpected ? " (money document — expected)" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function AiConnectorPage() {
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [grantId, setGrantId] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("/api/mcp-admin/me");
      setMe(m);
      if (m.isSuperAdmin) setOv(await api<Overview>(`/api/mcp-admin/admin/overview${who ? `?userId=${encodeURIComponent(who)}` : ""}`));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [who]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open / when the person filter changes; state is set after the await
    void load();
  }, [load]);
  useEffect(() => {
    if (!me?.isSuperAdmin) return;
    void fetch("/api/users", { credentials: "include" })
      .then((r) => r.json())
      .then((raw: unknown) => {
        const j = raw as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
        const rows = Array.isArray(j) ? j : j.data ?? [];
        setUsers(
          rows
            .filter((u) => u.isActive === undefined || Number(u.isActive) === 1 || u.isActive === true)
            .map((u) => ({ id: String(u.id), name: String(u.displayName ?? u.email ?? u.id) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => setUsers([]));
  }, [me?.isSuperAdmin]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const url = ov?.connectorUrl ?? me?.connectorUrl ?? "";
  const appsLine = useMemo(() => Object.entries(ov?.stats.connectedApps ?? {}).map(([k, v]) => `${v} ${k}`).join(" · "), [ov]);

  if (err) return <div className="p-6 text-sm text-[#B42318]">Could not load AI Connector: {err}</div>;
  if (!me) return <div className="p-6 text-sm text-[#6B6B66]">Loading…</div>;

  return (
    <div className="mx-auto max-w-[1216px] space-y-5 p-4 sm:p-6">
      <PageHeader
        title={me.isSuperAdmin ? "AI Connector" : "My AI connections"}
        subtitle="Ask Claude or ChatGPT about Hookka ERP in your own words. Each person sees only what their ERP permissions allow."
      />

      <section className={`${CARD} flex flex-wrap items-center justify-between gap-4 p-5`}>
        <div className="min-w-0 flex-1 basis-[420px] space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#6B6B66]">Connector URL — paste this into Claude or ChatGPT</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg border border-[#E6E1D6] bg-[#F6F4EF] px-3 py-2 font-mono text-[15px]">{url}</code>
            <button
              type="button"
              className={SECONDARY}
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-[#E7F3EC] px-3 py-1.5 text-[#1E6B3F]">{me.actionsEnabled ? "READS + CONFIRMED ACTIONS" : "READ-ONLY"}</span>
          <span className="rounded-full bg-[#E8F0F8] px-3 py-1.5 text-[#1F4E6B]">OWN PERMISSIONS</span>
          <span className="rounded-full bg-[#F3EEDF] px-3 py-1.5 text-[#6B5A2E]">EVERY QUESTION LOGGED</span>
        </div>
      </section>

      {me.isSuperAdmin && ov && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Allowed to connect", ov.stats.allowed, "people approved (you always may)"],
              ["Connected now", ov.stats.connectedPeople, appsLine || "no apps yet"],
              ["Questions today", ov.stats.callsToday, ov.limits ? `limit ${ov.limits.perMinute} a minute, ${ov.limits.perDay} a day per person` : "ERP look-ups made"],
              ["Refused (no permission)", ov.stats.refusedToday, "today"],
            ].map(([l, v, s]) => (
              <div key={String(l)} className={`${CARD} space-y-1 p-4`}>
                <div className="text-xs text-[#6B6B66]">{l}</div>
                <div className={`text-2xl font-bold ${l === "Refused (no permission)" && Number(v) > 0 ? "text-[#B42318]" : ""}`}>{v}</div>
                <div className="text-xs text-[#6B6B66]">{s}</div>
              </div>
            ))}
          </div>

          <section className={`${CARD} flex flex-wrap items-center justify-between gap-4 p-5`}>
            <div className="min-w-0 flex-1 basis-[420px] space-y-1">
              <h2 className="text-base font-bold">Allow AI actions (meetings, email)</h2>
              <p className="text-[13px] text-[#55534E]">
                When on, a connected AI can book a meeting or send an email for the person — it shows them each one first and does it only after they confirm. Up to 30 a day per person, as that person, logged below. This is also the main switch for the write actions below. Never payments, stock, prices, payroll or deletes.
              </p>
            </div>
            <label className="flex items-center gap-3 text-sm font-semibold">
              <span>{ov.actionsEnabled ? "On" : "Off"}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!ov.actionsEnabled}
                aria-label="Allow AI actions (meetings, email)"
                disabled={busy}
                onClick={() => act(() => api("/api/mcp-admin/admin/actions", { method: "POST", body: JSON.stringify({ enabled: !ov.actionsEnabled }) }), ov.actionsEnabled ? "AI actions switched off" : "AI actions switched on")}
                className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${FOCUS} ${ov.actionsEnabled ? "bg-[#6B5C32]" : "bg-[#D9D4C7]"}`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${ov.actionsEnabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </label>
          </section>

          <section className={`${CARD} space-y-3 p-5`}>
            <div className="space-y-1">
              <h2 className="text-base font-bold">AI write actions</h2>
              <p className="text-[13px] text-[#55534E]">
                Each is off until you turn it on, and works only while “Allow AI actions” above is on. The person always sees the exact change first and confirms it; the ERP&apos;s own permission and checks decide, and it is logged here and in the ERP&apos;s audit trail. Never payments, stock, prices, payroll or deletes.
              </p>
            </div>
            {WRITE_ACTION_ROWS.map((r) => {
              const on = !!ov.writeActions?.[r.key];
              return (
                <div key={r.key} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEBE2] pt-3">
                  <div className="min-w-0 flex-1 basis-[320px]">
                    <div className="text-sm font-semibold">{r.label}</div>
                    <div className="text-[13px] text-[#55534E]">{r.help}</div>
                  </div>
                  <label className="flex items-center gap-3 text-sm font-semibold">
                    <span>{on ? (ov.actionsEnabled ? "On" : "On (main switch off)") : "Off"}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={r.label}
                      disabled={busy}
                      onClick={() => act(() => api("/api/mcp-admin/admin/write-actions", { method: "POST", body: JSON.stringify({ action: r.key, enabled: !on }) }), on ? `${r.label}: off` : `${r.label}: on`)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${FOCUS} ${on ? "bg-[#6B5C32]" : "bg-[#D9D4C7]"}`}
                    >
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </label>
                </div>
              );
            })}
          </section>

          <section id="approve" className="overflow-hidden rounded-xl border border-[#EADFC2] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEBE2] bg-[#FBF7EC] px-5 py-4">
              <h2 className="text-base font-bold">Waiting for your approval ({ov.requests.length})</h2>
              <span className="text-[13px] text-[#55534E]">Staff press “Request access” on this page; you get a bell notification.</span>
            </div>
            {ov.requests.length === 0 && <p className="px-5 py-4 text-sm text-[#6B6B66]">No requests waiting.</p>}
            {ov.requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEBE2] px-5 py-3.5 first:border-t-0">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">
                    {r.name} <span className="font-normal text-[#6B6B66]">· {r.role}</span>
                  </div>
                  <div className="text-[13px] text-[#55534E]">
                    Asked {when(r.at)}
                    {r.reason ? ` · “${r.reason}”` : ""}
                  </div>
                  <div className="text-xs text-[#6B6B66]">Will see the same as their ERP login.</div>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className={PRIMARY} onClick={() => act(() => api(`/api/mcp-admin/admin/requests/${r.id}/approve`, { method: "POST", body: "{}" }), `${r.name} approved`)}>
                    Approve
                  </button>
                  <button type="button" disabled={busy} className={SECONDARY} onClick={() => act(() => api(`/api/mcp-admin/admin/requests/${r.id}/reject`, { method: "POST", body: "{}" }), `${r.name} rejected`)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-[#EFEBE2] px-5 py-3 text-[13px] text-[#55534E]">
              <label htmlFor="grant" className="font-semibold text-[#1F1D1A]">Turn on for someone without a request:</label>
              <select id="grant" value={grantId} onChange={(e) => setGrantId(e.target.value)} className={`h-9 max-w-full rounded-lg border border-[#D9D4C7] bg-white px-2 text-sm ${FOCUS}`}>
                <option value="">Choose a person…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <button type="button" disabled={busy || !grantId} className={PRIMARY} onClick={() => act(() => api("/api/mcp-admin/admin/access", { method: "POST", body: JSON.stringify({ userId: grantId }) }), "Turned on")}>
                Turn on
              </button>
            </div>
          </section>

          <section className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEBE2] px-5 py-4">
              <h2 className="text-base font-bold">Connected people</h2>
              <span className="text-[13px] text-[#6B6B66]">Disconnect signs that app out at once. Remove access to stop a person for good.</span>
            </div>
            {ov.connections.length === 0 ? (
              <p className="px-5 py-4 text-sm text-[#6B6B66]">Nobody is connected yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#FAF8F3]">
                      <th className={TH}>Person</th>
                      <th className={TH}>Role</th>
                      <th className={TH}>App</th>
                      <th className={TH}>Connected</th>
                      <th className={TH}>Last used</th>
                      <th className={`${TH} text-right`}>Questions (7 days)</th>
                      <th className={TH}><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.connections.map((c) => (
                      <tr key={c.tokenId} className="border-t border-[#EFEBE2]">
                        <td className={`${TD} font-semibold`}>{c.name || c.userId}</td>
                        <td className={`${TD} text-[#55534E]`}>{c.role}</td>
                        <td className={TD}><span className="rounded-md bg-[#F3EEDF] px-2 py-0.5 text-xs font-semibold text-[#4A3E1F]">{c.app}</span></td>
                        <td className={`${TD} text-[#55534E]`}>{when(c.connectedAt)}</td>
                        <td className={`${TD} text-[#55534E]`}>{when(c.lastUsedAt)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{c.callsWeek ?? 0}</td>
                        <td className={`${TD} text-right`}>
                          <button type="button" disabled={busy} className={DANGER} onClick={() => act(() => api("/api/mcp-admin/admin/revoke", { method: "POST", body: JSON.stringify({ tokenId: c.tokenId }) }), "Disconnected")}>
                            Disconnect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ov.allowed.length > 0 && (
              <div className="border-t border-[#EFEBE2] px-5 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B6B66]">Allowed to connect</div>
                <div className="flex flex-wrap gap-2">
                  {ov.allowed.map((a) => (
                    <span key={a.userId} className="inline-flex items-center gap-2 rounded-full border border-[#E6E1D6] bg-[#FAF8F3] py-1 pl-3 pr-1 text-sm">
                      {a.name}
                      <button
                        type="button"
                        aria-label={`Remove access for ${a.name}`}
                        disabled={busy}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold text-[#B42318] hover:bg-[#FDECEA] ${FOCUS}`}
                        onClick={() => act(() => api(`/api/mcp-admin/admin/access/${encodeURIComponent(a.userId)}`, { method: "DELETE" }), `Access removed for ${a.name}`)}
                      >
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {ov.latency && <LatencyCard latency={ov.latency} />}

          <LeakCheck people={ov.allowed} />

          <section className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEBE2] px-5 py-4">
              <h2 className="text-base font-bold">Recent questions</h2>
              <label className="flex items-center gap-2 text-[13px] text-[#55534E]">
                Person
                <select value={who} onChange={(e) => setWho(e.target.value)} className={`h-9 rounded-lg border border-[#D9D4C7] bg-white px-2 text-sm ${FOCUS}`}>
                  <option value="">Everyone</option>
                  {[...new Map(ov.connections.map((c) => [c.userId, c.name])).entries()].map(([id, name]) => (
                    <option key={id} value={id}>{name || id}</option>
                  ))}
                </select>
              </label>
            </div>
            <CallsTable calls={ov.calls} showWho />
          </section>
        </>
      )}

      {!me.isSuperAdmin && !me.allowed && (
        <section className="rounded-xl border border-[#EADFC2] bg-[#FBF7EC] p-5">
          <h2 className="text-base font-bold">AI Connector is not turned on for your account</h2>
          {me.pendingRequestAt ? (
            <p className="mt-1 text-sm text-[#4A3E1F]">Request sent {when(me.pendingRequestAt)} — waiting for approval. You will get a notification.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="why" className="sr-only">Why do you need it?</label>
              <input
                id="why"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What will you ask? (optional)"
                className={`h-10 min-w-0 flex-1 basis-[260px] rounded-lg border border-[#D9D4C7] bg-white px-3 text-sm ${FOCUS}`}
              />
              <button type="button" disabled={busy} className={PRIMARY} onClick={() => act(() => api("/api/mcp-admin/me/request", { method: "POST", body: JSON.stringify({ reason }) }), "Request sent")}>
                Request access
              </button>
            </div>
          )}
        </section>
      )}

      {(me.allowed || me.isSuperAdmin) && (
        <section className={`${CARD} overflow-hidden`}>
          <div className="border-b border-[#EFEBE2] px-5 py-4">
            <h2 className="text-base font-bold">My connected apps</h2>
          </div>
          {me.connections.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[#6B6B66]">No app connected yet — follow “How to connect” below.</p>
          ) : (
            me.connections.map((c) => (
              <div key={c.tokenId} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEBE2] px-5 py-4 first:border-t-0">
                <div>
                  <div className="text-[15px] font-semibold">{c.app}</div>
                  <div className="text-[13px] text-[#6B6B66]">Connected {when(c.connectedAt)} · last used {when(c.lastUsedAt)}</div>
                </div>
                <button type="button" disabled={busy} className={DANGER} onClick={() => act(() => api("/api/mcp-admin/me/revoke", { method: "POST", body: JSON.stringify({ tokenId: c.tokenId }) }), "Disconnected")}>
                  Disconnect
                </button>
              </div>
            ))
          )}
        </section>
      )}

      {(me.allowed || me.isSuperAdmin) && <HowTo url={url} />}

      {!me.isSuperAdmin && me.allowed && (
        <section className={`${CARD} overflow-hidden`}>
          <div className="border-b border-[#EFEBE2] px-5 py-4">
            <h2 className="text-base font-bold">What the AI looked up for me</h2>
          </div>
          <CallsTable calls={me.calls} showWho={false} />
        </section>
      )}

      <p className="text-xs text-[#6B6B66]">
        {me.actionsEnabled
          ? "The AI reads with your permissions. It can book a meeting, send an email — and, where your admin turned them on, reply to a Mail Center thread, add a note to a PO or service case, or approve a PO — only after you confirm each one, and only where your ERP permissions allow; it cannot touch payments, stock, prices or payroll, or delete anything."
          : "The AI can only read — it cannot create, change or delete anything."}{" "}
        Your admin can see what it looked up and did; the chat itself stays in Claude / ChatGPT.
        {me.limits ? ` Limits: ${me.limits.perMinute} questions a minute and ${me.limits.perDay} a day per person.` : ""}
      </p>
    </div>
  );
}
