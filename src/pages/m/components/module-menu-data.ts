// module-menu-data — the non-component helpers shared by ModuleMenu.tsx
// (/m/more) and NavDrawer.tsx (phone drawer). Kept out of the .tsx files so
// those export components only (react-refresh/only-export-components).
import { clearAuth } from "@/lib/auth";

// POST /api/auth/logout, then clear local state and bounce to /login — the same
// best-effort flow the desktop top bar uses (a network hiccup must not trap the
// user; the client token is wiped regardless so a reload won't auto-sign-in).
export async function handleSignOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore — best effort
  }
  clearAuth();
  window.location.href = "/login";
}

/** Initials from a display name (up to 2), falling back to email / "H". */
export function initialsOf(name: string, email: string): string {
  const src = (name || email || "H").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

/** Human-readable role (SUPER_ADMIN → "Super Admin"). */
export function prettyRole(role: string): string {
  if (!role) return "";
  return role
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
