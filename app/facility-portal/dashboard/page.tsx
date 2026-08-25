import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  facilityPortalHasOperationalNav,
} from "@/app/facility-portal/portal-nav-config";
import {
  formatMaintenanceMoney,
  fetchFacilityPortalDashboardSummary,
} from "@/utils/facility-portal-data";
import {
  portalCompactSectionClassName,
  portalPageClassName,
  portalPrimaryButtonClassName,
  portalSectionTitleClassName,
} from "../portal-ui";

export default async function FacilityPortalDashboardPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }

  const admin = createAdminClient();
  const { summary, error } = await fetchFacilityPortalDashboardSummary(
    admin,
    session,
  );
  const hasOps = facilityPortalHasOperationalNav(session);

  const cards: Array<{
    label: string;
    value: string;
    href?: string;
    show: boolean;
  }> = [
    {
      label: "Assigned properties",
      value: String(summary.assignedPropertyCount),
      show: true,
    },
    {
      label: "Open maintenance",
      value: String(summary.openMaintenanceCount),
      href: session.canManageMaintenance
        ? "/facility-portal/maintenance"
        : undefined,
      show: session.canManageMaintenance,
    },
    {
      label: "Services this month",
      value: String(summary.servicesLoggedThisMonth),
      href: session.canLogServices ? "/facility-portal/services" : undefined,
      show: session.canLogServices,
    },
    {
      label: "Service cost (month)",
      value: formatMaintenanceMoney(summary.servicesCostThisMonthGhs),
      href: session.canLogServices ? "/facility-portal/services" : undefined,
      show: session.canLogServices,
    },
    {
      label: "Open complaints",
      value: String(summary.pendingComplaintsCount),
      show: session.canManageComplaints,
    },
    {
      label: "Inspections logged",
      value: String(summary.upcomingInspectionsCount),
      show: session.canManageInspections,
    },
    {
      label: "Pending collections",
      value: String(summary.pendingCollectionsCount),
      show: session.canCollectRent || session.canCollectCharges,
    },
  ];

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Dashboard</h1>
        <p className="text-sm text-slate-600">
          Welcome, {session.fullName}. Summary for your assigned properties
          only.
        </p>
        {summary.propertyNames.length > 0 ? (
          <p className="text-xs text-slate-500">
            {summary.propertyNames.join(" · ")}
          </p>
        ) : (
          <p className="text-sm text-amber-700">
            No properties are assigned to your account yet. Contact your
            landlord.
          </p>
        )}
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : null}
      </section>

      {!hasOps ? (
        <section className={portalCompactSectionClassName}>
          <p className="text-sm text-slate-700">
            You do not have operational capabilities enabled yet. Ask your
            landlord to grant maintenance, complaints, inspections, services,
            or collections access.
          </p>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards
            .filter((card) => card.show)
            .map((card) => {
              const inner = (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {card.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
                    {card.value}
                  </p>
                </>
              );
              if (card.href) {
                return (
                  <Link
                    key={card.label}
                    href={card.href}
                    className={`${portalCompactSectionClassName} transition-colors hover:border-[#0f2744]/40`}
                  >
                    {inner}
                  </Link>
                );
              }
              return (
                <div key={card.label} className={portalCompactSectionClassName}>
                  {inner}
                </div>
              );
            })}
        </div>
      )}

      {session.canManageMaintenance || session.canLogServices ? (
        <section className={portalCompactSectionClassName}>
          <h2 className={portalSectionTitleClassName}>Quick actions</h2>
          <div className="flex flex-wrap gap-2">
            {session.canManageMaintenance ? (
              <Link
                href="/facility-portal/maintenance"
                className={portalPrimaryButtonClassName}
              >
                Maintenance
              </Link>
            ) : null}
            {session.canLogServices ? (
              <Link
                href="/facility-portal/services"
                className={portalPrimaryButtonClassName}
              >
                Log service
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
