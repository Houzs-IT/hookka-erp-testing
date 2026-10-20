// ---------------------------------------------------------------------------
// Setup › Currency & FX (owner 2026-10-20 「要」, the design's page; plan
// docs/superpowers/plans/2026-10-20-currency-fx.md). Two cards:
//   - FX gain / loss accounts — where a realised FX difference on a payment
//     posts (both 530-0000 GAIN ON FOREIGN EXCHANGE, his ruling, until he
//     splits them here);
//   - Monthly rates (1 unit = RM) — one row per currency, the six months to
//     this one, each cell keyed in place (Enter or leaving the cell saves; an
//     empty cell clears it), "+ Add currency", × to remove a currency.
// A month's rate is only the DEFAULT a form fills in for the document's month;
// each document keeps its own rate, so nothing here changes a posted figure.
// The page warns when this month has no rate for a currency on the list.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ChartOfAccount } from "@/types";
import { FX_DEFAULT_ACCOUNT, fmtFxRate, fxMonthLabel, parseFxRate, type FxSettings } from "@/lib/fx";

type FxPayload = FxSettings & { thisMonth: string; months: string[]; missing: string[] };

const asJson = (r: Response) => r.json() as Promise<{ success?: boolean; error?: string }>;

export function FxTab({ accounts }: { accounts: ChartOfAccount[] }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [data, setData] = useState<FxPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/fx?x=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ success?: boolean; data?: FxPayload }>)
      .then((j) => {
        if (j?.success && j.data) { setData(j.data); setFailed(false); } else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Monthly rates: a cell's typed text until it is saved ──
  const [cells, setCells] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const keyOf = (code: string, ym: string) => `${code}|${ym}`;
  const stored = (code: string, ym: string): number | null => data?.rates[code]?.[ym] ?? null;
  const cellText = (code: string, ym: string) => {
    const k = keyOf(code, ym);
    if (k in cells) return cells[k];
    const r = stored(code, ym);
    return r === null ? "" : fmtFxRate(r);
  };
  const dropDraft = (k: string) => setCells((p) => { const n = { ...p }; delete n[k]; return n; });
  const saveCell = async (code: string, ym: string) => {
    const k = keyOf(code, ym);
    if (!(k in cells)) return;
    const text = cells[k].trim();
    const rate = text === "" ? null : parseFxRate(text);
    if (text !== "" && rate === null) {
      toast.error(`${code} ${fxMonthLabel(ym)}: a rate is a number above 0 with at most six decimals`);
      return;
    }
    if (rate === stored(code, ym)) { dropDraft(k); return; }
    setBusy(k);
    try {
      const j = await asJson(await fetch("/api/fx/rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: code, month: ym, rate }),
      }));
      if (j?.success) {
        toast.success(rate === null ? `${code} ${fxMonthLabel(ym)} cleared` : `${code} ${fxMonthLabel(ym)} = RM ${fmtFxRate(rate)}`);
        dropDraft(k);
        load();
      } else toast.error(j?.error || "Save failed");
    } catch {
      toast.error("Save failed");
    } finally {
      setBusy(null);
    }
  };

  // ── Currencies ──
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const addCurrency = async () => {
    setBusy("add");
    try {
      const j = await asJson(await fetch("/api/fx/currency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode, name: newName }),
      }));
      if (j?.success) { toast.success(`${newCode.trim().toUpperCase()} added — key its monthly rates`); setNewCode(""); setNewName(""); load(); }
      else toast.error(j?.error || "Add failed");
    } catch {
      toast.error("Add failed");
    } finally {
      setBusy(null);
    }
  };
  const removeCurrency = async (code: string) => {
    const ok = await confirm({
      title: `Remove ${code}?`,
      message: `Its monthly rates are removed. Documents already keyed in ${code} keep their own rate.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(`del|${code}`);
    try {
      const j = await asJson(await fetch(`/api/fx/currency/${encodeURIComponent(code)}`, { method: "DELETE" }));
      if (j?.success) { toast.success(`${code} removed`); load(); }
      else toast.error(j?.error || "Remove failed");
    } catch {
      toast.error("Remove failed");
    } finally {
      setBusy(null);
    }
  };

  // ── FX gain / loss accounts ──
  const [gain, setGain] = useState<string | null>(null);
  const [loss, setLoss] = useState<string | null>(null);
  const gainVal = gain ?? data?.gainAccount ?? FX_DEFAULT_ACCOUNT;
  const lossVal = loss ?? data?.lossAccount ?? FX_DEFAULT_ACCOUNT;
  const accountsChanged = !!data && (gainVal !== data.gainAccount || lossVal !== data.lossAccount);
  const postable = useMemo(
    () => accounts.filter((a) => a.isActive !== false && a.isPostable !== false).sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );
  const optionsFor = (current: string) =>
    postable.some((a) => a.code === current) ? postable : [{ code: current, name: "(not found)" } as ChartOfAccount, ...postable];
  const saveAccounts = async () => {
    setBusy("accounts");
    try {
      const j = await asJson(await fetch("/api/fx/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gainAccount: gainVal, lossAccount: lossVal }),
      }));
      if (j?.success) { toast.success("FX accounts saved — payments posted from now on use them"); setGain(null); setLoss(null); load(); }
      else toast.error(j?.error || "Save failed");
    } catch {
      toast.error("Save failed");
    } finally {
      setBusy(null);
    }
  };

  if (failed) return <p className="text-sm text-[#9A3A2D]">Could not load Currency &amp; FX.</p>;
  if (!data) return <p className="text-sm text-[#9CA3AF]">Loading…</p>;

  const selCls = "w-full rounded-md border border-[#E2DDD8] bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4" data-fx-page="">
      {data.missing.length > 0 && (
        <div className="rounded-md border border-[#E8D9B5] bg-[#FBF3E4] px-3 py-2 text-sm text-[#7A5B12]" data-fx-missing="">
          {fxMonthLabel(data.thisMonth)} rate not set: <b>{data.missing.join(", ")}</b> — a form in that currency will ask for the rate.
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-[#1F1D1B]">FX Gain / Loss Accounts</h3>
          <p className="mt-1 text-[11px] text-[#9CA3AF]">
            Where the difference posts when a foreign-currency bill is paid at a rate other than its own: a gain (less RM paid than booked) is credited to the first account, a loss debited to the second. Payments already posted stay where they posted.
          </p>
          <div className="mt-3 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-xs font-medium text-[#6B7280]">
              Realised FX gain posts to
              <select aria-label="Realised FX gain posts to" className={`${selCls} mt-1`} value={gainVal} onChange={(e) => setGain(e.target.value)}>
                {optionsFor(gainVal).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-[#6B7280]">
              Realised FX loss posts to
              <select aria-label="Realised FX loss posts to" className={`${selCls} mt-1`} value={lossVal} onChange={(e) => setLoss(e.target.value)}>
                {optionsFor(lossVal).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </label>
            <Button variant="primary" size="sm" disabled={!accountsChanged || busy === "accounts"} onClick={() => void saveAccounts()}>
              {busy === "accounts" ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-[#1F1D1B]">Monthly Rates <span className="font-normal text-[#6B7280]">· 1 unit = RM</span></h3>
          <p className="mt-1 text-[11px] text-[#9CA3AF]">
            A form fills in the rate for its document&apos;s month — it can be changed there, and each document keeps its own rate. Changing a rate here never changes a document already keyed. Enter or leave a cell to save it; empty a cell to clear it.
          </p>
          {data.currencies.length === 0 ? (
            <p className="mt-3 text-sm text-[#6B7280]" data-fx-empty="">No foreign currency yet — add one below (e.g. USD, CNY) to key its monthly rates.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table data-fin-list className="text-sm">
                <thead>
                  <tr className="text-[12px] text-[#6B7280]">
                    <th className="px-2 py-1.5 text-left font-semibold">Currency</th>
                    {data.months.map((ym) => (
                      <th key={ym} className={`px-2 py-1.5 text-right font-semibold whitespace-nowrap ${ym === data.thisMonth ? "text-[#1F1D1B]" : ""}`}>{fxMonthLabel(ym)}</th>
                    ))}
                    <th className="w-10 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.currencies.map((cur) => (
                    <tr key={cur.code} data-fin-nolift="">
                      <td className="px-2 py-1.5 whitespace-nowrap"><b>{cur.code}</b>{cur.name && <span className="ml-2 text-[#6B7280]">{cur.name}</span>}</td>
                      {data.months.map((ym) => {
                        const k = keyOf(cur.code, ym);
                        const text = cellText(cur.code, ym);
                        const empty = text.trim() === "";
                        const bad = !empty && parseFxRate(text) === null;
                        return (
                          <td key={ym} className="px-1 py-1">
                            <input
                              aria-label={`${cur.code} ${fxMonthLabel(ym)}`}
                              type="text"
                              inputMode="decimal"
                              value={text}
                              placeholder="not set"
                              disabled={busy === k}
                              onChange={(e) => setCells((p) => ({ ...p, [k]: e.target.value }))}
                              onBlur={() => void saveCell(cur.code, ym)}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { dropDraft(k); e.currentTarget.blur(); } }}
                              title={bad ? "Not a rate — a number above 0, at most six decimals" : undefined}
                              className={`w-24 rounded border px-2 py-1 text-right text-sm tabular-nums ${bad ? "border-[#9A3A2D] text-[#9A3A2D]" : empty ? "border-[#E8C9C2] bg-[#FDF6F4] placeholder:text-[#C0857A]" : "border-[#E2DDD8]"}`}
                            />
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          title={`Remove ${cur.code}`}
                          disabled={busy === `del|${cur.code}`}
                          onClick={() => void removeCurrency(cur.code)}
                          className="rounded px-1.5 text-[#9CA3AF] hover:bg-[#F7E5E1] hover:text-[#9A3A2D]"
                        >×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2" data-fx-add="">
            <label className="text-xs font-medium text-[#6B7280]">
              Code
              <input
                aria-label="New currency code"
                value={newCode}
                maxLength={3}
                placeholder="USD"
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                className="mt-1 block w-20 rounded border border-[#E2DDD8] px-2 py-1 text-sm uppercase"
              />
            </label>
            <label className="text-xs font-medium text-[#6B7280]">
              Name
              <input
                aria-label="New currency name"
                value={newName}
                placeholder="US Dollar"
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 block w-48 rounded border border-[#E2DDD8] px-2 py-1 text-sm"
              />
            </label>
            <Button variant="outline" size="sm" disabled={newCode.trim().length !== 3 || busy === "add"} onClick={() => void addCurrency()}>
              + Add currency
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
