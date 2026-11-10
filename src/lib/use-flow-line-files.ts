// ---------------------------------------------------------------------------
// use-flow-line-files.ts — every line's files for one flow document, in one
// request (GET /api/files/flow-lines; review pass 2 C1-5). Feeds the
// LineFilesButton paperclips in src/components/flow-files.tsx. Read-only.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import type { FlowDoc, LineFiles } from "@/lib/flow-files";

export type FlowLineFilesState = {
  data: Record<string, LineFiles>;
  loaded: boolean;
  reload: () => Promise<void>;
};

/** Every line's files for one document, in one request (GET /api/files/flow-lines). */
export function useFlowLineFiles(doc: FlowDoc, docId: string | null | undefined): FlowLineFilesState {
  const [data, setData] = useState<Record<string, LineFiles>>({});
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await fetch(`/api/files/flow-lines?doc=${encodeURIComponent(doc)}&id=${encodeURIComponent(docId)}`);
      const j = (await res.json().catch(() => null)) as { data?: Record<string, LineFiles> } | null;
      if (res.ok && j?.data) setData(j.data);
    } catch {
      /* the paperclips just show no count */
    } finally {
      setLoaded(true);
    }
  }, [doc, docId]);
  useEffect(() => {
    if (!docId) return;
    // Deferred one tick (no state flip in the effect body); re-armed per document.
    // eslint-disable-next-line no-restricted-syntax
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [docId, reload]);
  return { data, loaded, reload };
}

