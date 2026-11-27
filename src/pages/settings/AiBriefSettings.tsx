// Settings › AI Connector › "Morning brief & urgent alerts" (round 4d, owner
// 2026-11-26). The person opts in themselves: brief time (Malaysia, half-hour
// steps — the check runs every 30 minutes), weekdays or every day, urgent
// alerts on/off. Thresholds are shown read-only (they live in one config,
// src/api/lib/mcp-proactive.ts PROACTIVE_CONFIG). Everything is built AS the
// person, so the email only ever shows what their ERP permissions allow.
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useAiBriefSettings, type BriefSubscription } from "./useAiBriefSettings";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32] focus-visible:ring-offset-1";
const BTN = `inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold ${FOCUS}`;
const PRIMARY = `${BTN} bg-[#6B5C32] text-white hover:bg-[#574A27] disabled:opacity-50`;
const SECONDARY = `${BTN} border border-[#D9D4C7] bg-white text-[#1F1D1A] hover:bg-[#FAF8F3] disabled:opacity-50`;

const TIMES = Array.from({ length: 36 }, (_, i) => {
  const m = 5 * 60 + i * 30; // 05:00 … 22:30
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 === 0 ? "00" : "30"}`;
});

const KIND_WORDS: Record<string, string> = { brief: "Morning brief", brief_test: "Test brief", alert: "Urgent alert" };

function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
}

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${FOCUS} ${on ? "bg-[#6B5C32]" : "bg-[#D9D4C7]"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function AiBriefSettings() {
  const { toast } = useToast();
  const { data, error, save, sendTest, preview } = useAiBriefSettings();
  const [draft, setDraft] = useState<BriefSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  if (error) return <section className="rounded-xl border border-[#E6E1D6] bg-white p-5 text-sm text-[#B42318]">Could not load the morning brief settings: {error}</section>;
  if (!data || !data.allowed) return null;

  const sub = draft ?? data.subscription;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(data.subscription);
  const set = (patch: Partial<BriefSubscription>) => setDraft({ ...sub, ...patch });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-[#E6E1D6] bg-white p-5">
      <div className="space-y-1">
        <h2 className="text-base font-bold">Morning brief &amp; urgent alerts by email</h2>
        <p className="text-[13px] text-[#55534E]">
          Sent to <b>{data.email || "(no email on your account)"}</b>. Built as you, so it shows only what your ERP permissions allow. Every email has an unsubscribe link.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEBE2] pt-4">
        <div className="min-w-0 flex-1 basis-[320px]">
          <div className="text-sm font-semibold">Morning brief</div>
          <div className="text-[13px] text-[#55534E]">What needs a look today: overdue and due-soon orders, mail waiting for you, approvals — counts and the top 5 with links. On Mondays it also lists data gaps to fill.</div>
        </div>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <span>{sub.briefEnabled ? "On" : "Off"}</span>
          <Switch on={sub.briefEnabled} label="Morning brief" disabled={busy} onClick={() => set({ briefEnabled: !sub.briefEnabled })} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="brief-time" className="font-semibold">Time (Malaysia)</label>
        <select id="brief-time" value={sub.briefTime} disabled={busy} onChange={(e) => set({ briefTime: e.target.value })} className={`h-10 rounded-lg border border-[#D9D4C7] bg-white px-2 text-sm ${FOCUS}`}>
          {TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label htmlFor="brief-days" className="font-semibold">Days</label>
        <select id="brief-days" value={sub.briefDays} disabled={busy} onChange={(e) => set({ briefDays: e.target.value === "daily" ? "daily" : "weekdays" })} className={`h-10 rounded-lg border border-[#D9D4C7] bg-white px-2 text-sm ${FOCUS}`}>
          <option value="weekdays">Weekdays (Mon–Fri)</option>
          <option value="daily">Every day</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEBE2] pt-4">
        <div className="min-w-0 flex-1 basis-[320px]">
          <div className="text-sm font-semibold">Urgent alerts</div>
          <div className="text-[13px] text-[#55534E]">An email when something you can see becomes urgent. Each alert is sent to you once.</div>
        </div>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <span>{sub.alertsEnabled ? "On" : "Off"}</span>
          <Switch on={sub.alertsEnabled} label="Urgent alerts" disabled={busy} onClick={() => set({ alertsEnabled: !sub.alertsEnabled })} />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#EFEBE2]">
        <table className="w-full text-[13px]">
          <caption className="bg-[#FAF8F3] px-3 py-2 text-left text-xs font-semibold text-[#55534E]">Alert rules (set by the admin, read-only)</caption>
          <tbody>
            {data.thresholds.map((t) => (
              <tr key={t.label} className="border-t border-[#EFEBE2]">
                <th scope="row" className="w-[40%] px-3 py-2 text-left align-top font-semibold">{t.label}</th>
                <td className="px-3 py-2 align-top text-[#55534E]">{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#6B6B66]">{data.schedule}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={busy || !dirty} onClick={() => run(async () => { await save(sub); setDraft(null); }, "Email settings saved")}>
          Save
        </button>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => run(async () => setPreviewHtml((await preview()).html), "Preview ready (nothing was sent)")}>
          Preview my brief
        </button>
        <button type="button" className={SECONDARY} disabled={busy || !data.email} onClick={() => run(async () => { const r = await sendTest(); return r; }, `Test brief queued to ${data.email}`)}>
          Send me a test brief
        </button>
      </div>

      {previewHtml !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#55534E]">Preview — not sent</span>
            <button type="button" className={`text-xs font-semibold text-[#6B5C32] underline ${FOCUS}`} onClick={() => setPreviewHtml(null)}>
              Close preview
            </button>
          </div>
          <iframe title="Morning brief preview" sandbox="" srcDoc={previewHtml} className="h-[520px] w-full rounded-lg border border-[#E6E1D6] bg-[#F6F4EF]" />
        </div>
      )}

      {data.recent.length > 0 && (
        <div className="border-t border-[#EFEBE2] pt-3">
          <div className="mb-1 text-xs font-semibold text-[#55534E]">Recent emails</div>
          <ul className="space-y-1 text-[13px] text-[#55534E]">
            {data.recent.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                {stamp(r.at)} · {KIND_WORDS[r.kind] ?? r.kind} · {r.status === "queued" ? `${r.items} item${r.items === 1 ? "" : "s"}` : r.status}
                {r.note && r.status !== "queued" ? ` — ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
