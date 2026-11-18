// Public rack stock-in page — opened by warehouse staff scanning the QR
// printed on a physical rack (/r/<rackId>). Intentionally standalone (no
// dashboard / worker-portal chrome), mobile-first, NO LOGIN — the rack id in
// the URL is the entry point, and the backend (/api/public/rack-qr) only
// performs the one forward action (stock items INTO this rack) the office
// rack-overview page already allows. Mirrors the public /d/:token DO-scan
// page's mounting + visual style.
//
// Flow:
//   1. On mount, GET the rack summary (label + current item count).
//   2. Open an in-page camera scanner. Each decoded ITEM QR is looked up via
//      the backend. PER-PIECE: every FG/WIP/packing QR is a UNIQUE token for
//      ONE physical piece, so each NEW QR value adds ONE line (qty 1) carrying
//      the piece's description + Sales Order number; re-scanning a QR already in
//      the list is rejected ("Already added" + error beep), never bumped — so 9
//      distinct stickers = 9 lines. An item currently in a DIFFERENT rack
//      prompts Move-here / Skip; one already in THIS rack just records the piece.
//   3. Tap the big "Stock In (N)" button (two-tap arm→confirm, like DO-scan) to
//      POST the list. On success the list clears; on error it's kept for retry.
//
// The camera loop lives in src/components/qr-camera-scanner.tsx. A short ~80ms
// WebAudio blip confirms every successful add; a lower double tone signals
// not-recognised / wrong-rack. The scanner stays open and keeps decoding after
// each hit so items are scanned continuously, with a per-value de-dup so one
// held sticker adds exactly once.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Trash2,
} from "lucide-react";
import { QrCameraScanner } from "@/components/qr-camera-scanner";
import { csrfHeaders } from "@/lib/csrf";

// ── Backend shapes (API contract — see routes/public-rack-qr.ts) ──────────
type RackContentItem = {
  description: string;
  salesOrderNo: string;
  // Owner 2026-06-25: each item must show whose goods (customer) + the customer PO.
  customerName: string;
  customerPO: string;
  stockedInDate: string;
};
type RackSummary = {
  rackId: string;
  rackLabel: string;
  itemCount: number;
  // Owner 2026-06-25: show WHAT is in the rack, not just the count.
  items?: RackContentItem[];
};

type ItemLookup = {
  found: boolean;
  productionOrderId: string | null;
  productName: string | null;
  poNo: string | null;
  // Per-piece (owner's model): the Sales Order this piece belongs to + a clear
  // human description (productName + size, e.g. "1013 King Size Headboard").
  salesOrderNo: string | null;
  description: string | null;
  // The EXACT job_card this piece resolved to (PACKING-sentinel or job-card
  // sticker). Threaded back into stock-in so the rack stamp hits THIS card's
  // rackingNumber — the only way to pick the right one of a bedframe PO's many
  // PACKING cards. null for a manual / PO-level match.
  jobCardId: string | null;
  // PER-PIECE (mig 0192): the physical piece number + the WIP's total piece count
  // for a multi-piece sticker (a DIVAN of 2 → pieceNo 1/2, totalPieces 2). Posted
  // back to stock-in so each physical piece writes its OWN distinct rack row (the
  // 2nd piece no longer reads "already in this rack"). null = single-piece/legacy.
  pieceNo: number | null;
  totalPieces: number | null;
  // When set AND different from the scanned rack, the item currently lives in
  // another rack — the UI offers Move-here / Skip before adding the line.
  currentRackId: string | null;
  currentRackLabel: string | null;
};

// One accumulated stock-in line = ONE unique physical piece.
//
// PER-PIECE MODEL: every FG/WIP/packing QR is a UNIQUE token for ONE piece, so
// the list is keyed by `rawValue` (the exact decoded QR string). A new QR value
// adds one line (qty is always 1 — a sticker is a single piece); re-scanning a
// QR already in the list is rejected ("Already added"), never bumped. So 9
// distinct stickers → 9 lines; the same sticker rescanned → ignored.
type Line = {
  rawValue: string; // the decoded QR string — the unique per-piece key
  productionOrderId: string | null;
  productName: string; // clear description shown to the worker
  poNo: string | null;
  salesOrderNo: string | null;
  // The exact job_card this piece resolved to (from the /item response); posted
  // back to stock-in so the rack stamp lands on THIS card. null when none.
  jobCardId: string | null;
  // Per-piece markers (mig 0192) carried from /item → posted to stock-in so a
  // multi-piece WIP writes one distinct rack row per physical piece. null/legacy.
  pieceNo: number | null;
  totalPieces: number | null;
  qty: number; // always 1 (kept for the POST contract / totals)
};

// An item found in a DIFFERENT rack, parked until the user taps Move / Skip.
type PendingMove = {
  line: Line;
  currentRackLabel: string;
};

export default function RackScanPage() {
  const { rackId } = useParams();

  // ── Rack summary (mount fetch) ───────────────────────────────────────────
  const [summary, setSummary] = useState<RackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "In this rack now" contents list — collapsible, open by default (owner
  // 2026-06-25: see what's inside the rack, full page scroll, no nested scroll).
  const [contentsOpen, setContentsOpen] = useState(true);

  // ── Accumulated stock-in list ────────────────────────────────────────────
  const [lines, setLines] = useState<Line[]>([]);
  // The cross-rack Move/Skip prompt for the most recent ambiguous scan.
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  // Transient one-line scan feedback (recognised / not-recognised / bumped).
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // ── Stock-in submit (two-tap arm→confirm, like DO-scan) ──────────────────
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  // ── Camera state ─────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // De-dupe the decode→lookup pipeline: a single sticker held in frame fires
  // many frames; remember the last raw value + when, so we don't spam the
  // backend or double-count. A different value, or the same value after a short
  // cooldown (DEDUP_MS), is allowed through. Set SYNCHRONOUSLY on the very first
  // hit (before any await) so two back-to-back frames can't both pass — this is
  // the guard that stops one physical scan adding a line twice.
  const lastRawRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  // A lookup is in flight — gate so frames decoded during the async round-trip
  // don't pile up requests (belt-and-braces with the value de-dup).
  const lookupBusyRef = useRef(false);
  // Lazily-created WebAudio context for the scan "滴" blip. Created on the first
  // user gesture (Start / tapping the video) so autoplay policy lets it sound;
  // null until then. Reused for every beep thereafter.
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Ignore the SAME decoded string for this long so one barcode held in frame
  // adds exactly once; a DIFFERENT item passes immediately.
  const DEDUP_MS = 1500;

  // ── Scan feedback beep ("滴") ─────────────────────────────────────────────
  // Lazily create one AudioContext on a user gesture, then play a short tone.
  // `ok` → a single bright ~880Hz blip (the "滴" the owner wants on every add);
  // not-ok → a lower, doubled tone for "not recognised" / "wrong rack". Wrapped
  // in try/catch so audio never breaks scanning on a locked-down browser.
  const ensureAudio = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    } catch {
      audioCtxRef.current = null;
    }
    return audioCtxRef.current;
  }, []);

  const beep = useCallback(
    (ok: boolean) => {
      try {
        const ctx = ensureAudio();
        if (!ctx) return;
        // A gesture-created context can still be suspended on iOS — resume it.
        if (ctx.state === "suspended") void ctx.resume();
        const play = (freq: number, startAt: number, durMs: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          // Tiny attack/decay envelope so the blip doesn't click.
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(0.32, startAt + 0.008);
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            startAt + durMs / 1000,
          );
          osc.connect(gain).connect(ctx.destination);
          osc.start(startAt);
          osc.stop(startAt + durMs / 1000 + 0.02);
        };
        const t0 = ctx.currentTime;
        if (ok) {
          play(880, t0, 80); // single bright "滴"
        } else {
          play(300, t0, 110); // lower, doubled → clearly "not added"
          play(300, t0 + 0.16, 110);
        }
      } catch {
        /* audio is best-effort — never break the scan over it */
      }
    },
    [ensureAudio],
  );

  // ── Mount: load the rack summary ─────────────────────────────────────────
  // No synchronous setState before the first await — `loading` starts true and
  // every write lands in the async continuation (react-hooks/set-state-in-effect),
  // matching the do-scan page's mount pattern.
  const load = useCallback(async () => {
    if (!rackId) return;
    try {
      const r = await fetch(
        `/api/public/rack-qr/${encodeURIComponent(rackId)}`,
        { cache: "no-store" },
      );
      setLoadError(null);
      const j = (await r.json().catch(() => ({}))) as Partial<RackSummary> & {
        error?: string;
      };
      if (!r.ok || !j.rackId) {
        setSummary(null);
        setLoadError(
          j.error ||
            "Rack not found. Please ask the Hookka office for a freshly printed rack QR.",
        );
      } else {
        setSummary({
          rackId: j.rackId,
          rackLabel: j.rackLabel || j.rackId,
          itemCount: j.itemCount ?? 0,
          items: j.items ?? [],
        });
      }
    } catch {
      setSummary(null);
      setLoadError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [rackId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount (public page, no session deps); same pattern as do-scan.tsx
    void load();
  }, [load]);

  // ── List mutation helpers ────────────────────────────────────────────────
  // Synchronous membership gate for PER-PIECE de-dup. Mirrors the raw QR values
  // currently in `lines`. We consult/claim it SYNCHRONOUSLY (state updates are
  // async/batched, so reading `lines` here would be stale) — this is what makes
  // "already added?" a reliable yes/no even for two back-to-back camera frames.
  // Kept in sync on add (here), on remove, and on submit-clear.
  const addedValuesRef = useRef<Set<string>>(new Set());

  // Add ONE unique piece, keyed by its raw QR value. PER-PIECE: a QR value
  // already recorded is a re-scan of the SAME physical sticker → NOT added and
  // NOT bumped (returns false so the caller shows "Already added" + the error
  // beep). A new QR value pushes one line at qty 1.
  const addPiece = useCallback((line: Line): boolean => {
    if (addedValuesRef.current.has(line.rawValue)) return false; // dup sticker
    addedValuesRef.current.add(line.rawValue);
    setDoneMsg(null);
    setLines((prev) => [...prev, { ...line, qty: 1 }]);
    return true;
  }, []);

  // ── Decode → item lookup ─────────────────────────────────────────────────
  // Each decoded raw code is looked up against the backend item endpoint. The
  // raw string is sent verbatim (URL-encoded) so the backend owns the parse —
  // this page makes no assumption about the sticker shape.
  const handleDecoded = useCallback(
    async (raw: string) => {
      if (!rackId || !raw) return;
      // Throttle the held-sticker frame burst: ignore the same raw value fired
      // again within DEDUP_MS (a held sticker decodes every frame). This check +
      // the synchronous ref write below run BEFORE any await, so two back-to-
      // back frames carrying the same code can't both reach the backend. A
      // different sticker, or the same one after the cooldown, passes — and the
      // permanent per-piece de-dup (addedValuesRef) then decides add vs
      // "Already added", so a sticker is recorded exactly once regardless.
      const now = performance.now();
      if (
        raw === lastRawRef.current.value &&
        now - lastRawRef.current.at < DEDUP_MS
      ) {
        // Held sticker: REFRESH the cooldown so a sticker kept in frame stays a
        // silent no-op instead of re-firing "Already added" + 滴 every DEDUP_MS
        // (owner 2026-06-17: "扫了一次它无限地扫、一直滴、拿走了还一直叫"). Only a
        // real gap — the sticker leaving the frame for > DEDUP_MS — lets the same
        // value through again (a deliberate re-scan), which shows "Already added"
        // exactly once.
        lastRawRef.current.at = now;
        return;
      }
      // Claim this value synchronously (no await in between) — the de-dup gate.
      lastRawRef.current = { value: raw, at: now };
      // Second guard: a lookup already in flight (the async round-trip) — drop
      // this frame entirely so requests can't pile up.
      if (lookupBusyRef.current) return;
      lookupBusyRef.current = true;
      try {
        // PER-PIECE: this exact QR is already listed → SAME sticker rescanned.
        // Tell the worker, skip the backend, never add a duplicate / bump.
        if (addedValuesRef.current.has(raw)) {
          setPendingMove(null);
          setScanMsg("Already added — this piece is already in the list.");
          beep(false);
          return;
        }
        const r = await fetch(
          `/api/public/rack-qr/${encodeURIComponent(rackId)}/item?code=${encodeURIComponent(raw)}`,
          { cache: "no-store" },
        );
        const j = (await r.json().catch(() => ({}))) as ItemLookup & {
          error?: string;
        };
        if (!r.ok || !j || j.found === false) {
          setPendingMove(null);
          // Keep the message short — show the human label if the raw is long.
          const shown = raw.length > 28 ? `${raw.slice(0, 28)}…` : raw;
          setScanMsg(`Not recognised: ${shown}`);
          beep(false);
          return;
        }
        // Description (productName + size) is the clear label the owner wants;
        // fall back through productName / poNo so a line is never blank.
        const desc = j.description || j.productName || j.poNo || "Item";
        const line: Line = {
          rawValue: raw, // unique per-piece key
          productionOrderId: j.productionOrderId,
          productName: desc,
          poNo: j.poNo,
          salesOrderNo: j.salesOrderNo,
          // Carry the resolved card id so stock-in stamps that exact card.
          jobCardId: j.jobCardId ?? null,
          // Carry the per-piece markers so a multi-piece WIP writes a distinct row.
          pieceNo: j.pieceNo ?? null,
          totalPieces: j.totalPieces ?? null,
          qty: 1,
        };
        // In a DIFFERENT rack → park for a Move / Skip decision. Lower tone:
        // nothing was added yet, the worker must choose Move / Skip.
        if (j.currentRackId && j.currentRackId !== rackId) {
          setScanMsg(null);
          setPendingMove({
            line,
            currentRackLabel: j.currentRackLabel || j.currentRackId,
          });
          beep(false);
          return;
        }
        // Already racked in THIS rack (persisted from a prior session) → tell the
        // worker and DON'T write a duplicate row (owner 2026-06-17: "它已经在 Rack
        // X 了却不显示"). A piece added earlier in THIS session is caught above by
        // addedValuesRef ("Already added"); this branch covers the DB state.
        if (j.currentRackId && j.currentRackId === rackId) {
          setPendingMove(null);
          setScanMsg(
            `Already in this rack${j.currentRackLabel ? ` (${j.currentRackLabel})` : ""} — no need to scan again.`,
          );
          beep(false);
          return;
        }
        // Not racked anywhere → record ONE piece + "滴" (qty 1, keyed by raw QR).
        // addPiece returns false only if this exact QR is already listed →
        // "Already added" + error tone.
        setPendingMove(null);
        if (addPiece(line)) {
          setScanMsg(`Added: ${desc}`);
          beep(true);
        } else {
          setScanMsg("Already added — this piece is already in the list.");
          beep(false);
        }
      } catch {
        setScanMsg("Network error — scan again.");
        // Allow an immediate retry of this same value after a network blip.
        lastRawRef.current = { value: "", at: 0 };
      } finally {
        lookupBusyRef.current = false;
      }
    },
    [rackId, addPiece, beep],
  );

  const stopScan = useCallback(() => {
    setScanning(false);
  }, []);

  const primeAudio = useCallback(() => {
    const ac = ensureAudio();
    if (ac && ac.state === "suspended") void ac.resume();
  }, [ensureAudio]);

  const startScan = useCallback(() => {
    if (scanning) return;
    setCameraError(null);
    setScanMsg(null);
    primeAudio();
    setScanning(true);
  }, [scanning, primeAudio]);

  useEffect(() => {
    return () => {
      const ac = audioCtxRef.current;
      if (ac) {
        audioCtxRef.current = null;
        try {
          void ac.close();
        } catch {
          /* */
        }
      }
    };
  }, []);

  // ── Move / Skip resolution for a cross-rack item ─────────────────────────
  const resolveMove = useCallback(
    (move: boolean) => {
      const cur = pendingMove;
      if (!cur) return;
      setPendingMove(null);
      if (move) {
        // Record the piece — the backend stock-in performs the actual move.
        // addPiece de-dups by raw QR, so re-confirming the same sticker is safe.
        if (addPiece(cur.line)) {
          setScanMsg(`Moving here: ${cur.line.productName}`);
          beep(true); // confirmed add → the same "滴"
        } else {
          setScanMsg("Already added — this piece is already in the list.");
          beep(false);
        }
      } else {
        setScanMsg(`Skipped: ${cur.line.productName}`);
      }
    },
    [pendingMove, addPiece, beep],
  );

  // Remove ONE piece by its raw QR key, and release that key from the
  // per-piece de-dup Set so the SAME sticker can be re-scanned afterwards.
  const removeLine = useCallback((line: Line) => {
    addedValuesRef.current.delete(line.rawValue);
    setLines((prev) => prev.filter((x) => x.rawValue !== line.rawValue));
  }, []);

  // ── Stock In (two-tap arm→confirm) ───────────────────────────────────────
  const totalQty = lines.reduce((s, x) => s + x.qty, 0);

  const handleStockIn = useCallback(async () => {
    if (!rackId || submitting || lines.length === 0) return;
    // First tap arms, second tap confirms — same guard as the DO-scan button.
    if (!armed) {
      setArmed(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(
        `/api/public/rack-qr/${encodeURIComponent(rackId)}/stock-in`,
        {
          method: "POST",
          // csrfHeaders: cookieless public users send no CSRF header (silently
          // omitted); a logged-in staff phone carries the session cookie and the
          // backend then requires the echo — include it so both paths work.
          headers: csrfHeaders(),
          body: JSON.stringify({
            // PER-PIECE: one entry per unique scanned sticker, qty 1. Send the
            // description (what the rack row will read) + the SO number so the
            // backend writes one row per piece carrying both.
            items: lines.map((x) => ({
              productionOrderId: x.productionOrderId,
              productName: x.productName,
              description: x.productName,
              poNo: x.poNo,
              salesOrderNo: x.salesOrderNo,
              // The exact card to stamp the rack onto (resolved at /item time).
              jobCardId: x.jobCardId,
              // Per-piece markers so a multi-piece WIP writes one distinct row per
              // physical piece (the 2nd DIVAN piece gets its own rack).
              pieceNo: x.pieceNo,
              totalPieces: x.totalPieces,
              qty: 1,
            })),
          }),
        },
      );
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        // Keep the list so the worker can retry.
        setSubmitError(j.error || "Stock-in failed. Please try again.");
        return;
      }
      const n = j.count ?? totalQty;
      const label = summary?.rackLabel || rackId;
      setDoneMsg(`✓ Stocked ${n} into ${label}`);
      setScanMsg(null);
      setLines([]);
      // Clear the per-piece de-dup keys so a fresh batch can scan cleanly.
      addedValuesRef.current.clear();
      // Reflect the new total in the rack header.
      setSummary((s) => (s ? { ...s, itemCount: s.itemCount + n } : s));
      // Refresh "In this rack now" so the just-stocked pieces show, with no
      // loading flash (background; keep the optimistic count if it fails).
      void (async () => {
        try {
          const rr = await fetch(
            `/api/public/rack-qr/${encodeURIComponent(rackId || "")}`,
            { credentials: "include" },
          );
          const jj = (await rr.json().catch(() => null)) as
            | (Partial<RackSummary> & { items?: RackContentItem[] })
            | null;
          if (rr.ok && jj && Array.isArray(jj.items)) {
            const fresh = jj.items;
            setSummary((s) =>
              s
                ? { ...s, itemCount: jj.itemCount ?? s.itemCount, items: fresh }
                : s,
            );
          }
        } catch {
          /* keep the optimistic count + existing list */
        }
      })();
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setArmed(false);
      setSubmitting(false);
    }
  }, [rackId, submitting, lines, armed, totalQty, summary]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F0ECE9]">
      {/* Header — mirrors the DO-scan dark bar. */}
      <header className="bg-[#1F1D1B] text-white">
        <div className="max-w-xl mx-auto px-4 py-5 flex items-center gap-3">
          <div className="h-9 w-9 rounded bg-[#6B5C32] flex items-center justify-center">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Rack Stock-In</h1>
            <p className="text-xs text-gray-400">HOOKKA INDUSTRIES</p>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-4 pb-12">
        {loading && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm border border-[#E6E0D9]">
            <div className="h-8 w-8 mx-auto rounded-full border-4 border-[#6B5C32] border-t-transparent animate-spin" />
            <p className="mt-3 text-sm text-gray-500">Looking up rack...</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-xl bg-white p-6 shadow-sm border border-[#E8B2A1]">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-[#9A3A2D] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[#9A3A2D]">Rack not found</p>
                <p className="text-sm text-[#9A3A2D] mt-1">{loadError}</p>
              </div>
            </div>
          </div>
        )}

        {!loading && summary && (
          <>
            {/* Rack header card */}
            <div className="rounded-xl bg-[#1F1D1B] text-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-widest text-gray-400">
                Rack
              </p>
              <p className="text-2xl font-bold mt-0.5">{summary.rackLabel}</p>
              <p className="text-xs text-gray-400 mt-1">
                Currently holds{" "}
                <span className="font-semibold text-white">
                  {summary.itemCount}
                </span>{" "}
                item{summary.itemCount === 1 ? "" : "s"}.
              </p>
            </div>

            {/* Success banner (last stock-in). */}
            {doneMsg && (
              <div className="rounded-xl bg-[#4F7C3A] text-white p-5 text-center shadow-sm">
                <CheckCircle2 className="h-12 w-12 mx-auto" strokeWidth={2.5} />
                <p className="text-lg font-bold mt-2">{doneMsg}</p>
                <p className="text-sm opacity-90 mt-1">
                  Scan more items to keep stocking this rack.
                </p>
              </div>
            )}

            {/* ── Camera scanner ──────────────────────────────────────────── */}
            {scanning ? (
              <QrCameraScanner
                onDecode={(text) => void handleDecoded(text)}
                onClose={stopScan}
                onError={(message) => {
                  setCameraError(message);
                  setScanning(false);
                }}
                onUserGesture={primeAudio}
                statusText={scanMsg ?? undefined}
              />
            ) : (
              <button
                type="button"
                onClick={startScan}
                className="w-full rounded-xl bg-[#6B5C32] active:bg-[#5a4d2a] text-white py-4 text-lg font-bold shadow-sm flex items-center justify-center gap-2"
              >
                <Camera className="h-5 w-5" />
                {lines.length > 0 ? "Scan more items" : "Scan items"}
              </button>
            )}

            {/* Camera error (permission / no camera). */}
            {cameraError && (
              <div className="rounded-xl bg-white p-4 shadow-sm border border-[#E8B2A1]">
                <p className="text-sm text-[#9A3A2D]">{cameraError}</p>
              </div>
            )}

            {/* Cross-rack Move / Skip prompt. */}
            {pendingMove && (
              <div className="rounded-xl bg-[#FBF1DF] p-4 shadow-sm border border-[#E8D3A1] space-y-3">
                <div className="flex items-start gap-2 text-sm text-[#9C6F1E]">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-px" />
                  <p>
                    <span className="font-semibold">
                      {pendingMove.line.productName}
                    </span>{" "}
                    is currently in Rack{" "}
                    <span className="font-semibold">
                      {pendingMove.currentRackLabel}
                    </span>
                    . Move it into {summary.rackLabel}?
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolveMove(true)}
                    className="flex-1 rounded-xl bg-[#9C6F1E] active:bg-[#835D19] text-white py-3 text-sm font-bold"
                  >
                    Move here
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveMove(false)}
                    className="flex-1 rounded-xl bg-white border border-[#E6E0D9] text-gray-600 py-3 text-sm font-semibold"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}

            {/* ── Accumulated stock-in list ──────────────────────────────── */}
            <div className="rounded-xl bg-white shadow-sm border border-[#E6E0D9] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-base font-bold text-[#1F1D1B]">
                  Items to stock in
                </p>
                {totalQty > 0 && (
                  <span className="text-sm font-semibold text-[#6B5C32]">
                    {totalQty} item{totalQty === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {lines.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">
                  Nothing scanned yet. Tap{" "}
                  <span className="font-medium">Scan items</span> and point at an
                  item QR — each scan adds one.
                </p>
              ) : (
                <ul className="divide-y divide-[#EFEAE5]">
                  {/* PER-PIECE: one row per unique sticker, keyed by its raw QR
                      value. No ×qty badge — each row IS one piece. Shows the
                      description + the piece's Sales Order number. */}
                  {lines.map((it) => (
                    <li
                      key={it.rawValue}
                      className="flex items-center gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#1F1D1B]">
                          {it.productName}
                        </p>
                        {(it.salesOrderNo || it.poNo) && (
                          <p className="truncate text-xs text-gray-500">
                            {it.salesOrderNo || it.poNo}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(it)}
                        className="shrink-0 text-gray-400 active:text-[#9A3A2D] p-1"
                        aria-label={`Remove ${it.productName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {submitError && (
                <p className="text-sm text-[#9A3A2D]">{submitError}</p>
              )}

              <button
                type="button"
                disabled={lines.length === 0 || submitting}
                onClick={() => void handleStockIn()}
                className="w-full rounded-xl bg-[#9C6F1E] active:bg-[#835D19] text-white py-4 text-lg font-bold shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? (
                  <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                ) : (
                  <PackageCheck className="h-5 w-5" />
                )}
                {armed
                  ? `Tap again to confirm — Stock In (${totalQty})`
                  : `Stock In (${totalQty})`}
              </button>
              {armed && !submitting && (
                <button
                  type="button"
                  onClick={() => setArmed(false)}
                  className="w-full rounded-xl bg-white border border-[#E6E0D9] text-gray-600 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>
              )}
            </div>

            {/* In this rack now — the rack's CURRENT contents (owner 2026-06-25):
                description + Sales Order + stocked-in date. The whole page scrolls
                (no nested scroll); collapsible, open by default. */}
            {(summary.items?.length ?? 0) > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setContentsOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-1 py-2"
                  aria-expanded={contentsOpen}
                >
                  <span className="text-base font-bold text-[#1F1D1B]">
                    In this rack now
                  </span>
                  <span className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="inline-flex items-center justify-center min-w-[24px] rounded-full bg-[#E7E1D8] px-2 py-0.5 text-xs font-semibold text-[#5F5A52]">
                      {summary.items?.length ?? 0}
                    </span>
                    {contentsOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </span>
                </button>
                {contentsOpen && (
                  <ul className="space-y-2 mt-1">
                    {summary.items?.map((it, i) => (
                      <li
                        key={i}
                        className="rounded-xl bg-white border border-[#E6E0D9] px-3 py-2.5"
                      >
                        <p className="text-sm font-medium text-[#1F1D1B] break-words">
                          {it.description}
                        </p>
                        {(it.customerName || it.customerPO) && (
                          <p className="text-xs text-[#1F1D1B] mt-0.5 break-words">
                            {it.customerName}
                            {it.customerName && it.customerPO ? " · " : ""}
                            {it.customerPO}
                          </p>
                        )}
                        {(it.salesOrderNo || it.stockedInDate) && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {it.salesOrderNo}
                            {it.salesOrderNo && it.stockedInDate ? " · " : ""}
                            {it.stockedInDate
                              ? `stocked in ${it.stockedInDate}`
                              : ""}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <p className="text-[10px] text-center text-gray-400">
              For other changes, contact the Hookka office.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
