// ===========================================================================
// Operational overlays for the case detail (Phase 4 prototype "Operations": full-screen,
// title + subtitle, one sticky action).
//
//  LegacyOrderSheet  External cases → POST /api/service-orders {caseId, mode, lines}
//                    Same rule check as the server (validateSpawnLines) and the
//                    same modes as desktop (Reproduce / Stock swap / Repair; the
//                    desktop dropped "Decide later" from its picker and so does
//                    this). Exchange approval is enforced by the SERVER: a
//                    Reproduce / Stock swap without an approved exchange answers
//                    409 (and files a pending request) — the sheet shows that
//                    message instead of inventing an approval state the case
//                    payload does not carry.
//  IssuePartSheet    POST /api/stock-adjustments (RM / WIP) + best-effort case
//                    log append — exactly the desktop sequence. FG is shown but
//                    unavailable: desktop posts a product id where the endpoint
//                    expects an fg_batches id (→ 404), so nothing is fabricated.
//  FilesSheet        /api/files with resourceType SERVICE_CASE (the existing
//                    mobile attachment store; separate from issue photos).
// ===========================================================================
import { useMemo, useRef, useState } from "react";
import { FileText, Info, Paperclip, Plus, TriangleAlert, Check } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { getCurrentUser } from "@/lib/auth";
import { SERVICE_MODE_SPECS, validateSpawnLines, type CatalogueProduct, type ServiceMode } from "@/lib/service-order-modes";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { mutateJson, refreshList, refreshOne } from "../../config/mutate";
import type { ActionLogEntry, ServiceCaseApi } from "./case-model";
import { Note, Seg, SearchField, Stepper } from "./case-ui";
import { CC, SH_CARD, SH_CTRL, fieldStyle } from "./case-style";
import { Overlay } from "./case-overlay";
import { CatalogPickerSheet } from "./case-pickers";
import { putCase } from "./case-api";

const msg = (t: string, tone: "err" | "warn" = "err") => (
  <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: tone === "err" ? CC.errBg : CC.warnBg, color: tone === "err" ? CC.dangerDark : CC.warnFg, fontSize: 12.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
    <TriangleAlert size={15} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} /><span style={{ minWidth: 0 }}>{t}</span>
  </div>
);
const label = (t: string, right?: string) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 2px 8px" }}>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>{t}</span>
    {right ? <span style={{ fontSize: 11.5, color: M.ink }}>{right}</span> : null}
  </div>
);
const stickyBtn = (text: string, onClick: () => void, disabled?: boolean) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} style={{ width: "100%", height: 52, border: "none", borderRadius: 14, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, boxShadow: disabled ? "none" : "0 10px 22px -10px rgba(107,92,50,.7)" }}>{text}</button>
);

// ---------------------------------------------------------------------------
type Line = { key: string; productId: string; code: string; name: string; qty: number; on: boolean; free?: boolean };
const MODES: ServiceMode[] = ["REPRODUCE", "STOCK_SWAP", "REPAIR"];
const NEEDS_APPROVAL: Record<ServiceMode, boolean> = { REPRODUCE: true, STOCK_SWAP: true, REPAIR: false };
const MODE_DESC: Record<ServiceMode, string> = {
  REPRODUCE: "Makes a new unit. Opens a production order for each item. Catalogue products only.",
  STOCK_SWAP: "Swaps from finished stock — the oldest batch with enough units is taken automatically. Catalogue products only.",
  REPAIR: "Records the returned unit and waits for it. A typed description is enough.",
};

function LegacyOrderInner({ onClose, c, onCreated }: { onClose: () => void; c: ServiceCaseApi; onCreated: (orderId: string) => void }) {
  const [mode, setMode] = useState<ServiceMode | null>(null);
  const initial = useMemo<Line[]>(
    () => (c.affectedProducts ?? []).map((p) => ({ key: p.productId, productId: p.productId, code: p.code, name: p.name, qty: Math.max(1, p.qty ?? 1), on: true })),
    [c.affectedProducts],
  );
  const [extra, setExtra] = useState<Line[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Line>>>({});
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [freeText, setFreeText] = useState("");

  const { data: inv } = useCachedJson<{ data?: { finishedProducts?: CatalogueProduct[] } }>("/api/inventory?buckets=finishedProducts");
  const catalogue = useMemo<CatalogueProduct[]>(() => (inv?.data?.finishedProducts ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name })), [inv]);

  const lines = useMemo(() => [...initial, ...extra].map((l) => ({ ...l, ...(edits[l.key] ?? {}) })), [initial, extra, edits]);
  const picked = lines.filter((l) => l.on);
  const payload = picked.map((l) => ({
    sourceLineId: null,
    productId: l.free ? null : l.productId || null,
    productCode: l.code || null,
    productName: l.name || null,
    qty: l.qty,
    issueSummary: null as string | null,
  }));
  const validation = useMemo(() => validateSpawnLines(mode, payload, catalogue), [mode, payload, catalogue]);
  const problems = mode ? validation.problems : [];
  const canSubmit = !!mode && picked.length > 0 && problems.length === 0 && !busy;
  const patch = (key: string, p: Partial<Line>) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...p } }));

  const submit = async () => {
    if (!canSubmit || !mode) return;
    setBusy(true); setErr(""); setWarn("");
    const user = getCurrentUser();
    const r = await mutateJson<{ data?: { id?: string }; error?: string }>("/api/service-orders", "POST", {
      caseId: c.id,
      mode,
      lines: payload,
      createdBy: user?.id ?? null,
      createdByName: user?.displayName ?? user?.email ?? null,
    });
    setBusy(false);
    const id = r.body?.data?.id;
    if (!r.ok || !id) {
      // 409 on an exchange mode = approval gate (server files / reports the request).
      const m = r.error || `Couldn’t create the service order (HTTP ${r.status}). Nothing was created.`;
      if (r.status === 409) setWarn(m); else setErr(m);
      return;
    }
    refreshList("/api/service-cases", "/api/service-orders");
    refreshOne(`/api/service-cases/${encodeURIComponent(c.id)}`);
    onCreated(id);
  };

  return (
    <>
      <Overlay
        title="New legacy service order"
        subtitle={`From ${c.caseNo} · External case`}
        onClose={busy ? () => undefined : onClose}
        closeLabel="Close"
        footer={<>
          {warn ? msg(warn, "warn") : null}
          {err ? msg(err) : null}
          {problems.map((p) => <div key={p.lineNo}>{msg(`Line ${p.lineNo}${p.typed ? ` (${p.typed})` : ""}: ${p.message}`)}</div>)}
          {stickyBtn(busy ? "Creating…" : "Create service order", () => void submit(), !canSubmit)}
        </>}
      >
        <section aria-label="Mode">
          {label("MODE")}
          <div role="radiogroup" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
            {MODES.map((m) => {
              const spec = SERVICE_MODE_SPECS[m];
              const on = mode === m;
              return (
                <button key={m} type="button" role="radio" aria-checked={on} onClick={() => { setMode(m); setErr(""); setWarn(""); }} style={{ display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", padding: "12px 14px", border: "none", borderRadius: 14, background: M.card, fontFamily: "inherit", cursor: "pointer", boxShadow: on ? `0 0 0 1.5px ${CC.brown},${SH_CARD}` : SH_CARD, WebkitTapHighlightColor: "transparent" }}>
                  <span aria-hidden style={{ flex: "none", width: 20, height: 20, marginTop: 1, boxSizing: "border-box", borderRadius: "50%", border: `1.5px solid ${on ? CC.brown : "#C9BFAE"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? <span style={{ width: 10, height: 10, borderRadius: "50%", background: CC.brown }} /> : null}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>{spec.label}</span>
                      <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: NEEDS_APPROVAL[m] ? CC.warnBg : "#DCEBDC", color: NEEDS_APPROVAL[m] ? CC.warnFg : "#3A6B3A" }}>{NEEDS_APPROVAL[m] ? "Needs exchange approval" : "No approval"}</span>
                    </span>
                    <span style={{ display: "block", fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 4 }}>{spec.blurb}. {MODE_DESC[m]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {mode && NEEDS_APPROVAL[mode] ? (
          <Note icon={Info}><b style={{ display: "block", color: CC.brown }}>Exchange approval needed</b>If no approval exists yet, creating the order files a pending request and stops — the order isn’t created until it’s approved in Service approvals.</Note>
        ) : null}

        <section aria-label="Lines">
          {label("LINES", `${picked.length} of ${lines.length}`)}
          {lines.length === 0 ? <div style={{ background: M.card, borderRadius: 14, boxShadow: SH_CARD, padding: 14, fontSize: 13, color: M.ink }}>No items yet — add one below.</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
            {lines.map((l) => (
              <div key={l.key} style={{ background: M.card, borderRadius: 14, boxShadow: SH_CARD, padding: "11px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <button type="button" role="checkbox" aria-checked={l.on} aria-label={`Include ${l.name || l.code}`} onClick={() => patch(l.key, { on: !l.on })} style={{ flex: "none", width: 24, height: 24, marginTop: 1, border: "none", borderRadius: 7, background: l.on ? CC.brown : M.card, boxShadow: l.on ? "none" : "inset 0 0 0 1.5px #C9BFAE", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>{l.on ? <Check size={15} strokeWidth={3} /> : null}</button>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{l.name || l.code}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{l.free ? "Typed description" : l.code} · Qty {l.qty}</span>
                  </span>
                </div>
                {l.on ? <div style={{ paddingLeft: 36, marginTop: 8 }}><Stepper label="Quantity" value={l.qty} decDisabled={l.qty <= 1} onDec={() => patch(l.key, { qty: Math.max(1, l.qty - 1) })} onInc={() => patch(l.key, { qty: l.qty + 1 })} /></div> : null}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setCatalogOpen(true)} style={{ marginTop: 6, height: 40, padding: "0 4px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: CC.brown, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2.2} />Add from catalogue</button>
          {mode === "REPAIR" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="Item not in the catalogue — describe it" aria-label="Typed item description" style={fieldStyle({ flex: 1, width: "auto", height: 44, padding: "0 13px", borderRadius: 12 })} />
              <button type="button" disabled={!freeText.trim()} onClick={() => { setExtra((l) => [...l, { key: `free-${Date.now()}`, productId: "", code: "", name: freeText.trim(), qty: 1, on: true, free: true }]); setFreeText(""); }} style={{ flex: "none", height: 44, padding: "0 16px", border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: freeText.trim() ? 1 : 0.5 }}>Add</button>
            </div>
          ) : null}
          {mode ? <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 8, padding: "0 2px" }}>{SERVICE_MODE_SPECS[mode].productRule}</div> : null}
        </section>
      </Overlay>
      <CatalogPickerSheet open={catalogOpen} onClose={() => setCatalogOpen(false)} excludeIds={lines.map((l) => l.productId)} onPick={(p) => setExtra((l) => [...l, { key: `cat-${p.id}`, productId: p.id, code: p.code, name: p.name, qty: 1, on: true }])} />
    </>
  );
}

export function LegacyOrderSheet({ open, onClose, c, onCreated }: { open: boolean; onClose: () => void; c: ServiceCaseApi; onCreated: (orderId: string) => void }) {
  return open ? <LegacyOrderInner onClose={onClose} c={c} onCreated={onCreated} /> : null;
}

// ---------------------------------------------------------------------------
type StockType = "RM" | "WIP" | "FG";
type Item = { id: string; code: string; name: string; onHand: number; unitCostSen: number };
const todayMY = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

function IssuePartInner({ onClose, c, onDone }: { onClose: () => void; c: ServiceCaseApi; onDone: (msg: string, tone: "success" | "error") => void }) {
  const [type, setType] = useState<StockType>("RM");
  const [q, setQ] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { tone: "ok" | "warn" | "err"; title: string; text: string }>(null);

  const { data: rm } = useCachedJson<{ data?: Array<{ id: string; itemCode: string; itemName?: string; description?: string; balanceQty: number; unitCostSen?: number }> }>(type === "RM" ? "/api/raw-materials" : null);
  const { data: wip } = useCachedJson<{ data?: Array<{ id: string; code: string; type: string; stockQty: number }> }>(type === "WIP" ? "/api/inventory/wip" : null);
  const items = useMemo<Item[]>(() => {
    const all: Item[] = type === "RM"
      ? (rm?.data ?? []).map((r) => ({ id: r.id, code: r.itemCode, name: r.itemName ?? r.description ?? "", onHand: r.balanceQty, unitCostSen: r.unitCostSen ?? 0 }))
      : type === "WIP" ? (wip?.data ?? []).map((w) => ({ id: w.id, code: w.code, name: w.type ?? "", onHand: w.stockQty, unitCostSen: 0 })) : [];
    const t = q.trim().toLowerCase();
    return (t ? all.filter((o) => o.code.toLowerCase().includes(t) || o.name.toLowerCase().includes(t)) : all).slice(0, 30);
  }, [type, rm, wip, q]);
  const all = type === "RM" ? rm?.data : type === "WIP" ? wip?.data : [];
  const selected = items.find((o) => o.id === itemId) ?? null;
  const short = selected ? qty > selected.onHand : false;
  const canIssue = type !== "FG" && !!selected && qty > 0 && !short && !busy;
  const finished = !!result && result.tone !== "err";

  const run = async () => {
    if (!selected || type === "FG") return;
    setConfirm(false); setBusy(true); setResult(null);
    const user = getCurrentUser();
    const r = await mutateJson("/api/stock-adjustments", "POST", {
      type,
      itemId: selected.id,
      qtyDelta: -Math.abs(qty),
      unitCostSen: selected.unitCostSen,
      reason: "SERVICE_REPLACEMENT",
      notes: `${c.caseNo}${note.trim() ? " — " + note.trim() : ""}`,
      caseId: c.id,
      adjustedBy: user?.id ?? null,
      adjustedByName: user?.displayName ?? user?.email ?? null,
    });
    if (!r.ok) {
      setBusy(false);
      return setResult({ tone: "err", title: "Couldn’t issue the part", text: `${r.error || `HTTP ${r.status}`} — nothing was deducted. Try again.` });
    }
    // Stock is committed. Append to the case log best-effort, like desktop —
    // but TELL the operator if that part fails (desktop swallows it).
    refreshList("/api/stock-adjustments", "/api/raw-materials", "/api/inventory");
    const entry: ActionLogEntry = {
      id: `act-${Math.random().toString(36).slice(2, 8)}`,
      date: todayMY(),
      description: `Issued replacement part: ${selected.code} × ${Math.abs(qty)} (${type} stock deducted${note.trim() ? " — " + note.trim() : ""})`,
      createdAt: new Date().toISOString(),
      createdByName: user?.displayName ?? user?.email ?? "",
    };
    const lg = await putCase(c.id, { actionLog: [...(c.actionLog ?? []), entry] });
    setBusy(false);
    const left = selected.onHand - Math.abs(qty);
    if (lg.ok) {
      setResult({ tone: "ok", title: "Stock deducted", text: `${qty} of ${selected.code} issued to ${c.caseNo} · ${left} left. Shown in Issued history.` });
      onDone(`Deducted ${qty} × ${selected.code} from ${type} stock`, "success");
    } else {
      setResult({ tone: "warn", title: "Stock deducted · case log not updated", text: `${qty} of ${selected.code} was deducted (${left} left) and shows in Issued history, but adding the note to the case log failed.` });
      onDone(`Deducted ${qty} × ${selected.code}; case log not updated`, "error");
    }
  };

  return (
    <>
      <Overlay
        title="Issue replacement part"
        subtitle={`${c.caseNo} · deducts live stock`}
        onClose={busy ? () => undefined : onClose}
        closeLabel="Close"
        footer={<>
          {result ? (
            <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: result.tone === "ok" ? "#DCEBDC" : result.tone === "warn" ? CC.warnBg : CC.errBg, color: result.tone === "ok" ? "#3A6B3A" : result.tone === "warn" ? CC.warnFg : CC.dangerDark, fontSize: 12.5, lineHeight: 1.45 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{result.title}</b> — {result.text}</span>
            </div>
          ) : null}
          {stickyBtn(finished ? "Done" : busy ? "Issuing…" : "Issue part", finished ? onClose : () => setConfirm(true), finished ? false : !canIssue)}
        </>}
      >
        <Seg<StockType> label="Stock type" value={type} onChange={(t) => { setType(t); setItemId(""); setQ(""); setResult(null); }} options={[["RM", "RM"], ["WIP", "WIP"], ["FG", "FG"]]} />
        {type === "FG" ? (
          <Note icon={TriangleAlert} bg={CC.warnBg} fg={CC.warnFg} color="#3A352C">Finished goods can’t be issued from here. The stock API needs a finished-goods batch id, which the case page doesn’t have (the desktop sends a product id and the request is refused). Use Inventory for finished goods.</Note>
        ) : (
          <>
            <div style={{ display: "flex" }}><SearchField value={q} onChange={setQ} placeholder="Search code or name" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
              {!all ? <div style={{ padding: 12, color: M.ink, fontSize: 13 }}>Loading stock…</div> : items.length === 0 ? <div role="status" style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>No items match.</div> : null}
              {items.map((o) => (
                <button key={o.id} type="button" onClick={() => { setItemId(o.id); setQty(1); setResult(null); }} aria-pressed={o.id === itemId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", minHeight: 52, border: "none", borderRadius: 12, background: M.card, textAlign: "left", fontFamily: "inherit", cursor: "pointer", boxShadow: o.id === itemId ? `0 0 0 1.5px ${CC.brown},${SH_CTRL}` : SH_CTRL }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name || o.code}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1 }}>{o.code}</span>
                  </span>
                  <span style={{ textAlign: "right", flex: "none" }}>
                    <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".5px", color: CC.hint }}>AVAILABLE</span>
                    <b style={{ fontSize: 13, color: o.onHand <= 0 ? CC.danger : M.raisin }}>{o.onHand}</b>
                  </span>
                </button>
              ))}
            </div>
            {selected ? (
              <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "13px 15px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{selected.name || selected.code}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: CC.brown, marginTop: 2 }}>{selected.code}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin }}>Quantity</span>
                  <Stepper label="Quantity" value={qty} decDisabled={qty <= 1} onDec={() => setQty((v) => Math.max(1, v - 1))} onInc={() => setQty((v) => v + 1)} />
                </div>
                {short ? <div role="alert" style={{ color: CC.danger, fontSize: 12.5, marginTop: 8 }}>{selected.onHand <= 0 ? "None in stock — this item can’t be issued." : `Only ${selected.onHand} available.`}</div> : null}
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. For re-sewing seat covers" aria-label="Note" style={fieldStyle({ height: 44, padding: "0 13px", borderRadius: 12, marginTop: 12, boxShadow: "inset 0 0 0 1px #E6E0D9", background: M.paper })} />
              </div>
            ) : <div style={{ fontSize: 12.5, color: CC.hint, padding: "0 2px" }}>Pick an item to issue.</div>}
          </>
        )}
        <div style={{ fontSize: 11.5, color: CC.hint, padding: "0 2px" }}>Issuing deducts live stock straight away. This is separate from creating a service order.</div>
      </Overlay>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Deduct live stock?">
        {selected ? (
          <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "4px 15px" }}>
            {([["Item", selected.code], ["Quantity", String(qty)], ["Available after", String(selected.onHand - qty)], ["Case", c.caseNo]] as [string, string][]).map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderTop: i ? `1px solid ${CC.sep}` : "none", fontSize: 12.5 }}>
                <span style={{ color: M.ink }}>{k}</span><span style={{ fontWeight: 600, color: M.raisin }}>{v}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ margin: "12px 0 8px" }}><Note icon={Info} bg={CC.warnBg} fg={CC.warnFg} color="#3A352C">Stock is deducted as soon as you confirm. It can’t be undone from this screen.</Note></div>
        <div style={{ display: "flex", gap: 10, margin: "14px 0 8px" }}>
          <button type="button" onClick={() => setConfirm(false)} style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: M.card, color: M.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SH_CTRL }}>Back</button>
          <button type="button" onClick={() => void run()} style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Deduct stock</button>
        </div>
      </Sheet>
    </>
  );
}

export function IssuePartSheet({ open, onClose, c, onDone }: { open: boolean; onClose: () => void; c: ServiceCaseApi; onDone: (msg: string, tone: "success" | "error") => void }) {
  return open ? <IssuePartInner onClose={onClose} c={c} onDone={onDone} /> : null;
}

// ---------------------------------------------------------------------------
type FileRow = { id: string; filename: string; contentType?: string; sizeBytes?: number; uploadedAt?: string };

function FilesInner({ onClose, c, canUpload }: { onClose: () => void; c: ServiceCaseApi; canUpload: boolean }) {
  const url = `/api/files?resourceType=SERVICE_CASE&resourceId=${encodeURIComponent(c.id)}`;
  const { data, loading, error } = useCachedJson<{ data?: FileRow[] }>(url);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const files = data?.data ?? [];

  const upload = async (f: File) => {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("resourceType", "SERVICE_CASE");
      fd.append("resourceId", c.id);
      const resp = await fetch("/api/files", { method: "POST", body: fd, credentials: "include" });
      const json = (await resp.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!resp.ok || !json.success) setErr(json.error || `Upload failed (${resp.status}). Files over 50 MB or of an unsupported type are refused. Nothing was added.`);
      else refreshOne(url);
    } catch (e) {
      setErr((e as Error).message || "Upload failed. Nothing was added.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <Overlay
      title="Files"
      subtitle={`${c.caseNo} · separate from issue photos`}
      onClose={onClose}
      closeLabel="Close"
      footer={<>
        {err ? msg(err) : null}
        <input ref={ref} type="file" hidden accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <button type="button" disabled={!canUpload || busy} onClick={() => ref.current?.click()} style={{ width: "100%", height: 52, border: "none", borderRadius: 14, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: canUpload && !busy ? "pointer" : "default", opacity: canUpload ? 1 : 0.55, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Paperclip size={17} strokeWidth={2} />{busy ? "Uploading…" : "Add file"}
        </button>
        {!canUpload ? <div style={{ fontSize: 12, color: M.ink, marginTop: 6, textAlign: "center" }}>Your role can view files but not upload them.</div> : null}
      </>}
    >
      <Note icon={Info}>Files are a separate store. They don’t add to or change the issue photos.</Note>
      {loading && !data ? <div role="status" style={{ padding: 12, color: M.ink, fontSize: 13 }}>Loading files…</div> : null}
      {error && !data ? msg("Couldn’t load the files for this case.") : null}
      {!loading && !error && files.length === 0 ? <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "18px 16px", textAlign: "center", fontSize: 13, color: M.ink }}>No files on this case yet.</div> : null}
      {files.length > 0 ? (
        <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
          {files.map((f, i) => (
            <a key={f.id} href={`/api/files/${encodeURIComponent(f.id)}/download`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "8px 15px", borderTop: i ? `1px solid ${CC.sep}` : "none", color: M.raisin, textDecoration: "none" }}>
              <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: CC.tile, display: "flex", alignItems: "center", justifyContent: "center" }}><FileText size={17} strokeWidth={1.9} color={CC.brown} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{f.filename}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{[f.sizeBytes ? `${Math.max(1, Math.round(f.sizeBytes / 1024))} KB` : "", f.uploadedAt ? f.uploadedAt.slice(0, 10) : ""].filter(Boolean).join(" · ")}</span>
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </Overlay>
  );
}

export function FilesSheet({ open, onClose, c, canUpload }: { open: boolean; onClose: () => void; c: ServiceCaseApi; canUpload: boolean }) {
  return open ? <FilesInner onClose={onClose} c={c} canUpload={canUpload} /> : null;
}
