import { useCallback, useState } from "react";
import { ChevronDown, LogOut, User, Building2, MonitorSmartphone, Sun, Moon, Laptop } from "lucide-react";
import { readThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "./global-search";
import { NotificationBell } from "./notification-bell";
import { WorkspaceTabs } from "./workspace-tabs";
import { clearAuth, getCurrentUser } from "@/lib/auth";
import { SignedInDevicesDialog } from "./signed-in-devices-dialog";

interface TopbarProps {
  user?: {
    name: string;
    email: string;
    role: string;
    organisationName: string;
    organisationCode: string;
  };
}

// POST /api/auth/logout, then clear local state and bounce to /login.
// We run the server call best-effort — even if it fails we still want to
// wipe the client token so a reload doesn't auto-sign-in.
async function handleSignOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore — network hiccup shouldn't trap the user in the app
  }
  clearAuth();
  window.location.href = "/login";
}

const organisations = [
  { code: "HOOKKA", name: "HOOKKA INDUSTRIES SDN BHD" },
  { code: "OHANA", name: "OHANA MARKETING" },
];

export function Topbar({ user }: TopbarProps) {
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const closeDevices = useCallback(() => setDevicesOpen(false), []);
  const [themePref, setThemePrefState] = useState<ThemePref>(() => readThemePref());
  const pickTheme = (p: ThemePref) => { setThemePref(p); setThemePrefState(p); };
  const currentOrg = user?.organisationCode || "HOOKKA";

  // Prefer the real signed-in user for the avatar label + dropdown.
  // If nobody is signed in yet (localStorage empty during boot), fall back
  // to "—" rather than inventing a name — never show a stale demo user
  // (P3.7: replaced hardcoded "Lim / Director" placeholder).
  const authUser = getCurrentUser();
  const displayName =
    authUser?.displayName || authUser?.email || user?.name || "—";
  const rawRole = authUser?.role || user?.role || "";
  const displayRole = rawRole
    ? rawRole
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "—";

  // z-[35], not z-30: page-level sticky bars (e.g. the dashboard tab strip)
  // are z-30 and come later in the DOM, so at an equal z they painted over
  // this header's user menu and hid its lower items. Still below the mobile
  // sidebar backdrop (z-40) and every modal (z-50+).
  return (
    <header className="sticky top-0 z-[35] flex h-16 items-center gap-4 border-b border-[#E2DDD8] bg-white px-6">
      {/* Workspace tab strip (open pages persist as browser-style tabs).
          Renders a plain flex spacer until a 2nd tab exists. */}
      <WorkspaceTabs />

      {/* Global Search (command palette) */}
      <GlobalSearch />

      {/* Organisation Switcher */}
      <div className="relative">
        <button
          onClick={() => { setOrgDropdownOpen(!orgDropdownOpen); setUserDropdownOpen(false); }}
          className="flex items-center gap-2 rounded-md border border-[#E2DDD8] px-3 py-1.5 text-sm hover:bg-[#F0ECE9] transition-colors"
        >
          <Building2 className="h-4 w-4 text-[#6B5C32]" />
          <span className="hidden sm:inline font-medium text-[#1F1D1B]">{currentOrg}</span>
          <ChevronDown className="h-3 w-3 text-[#9CA3AF]" />
        </button>
        {orgDropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 rounded-md border border-[#E2DDD8] bg-white shadow-lg py-1 z-50">
            {organisations.map((org) => (
              <button
                key={org.code}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-[#F0ECE9]",
                  currentOrg === org.code && "bg-[#F5F2ED] text-[#6B5C32] font-medium"
                )}
                onClick={() => setOrgDropdownOpen(false)}
              >
                <Building2 className="h-4 w-4" />
                <div className="text-left">
                  <div className="font-medium">{org.code}</div>
                  <div className="text-xs text-[#9CA3AF]">{org.name}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notifications — real feed + real unread count (see notification-bell.tsx) */}
      <NotificationBell />

      {/* User menu */}
      <div className="relative">
        <button
          onClick={() => { setUserDropdownOpen(!userDropdownOpen); setOrgDropdownOpen(false); }}
          className="flex items-center gap-2 rounded-md p-1.5 hover:bg-[#F0ECE9] transition-colors"
        >
          <div className="h-8 w-8 rounded-full bg-[#6B5C32] flex items-center justify-center text-white text-sm font-medium">
            {displayName.charAt(0).toUpperCase() || "U"}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium text-[#1F1D1B]">{displayName}</p>
            <p className="text-xs text-[#9CA3AF]">{displayRole}</p>
          </div>
          <ChevronDown className="h-3 w-3 text-[#9CA3AF] hidden sm:block" />
        </button>
        {userDropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-[#E2DDD8] bg-white shadow-lg py-1 z-50">
            <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#4B5563] hover:bg-[#F0ECE9]">
              <User className="h-4 w-4" />
              Profile
            </button>
            <button
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#4B5563] hover:bg-[#F0ECE9]"
              onClick={() => { setUserDropdownOpen(false); setDevicesOpen(true); }}
            >
              <MonitorSmartphone className="h-4 w-4" />
              Signed-in Devices
            </button>
            <hr className="my-1 border-[#E2DDD8]" />
            {/* Theme (src/lib/theme.ts). Default Light; System follows the OS. */}
            <div className="px-4 pt-1 pb-2" role="group" aria-label="Theme">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#9CA3AF] mb-1.5">Theme</p>
              <div className="grid grid-cols-3 gap-1">
                {([
                  ["light", "Light", Sun],
                  ["dark", "Dark", Moon],
                  ["system", "System", Laptop],
                ] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={themePref === value}
                    onClick={() => pickTheme(value)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px]",
                      themePref === value
                        ? "border-[#6B5C32] bg-[#F5F2ED] text-[#6B5C32] font-medium"
                        : "border-[#E2DDD8] text-[#4B5563] hover:bg-[#F0ECE9]",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <hr className="my-1 border-[#E2DDD8]" />
            <button
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={() => { handleSignOut(); }}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
      {devicesOpen && <SignedInDevicesDialog onClose={closeDevices} />}
    </header>
  );
}
