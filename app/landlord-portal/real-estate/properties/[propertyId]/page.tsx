import Link from "next/link";
import { redirect } from "next/navigation";
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

  const { propertyId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchPropertyDetail(
    admin,
    session.tenantId,
    propertyId,
  );

  if (!detail && !fetchError) {
    return (
      <section className={portalSectionClassName}>
        <p className="text-sm text-slate-600">Property not found.</p>
        <Link
          href="/landlord-portal/real-estate/properties"
          className="mt-3 inline-block text-sm text-[#0f2744] hover:underline"
        >
          Back to properties
        </Link>
      </section>
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
            <p className="mt-1 text-sm text-slate-600">
              Same gallery storage as staff Real Estate (read-only).
            </p>
            <div className="mt-4">
              <LandlordPortalPhotoGalleryReadonly
                urls={property.photoUrls}
                alt="Property photo"
              />
            </div>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Document storage</h2>
            <p className="mt-4 text-sm text-slate-600">
              No property document store exists in the schema yet (staff uses
              photo galleries only). Lease PDFs / title deeds are not available
              until a documents table or column is added.
            </p>
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
