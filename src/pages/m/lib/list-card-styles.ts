// Style constants shared by ListCardShell and the screens that fill its boxes.
// Kept out of the component file so that file only exports a component.
import type { CSSProperties } from "react";

/** Small caps label used inside the two bottom boxes of the shared list card. */
export const CARD_LABEL: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: 0.5, whiteSpace: "nowrap" };
