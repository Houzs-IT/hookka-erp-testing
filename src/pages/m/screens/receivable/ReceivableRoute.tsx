// ---------------------------------------------------------------------------
// /m/receivables — the phone's Receivable app (Batch 3 prototype "Receivable
// (standalone)"): a hub of six read-only views, each gated like the desktop
// page it mirrors (no permission = no row; a deep link says "No access"):
//   debt   Debtor Aging          /accounting?tab=ar          (the shared AgingScreen)
//   rlist  Debtor List           /accounting?tab=debtors
//   rinv   AR Invoices           /accounting?tab=arinvoices
//   rstmt  Customer Statement    /accounting?tab=arinvoices  (the statement sits under AR Invoices on desktop)
//   rcpt   Receipts              /accounting?tab=receipts
//   rnote  Credit & Debit Notes  /invoices/credit-notes or /invoices/debit-notes
// Nothing here writes: receipts, notes and other-debtor records are created
// and changed on the desktop (Batch 3 scope). A sales invoice and a trade
// customer open the existing Invoice / Customer detail screens.
// ---------------------------------------------------------------------------
import { type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { RCV_ROWS, allowedRcvRows, type RcvView } from "./rcv-rows";
import { FinChips, FinLabel, FinMenu, FinScreen, FinState } from "../finance/fin-kit";
import { F } from "../finance/fin-format";
import { SwipeBack } from "../finance/finance-shell";
import { AgingScreen } from "../finance/AgingScreen";
import { DebtorListView, OtherDebtorDetail } from "./DebtorListView";
import { ArInvoicesView, OdBillDetail } from "./ArInvoicesView";
import { StatementView } from "./StatementView";
import { ReceiptDetail, ReceiptsView } from "./ReceiptsView";
import { NoteDetail, NotesView } from "./NotesView";


const BASE = "/m/receivables";

/** The chip rail at the top of every view: hop between the allowed views. */
export function RcvNav({ cur, rows }: { cur: RcvView; rows: { k: RcvView; l: string }[] }) {
  const navigate = useNavigate();
  return <FinChips opts={rows.map((r) => ({ k: r.k, l: r.l }))} cur={cur} set={(k) => navigate(`${BASE}/${k}`, { replace: true })} />;
}

function NoAccess({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <FinScreen title={title} onBack={onBack}>
      <FinState icon={Lock} bg={F.track} c={F.muted} t="No access" s="You don't have permission for this page." />
    </FinScreen>
  );
}

export default function ReceivableRoute() {
  const { view, id } = useParams();
  const navigate = useNavigate();
  const { isNavAllowed } = usePermissions();
  const rows = allowedRcvRows(isNavAllowed);
  const toHub = () => navigate(BASE);

  if (view) {
    const row = rows.find((r) => r.k === view);
    const known = RCV_ROWS.find((r) => r.k === view);
    if (!row) return <NoAccess title={known?.l ?? "Receivable"} onBack={toHub} />;
    const toView = () => navigate(`${BASE}/${row.k}`);
    const nav = <RcvNav cur={row.k} rows={rows} />;
    let body: ReactNode;
    if (id) {
      const d = decodeURIComponent(id);
      body = row.k === "rlist" ? <OtherDebtorDetail id={d} onBack={toView} />
        : row.k === "rinv" ? <OdBillDetail billNo={d} onBack={toView} />
        : row.k === "rcpt" ? <ReceiptDetail ref_={d} onBack={toView} />
        : row.k === "rnote" ? <NoteDetail ref_={d} onBack={toView} />
        : <NoAccess title={row.l} onBack={toView} />;
      return <SwipeBack onBack={toView}>{body}</SwipeBack>;
    }
    body = row.k === "debt" ? <AgingScreen side="debtor" onBack={toHub} nav={nav} />
      : row.k === "rlist" ? <DebtorListView nav={nav} onBack={toHub} />
      : row.k === "rinv" ? <ArInvoicesView nav={nav} onBack={toHub} />
      : row.k === "rstmt" ? <StatementView nav={nav} onBack={toHub} />
      : row.k === "rcpt" ? <ReceiptsView nav={nav} onBack={toHub} />
      : <NotesView nav={nav} onBack={toHub} />;
    return <SwipeBack onBack={toHub}>{body}</SwipeBack>;
  }

  return (
    <FinScreen title="Receivable" menu onBack={() => navigate("/m/more")}>
      {rows.length === 0 ? (
        <FinState icon={Lock} bg={F.track} c={F.muted} t="No access" s="You don't have permission for Receivable." />
      ) : (
        <>
          <FinLabel l="RECEIVABLE" />
          <FinMenu items={rows.map((r) => ({ key: r.k, l: r.l, s: r.s, icon: r.icon, c: r.c, bg: r.bg, onTap: () => navigate(`${BASE}/${r.k}`) }))} />
        </>
      )}
    </FinScreen>
  );
}
