// Mount once per layout: outlines the element named by ?highlight=<label>
// (AI Connector "show me where it is" links). Renders nothing.
import { useHighlightParam } from "@/hooks/use-highlight-param";

export function HighlightFromUrl() {
  useHighlightParam();
  return null;
}
