import { useCallback, useEffect, useRef, useState } from "react";
import type { OutsourceIssue } from "@/api/lib/outsource-issue";
import { workerFetch } from "@/layouts/WorkerLayout";

export type OutsourceTasksState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; incomplete: OutsourceIssue[]; completedRecent: OutsourceIssue[] };

interface TasksEnvelope {
  error?: string;
  data?: { incomplete?: OutsourceIssue[]; completedRecent?: OutsourceIssue[] };
}

const TASKS_URL = "/api/worker/outsource-issues";

async function loadTasks(): Promise<OutsourceTasksState> {
  try {
    const response = await workerFetch(TASKS_URL);
    if (response.status === 403) return { kind: "forbidden" };
    const envelope = (await response.json().catch(() => null)) as TasksEnvelope | null;
    if (!response.ok || !envelope?.data) {
      return { kind: "error", message: envelope?.error ?? `Request failed (${response.status})` };
    }
    return {
      kind: "ready",
      incomplete: envelope.data.incomplete ?? [],
      completedRecent: envelope.data.completedRecent ?? [],
    };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Network error" };
  }
}

export function useOutsourceTasks(): { state: OutsourceTasksState; reload: () => void } {
  const [state, setState] = useState<OutsourceTasksState>({ kind: "loading" });
  const isMountedRef = useRef(true);

  const reload = useCallback((): void => {
    void loadTasks().then((next) => {
      if (isMountedRef.current) setState(next);
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    reload();
    return () => {
      isMountedRef.current = false;
    };
  }, [reload]);

  return { state, reload };
}
