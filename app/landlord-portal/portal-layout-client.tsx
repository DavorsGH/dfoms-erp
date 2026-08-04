"use client";

import { usePathname } from "next/navigation";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import LandlordPortalDashboardShell from "./portal-dashboard-shell";

const PUBLIC_AUTH_PREFIXES = [
  "/landlord-portal/login",
  "/landlord-portal/signup",
  "/landlord-portal/accept-invite",
] as const;

type PortalLayoutClientProps = {
  children: React.ReactNode;
  userLabel: string | null;
  userPhotoUrl?: string | null;
  landlordType: LandlordType | null;
  hasDataAccess: boolean;
  isAuthenticatedLandlord: boolean;
};

function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Applies the staff-style sidebar shell to authenticated landlord routes only.
 * Login / signup / accept-invite render without chrome.
 */
export default function PortalLayoutClient({
  children,
  userLabel,
  userPhotoUrl = null,
  landlordType,
  hasDataAccess,
  isAuthenticatedLandlord,
}: PortalLayoutClientProps) {
  const pathname = usePathname();

  if (isPublicAuthPath(pathname) || !isAuthenticatedLandlord || !userLabel) {
    return <>{children}</>;
  }

  return (
    <LandlordPortalDashboardShell
      userLabel={userLabel}
      userPhotoUrl={userPhotoUrl}
      landlordType={landlordType}
      showNav={hasDataAccess}
    >
      {children}
    </LandlordPortalDashboardShell>
  );
}
