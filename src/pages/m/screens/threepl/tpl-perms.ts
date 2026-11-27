// 3PL Providers — one place that maps each action to the API's own gate
// (src/api/routes/drivers.ts, three-pl-*.ts, files.ts). The API still decides;
// these only hide actions a role would be refused.
import { usePermissions } from "@/lib/use-permission";

export type TplPerms = {
  loading: boolean;
  provCreate: boolean; // POST /api/drivers
  provUpdate: boolean; // PUT /api/drivers/:id (also deactivate / reactivate)
  provDelete: boolean; // DELETE /api/drivers/:id
  rates: boolean; // PUT /api/three-pl-state-rates/bulk = drivers:update
  drvCreate: boolean; // POST /api/three-pl-drivers = drivers:create
  drvUpdate: boolean; // PUT /api/three-pl-drivers/:id = drivers:update
  vehCreate: boolean; // POST /api/three-pl-vehicles = lorries:create
  vehUpdate: boolean; // PUT /api/three-pl-vehicles/:id = lorries:update
  fileCreate: boolean; // POST /api/files (THREE_PL_PROVIDER is not a flow type) = files:create
  fileDelete: boolean; // DELETE /api/files/:id = files:delete
};

export function useTplPerms(): TplPerms {
  const { hasPermission: can, loading } = usePermissions();
  return {
    loading,
    provCreate: can("drivers", "create"),
    provUpdate: can("drivers", "update"),
    provDelete: can("drivers", "delete"),
    rates: can("drivers", "update"),
    drvCreate: can("drivers", "create"),
    drvUpdate: can("drivers", "update"),
    vehCreate: can("lorries", "create"),
    vehUpdate: can("lorries", "update"),
    fileCreate: can("files", "create"),
    fileDelete: can("files", "delete"),
  };
}
