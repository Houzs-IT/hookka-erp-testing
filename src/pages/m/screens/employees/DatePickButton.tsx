// DatePickButton — a visible button that opens the browser's date picker (HK-0125 Phase 2 fix).
//
// Why: the first build laid an invisible <input type="date"> over a label and relied on tapping it. Desktop Chromium
// (and the app's browser pane) only opens the picker from the input's own small calendar icon, so a tap on the label did
// nothing. Here a real <button> calls `input.showPicker()` (Chromium 99+, Safari 16+, Firefox 101+). Browsers without
// showPicker fall back to the old overlay, where a tap on the input itself opens the native picker (iOS / Android).
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

type Props = {
  /** Current value, YYYY-MM-DD, or "" for none. */
  value: string;
  min: string;
  max: string;
  /** Called with the picked YYYY-MM-DD ("" when cleared). */
  onPick: (value: string) => void;
  ariaLabel: string;
  style?: CSSProperties;
  children: ReactNode;
};

const hasShowPicker = () => typeof HTMLInputElement !== "undefined" && "showPicker" in HTMLInputElement.prototype;

export default function DatePickButton({ value, min, max, onPick, ariaLabel, style, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  // Decided once on mount: when showPicker is missing the input itself must receive the tap.
  const [overlay] = useState(() => !hasShowPicker());

  function open() {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // showPicker throws if the document is not focused or the input cannot show one; focus + click is the last resort.
      el.focus();
      el.click();
    }
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      <button
        type="button"
        onClick={open}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        style={{ border: "none", fontFamily: "inherit", padding: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent", ...style }}
      >
        {children}
      </button>
      <input
        ref={input}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onPick(e.target.value)}
        aria-hidden={overlay ? undefined : true}
        aria-label={overlay ? ariaLabel : undefined}
        tabIndex={overlay ? 0 : -1}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          border: "none",
          padding: 0,
          margin: 0,
          pointerEvents: overlay ? "auto" : "none",
        }}
      />
    </span>
  );
}
