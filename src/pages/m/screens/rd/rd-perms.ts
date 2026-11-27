// R&D Projects — one place that maps each action to the API's own gate
// (src/api/routes/rd-projects.ts, rd-team-members.ts, audit-events.ts, files.ts).
// The API still decides; these only hide actions a role would be refused.
// Reads stay open (owner decision R-1): no screen-level gate here.
import { usePermissions } from "@/lib/use-permission";

export type RdPerms = {
  loading: boolean;
  create: boolean; // POST /api/rd-projects = rd-projects:create
  update: boolean; // lifecycle POSTs, advance / milestone / photo / prototype PUT = rd-projects:update
  logHours: boolean; // POST /:id/labour-hours = rd-projects:create (NOT update)
  read: boolean; // team members + history = rd-projects:read
  fileUpload: boolean; // POST /api/files (RD_PROJECT is not a flow type) = files:create
};

export function useRdPerms(): RdPerms {
  const { hasPermission: can, loading } = usePermissions();
  // Every action is hidden while the permission set is still loading.
  const ok = (r: string, a: string) => !loading && can(r, a);
  return {
    loading,
    create: ok("rd-projects", "create"),
    update: ok("rd-projects", "update"),
    logHours: ok("rd-projects", "create"),
    read: ok("rd-projects", "read"),
    fileUpload: ok("files", "create"),
  };
}
