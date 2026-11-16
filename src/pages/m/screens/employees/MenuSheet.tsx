// MenuSheet — the "..." bottom sheet from Employees 3.dc.html (`actList`): a titled sheet holding one white rounded card of
// rows; each row = a 32px icon tile + a 13.5px semibold label, 52px tall, dividers between, no chevron. HK-0125 menu step 1.
import { FileText, Printer } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import type { MenuAction, MenuIcon, MenuItem } from "./employees-menu";

const ICONS = { FileText, Printer } as const satisfies Record<MenuIcon, unknown>;

export default function MenuSheet({
  open,
  title,
  items,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  items: MenuItem[];
  onClose: () => void;
  onPick: (a: MenuAction) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div style={{ background: M.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)", overflow: "hidden" }}>
        {items.map((it, i) => {
          const Icon = ICONS[it.icon];
          return (
            <button
              key={it.action}
              type="button"
              onClick={() => onPick(it.action)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 14px", border: "none", borderTop: i ? "1px solid #F0ECE9" : "none", background: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
            >
              <span style={{ width: 32, height: 32, flex: "none", borderRadius: 9, background: "#F4EFE6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={15} strokeWidth={1.9} color="#6B5C32" />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: M.raisin }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
