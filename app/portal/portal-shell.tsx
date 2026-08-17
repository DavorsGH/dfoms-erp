import TenantPortalDashboardShell from "./portal-dashboard-shell";

type PortalShellProps = {
  fullName: string;
  photoUrl?: string | null;
  children: React.ReactNode;
};

/**
 * Shared Tenant Portal chrome — sidebar + top bar (matches staff / landlord shell).
 */
export default function PortalShell({
  fullName,
  photoUrl = null,
  children,
}: PortalShellProps) {
  return (
    <TenantPortalDashboardShell
      userLabel={fullName}
      userPhotoUrl={photoUrl}
    >
      {children}
    </TenantPortalDashboardShell>
  );
}
