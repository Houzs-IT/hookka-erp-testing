// ---------------------------------------------------------------------------
// /m/outsource-issue — Outsource Work (Batch 4 redesign, approved Claude Design
// prototype "Outsource Work"). Issue tab: pick a worker, scan (the real shared
// scanner) or type a sticker code, undo this session's issues. Tracking tab:
// status chips with server counts, search, filters, cards and the record page
// with Approve / Send back. Phone, foldable and tablet (worker aside + split
// record pane). Every read and write goes through useOutsourceIssue.
// ---------------------------------------------------------------------------
import { useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, RefreshCw, ScanQrCode } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { useOutsourceIssue } from "@/pages/production/use-outsource-issue";
import type { OutsourceIssueWithDone } from "@/pages/production/use-outsource-issue";
import { useNavDrawer } from "../lib/nav-drawer";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { DetailPlaceholder, IssueDetail, ReviewSheet } from "./outsource/os-detail";
import { IssueSection, WorkerAside, WorkerPickerSheet, type IssueAccess } from "./outsource/os-issue";
import { OsHeader, RoundButton } from "./outsource/os-kit";
import { ScannerOverlay } from "./outsource/os-scanner";
import { KEYFRAMES, X } from "./outsource/os-style";
import { TrackingList, type ReviewAccess, type ReviewKind } from "./outsource/os-tracking";

type Tab = "issue" | "tracking";
type Selection = { id: string; snap: OutsourceIssueWithDone; verified: OutsourceIssueWithDone | null };

const TABS: { key: Tab; l: string; icon: typeof ScanQrCode }[] = [
  { key: "issue", l: "Issue", icon: ScanQrCode },
  { key: "tracking", l: "Tracking", icon: ListChecks },
];

function clockLabel(): string {
  const d = new Date();
  return `Updated ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function scrollPageTo(y: number): void {
  if (typeof window !== "undefined") window.scrollTo(0, y);
}

export function OutsourceIssueScreen(): JSX.Element {
  const navigate = useNavigate();
  const drawer = useNavDrawer();
  const layout = useResponsiveLayout();
  const phone = layout.mode === "phone";
  const wide = layout.canSplitDetail;
  const issue = useOutsourceIssue();

  // Permissions: issue / undo stay allowed while the permission set loads (as before);
  // approve / send back wait for it. Each review action can appear alone.
  const { hasPermission, loading: isPermissionsLoading } = usePermissions();
  const access: IssueAccess = {
    canIssue: isPermissionsLoading || hasPermission("outsource-issues", "create"),
    canUndo: isPermissionsLoading || hasPermission("outsource-issues", "delete"),
  };
  const review: ReviewAccess = {
    canApprove: !isPermissionsLoading && hasPermission("production-orders", "create"),
    canSendBack: !isPermissionsLoading && hasPermission("outsource-issues", "update"),
  };

  const [tab, setTab] = useState<Tab>("issue");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastAction, setLastAction] = useState<"issue" | "undo">("issue");
  const [sel, setSel] = useState<Selection | null>(null);
  const [listScroll, setListScroll] = useState(0);
  const [asking, setAsking] = useState<{ kind: ReviewKind; item: OutsourceIssueWithDone } | null>(null);

  // "Updated hh:mm": the time the list last finished loading (derived state, no effect).
  const [loaded, setLoaded] = useState<{ list: unknown; label: string }>({ list: null, label: "" });
  if (!issue.isListLoading && !issue.listError && loaded.list !== issue.issues) {
    setLoaded({ list: issue.issues, label: clockLabel() });
  }

  const pickWorker = (id: string) => {
    issue.selectWorker(id);
    issue.clearFeedback();
    setPickerOpen(false);
  };
  const openDetail = (item: OutsourceIssueWithDone) => {
    if (!wide) {
      setListScroll(typeof window === "undefined" ? 0 : window.scrollY);
      scrollPageTo(0);
    }
    setSel({ id: item.id, snap: item, verified: null });
  };
  const closeDetail = () => {
    setSel(null);
    if (!wide) requestAnimationFrame(() => scrollPageTo(listScroll));
  };

  const live = sel ? issue.issues.find((row) => row.id === sel.id) : undefined;
  const detailItem = sel ? sel.verified ?? live ?? sel.snap : null;
  const detailWorker = detailItem ? issue.workers.find((w) => w.id === detailItem.workerId) : undefined;

  const reviewSheet = asking ? (
    <ReviewSheet
      kind={asking.kind}
      item={asking.item}
      issue={issue}
      onClose={() => setAsking(null)}
      onVerified={(row) => setSel((s) => (s && s.id === row.id ? { ...s, verified: row } : s))}
    />
  ) : null;

  const rootStyle = wide
    ? {
        height: "100dvh",
        marginBottom: "calc(-24px - env(safe-area-inset-bottom))",
        display: "flex",
        flexDirection: "column" as const,
        overflow: "hidden",
      }
    : { minHeight: "100dvh" };

  // Phone / narrow tablet: the record is its own page.
  if (!wide && detailItem && tab === "tracking") {
    return (
      <div data-os="" style={{ background: X.bg, color: X.ink, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <style>{KEYFRAMES}</style>
        <IssueDetail item={detailItem} worker={detailWorker} access={review} wide={false} onBack={closeDetail}
          onAsk={(kind) => setAsking({ kind, item: detailItem })} />
        {reviewSheet}
      </div>
    );
  }

  const left: "menu" | "back" | null = phone ? (drawer ? "menu" : "back") : null;

  return (
    <div data-os="" style={{ background: X.bg, color: X.ink, ...rootStyle }}>
      <style>{KEYFRAMES}</style>
      <OsHeader
        title="Outsource Work"
        left={left}
        onLeft={left === "menu" ? drawer?.open : () => navigate(-1)}
        right={tab === "tracking" ? <RoundButton icon={RefreshCw} aria="Refresh" onTap={issue.refreshList} spin={issue.isListLoading} /> : null}
      />
      <div style={{ flex: "none", padding: "2px 16px 0" }}>
        <div role="tablist" aria-label="Outsource Work" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, height: 46, boxSizing: "border-box", padding: 4, borderRadius: 14, background: X.chip }}>
          {TABS.map((t) => {
            const on = tab === t.key;
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                style={{ height: "100%", borderRadius: 10, border: "none", background: on ? X.card : "transparent", color: on ? X.ink : X.sub, fontWeight: on ? 700 : 600, boxShadow: on ? "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)" : "none", fontFamily: "inherit", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
                <Icon size={15} strokeWidth={1.9} />{t.l}
              </button>
            );
          })}
        </div>
      </div>

      <div style={wide ? { flex: 1, minHeight: 0, display: "flex" } : undefined}>
        {tab === "issue" ? (
          <>
            {wide ? <WorkerAside issue={issue} onPick={pickWorker} /> : null}
            <IssueSection
              issue={issue}
              access={access}
              wide={wide}
              lastAction={lastAction}
              onAction={setLastAction}
              onOpenPicker={() => setPickerOpen(true)}
              onOpenScanner={() => {
                setLastAction("issue");
                setScannerOpen(true);
              }}
            />
          </>
        ) : (
          <>
            <section aria-label="Tracking" className={wide ? "os-scroll" : undefined}
              style={wide ? { flex: "none", width: "min(420px,44%)", overflowY: "auto", scrollbarWidth: "none", borderRight: `1px solid ${X.ln}` } : { paddingBottom: 8 }}>
              <TrackingList
                issue={issue}
                access={review}
                selectedId={sel?.id ?? ""}
                wide={wide}
                updated={loaded.label}
                onOpen={openDetail}
                onAsk={(kind, item) => setAsking({ kind, item })}
              />
            </section>
            {wide ? (
              detailItem ? (
                <IssueDetail key={detailItem.id} item={detailItem} worker={detailWorker} access={review} wide onBack={() => setSel(null)}
                  onAsk={(kind) => setAsking({ kind, item: detailItem })} />
              ) : <DetailPlaceholder />
            ) : null}
          </>
        )}
      </div>

      {pickerOpen ? <WorkerPickerSheet open onClose={() => setPickerOpen(false)} issue={issue} onPick={pickWorker} /> : null}
      {scannerOpen && issue.selectedWorker ? <ScannerOverlay issue={issue} onClose={() => setScannerOpen(false)} /> : null}
      {reviewSheet}
    </div>
  );
}
