import type { FacilityManagerPortalSession } from "@/utils/facility-portal-auth";

export type FacilityPortalNavLink = {
  id: string;
  label: string;
  href: string;
};

/**
 * Capability-gated Facility Manager nav.
 * Dashboard is always shown; operational links follow flags.
 */
export function getFacilityPortalNavLinks(
  session: Pick<
    FacilityManagerPortalSession,
    | "canManageMaintenance"
    | "canManageComplaints"
    | "canManageInspections"
    | "canLogServices"
    | "canCollectRent"
    | "canCollectCharges"
  >,
): FacilityPortalNavLink[] {
  const links: FacilityPortalNavLink[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      href: "/facility-portal/dashboard",
    },
  ];

  if (session.canManageMaintenance) {
    links.push({
      id: "maintenance",
      label: "Maintenance",
      href: "/facility-portal/maintenance",
    });
  }

  if (session.canManageComplaints) {
    links.push({
      id: "complaints",
      label: "Complaints",
      href: "/facility-portal/complaints",
    });
  }

  if (session.canManageInspections) {
    links.push({
      id: "inspections",
      label: "Inspections",
      href: "/facility-portal/inspections",
    });
  }

  if (session.canLogServices) {
    links.push({
      id: "services",
      label: "Services",
      href: "/facility-portal/services",
    });
  }

  if (session.canCollectRent || session.canCollectCharges) {
    links.push({
      id: "collections",
      label: "Collections",
      href: "/facility-portal/collections",
    });
  }

  return links;
}

export function isFacilityPortalPathActive(
  pathname: string,
  href: string,
): boolean {
  if (pathname === href) {
    return true;
  }
  return pathname.startsWith(`${href}/`);
}

export function facilityPortalHasOperationalNav(
  session: Pick<
    FacilityManagerPortalSession,
    | "canManageMaintenance"
    | "canManageComplaints"
    | "canManageInspections"
    | "canLogServices"
    | "canCollectRent"
    | "canCollectCharges"
  >,
): boolean {
  return (
    session.canManageMaintenance ||
    session.canManageComplaints ||
    session.canManageInspections ||
    session.canLogServices ||
    session.canCollectRent ||
    session.canCollectCharges
  );
}
