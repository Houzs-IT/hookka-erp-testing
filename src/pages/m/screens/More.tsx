// More — the profile + grouped module menu at /m/more.
//
// Reskinned (Wave 4) 1:1 to the design source (Hookka ERP Mobile.dc.html — the
// `isMore` view). Since the 2026-10-12 phone nav shell the bottom bar has no
// More tab: phones reach the same content from the left NavDrawer, and this
// route stays for deep links and the tablet rail. The building blocks live in
// components/ModuleMenu.tsx so the two surfaces cannot drift apart.
import { useLocation, useNavigate } from "react-router-dom";
import {
  MobileHeader,
  InstallAppCard,
  ProfileCard,
  ThemeToggleCard,
  ModuleGroupList,
  DesktopAppLink,
} from "../components";
import { visibleModuleGroups } from "../nav";
import { useItUnread, withItBadge } from "../lib/it-unread";
import { usePermissions } from "@/lib/use-permission";

export default function MobileMore() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isNavAllowed } = usePermissions();
  const itUnread = useItUnread();

  return (
    <>
      <MobileHeader title="More" menu />
      <div style={{ padding: "12px 18px 0", display: "grid", gap: 0 }}>
        <ProfileCard />
        <ThemeToggleCard />
        <InstallAppCard />
        <ModuleGroupList
          groups={withItBadge(visibleModuleGroups(isNavAllowed), itUnread)}
          onSelect={(path) => navigate(path)}
          currentPath={pathname}
        />
        <DesktopAppLink />
      </div>
    </>
  );
}
