import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";

export type LandlordPortalNavLink = {
  label: string;
  href: string;
};

export type LandlordPortalNavSection = {
  id: string;
  label: string;
  /** Flat link (Dashboard, Maintenance, …) */
  href?: string;
  /** Expandable sub-links */
  links?: readonly LandlordPortalNavLink[];
};

export function getLandlordPortalNavSections(
  landlordType: LandlordType | null,
  options?: { showNotificationContacts?: boolean },
): LandlordPortalNavSection[] {
  const showNotificationContacts = options?.showNotificationContacts ?? true;

  const financeLinks: LandlordPortalNavLink[] = [
    {
      label: "Rent Ledger",
      href: "/landlord-portal/finance/rent-ledger",
    },
  ];

  if (landlordType === "platform_only") {
    financeLinks.push({
      label: "Expenses",
      href: "/landlord-portal/finance/expenses",
    });
  }

  const realEstateLinks: LandlordPortalNavLink[] = [
    {
      label: "Properties",
      href: "/landlord-portal/real-estate/properties",
    },
    { label: "Units", href: "/landlord-portal/real-estate/units" },
    {
      label: "Applications",
      href: "/landlord-portal/real-estate/applications",
    },
    { label: "Tenants", href: "/landlord-portal/real-estate/tenants" },
    { label: "Leases", href: "/landlord-portal/real-estate/leases" },
    {
      label: "Facility Managers",
      href: "/landlord-portal/real-estate/facility-managers",
    },
  ];

  if (landlordType === "platform_only") {
    realEstateLinks.push({
      label: "Announcements",
      href: "/landlord-portal/real-estate/announcements",
    });
  }

  if (landlordType === "davors_managed") {
    financeLinks.push({
      label: "Payouts & Escrow",
      href: "/landlord-portal/finance/payouts",
    });
  }

  const administrationLinks: LandlordPortalNavLink[] = [
    {
      label: "Workspace Settings",
      href: "/landlord-portal/administration/workspace",
    },
    {
      label: "Billing Settings",
      href: "/landlord-portal/administration/billing",
    },
    {
      label: "User Accounts",
      href: "/landlord-portal/administration/user-accounts",
    },
    {
      label: "Login Activity",
      href: "/landlord-portal/administration/login-activity",
    },
  ];

  if (showNotificationContacts) {
    administrationLinks.splice(3, 0, {
      label: "Notification Contacts",
      href: "/landlord-portal/administration/notification-contacts",
    });
  }

  return [
    {
      id: "dashboard",
      label: "Dashboard",
      href: "/landlord-portal/dashboard",
    },
    {
      id: "account",
      label: "My Account",
      href: "/landlord-portal/account",
    },
    {
      id: "real-estate",
      label: "Real Estate",
      links: realEstateLinks,
    },
    {
      id: "finance",
      label: "Finance",
      links: financeLinks,
    },
    {
      id: "maintenance",
      label: "Maintenance",
      href: "/landlord-portal/maintenance",
    },
    {
      id: "complaints",
      label: "Complaints",
      href: "/landlord-portal/complaints",
    },
    {
      id: "terminations",
      label: "Terminations",
      href: "/landlord-portal/terminations",
    },
    {
      id: "reports",
      label: "Reports",
      href: "/landlord-portal/reports",
    },
    {
      id: "administration",
      label: "Administration",
      links: administrationLinks,
    },
  ];
}

export function isLandlordPortalPathActive(
  pathname: string,
  href: string,
): boolean {
  if (href === "/landlord-portal/dashboard") {
    return pathname === "/landlord-portal/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isLandlordPortalSectionActive(
  pathname: string,
  section: LandlordPortalNavSection,
): boolean {
  if (section.href) {
    return isLandlordPortalPathActive(pathname, section.href);
  }
  return (
    section.links?.some((link) =>
      isLandlordPortalPathActive(pathname, link.href),
    ) ?? false
  );
}
