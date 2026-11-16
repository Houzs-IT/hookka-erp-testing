// menu-context.ts — lets a section tell the shell's "..." menu what it can print right now (HK-0125 menu step 1).
// Working Hours registers its Print action while it has entries to print and clears it when it unmounts, so the menu
// shows "Print" only when its destination is ready.
import { createContext, useContext } from "react";

export type MenuBridge = {
  setPrint: (fn: (() => void) | null) => void;
};

export const MenuBridgeContext = createContext<MenuBridge | null>(null);

export function useMenuBridge(): MenuBridge | null {
  return useContext(MenuBridgeContext);
}
