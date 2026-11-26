// ---------------------------------------------------------------------------
// Small shared pieces of the Receivable views (Batch 3): dual-keyed reads of
// the server's rows, the list envelope, and the loading / error / detail
// frames drawn with the Finance kit. No figure is computed here.
// ---------------------------------------------------------------------------
import { type ReactNode } from "react";
import { CloudOff, FileSearch } from "lucide-react";
import { FinRows, FinSkel, FinState } from "../finance/fin-kit";
import { F } from "../finance/fin-format";
import { kvRows } from "./rcv-data";

/** Loading → skeletons; a failed read → the error card with Try again. */
export function LoadOr({ loading, failed, retry, what, children }: { loading: boolean; failed: boolean; retry: () => void; what: string; children: ReactNode }) {
  if (loading) return <FinSkel n={3} h={120} />;
  if (failed) return <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t={`Couldn't load ${what}`} s="The finance service didn't answer." btn={{ l: "Try again", onTap: retry }} />;
  return <>{children}</>;
}

/** A detail that is not in the list (deleted, or a stale link). */
export function NotFound({ what }: { what: string }) {
  return <FinState icon={FileSearch} bg={F.cream} c={F.gold} t={`${what} not found`} s="It may have been deleted or moved. Go back and pick it again." />;
}

export function KvRows({ pairs }: { pairs: [string, ReactNode][] }) {
  return <FinRows rows={kvRows(pairs)} />;
}

