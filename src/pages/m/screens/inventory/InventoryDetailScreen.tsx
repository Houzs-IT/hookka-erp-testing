// ===========================================================================
// InventoryDetailScreen — /m/inventory/:id, the L2 detail (full screen on a
// phone, the right pane of the tablet split). The id says which kind:
//   fg.<productId>  → FgDetail  (stock breakdown)
//   wip.<id>        → WipDetail
//   anything else   → RmDetail  (raw materials keep their own id, so old links open)
// Without the /inventory gate the page shows the restricted state instead.
// ===========================================================================
import { useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { parseDetailId } from "../../lib/inventory-lib";
import { StateCard } from "../threepl/tpl-kit";
import { FgDetail } from "./FgDetail";
import { useInvPerms } from "./inv-data";
import { DetailFrame } from "./inv-detail";
import { Skeletons } from "./inv-kit";
import { RmDetail } from "./RmDetail";
import { WipDetail } from "./WipDetail";

const HEAD = { fg: "Stock breakdown", wip: "Work in progress", rm: "Raw material" } as const;

export function InventoryDetailScreen() {
  const { id = "" } = useParams();
  const ref = parseDetailId(id);
  const perms = useInvPerms();
  if (perms.loading) {
    return (
      <DetailFrame head={HEAD[ref.kind]}>
        <Skeletons n={3} h={96} pad="0" />
      </DetailFrame>
    );
  }
  if (!perms.module) {
    return (
      <DetailFrame head={HEAD[ref.kind]}>
        <StateCard icon={Lock} title="You can't see inventory" sub="Your role doesn't include inventory access. Ask an admin." />
      </DetailFrame>
    );
  }
  if (ref.kind === "fg") return <FgDetail key={id} id={ref.id} />;
  if (ref.kind === "wip") return <WipDetail key={id} id={ref.id} />;
  return <RmDetail key={id} id={ref.id} />;
}
