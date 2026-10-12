// Phone nav-drawer state, shared between MobileLayout (which owns and renders
// the NavDrawer) and the hamburger MenuButton in any header.
//
// The provider is mounted only while the shell is in phone mode, so outside
// it (tablet rail, tests, a screen rendered on its own) useNavDrawer() returns
// null and the MenuButton renders nothing.
import { createContext, useContext } from "react";

export type NavDrawerControls = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const NavDrawerContext = createContext<NavDrawerControls | null>(null);

export const NavDrawerProvider = NavDrawerContext.Provider;

export function useNavDrawer(): NavDrawerControls | null {
  return useContext(NavDrawerContext);
}

/** id of the drawer dialog, for the hamburger's aria-controls. */
export const NAV_DRAWER_ID = "m-nav-drawer";
