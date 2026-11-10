// Board Report — render a section, or say why its source could not be read.
import type { ReactNode } from "react";
import type { Section } from "@/lib/board-report";
import { Unavailable } from "./page-kit";

export function withSection<T>(s: Section<T>, render: (d: T) => ReactNode): ReactNode {
  return s.ok ? render(s.data) : <Unavailable error={s.error} />;
}
