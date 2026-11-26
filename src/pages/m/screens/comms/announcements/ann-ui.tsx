// Announcements v3 — category / status tones, data hooks shared by the list,
// the detail and the composer.
import { useMemo } from "react";
import { ClipboardList, FileText, GraduationCap, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { C } from "../comms-kit";
import { readAnnList, type Ann, type AnnCategory, type AnnStatus } from "./ann-lib";

export const ANN_LIST_URL = "/api/announcements";

export const CAT_UI: Record<AnnCategory, { icon: LucideIcon; fg: string; bg: string; dot: string }> = {
  GENERAL: { icon: FileText, fg: C.gold, bg: C.cream, dot: C.gold },
  WARNING: { icon: TriangleAlert, fg: C.red, bg: C.redBg, dot: C.red },
  SOP: { icon: ClipboardList, fg: C.teal, bg: C.tealBg, dot: C.teal },
  LEARNING: { icon: GraduationCap, fg: C.green, bg: C.greenBg, dot: C.green },
};

export const STATUS_UI: Record<AnnStatus, { fg: string; bg: string }> = {
  live: { fg: C.green, bg: C.greenBg },
  expired: { fg: C.grey, bg: C.greyBg },
  hidden: { fg: C.amber, bg: C.amberBg },
};

/** The office list (GET /api/announcements, newest first). */
export function useAnnList() {
  const r = useCachedJson<unknown>(ANN_LIST_URL, 60);
  const list = useMemo<Ann[] | null>(() => (r.data ? readAnnList(r.data) : null), [r.data]);
  return { list, loading: r.loading, error: r.error, refresh: r.refresh };
}

export type Dept = { code: string; name: string };
export type Worker = { id: string; name: string; empNo: string; dept: string; active: boolean };

/** Departments + workers (the same lists the desktop composer reads). Either may be refused (403) — callers cope. */
export function usePeople() {
  const d = useCachedJson<{ data?: { code?: string; name?: string }[] }>("/api/departments", 600);
  const w = useCachedJson<{ data?: Record<string, unknown>[] }>("/api/workers", 300);
  const depts = useMemo<Dept[]>(
    () => (Array.isArray(d.data?.data) ? d.data!.data!.map((x) => ({ code: String(x.code ?? ""), name: String(x.name ?? x.code ?? "") })).filter((x) => x.code) : []),
    [d.data],
  );
  const workers = useMemo<Worker[] | null>(() => {
    if (!Array.isArray(w.data?.data)) return null;
    return w.data!.data!.map((x) => ({
      id: String(x.id ?? ""),
      name: String(x.name ?? ""),
      empNo: String(x.empNo ?? x.emp_no ?? ""),
      dept: String(x.departmentCode ?? x.department_code ?? ""),
      active: String(x.status ?? "ACTIVE") === "ACTIVE",
    }));
  }, [w.data]);
  const deptName = useMemo(() => {
    const m = new Map(depts.map((x) => [x.code, x.name]));
    return (code: string) => m.get(code) ?? code;
  }, [depts]);
  const workerById = useMemo(() => new Map((workers ?? []).map((x) => [x.id, x])), [workers]);
  return { depts, workers, workersLoading: w.loading, workersError: !w.data && !!w.error, deptName, workerById };
}

/** Separate create / update / delete, as the API gates them. */
export function useAnnPerms() {
  const { hasPermission, loading } = usePermissions();
  return {
    loading,
    canCreate: hasPermission("announcements", "create"),
    canUpdate: hasPermission("announcements", "update"),
    canDelete: hasPermission("announcements", "delete"),
  };
}

/** /api/files/:id/download — the stored file, as desktop links it. */
export const fileUrl = (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/download`;
