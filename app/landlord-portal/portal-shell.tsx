import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import LandlordPortalDashboardShell from "./portal-dashboard-shell";

type LandlordPortalShellProps = {
  fullName: string;
  logoUrl?: string | null;
  children: React.ReactNode;
  landlordType?: LandlordType | null;
  /** Hide operational nav for pending/rejected accounts. */
  showNav?: boolean;
};

/**
 * Landlord Portal chrome — matches staff DashboardShell (sidebar + top bar).
 * Prefer the authenticated `(portal)` layout; this wrapper remains for
 * pending-approval and any page that still needs an explicit shell.
 */
export default function LandlordPortalShell({
  fullName,
  logoUrl = null,
  children,
  landlordType = null,
  showNav = true,
}: LandlordPortalShellProps) {
  return (
    <LandlordPortalDashboardShell
      userLabel={fullName}
      userPhotoUrl={logoUrl}
      landlordType={landlordType}
      showNav={showNav}
    >
      {children}
    </LandlordPortalDashboardShell>
  );
}
