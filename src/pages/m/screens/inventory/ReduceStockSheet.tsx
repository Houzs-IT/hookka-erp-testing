// ===========================================================================
// Reduce stock — the prototype's sheet: form → review → saving → done / error.
// Raw materials only; POST /api/stock-adjustments exactly as desktop sends it
// (type RM, negative qtyDelta, reason enum, unitCostSen 0, adjustedBy /
// adjustedByName from the signed-in user).
//
// Duplicate protection on THIS side (the server stays the authority):
//   • the submit is ignored while a request is in flight (ref guard + disabled);
//   • one Idempotency-Key per intent: a retry of the same body reuses it, a
//     changed body gets a new one (keyForIntent);
//   • an uncertain outcome (no answer, timeout, 5xx, "still in flight") never
//     offers an immediate resubmit: the balance is re-read from the server and
//     shown first, and only then can a submission be made again;
//   • on success the balance is re-read, never computed here.
// A definite refusal (400 / 403 / 404 / 409 below zero) shows the server's own
// words, verbatim.
// ===========================================================================
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleHelp, PackageMinus, X as XIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { refreshList, refreshOne } from "../../config/mutate";
import { Sheet } from "../../components/Sheet";
import {
  classifyOutcome, keyForIntent, parseQty, q2, REDUCE_REASONS, reduceBody, toRm, URLS, validateReduceQty, withUom,
  type IntentKey, type ReduceReason, type RmRow,
} from "../../lib/inventory-lib";
import { Spinner } from "../threepl/tpl-kit";
import { Rows } from "./inv-kit";
import { BTN_PRIMARY, BTN_SECOND, SH_SECTION, X } from "./inv-style";

type Step = "form" | "review" | "busy" | "done" | "rejected" | "checking" | "uncertain" | "discard";

const mintKey = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Read the material's balance straight from the server (no cache). */
async function readBalance(id: string): Promise<RmRow | null> {
  try {
    const res = await fetch(URLS.rmOne(id), { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Record<string, unknown> };
    return j?.data ? toRm(j.data) : null;
  } catch {
    return null;
  }
}

/** Every cached read the adjustment touches. */
function invalidateAfterWrite(id: string) {
  refreshOne(URLS.rmOne(id));
  refreshList(URLS.rm, URLS.adjustments, `/api/stock/breakdown?type=RM&itemId=${encodeURIComponent(id)}`);
}

export function ReduceStockSheet({ rm, onClose, onSaved }: { rm: RmRow; onClose: () => void; onSaved: (msg: string) => void }) {
  const [step, setStep] = useState<Step>("form");
  const [back, setBack] = useState<Step>("form");
  const [reason, setReason] = useState<ReduceReason>("COUNT_CORRECTION");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState("");
  const [balance, setBalance] = useState<number>(rm.balanceQty);
  const [checkedOk, setCheckedOk] = useState(true);
  const inflight = useRef(false);
  const key = useRef<IntentKey>(null);

  const uom = rm.baseUOM;
  const err = validateReduceQty(qty, balance, uom);
  const n = parseQty(qty);
  const dirty = qty.trim() !== "" || notes.trim() !== "";
  const locked = step === "busy" || step === "checking";

  const close = useCallback(() => {
    if (locked) return;
    if ((step === "form" || step === "review") && dirty) {
      setBack(step);
      setStep("discard");
      return;
    }
    onClose();
  }, [locked, step, dirty, onClose]);
  // The shared Sheet re-focuses its first control whenever onClose changes, so
  // it gets one stable function that calls the current closer.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  const stableClose = useCallback(() => closeRef.current(), []);

  const refreshBalance = async (): Promise<boolean> => {
    setStep("checking");
    const fresh = await readBalance(rm.id);
    invalidateAfterWrite(rm.id);
    if (fresh) setBalance(fresh.balanceQty);
    setCheckedOk(!!fresh);
    return !!fresh;
  };

  const submit = async () => {
    if (inflight.current || err) return;
    inflight.current = true;
    setStep("busy");
    const body = reduceBody({ itemId: rm.id, qty: n, reason, notes, user: getCurrentUser() });
    key.current = keyForIntent(key.current, body, mintKey);
    let status = 0;
    let parsed: unknown = null;
    try {
      const res = await fetch(URLS.adjustments, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current.key },
        body: JSON.stringify(body),
      });
      status = res.status;
      parsed = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    const out = classifyOutcome(status, parsed);
    if (out.kind === "ok") {
      const fresh = await readBalance(rm.id);
      invalidateAfterWrite(rm.id);
      if (fresh) setBalance(fresh.balanceQty);
      const no = out.adjNo || "The adjustment";
      setMsg(fresh ? `${no} saved. New balance ${withUom(fresh.balanceQty, uom)}.` : `${no} saved. The new balance shows once the page refreshes.`);
      key.current = null; // the intent is done; another reduction is a new intent
      setStep("done");
    } else if (out.kind === "rejected") {
      setMsg(out.error);
      setStep("rejected");
    } else {
      setMsg(out.error);
      await refreshBalance();
      setStep("uncertain");
    }
    inflight.current = false;
  };

  const startAgain = () => {
    setQty("");
    setTried(false);
    setStep("form");
  };

  // ---- buttons per step ----
  let secondL = "Cancel";
  let second: () => void = close;
  let primaryL = "Review";
  let primary: () => void = () => {
    if (err) setTried(true);
    else setStep("review");
  };
  let danger = false;
  if (step === "review") {
    secondL = "Back";
    second = () => setStep("form");
    primaryL = "Confirm adjustment";
    primary = () => void submit();
    danger = true;
  } else if (step === "busy") {
    secondL = "Back";
    primaryL = "Saving…";
    danger = true;
  } else if (step === "done") {
    secondL = "Close";
    second = onClose;
    primaryL = "Done";
    primary = () => onSaved(msg);
  } else if (step === "rejected") {
    secondL = "Close";
    second = onClose;
    primaryL = "Change details";
    primary = () => setStep("form");
  } else if (step === "checking") {
    secondL = "Close";
    primaryL = "Checking…";
  } else if (step === "uncertain") {
    secondL = "Close";
    second = onClose;
    if (checkedOk) {
      primaryL = "Start a new reduction";
      primary = startAgain;
    } else {
      primaryL = "Check again";
      primary = () => void refreshBalance().then(() => setStep("uncertain"));
    }
  } else if (step === "discard") {
    secondL = "Keep editing";
    second = () => setStep(back);
    primaryL = "Discard";
    primary = onClose;
    danger = true;
  }

  const form = step === "form";
  const summary = step === "review" || step === "busy" || step === "rejected";
  const reasonL = REDUCE_REASONS.find((r) => r.k === reason)?.l ?? reason;

  return (
    <Sheet open onClose={stableClose} title="Reduce stock" bare portal panelStyle={{ background: X.bg, color: X.ink, display: "flex", flexDirection: "column", overflow: "hidden", paddingBottom: 0, maxHeight: "92dvh" }}>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: X.ln }} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Reduce stock</div>
          <div style={{ fontSize: 12, color: X.mut, marginTop: 2 }}>Removes stock immediately · no approval step</div>
        </div>
        <button type="button" onClick={close} disabled={locked} aria-label="Close" style={{ width: 44, height: 44, margin: "-8px -10px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: locked ? "default" : "pointer", color: X.mut, flex: "none", opacity: locked ? 0.5 : 1 }}>
          <XIcon size={20} strokeWidth={1.9} />
        </button>
      </div>

      <div className="tpl-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 16px 0", scrollbarWidth: "none", display: "grid", gap: 14, alignContent: "start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 16, background: X.card, boxShadow: SH_SECTION }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.br, overflowWrap: "anywhere" }}>{rm.itemCode}</span>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, marginTop: 2, lineHeight: 1.3, overflowWrap: "anywhere" }}>{rm.description || "—"}</span>
          </span>
          <span style={{ flex: "none", textAlign: "right" }}>
            <span style={{ display: "block", fontSize: 11, color: X.mut }}>{step === "uncertain" || step === "done" ? "Balance now" : "Available"}</span>
            <span style={{ display: "block", fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{withUom(balance, uom)}</span>
          </span>
        </div>

        {form ? (
          <>
            <div>
              <div style={{ marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>Reason</div>
              <div role="radiogroup" aria-label="Reason" style={{ display: "grid", gap: 6 }}>
                {REDUCE_REASONS.map((o) => {
                  const on = reason === o.k;
                  return (
                    <button
                      key={o.k}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setReason(o.k)}
                      style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 12px", borderRadius: 12, border: "none", background: X.card, boxShadow: on ? `0 0 0 1.5px ${X.pri}` : `0 0 0 1px ${X.ln}`, fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink }}
                    >
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: on ? 700 : 600 }}>{o.l}</span>
                      <span style={{ width: 20, height: 20, flex: "none", borderRadius: "50%", boxShadow: on ? `inset 0 0 0 6px ${X.pri}` : `inset 0 0 0 1.5px ${X.chev}` }} />
                    </button>
                  );
                })}
              </div>
            </div>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>Quantity to remove</span>
              <span style={{ display: "flex", alignItems: "center", height: 48, padding: "0 13px", borderRadius: 12, background: X.inp, boxShadow: tried && err ? `0 0 0 1.5px ${X.bad}` : `0 0 0 1px ${X.ln}` }}>
                <input
                  className="tpl-in"
                  type="text"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="0"
                  aria-invalid={tried && !!err}
                  aria-label="Quantity to remove"
                  style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 17, fontWeight: 700, color: X.ink, padding: 0, fontVariantNumeric: "tabular-nums" }}
                />
                <span style={{ flex: "none", fontSize: 13, fontWeight: 600, color: X.mut }}>{uom}</span>
              </span>
              {tried && err ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: X.bad }}>{err}</span> : null}
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>
                Notes <span style={{ fontWeight: 500, color: X.mut }}>optional</span>
              </span>
              <textarea
                className="tpl-in"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Water damage at rack B3"
                style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 12, border: "none", background: X.inp, boxShadow: `0 0 0 1px ${X.ln}`, fontFamily: "inherit", fontSize: 16, lineHeight: 1.45, color: X.ink, outline: "none", resize: "vertical" }}
              />
            </label>
          </>
        ) : null}

        {summary ? (
          <Rows
            rows={[
              { k: "Material", v: rm.itemCode },
              { k: "Reason", v: reasonL },
              { k: "Remove", v: `−${withUom(Number.isFinite(n) ? n : 0, uom)}`, c: X.bad },
              { k: "Balance after", v: `About ${withUom(Math.round((balance - (Number.isFinite(n) ? n : 0)) * 10000) / 10000, uom)}` },
              ...(notes.trim() ? [{ k: "Notes", v: notes.trim() }] : []),
            ]}
          />
        ) : null}

        {step === "done" ? <Result tone="ok" title="Stock reduced.">{msg}</Result> : null}
        {step === "rejected" ? <Result tone="bad" title="Not saved.">{msg}</Result> : null}
        {step === "checking" ? <Result tone="warn" title="Checking the balance…">We didn't get a clear answer from the server, so the current balance is being read again before anything else.</Result> : null}
        {step === "uncertain" ? (
          <Result tone="warn" title="We couldn't confirm the save.">
            {checkedOk
              ? `${msg} The stock may or may not have been reduced. The balance above was just re-read from the server: ${withUom(balance, uom)}. Check the Adjustments tab before reducing again.`
              : `${msg} The balance couldn't be re-read either. Check your connection, then check again before reducing.`}
          </Result>
        ) : null}
        {step === "discard" ? <Result tone="warn" title="Discard this reduction?">Nothing has been saved yet. Your quantity and notes will be lost.</Result> : null}
        {step === "review" ? <div style={{ fontSize: 11.5, color: X.mut, lineHeight: 1.45, padding: "0 4px" }}>{`The server takes ${q2(Number.isFinite(n) ? n : 0)} ${uom} from the oldest receipt lots first. The final balance is read back after saving.`}</div> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)", gap: 8, padding: "14px 16px calc(16px + env(safe-area-inset-bottom))", flex: "none" }}>
        <button type="button" onClick={second} disabled={locked} style={{ ...BTN_SECOND, opacity: locked ? 0.6 : 1, cursor: locked ? "default" : "pointer" }}>
          {secondL}
        </button>
        <button
          type="button"
          onClick={primary}
          disabled={locked}
          style={{ ...BTN_PRIMARY, fontSize: 14.5, background: danger ? X.bad : X.grad, opacity: locked ? 0.75 : 1, cursor: locked ? "default" : "pointer" }}
        >
          {locked ? <Spinner /> : step === "form" ? <PackageMinus size={17} strokeWidth={2} /> : null}
          {primaryL}
        </button>
      </div>
    </Sheet>
  );
}

function Result({ tone, title, children }: { tone: "ok" | "bad" | "warn"; title: string; children: ReactNode }) {
  const c = tone === "ok" ? X.ok : tone === "bad" ? X.bad : X.warn;
  const b = tone === "ok" ? X.okb : tone === "bad" ? X.badb : X.warnb;
  const Icon = tone === "ok" ? CircleCheck : tone === "bad" ? CircleAlert : CircleHelp;
  return (
    <div role={tone === "ok" ? "status" : "alert"} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "11px 12px", borderRadius: 12, background: b, boxShadow: `inset 3px 0 0 ${c}`, fontSize: 12.5, lineHeight: 1.45, color: X.sub }}>
      <Icon size={16} strokeWidth={2} color={c} style={{ flex: "none", marginTop: 1 }} />
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <b style={{ color: c }}>{title}</b> {children}
      </span>
    </div>
  );
}
