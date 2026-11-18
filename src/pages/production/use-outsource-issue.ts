import { useCallback, useMemo, useRef, useState } from "react";
import type {
  IssueStatus,
  OutsourceIssue,
  OutsourceIssueWithSewing,
  OutsourceWorkerSummary,
} from "@/api/lib/outsource-issue";
import {
  invalidateCache,
  invalidateCachePrefix,
  useCachedJson,
} from "@/lib/cached-fetch";
import { describeIssue } from "@/lib/outsource-issue-format";
import { useDebounced } from "@/pages/m/lib/use-debounced";

export type { OutsourceIssue, OutsourceIssueWithSewing, OutsourceWorkerSummary };

export type StatusFilter = IssueStatus | "ALL";
export type FeedbackTone = "success" | "warning" | "danger";

export interface IssueFeedback {
  tone: FeedbackTone;
  message: string;
}

export interface TrackingFilters {
  status: StatusFilter;
  workerId: string;
  from: string;
  to: string;
  query: string;
}

interface ApiEnvelope<T> {
  success?: boolean;
  code?: string;
  error?: string;
  data?: T;
}

const ISSUES_URL = "/api/outsource-issues";
const WORKERS_URL = `${ISSUES_URL}/workers`;
const ENFORCE_URL = "/api/kv-config/outsource_issue.enforce";
const SAME_CODE_COOLDOWN_MS = 1500;
const WARNING_CODES = new Set(["ALREADY_ISSUED", "ALREADY_SEWN"]);

export const LIST_CAP = 500;

export const DEFAULT_FILTERS: TrackingFilters = {
  status: "INCOMPLETE",
  workerId: "",
  from: "",
  to: "",
  query: "",
};

const NETWORK_MESSAGE = "Network problem. Check the connection and try again.";

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  return (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
}

function failureMessage<T>(envelope: ApiEnvelope<T> | null, status: number): string {
  return envelope?.error || `The request failed (status ${status}). Try again.`;
}

export interface UseOutsourceIssueResult {
  workers: OutsourceWorkerSummary[];
  isWorkersLoading: boolean;
  workersError: string | null;
  selectedWorkerId: string;
  selectedWorker: OutsourceWorkerSummary | null;
  selectWorker: (workerId: string) => void;
  isIssuing: boolean;
  issueByScan: (qr: string) => Promise<void>;
  feedback: IssueFeedback | null;
  clearFeedback: () => void;
  sessionIssues: OutsourceIssue[];
  undoIssue: (issue: OutsourceIssue) => Promise<void>;
  undoingId: string;
  filters: TrackingFilters;
  setFilters: (patch: Partial<TrackingFilters>) => void;
  issues: OutsourceIssueWithSewing[];
  isListLoading: boolean;
  listError: string | null;
  isListTruncated: boolean;
  refreshList: () => void;
}

export function useOutsourceIssue(): UseOutsourceIssueResult {
  const workersResult = useCachedJson<ApiEnvelope<OutsourceWorkerSummary[]>>(WORKERS_URL, 30);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [filters, setFiltersState] = useState<TrackingFilters>(DEFAULT_FILTERS);
  const [feedback, setFeedback] = useState<IssueFeedback | null>(null);
  const [sessionIssues, setSessionIssues] = useState<OutsourceIssue[]>([]);
  const [isIssuing, setIsIssuing] = useState(false);
  const [undoingId, setUndoingId] = useState("");
  const lastScanRef = useRef({ value: "", at: 0 });
  const isBusyRef = useRef(false);

  const workers = useMemo(() => workersResult.data?.data ?? [], [workersResult.data]);
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId) ?? null;

  const debouncedQuery = useDebounced(filters.query.trim(), 300);
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status !== "ALL") params.set("status", filters.status);
    if (filters.workerId) params.set("workerId", filters.workerId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (debouncedQuery) params.set("q", debouncedQuery);
    const query = params.toString();
    return query ? `${ISSUES_URL}?${query}` : ISSUES_URL;
  }, [filters.status, filters.workerId, filters.from, filters.to, debouncedQuery]);
  const listResult = useCachedJson<ApiEnvelope<OutsourceIssueWithSewing[]>>(listUrl, 15);
  const issues = useMemo(() => listResult.data?.data ?? [], [listResult.data]);

  const setFilters = useCallback((patch: Partial<TrackingFilters>): void => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

  const issueByScan = useCallback(
    async (rawText: string): Promise<void> => {
      const qr = rawText.trim();
      if (!qr) return;
      if (!selectedWorker) {
        setFeedback({ tone: "danger", message: "Pick a worker before scanning." });
        return;
      }
      const now = performance.now();
      const last = lastScanRef.current;
      if (qr === last.value && now - last.at < SAME_CODE_COOLDOWN_MS) {
        last.at = now;
        return;
      }
      lastScanRef.current = { value: qr, at: now };
      if (isBusyRef.current) return;
      isBusyRef.current = true;
      setIsIssuing(true);
      try {
        const response = await fetch(ISSUES_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workerId: selectedWorker.id, qr }),
        });
        const envelope = await readEnvelope<OutsourceIssue>(response);
        if (response.status === 201 && envelope?.data) {
          const issued = envelope.data;
          setSessionIssues((current) => [issued, ...current.filter((item) => item.id !== issued.id)]);
          setFeedback({
            tone: "success",
            message: `Issued to ${issued.workerName}: ${describeIssue(issued)}`,
          });
          invalidateCachePrefix(ISSUES_URL);
          return;
        }
        setFeedback({
          tone: envelope?.code && WARNING_CODES.has(envelope.code) ? "warning" : "danger",
          message: failureMessage(envelope, response.status),
        });
      } catch {
        lastScanRef.current = { value: "", at: 0 };
        setFeedback({ tone: "danger", message: NETWORK_MESSAGE });
      } finally {
        isBusyRef.current = false;
        setIsIssuing(false);
      }
    },
    [selectedWorker],
  );

  const undoIssue = useCallback(async (issue: OutsourceIssue): Promise<void> => {
    setUndoingId(issue.id);
    try {
      const response = await fetch(`${ISSUES_URL}/${encodeURIComponent(issue.id)}`, {
        method: "DELETE",
      });
      const envelope = await readEnvelope<OutsourceIssue>(response);
      if (response.ok || response.status === 404) {
        setSessionIssues((current) => current.filter((item) => item.id !== issue.id));
        setFeedback({ tone: "success", message: `Undone: ${describeIssue(issue)}` });
        lastScanRef.current = { value: "", at: 0 };
        invalidateCachePrefix(ISSUES_URL);
        return;
      }
      setFeedback({ tone: "danger", message: failureMessage(envelope, response.status) });
    } catch {
      setFeedback({ tone: "danger", message: NETWORK_MESSAGE });
    } finally {
      setUndoingId("");
    }
  }, []);

  return {
    workers,
    isWorkersLoading: workersResult.loading,
    workersError: workersResult.error,
    selectedWorkerId,
    selectedWorker,
    selectWorker: setSelectedWorkerId,
    isIssuing,
    issueByScan,
    feedback,
    clearFeedback: () => setFeedback(null),
    sessionIssues,
    undoIssue,
    undoingId,
    filters,
    setFilters,
    issues,
    isListLoading: listResult.loading,
    listError: listResult.error,
    isListTruncated: issues.length >= LIST_CAP,
    refreshList: listResult.refresh,
  };
}

export interface UseEnforceSwitchResult {
  isEnforced: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  setEnforced: (next: boolean) => Promise<void>;
}

export function useEnforceSwitch(): UseEnforceSwitchResult {
  const result = useCachedJson<ApiEnvelope<boolean | null>>(ENFORCE_URL, 10);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setEnforced = useCallback(async (next: boolean): Promise<void> => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(ENFORCE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        const envelope = await readEnvelope<unknown>(response);
        setSaveError(failureMessage(envelope, response.status));
        return;
      }
      invalidateCache(ENFORCE_URL);
    } catch {
      setSaveError(NETWORK_MESSAGE);
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    isEnforced: result.data?.data === true,
    isLoading: result.loading,
    isSaving,
    error: saveError ?? result.error,
    setEnforced,
  };
}
