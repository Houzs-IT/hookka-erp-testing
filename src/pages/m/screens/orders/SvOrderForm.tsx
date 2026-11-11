// ===========================================================================
// SvOrderForm — the full-screen create / edit form of an SV service order (sales_orders with isServiceOrder=true).
//   /m/serviceorders/sv/new            blank
//     ?from=so|co                      source picker first (searchable list -> lines + quantities), then hydrate
//     ?from=so|co&sourceId=<id>        copy that order straight away (lines: all)
//     ?from=case | ?fromCase=<caseId>  hand-off from a Service Case (the order keeps caseId)
//     ?clone=<svId>                    start from another SV order
//   /m/serviceorders/sv/:id/edit       edit (only while the server says the order is editable)
// Every rule is the desktop's (see sv-form-model.ts for the file:line map). Save draft = POST /api/sales-orders;
// Save & confirm = that POST, then POST …/:id/confirm exactly like lib/use-so-actions.ts confirmOrder. The edit lock
// override is NOT supported (the server ignores overrideToken): a locked order shows "Editing is locked".
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CircleAlert, ChevronRight, Copy, Info, Receipt, Wrench, Lock, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { useCachedJson } from "@/lib/cached-fetch";
import { verifiedSave, formatMismatchError } from "@/lib/verified-save";
import { mutateJson, newIdOf, refreshList, refreshOne } from "../../config/mutate";
import { M } from "../../theme";
import { Btn, Card, Msg, Note, SectionLabel } from "../cases/case-ui";
import { SH_CARD } from "../cases/case-style";
import { ConfirmDialog, Overlay } from "../cases/case-overlay";
import { CC, fieldStyle } from "../cases/case-style";
import { CustomerChangeSheet, HubChangeSheet } from "../so/so-change-sheets";
import { ORDERS_LIST, SV_STATUS_LABEL, casePath, svDetailPath } from "./order-model";
import { FootBtn, SvItemEditor } from "./sv-form-item";
import { CustomerPickerSheet, HubPickerSheet, SourcePickerScreen, type SourceChoice } from "./sv-form-pickers";
import {
  blankHeader, blankLine, createBody, editBody, entryFromQuery, fmtRm, formBlockers, formSignature, headerFromCopyDraft, headerFromDoc,
  lineFromServer, linesFromCase, linesFromCopyDraft, lockFromResponse, lockedMessage, lineTotalSen, unitPriceSen, createOutcome, resultCard, SCOPE_PRESET_LABEL, totals,
  cloneSeedFromDoc, companyForCustomer, type CaseForSv, type CopyDraft, type Eligibility, type SvEntry, type SvHeader, type SvLine,
} from "./sv-form-model";

type Row = Record<string, unknown>;
type Seed = { header: SvHeader; lines: SvLine[]; caseLink: { id: string; caseNo: string } | null; source: { title: string; sub: string } | null; meta?: { status: string; no: string } };
type Loaded = { status: "loading" } | { status: "error"; text: string; manual?: Seed } | { status: "ready"; seed: Seed };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const actor = (): string => {
  try { return getCurrentUser()?.displayName?.trim() || "Admin"; } catch { return "Admin"; }
};
const blankSeed = (): Seed => ({ header: blankHeader(todayIso()), lines: [], caseLink: null, source: null });

async function postCopy(sourceType: "SO" | "CO", sourceId: string, lineItems?: { id: string; qty: number }[]) {
  return mutateJson<{ data?: CopyDraft }>("/api/sales-orders/copy-for-service-order", "POST", { sourceType, sourceId, ...(lineItems ? { lineItems } : {}) });
}

// ---- loader: resolves the entry into a seed, then renders the form body ----------------------------------------------
export function SvOrderForm() {
  const { id } = useParams();
  const [q] = useSearchParams();
  const navigate = useNavigate();
  const urlEntry = useMemo<SvEntry>(() => (id ? { kind: "blank" } : entryFromQuery(q)), [id, q]);
  // The source picker turns a "pick" entry into a "copy" / "case" one without leaving the route.
  const [entry, setEntry] = useState<SvEntry>(urlEntry);
  const entryKey = JSON.stringify(entry);
  // Browser back/forward changes the URL: keep the entry in step.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state to the URL entry
  useEffect(() => { setEntry(urlEntry); }, [urlEntry]);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [pickLines, setPickLines] = useState<{ id: string; qty: number }[] | undefined>(undefined);
  const [sourceNo, setSourceNo] = useState("");
  const [nonce, setNonce] = useState(0);

  const closeToList = () => navigate(id ? svDetailPath(id) : ORDERS_LIST, { replace: true });

  useEffect(() => {
    if (entry.kind === "pick") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to loading whenever the source entry / retry changes
    setLoaded({ status: "loading" });
    const done = (l: Loaded) => { if (!cancelled) setLoaded(l); };
    void (async () => {
      try {
        if (id) {
          // EDIT: the order + the server's own verdict on whether it may be edited.
          const [r, e] = await Promise.all([
            fetch(`/api/sales-orders/${encodeURIComponent(id)}?_v=${Date.now()}`, { cache: "no-store" }),
            fetch(`/api/sales-orders/${encodeURIComponent(id)}/edit-eligibility`, { cache: "no-store" }),
          ]);
          if (r.status === 404) return done({ status: "error", text: "This order no longer exists." });
          const dj = (await r.json().catch(() => ({}))) as { data?: Row; error?: string };
          if (!r.ok || !dj.data) return done({ status: "error", text: dj.error || `Couldn’t load the order (HTTP ${r.status}).` });
          const doc = dj.data;
          if (!doc.isServiceOrder) return done({ status: "error", text: "This is a normal sales order, not an SV service order. Open it from Sales." });
          const ej = (await e.json().catch(() => ({}))) as Eligibility;
          const locked = e.ok ? lockedMessage(ej) : "";
          if (locked) return done({ status: "error", text: locked });
          if (!e.ok) return done({ status: "error", text: `Couldn’t check whether this order can be edited (HTTP ${e.status}).` });
          const items = Array.isArray(doc.items) ? (doc.items as Row[]) : [];
          const cs = doc.caseId ? { id: String(doc.caseId), caseNo: String(doc.caseNo ?? doc.caseId) } : null;
          return done({ status: "ready", seed: { header: headerFromDoc(doc), lines: items.map(lineFromServer), caseLink: cs, source: null, meta: { status: String(doc.status ?? "DRAFT"), no: String(doc.companySOId ?? doc.companySO ?? "") } } });
        }
        if (entry.kind === "blank") return done({ status: "ready", seed: blankSeed() });
        if (entry.kind === "clone") {
          const r = await fetch(`/api/sales-orders/${encodeURIComponent(entry.svId)}?_v=${Date.now()}`, { cache: "no-store" });
          const dj = (await r.json().catch(() => ({}))) as { data?: Row; error?: string };
          if (!r.ok || !dj.data) return done({ status: "error", text: dj.error || `Couldn’t load the order to copy (HTTP ${r.status}).`, manual: blankSeed() });
          const doc = dj.data;
          // Same payload as desktop Clone (sales/detail.tsx handleClone): PO / SO ids, hub and company are NOT carried.
          const { header, lines } = cloneSeedFromDoc(doc, todayIso());
          return done({ status: "ready", seed: { header, lines, caseLink: null, source: { title: `Clone of ${String(doc.companySOId ?? doc.companySO ?? "SV order")}`, sub: "Customer, dates, notes and lines are copied. PO / SO numbers, hub and company are not — set them before saving." } } });
        }
        if (entry.kind === "copy") {
          const r = await postCopy(entry.type, entry.sourceId, pickLines);
          const d = r.body?.data;
          if (!r.ok || !d) return done({ status: "error", text: r.error || "Couldn’t copy that order.", manual: blankSeed() });
          return done({ status: "ready", seed: { header: headerFromCopyDraft(blankHeader(todayIso()), d), lines: linesFromCopyDraft(d.items), caseLink: null, source: { title: `From ${entry.type === "SO" ? "sales order" : "consignment order"} ${d.sourceNo || sourceNo || entry.sourceId}`, sub: "Prices start at zero — set the price of every line before confirming." } } });
        }
        if (entry.kind === "case") {
          const cr = await fetch(`/api/service-cases/${encodeURIComponent(entry.caseId)}`, { cache: "no-store" });
          const cj = (await cr.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: CaseForSv };
          if (!cr.ok || !cj.success || !cj.data) return done({ status: "error", text: cj.error || `Couldn’t load the case (HTTP ${cr.status}).`, manual: blankSeed() });
          const sc = cj.data;
          if ((sc.sourceType !== "SO" && sc.sourceType !== "CO") || !sc.sourceId) {
            return done({ status: "error", text: "This case has no source order to copy from — fill the form manually.", manual: blankSeed() });
          }
          // Same loader the copy picker uses; with no lineItems it copies EVERY source line and the case narrows them.
          const r = await postCopy(sc.sourceType, sc.sourceId);
          const d = r.body?.data;
          if (!r.ok || !d) return done({ status: "error", text: r.error || "Couldn’t copy the case’s source order.", manual: blankSeed() });
          const { lines, alreadyCovered } = linesFromCase(sc, d.items);
          return done({ status: "ready", seed: {
            header: headerFromCopyDraft(blankHeader(todayIso()), d), lines, caseLink: { id: sc.id, caseNo: sc.caseNo },
            source: { title: `From service case ${sc.caseNo}`, sub: `Affected quantities and damaged components are prefilled from ${sc.caseNo}${alreadyCovered > 0 ? ` (${alreadyCovered} already on a service order)` : ""} — review before saving.` },
          } });
        }
      } catch (err) {
        done({ status: "error", text: err instanceof Error ? err.message : "Network error — please try again.", manual: id ? undefined : blankSeed() });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the resolved entry + retry nonce
  }, [id, entryKey, nonce]);

  if (entry.kind === "pick") {
    return (
      <SourcePickerScreen
        pick={entry.pick}
        onCancel={closeToList}
        onChoose={(c: SourceChoice) => {
          if (c.kind === "case") setEntry({ kind: "case", caseId: c.caseId });
          else { setPickLines(c.lineItems); setSourceNo(c.sourceNo); setEntry({ kind: "copy", type: c.type, sourceId: c.sourceId }); }
        }}
      />
    );
  }
  const title = id ? "Edit SV service order" : "New SV service order";
  if (loaded.status === "loading") {
    return <Overlay title={title} subtitle="Loading…" onClose={closeToList}><div role="status" aria-busy="true" style={{ padding: "40px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>Loading…</div></Overlay>;
  }
  if (loaded.status === "error") {
    const manual = loaded.manual;
    const locked = !!id && /^Cannot edit/.test(loaded.text);
    return (
      <Overlay title={title} onClose={closeToList} closeLabel="Close">
        <Msg
          icon={locked ? Lock : CircleAlert}
          tone={locked ? "neutral" : "danger"}
          text={locked ? "Editing is locked" : "Couldn’t open the form"}
          sub={loaded.text}
          action={(
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn kind="secondary" onClick={closeToList}>Back</Btn>
              {manual ? <Btn onClick={() => setLoaded({ status: "ready", seed: manual })}>Fill in manually</Btn> : null}
              {!locked && !manual ? <Btn onClick={() => setNonce((n) => n + 1)}>Try again</Btn> : null}
            </div>
          )}
        />
      </Overlay>
    );
  }
  // A new key per seed so a fresh hydration never inherits a previous form's state.
  return <FormBody key={`${id ?? "new"}:${entryKey}:${nonce}`} editId={id ?? null} seed={loaded.seed} />;
}

// ---- the form ------------------------------------------------------------------------------------------------------------
function FormBody({ editId, seed }: { editId: string | null; seed: Seed }) {
  const navigate = useNavigate();
  const isEdit = !!editId;
  const [base, setBase] = useState<{ header: SvHeader; lines: SvLine[] }>({ header: seed.header, lines: seed.lines });
  const [header, setHeader] = useState<SvHeader>(seed.header);
  const [lines, setLines] = useState<SvLine[]>(seed.lines);
  const status = seed.meta?.status ?? "DRAFT";
  const orderNo = seed.meta?.no ?? "";
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "draft" | "confirm" | "save">("");
  const [edit, setEdit] = useState<{ line: SvLine; isNew: boolean } | null>(null);
  const [sheet, setSheet] = useState<"" | "customer" | "hub" | "changeCustomer" | "changeHub">("");
  const [askDiscard, setAskDiscard] = useState(false);
  const [askConfirm, setAskConfirm] = useState(false);
  const [fail, setFail] = useState<{ kind: "warn_draft" | "warn_unconfirmed" | "confirm_failed"; id: string; no: string; text: string } | null>(null);
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const failCard = useRef<HTMLElement | null>(null);
  // The result card sits at the top of the form; the person saved from further down, so bring it into view.
  useEffect(() => { if (fail) failCard.current?.scrollIntoView({ block: "start" }); }, [fail]);

  const draft = status === "DRAFT";
  const rowId = editId ?? "";
  // Company (desktop create.tsx "Company" select): active orgs from GET /api/organisations; create only, like desktop.
  const orgs = useCachedJson<{ organisations?: { code: string; name: string; isActive?: boolean }[] }>(isEdit ? null : "/api/organisations", 300);
  const activeOrgs = useMemo(() => (orgs.data?.organisations ?? []).filter((o) => o.isActive !== false), [orgs.data]);

  const dirty = formSignature(header, lines) !== formSignature(base.header, base.lines);
  const blockers = formBlockers(header, lines);
  const sum = totals(lines);
  const setH = (p: Partial<SvHeader>) => { setHeader((h) => ({ ...h, ...p })); setErr(""); };
  const leave = () => navigate(isEdit ? svDetailPath(rowId) : ORDERS_LIST, { replace: true });
  const tryLeave = () => (dirty && !fail ? setAskDiscard(true) : leave());

  const afterCaches = (caseId?: string | null) => {
    refreshList("/api/sales-orders");
    refreshList("/api/production-orders");
    if (editId) refreshOne(`/api/sales-orders/${editId}`);
    if (caseId) { refreshOne(`/api/service-cases/${caseId}`); refreshList("/api/service-cases"); }
  };

  // Confirm exactly like lib/use-so-actions.ts confirmOrder: Idempotency-Key + changedBy; 422 = BOM-incomplete list.
  const confirm = async (id: string, no: string): Promise<boolean> => {
    const r = await mutateJson<{ message?: string; details?: { incompleteProducts?: { productCode: string; productName: string }[] } }>(
      `/api/sales-orders/${encodeURIComponent(id)}/confirm`, "POST", { changedBy: actor() }, { "Idempotency-Key": crypto.randomUUID() });
    if (r.ok) { afterCaches(seed.caseLink?.id); return true; }
    const bad = r.body?.details?.incompleteProducts;
    const reason = r.status === 422 && bad?.length
      ? `These products have no WIP components in their BOM yet: ${bad.map((p) => `${p.productCode} (${p.productName})`).join(", ")}. Fill them in under Products → BOM, then retry. The order stays a draft.`
      : r.error || `HTTP ${r.status}`;
    setFail({ kind: "confirm_failed", id, no, text: reason });
    afterCaches(seed.caseLink?.id);
    return false;
  };

  const saveNew = async (andConfirm: boolean) => {
    if (submitting.current) return;
    if (blockers.length) { setErr(blockers[0]); return; }
    submitting.current = true;
    setBusy(andConfirm ? "confirm" : "draft");
    setErr("");
    const r = await mutateJson<{ data?: { id?: string; companySOId?: string }; warning?: string }>(
      "/api/sales-orders", "POST", createBody(header, lines, { caseId: seed.caseLink?.id }), { "Idempotency-Key": crypto.randomUUID() });
    if (!r.ok) {
      setBusy(""); submitting.current = false;
      setErr(r.error || `Failed to create the order (HTTP ${r.status}).`);
      return;
    }
    const id = newIdOf(r.body);
    const no = r.body?.data?.companySOId ?? "";
    afterCaches(seed.caseLink?.id);
    if (!id) { setBusy(""); submitting.current = false; setErr("The order was saved but the server did not return its id. Check the order list."); return; }
    // A customer PO/SO already on another order: the server saved a DRAFT with a warning (desktop toasts it and never
    // confirms). No cross-navigation toast exists on mobile, so the warning stays on this card with "Open draft".
    const outcome = createOutcome(andConfirm, r.body?.warning);
    if (outcome.kind === "warn_draft" || outcome.kind === "warn_unconfirmed") { setBusy(""); setFail({ kind: outcome.kind, id, no, text: outcome.text }); return; }
    if (outcome.kind === "confirm") {
      const ok = await confirm(id, no);
      setBusy("");
      if (!ok) return;
    }
    setBusy("");
    navigate(svDetailPath(id), { replace: true });
  };

  const saveEdit = async () => {
    if (submitting.current) return;
    if (blockers.length) { setErr(blockers[0]); return; }
    submitting.current = true;
    setBusy("save");
    setErr("");
    const url = `/api/sales-orders/${encodeURIComponent(rowId)}`;
    const result = await verifiedSave<Row>({
      endpoint: url,
      method: "PUT",
      body: editBody(header, lines, { draft, stored: { customerId: base.header.customerId, hubId: base.header.hubId } }),
      readback: async () => {
        const r = await fetch(`${url}?_v=${Date.now()}`, { credentials: "include", cache: "no-store" });
        if (!r.ok) return null;
        const j = (await r.json()) as { data?: Row } | Row;
        return (j as { data?: Row }).data ?? (j as Row) ?? null;
      },
      expect: {
        customerId: header.customerId, customerPOId: header.customerPOId.trim(), customerSOId: header.customerSOId.trim(), reference: header.reference.trim(),
        companySODate: header.companySODate, customerDeliveryDate: header.customerDeliveryDate, hookkaExpectedDD: header.hookkaExpectedDD, notes: header.notes.trim(),
      },
    });
    setBusy(""); submitting.current = false;
    if (!result.ok) {
      if (result.reason === "mismatch") setErr(formatMismatchError(result.diffs));
      else if (result.reason === "http") {
        let parsed: unknown = null;
        try { parsed = JSON.parse(result.body); } catch { /* keep raw */ }
        const lock = lockFromResponse(result.status, parsed);
        if (lock) setErr(lock);
        else setErr((parsed as { error?: string } | null)?.error || result.body || `Failed to update the order (HTTP ${result.status}).`);
      } else if (result.reason === "unverified") {
        afterCaches(); navigate(svDetailPath(rowId), { replace: true }); // the write itself succeeded; only the confirming read failed
      } else setErr(`Save failed: ${result.details}`);
      return;
    }
    afterCaches();
    navigate(svDetailPath(rowId), { replace: true });
  };

  // Customer / hub rows.
  const onCustomer = () => setSheet(isEdit && !draft ? "changeCustomer" : "customer");
  const onHub = () => { if (!header.customerId) { setErr("Choose a customer first."); return; } setSheet(isEdit && !draft ? "changeHub" : "hub"); };
  // After PATCH …/customer or …/hub: re-read the order so the rows show what the server now holds.
  const reloadParty = async (message: string) => {
    setSheet("");
    refreshOne(`/api/sales-orders/${rowId}`); refreshList("/api/sales-orders");
    try {
      const r = await fetch(`/api/sales-orders/${encodeURIComponent(rowId)}?_v=${Date.now()}`, { cache: "no-store" });
      const d = ((await r.json()) as { data?: Row }).data;
      if (d) {
        const p = { customerId: String(d.customerId ?? ""), customerName: String(d.customerName ?? ""), hubId: String(d.hubId ?? ""), hubName: String(d.hubName ?? "") };
        setHeader((h) => ({ ...h, ...p }));
        setBase((b) => ({ ...b, header: { ...b.header, ...p } }));
      }
    } catch { /* the rows keep their old text; the order itself is already updated */ }
    setNotice(message);
  };

  // After a draft was saved but not confirmed the header names the saved order (the design swaps "New…" for its number).
  const title = isEdit ? `Edit ${orderNo || "SV order"}` : fail?.no || "New SV service order";
  const subtitle = isEdit ? SV_STATUS_LABEL[status] ?? status : fail ? "Draft" : "Not saved yet";
  const nextLines = (l: SvLine, isNew: boolean) => setLines((ls) => (isNew ? [...ls, l] : ls.map((x) => (x.key === l.key ? l : x))));

  const label = (t: string) => <span style={{ fontSize: 11.5, color: M.ink }}>{t}</span>;
  const input = (k: keyof SvHeader, text: string, type: "text" | "date" = "text", wide?: boolean) => (
    <label style={{ display: "block", paddingTop: 10, minWidth: 0, gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginBottom: 5 }}>{text}</span>
      <input type={type} aria-label={text} value={header[k]} onChange={(e) => setH({ [k]: e.target.value } as Partial<SvHeader>)} style={fieldStyle({ height: 42, padding: "0 10px", fontSize: 15, borderRadius: 10, border: `1px solid ${M.hairline}`, boxShadow: "none", minWidth: 0 })} />
    </label>
  );
  const party = (labelText: string, value: string, placeholder: string, onClick: () => void, first?: boolean, sub?: string): ReactNode => (
    <button type="button" onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: first ? 60 : 52, padding: "10px 14px", border: "none", borderTop: first ? "none" : `1px solid ${CC.sep}`, background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        {label(labelText)}
        <span style={{ display: "block", fontSize: 14, fontWeight: first ? (value ? 700 : 500) : 600, color: first && !value ? CC.hint : M.raisin, marginTop: 2, overflowWrap: "anywhere" }}>{value || placeholder}</span>
        {sub ? <span style={{ display: "block", fontSize: 11.5, color: CC.hint, marginTop: 1 }}>{sub}</span> : null}
      </span>
      <ChevronRight size={17} strokeWidth={2} color={CC.brownSoft} aria-hidden />
    </button>
  );

  const footer = fail ? undefined : (
    <div>
      {err ? <div role="alert" style={{ fontSize: 12.5, color: CC.dangerDark, margin: "0 2px 8px", overflowWrap: "anywhere" }}>{err}</div> : null}
      {isEdit ? (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><FootBtn disabled={busy !== ""} onClick={tryLeave}>Discard</FootBtn></div>
          <div style={{ flex: 1.3 }}><Btn full h={48} disabled={busy !== ""} onClick={() => void saveEdit()}>{busy === "save" ? "Saving…" : "Save changes"}</Btn></div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><FootBtn disabled={busy !== ""} onClick={() => void saveNew(false)}>{busy === "draft" ? "Saving…" : "Save draft"}</FootBtn></div>
          <div style={{ flex: 1.3 }}><Btn full h={48} disabled={busy !== ""} onClick={() => { if (blockers.length) { setErr(blockers[0]); return; } setAskConfirm(true); }}>{busy === "confirm" ? "Saving…" : "Save & confirm"}</Btn></div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Overlay title={title} subtitle={subtitle} onClose={tryLeave} closeLabel="Close" footer={footer}>
        {fail ? (
          <section ref={failCard} role="alert" style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "13px 14px", background: CC.errBg }}>
              <CircleAlert size={18} strokeWidth={2} color={CC.dangerDark} style={{ flex: "none", marginTop: 1 }} aria-hidden />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: CC.dangerDark }}>{resultCard(fail.kind).title}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: CC.chipText, marginTop: 2, overflowWrap: "anywhere" }}>{fail.no ? `${fail.no} is saved as a draft. ` : "The order is saved as a draft. "}{fail.text}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "10px 14px 14px" }}>
              <button type="button" onClick={() => navigate(svDetailPath(fail.id), { replace: true })} style={{ flex: 1, height: 42, border: "none", borderRadius: 11, background: CC.tile, color: CC.brown, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Open draft</button>
              {resultCard(fail.kind).retry ? <button type="button" disabled={busy !== ""} onClick={() => { setBusy("confirm"); void confirm(fail.id, fail.no).then((ok) => { setBusy(""); if (ok) navigate(svDetailPath(fail.id), { replace: true }); }); }} style={{ flex: 1, height: 42, border: "none", borderRadius: 11, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: busy !== "" ? 0.5 : 1 }}>{busy === "confirm" ? "Confirming…" : "Try confirm again"}</button> : null}
            </div>
          </section>
        ) : null}
        {notice ? <Note>{notice}</Note> : null}
        {seed.source ? (
          <section style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: M.card, borderRadius: 16, boxShadow: SH_CARD }}>
            <span style={{ width: 38, height: 38, flex: "none", borderRadius: 11, background: CC.tile, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {seed.caseLink ? <Wrench size={18} strokeWidth={1.9} color={CC.brown} aria-hidden /> : seed.source.title.startsWith("Clone of") ? <Copy size={18} strokeWidth={1.9} color={CC.brown} aria-hidden /> : <Receipt size={18} strokeWidth={1.9} color={CC.brown} aria-hidden />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{seed.source.title}</div>
              <div style={{ fontSize: 12, lineHeight: 1.4, color: M.ink, marginTop: 2 }}>{seed.source.sub}</div>
            </div>
          </section>
        ) : null}
        {seed.caseLink && !seed.source ? (
          <button type="button" onClick={() => navigate(casePath(seed.caseLink!.id))} style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 8, minHeight: 36, padding: 0, border: "none", background: "none", color: M.ink, fontFamily: "inherit", fontSize: 12.5, cursor: "pointer" }}>
            <Wrench size={14} strokeWidth={2} color={CC.brownSoft} aria-hidden />Linked to service case <b style={{ color: M.raisin }}>{seed.caseLink.caseNo}</b>
          </button>
        ) : null}

        <section>
          <SectionLabel>Customer</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {party("Customer", header.customerName || (header.customerId ? "Selected customer" : ""), "Choose customer", onCustomer, true, header.customerId ? undefined : "Required")}
            {party("Delivery hub", header.hubName || (header.hubId ? "Selected hub" : ""), "Choose hub", onHub)}
            {!isEdit ? (
              <label style={{ display: "block", padding: "10px 14px", borderTop: `1px solid ${CC.sep}` }}>
                {label("Company")}
                <select aria-label="Company this order is booked under" value={header.salesOrgCode} onChange={(e) => setH({ salesOrgCode: e.target.value })} style={fieldStyle({ height: 42, padding: "0 10px", fontSize: 15, borderRadius: 10, border: `1px solid ${M.hairline}`, boxShadow: "none", width: "100%", marginTop: 2 })}>
                  {activeOrgs.length === 0 ? <option value={header.salesOrgCode}>{header.salesOrgCode}</option> : activeOrgs.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                </select>
              </label>
            ) : null}
          </Card>
          {isEdit && !draft ? <div style={{ fontSize: 11.5, color: CC.hint, margin: "7px 2px 0" }}>Changing the customer or hub after confirmation applies straight away and can carry a reason.</div> : null}
        </section>

        <section>
          <SectionLabel>Dates &amp; references</SectionLabel>
          <Card style={{ padding: "4px 14px 12px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0 10px" }}>
            {input("customerDeliveryDate", "Customer DD", "date")}
            {input("hookkaExpectedDD", "Expected DD", "date")}
            {input("customerPOId", "Customer PO")}
            {input("customerSOId", "Customer SO")}
            {input("reference", "Reference", "text", true)}
          </Card>
        </section>

        <section>
          <SectionLabel right={lines.length ? <span style={{ fontSize: 12, color: CC.hint }}>{lines.length} line{lines.length > 1 ? "s" : ""}</span> : undefined}>Items</SectionLabel>
          <div style={{ display: "grid", gap: 10 }}>
            {lines.map((l) => (
              <button key={l.key} type="button" onClick={() => setEdit({ line: l, isNew: false })} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, padding: "13px 14px", border: "none", borderRadius: 16, background: M.card, boxShadow: SH_CARD, fontFamily: "inherit", textAlign: "left", cursor: "pointer", minWidth: 0, WebkitTapHighlightColor: "transparent" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{l.productName || l.productCode || "Choose product"}</span>
                    <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtRm(lineTotalSen(l))}</span>
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 3, overflowWrap: "anywhere" }}>{[l.productCode, l.sizeLabel, l.fabricCode].filter(Boolean).join(" · ")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <span style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: CC.tile, color: CC.brown, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{SCOPE_PRESET_LABEL[l.scope.preset]}{l.scope.components.length ? ` · ${l.scope.components.length} component${l.scope.components.length > 1 ? "s" : ""}` : ""}</span>
                    <span style={{ fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{l.quantity} × {fmtRm(unitPriceSen(l))}</span>
                    {l.prefilled ? <span style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: CC.warnBg, color: CC.warnFg, fontSize: 11, fontWeight: 700 }}>Prefilled · review</span> : null}
                    {!l.fabricCode.trim() ? <span style={{ fontSize: 12, color: CC.danger, fontWeight: 600 }}>Fabric missing</span> : null}
                  </span>
                </span>
                <ChevronRight size={17} strokeWidth={2} color={CC.brownSoft} aria-hidden />
              </button>
            ))}
            {lines.length === 0 ? <div style={{ padding: 16, borderRadius: 16, background: M.card, boxShadow: SH_CARD, textAlign: "center", fontSize: 13, color: CC.hint }}>No items yet.</div> : null}
            <button type="button" onClick={() => setEdit({ line: blankLine(), isNew: true })} style={{ height: 46, border: "1.5px dashed #C9BFAE", borderRadius: 14, background: "transparent", color: CC.brown, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" }}>
              <Plus size={16} strokeWidth={2.2} aria-hidden />Add item
            </button>
          </div>
        </section>

        <section>
          <SectionLabel>Totals</SectionLabel>
          <Card style={{ padding: "2px 14px" }}>
            {([["Lines", String(sum.lines)], ["Quantity", String(sum.qty)], ["Subtotal", fmtRm(sum.subtotalSen)], ["Total", fmtRm(sum.totalSen)]] as const).map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: i ? `1px solid ${CC.sep}` : "none" }}>
                <span style={{ fontSize: 13, color: M.ink }}>{k}</span><span style={{ fontSize: 14, fontWeight: i === 3 ? 700 : 600, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </div>
            ))}
          </Card>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "8px 2px 0", fontSize: 12, lineHeight: 1.45, color: M.ink }}>
            <Info size={13} strokeWidth={2} color={CC.brownSoft} style={{ flex: "none", marginTop: 2 }} aria-hidden /><span>Review prices before confirming; zero is allowed.</span>
          </div>
        </section>

        <label style={{ display: "block" }}>
          <SectionLabel>Notes</SectionLabel>
          <textarea aria-label="Notes" rows={3} value={header.notes} placeholder="Anything production or delivery should know" onChange={(e) => setH({ notes: e.target.value })} style={fieldStyle({ padding: "12px 13px", resize: "vertical", lineHeight: 1.5, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 6px 18px -10px rgba(31,29,27,.18)" })} />
        </label>
      </Overlay>

      {edit ? (
        <SvItemEditor
          key={edit.line.key}
          initial={edit.line}
          isNew={edit.isNew}
          onBack={() => setEdit(null)}
          onSave={(l) => { nextLines(l, edit.isNew); setEdit(null); setErr(""); }}
          onRemove={edit.isNew ? undefined : () => { const k = edit.line.key; setLines((ls) => ls.filter((x) => x.key !== k)); setEdit(null); }}
        />
      ) : null}

      <CustomerPickerSheet open={sheet === "customer"} onClose={() => setSheet("")} currentId={header.customerId}
        onPick={(c) => {
          const same = c.id === header.customerId;
          // A hub belongs to one customer: a different customer clears it (one hub = auto, as the server does).
          setH(same ? { customerName: c.name } : { customerId: c.id, customerName: c.name, hubId: c.hubs.length === 1 ? c.hubs[0].id : "", hubName: c.hubs.length === 1 ? c.hubs[0].shortName : "", salesOrgCode: companyForCustomer(c.defaultCompany, activeOrgs.map((o) => o.code), header.salesOrgCode) });
        }} />
      <HubPickerSheet open={sheet === "hub"} onClose={() => setSheet("")} customerId={header.customerId} customerName={header.customerName} currentId={header.hubId} onPick={(h) => setH({ hubId: h.id, hubName: h.name })} />
      {isEdit && !draft ? (
        <>
          <CustomerChangeSheet open={sheet === "changeCustomer"} orderId={rowId} currentCustomerId={header.customerId} onClose={() => setSheet("")} onSaved={(m) => void reloadParty(m)} />
          <HubChangeSheet open={sheet === "changeHub"} orderId={rowId} customerId={header.customerId} currentHubId={header.hubId} onClose={() => setSheet("")} onSaved={(m, w) => void reloadParty([m, ...w].join(" "))} />
        </>
      ) : null}
      <ConfirmDialog open={askConfirm} title="Save & confirm" text="Saves the draft, then confirms it. Confirming creates production orders for every line; the order takes the status the server returns. Proceed?" keepLabel="Back" goLabel="Save & confirm" danger={false} onKeep={() => setAskConfirm(false)} onGo={() => { setAskConfirm(false); void saveNew(true); }} />
      <ConfirmDialog open={askDiscard} title="Discard changes?" text="Your changes to this form will be lost." danger={false} onKeep={() => setAskDiscard(false)} onGo={() => { setAskDiscard(false); leave(); }} />
    </>
  );
}
