// ===========================================================================
// DeliveryDetailScreen — L2 /m/delivery/:id on phone AND tablet (owner
// 2026-10-20: the Claude Design Delivery detail everywhere; the old generic
// DocumentDetailScreen path for Delivery is retired). DeliveryDetailPhone
// adapts to tablet widths and to the split view's right pane itself.
// ===========================================================================
import { DeliveryDetailPhone } from "./DeliveryDetailPhone";

export function DeliveryDetailScreen() {
  return <DeliveryDetailPhone />;
}
