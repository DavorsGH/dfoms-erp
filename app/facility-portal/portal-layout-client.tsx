"use client";

import { usePathname } from "next/navigation";
import type { FacilityPortalNavLink } from "./portal-nav-config";
import FacilityPortalDashboardShell from "./portal-dashboard-shell";

const PUBLIC_AUTH_PREFIXES = [
  "/facility-portal/login",
  "/facility-portal/accept-invite",
  "/facility-portal/forgot-password",
  "/facility-portal/reset-password",
] as const;

type PortalLayoutClientProps = {
  children: React.ReactNode;
  userLabel: string | null;
  links: FacilityPortalNavLink[];
  isAuthenticated: boolean;
};

function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Applies the staff-style sidebar shell to authenticated facility routes only.
 * Login / accept-invite / password flows render without chrome.
 */
export default function PortalLayoutClient({
  children,
  userLabel,
  links,
  isAuthenticated,
}: PortalLayoutClientProps) {
  const pathname = usePathname();

  if (isPublicAuthPath(pathname) || !isAuthenticated || !userLabel) {
    return <>{children}</>;
  }

  return (
    <FacilityPortalDashboardShell userLabel={userLabel} links={links}>
      {children}
    </FacilityPortalDashboardShell>
  );
}
