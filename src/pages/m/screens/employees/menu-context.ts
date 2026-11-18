// menu-context.ts — lets a section tell the shell's "..." menu which actions are ready right now (HK-0125 menu).
// A section calls `bridge.set(registry)` while it has something to offer and `bridge.set(null)` when it unmounts, so an item
// shows only when its destination is ready (permission held, data loaded). `useMenuOpen()` tells a section the sheet is open, so
// it can fetch extra data only then (Department Performance's printable per-worker rows).
import { createContext, useContext } from "react";
import type { MenuRegistry } from "./employees-menu";

export type MenuBridge = {
  set: (registry: MenuRegistry | null) => void;
};

export const MenuBridgeContext = createContext<MenuBridge | null>(null);
export const MenuOpenContext = createContext<boolean>(false);

export function useMenuBridge(): MenuBridge | null {
  return useContext(MenuBridgeContext);
}

export function useMenuOpen(): boolean {
  return useContext(MenuOpenContext);
}
