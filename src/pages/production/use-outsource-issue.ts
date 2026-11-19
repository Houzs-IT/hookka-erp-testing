import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  IssueStatus,
  IssueStatusCounts,
  OutsourceIssue,
  OutsourceIssueWithDone,
  OutsourceWorkerSummary,
} from "@/api/lib/outsource-issue";
import {
  invalidateCache,
  invalidateCachePrefix,
  useCachedJson,
} from "@/lib/cached-fetch";
import { describeIssue } from "@/lib/outsource-issue-format";
import { useDebounced } from "@/pages/m/lib/use-debounced";

export type { IssueStatusCounts, OutsourceIssue, OutsourceIssueWithDone, OutsourceWorkerSummary };

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
  counts?: IssueStatusCounts;
}

const ISSUES_URL = "/api/outsource-issues";
const WORKERS_URL = `${ISSUES_URL}/workers`;
const ENFORCE_URL = "/api/kv-config/outsource_issue.enforce";
const SAME_CODE_COOLDOWN_MS = 1500;
const WARNING_CODES = new Set(["ALREADY_ISSUED", "ALREADY_DONE"]);

export const LIST_CAP = 500;

const COMPLETION_URL_PREFIX = "/api/production-orders/";

export const DEFAULT_FILTERS: TrackingFilters = {
  status: "PENDING_APPROVAL",
  workerId: "",
  from: "",
  to: "",
  query: "",
};

interface ListResult {
  key: string;
  issues: OutsourceIssueWithDone[];
  isTruncated: boolean;
  counts: IssueStatusCounts | null;
  error: string | null;
}

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
  approveIssue: (issue: OutsourceIssue) => Promise<void>;
  sendBackIssue: (issue: OutsourceIssue) => Promise<void>;
  reviewingId: string;
  filters: TrackingFilters;
  setFilters: (patch: Partial<TrackingFilters>) => void;
  issues: OutsourceIssueWithDone[];
  isListLoading: boolean;
  listError: string | null;
  isListTruncated: boolean;
  statusCounts: IssueStatusCounts | null;
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
  const [reviewingId, setReviewingId] = useState("");
  const lastScanRef = useRef({ value: "", at: 0 });
  const isBusyRef = useRef(false);
  const pendingScanRef = useRef<string | null>(null);
  const [listReloadTick, setListReloadTick] = useState(0);
  const [listResult, setListResult] = useState<ListResult | null>(null);

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
  const listKey = `${listReloadTick}|${listUrl}`;

  useEffect(() => {
    let isCancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(listUrl);
        const envelope = await readEnvelope<OutsourceIssueWithDone[]>(response);
        if (isCancelled) return;
        if (!response.ok || !envelope?.data) {
          setListResult({ key: listKey, issues: [], isTruncated: false, counts: null, error: failureMessage(envelope, response.status) });
          return;
        }
        setListResult({
          key: listKey,
          issues: envelope.data,
          isTruncated: response.headers.has("X-List-Truncated"),
          counts: envelope.counts ?? null,
          error: null,
        });
      } catch {
        if (!isCancelled) {
          setListResult({ key: listKey, issues: [], isTruncated: false, counts: null, error: NETWORK_MESSAGE });
        }
      }
    };
    void load();
    return () => {
      isCancelled = true;
    };
  }, [listUrl, listKey]);

  const refreshList = useCallback((): void => {
    setListReloadTick((current) => current + 1);
  }, []);

  const currentList = listResult?.key === listKey ? listResult : null;
  const issues = useMemo(
    () => (currentList ?? listResult)?.issues ?? [],
    [currentList, listResult],
  );

  const setFilters = useCallback((patch: Partial<TrackingFilters>): void => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

  const submitIssue = useCallback(async (workerId: string, qr: string): Promise<void> => {
    try {
      const response = await fetch(ISSUES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId, qr }),
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
        setListReloadTick((current) => current + 1);
        return;
      }
      setFeedback({
        tone: envelope?.code && WARNING_CODES.has(envelope.code) ? "warning" : "danger",
        message: failureMessage(envelope, response.status),
      });
    } catch {
      lastScanRef.current = { value: "", at: 0 };
      setFeedback({ tone: "danger", message: NETWORK_MESSAGE });
    }
  }, []);

  const issueByScan = useCallback(
    async (rawText: string): Promise<void> => {
      const firstCode = rawText.trim();
      if (!firstCode) return;
      if (!selectedWorker) {
        setFeedback({ tone: "danger", message: "Pick a worker before scanning." });
        return;
      }
      if (isBusyRef.current) {
        pendingScanRef.current = firstCode;
        return;
      }
      isBusyRef.current = true;
      setIsIssuing(true);
      let nextCode: string | null = firstCode;
      try {
        while (nextCode) {
          const qr: string = nextCode;
          nextCode = null;
          const now = performance.now();
          const last = lastScanRef.current;
          if (qr === last.value && now - last.at < SAME_CODE_COOLDOWN_MS) {
            last.at = now;
          } else {
            lastScanRef.current = { value: qr, at: now };
            await submitIssue(selectedWorker.id, qr);
          }
          nextCode = pendingScanRef.current;
          pendingScanRef.current = null;
        }
      } finally {
        isBusyRef.current = false;
        setIsIssuing(false);
      }
    },
    [selectedWorker, submitIssue],
  );

  const selectWorker = useCallback((workerId: string): void => {
    pendingScanRef.current = null;
    setSelectedWorkerId(workerId);
  }, []);

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
        setListReloadTick((current) => current + 1);
        return;
      }
      setFeedback({ tone: "danger", message: failureMessage(envelope, response.status) });
    } catch {
      setFeedback({ tone: "danger", message: NETWORK_MESSAGE });
    } finally {
      setUndoingId("");
    }
  }, []);

  const runReview = useCallback(
    async (issue: OutsourceIssue, request: () => Promise<Response>, successMessage: string): Promise<void> => {
      setReviewingId(issue.id);
      try {
        const response = await request();
        const envelope = await readEnvelope<unknown>(response);
        if (response.ok && envelope?.success !== false) {
          setFeedback({ tone: "success", message: successMessage });
          invalidateCachePrefix(ISSUES_URL);
          setListReloadTick((current) => current + 1);
          return;
        }
        setFeedback({ tone: "danger", message: failureMessage(envelope, response.status) });
      } catch {
        setFeedback({ tone: "danger", message: NETWORK_MESSAGE });
      } finally {
        setReviewingId("");
      }
    },
    [],
  );

  const approveIssue = useCallback(
    async (issue: OutsourceIssue): Promise<void> => {
      const scan = issue.submittedScan;
      if (!scan || !scan.url.startsWith(COMPLETION_URL_PREFIX)) {
        setFeedback({
          tone: "danger",
          message: "This item has no finished scan to approve. Send it back and ask the worker to scan it again.",
        });
        return;
      }
      await runReview(
        issue,
        () =>
          fetch(scan.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scan.body),
          }),
        `Received from ${issue.workerName}: ${describeIssue(issue)}. ${issue.departmentName} is completed.`,
      );
    },
    [runReview],
  );

  const sendBackIssue = useCallback(
    async (issue: OutsourceIssue): Promise<void> => {
      await runReview(
        issue,
        () => fetch(`${ISSUES_URL}/${encodeURIComponent(issue.id)}/send-back`, { method: "POST" }),
        `Sent back to ${issue.workerName}: ${describeIssue(issue)}`,
      );
    },
    [runReview],
  );

  return {
    workers,
    isWorkersLoading: workersResult.loading,
    workersError: workersResult.error,
    selectedWorkerId,
    selectedWorker,
    selectWorker,
    isIssuing,
    issueByScan,
    feedback,
    clearFeedback: () => setFeedback(null),
    sessionIssues,
    undoIssue,
    undoingId,
    approveIssue,
    sendBackIssue,
    reviewingId,
    filters,
    setFilters,
    issues,
    isListLoading: currentList === null,
    listError: currentList?.error ?? null,
    isListTruncated: currentList?.isTruncated ?? false,
    statusCounts: (currentList ?? listResult)?.counts ?? null,
    refreshList,
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
