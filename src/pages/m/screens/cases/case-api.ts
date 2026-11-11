// Partial PUT /api/service-cases/:id (the server keeps any field that is omitted) + cache refresh.
import { mutateJson, refreshList, refreshOne } from "../../config/mutate";

export async function putCase(caseId: string, patch: Record<string, unknown>) {
  const r = await mutateJson(`/api/service-cases/${encodeURIComponent(caseId)}`, "PUT", patch);
  if (r.ok) {
    refreshOne(`/api/service-cases/${encodeURIComponent(caseId)}`);
    refreshList("/api/service-cases");
  }
  return r;
}
