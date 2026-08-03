import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchPropertyDetail } from "@/utils/property-management";
import {
  formatPropertyType,
  formatUnitStatus,
} from "@/app/dashboard/real-estate/properties-utils";
import { formatLeaseMoney } from "@/app/dashboard/real-estate/leases-utils";
import PropertyDetailView from "@/app/dashboard/real-estate/property-detail";
import { getPlatformOnlyUnitActivationPriceGhs } from "@/utils/platform-billing-config";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import LandlordPortalPhotoGalleryReadonly from "../../photo-gallery-readonly";

type PageProps = {
  params: Promise<{ propertyId: string }>;
};

export default async function LandlordPortalPropertyDetailPage({
  params,
}: PageProps) {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  if (!landlordPortalHasDataAccess(session)) {
    return (
      <LandlordPortalPendingApprovalView
        fullName={session.fullName}
        approvalStatus={session.approvalStatus}
      />
    );
  }

  const canManage = session.landlordType === "platform_only";
  const { propertyId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchPropertyDetail(
    admin,
    session.tenantId,
    propertyId,
  );

  if (!detail && !fetchError) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/real-estate/properties"
        backLabel="Back to properties"
      />
    );
  }

  if (canManage && detail) {
    const unitActivationPriceGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-[#0f2744]">
            {detail.property.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Edit property details, photos, and units.
          </p>
        </div>
        <PropertyDetailView
          initialDetail={detail}
          fetchError={fetchError}
          apiBasePath="/api/landlord-portal/properties"
          backHref="/landlord-portal/real-estate/properties"
          showLandlordName={false}
          showUnitBillingControls={canManage}
          unitActivationPriceGhs={unitActivationPriceGhs}
        />
      </div>
    );
  }

  const property = detail?.property;
  const units = detail?.units ?? [];
  const occupiedCount = units.filter((unit) => unit.status === "occupied").length;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/landlord-portal/real-estate/properties"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Properties
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
          {property?.name ?? "Property"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Read-only — Davors staff manages property changes for managed
          landlords.
        </p>
      </div>

      {fetchError ? (
        <div className={portalErrorBannerClassName}>{fetchError}</div>
      ) : null}

      {property ? (
        <>
          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Details</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Type
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatPropertyType(property.propertyType)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Location
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {[
                    property.addressLine1,
                    property.addressLine2,
                    property.city,
                    property.region,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Units
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {occupiedCount} occupied / {units.length} total
                </dd>
              </div>
            </dl>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Property photos</h2>
            <div className="mt-4">
              <LandlordPortalPhotoGalleryReadonly
                urls={property.photoUrls}
                alt="Property photo"
              />
            </div>
          </section>
        </>
      ) : null}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Units</h2>
        {units.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No units on this property.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {units.map((unit) => (
              <li key={unit.unitId} className="space-y-3 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Unit {unit.unitNumber}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatUnitStatus(unit.status)} ·{" "}
                    {formatLeaseMoney(unit.baseRentGhs)} base rent
                    {unit.bedrooms != null ? ` · ${unit.bedrooms} bed` : ""}
                    {unit.bathrooms != null ? ` · ${unit.bathrooms} bath` : ""}
                  </p>
                </div>
                <LandlordPortalPhotoGalleryReadonly
                  urls={unit.photoUrls}
                  emptyLabel="No unit photos."
                  alt={`Unit ${unit.unitNumber} photo`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
