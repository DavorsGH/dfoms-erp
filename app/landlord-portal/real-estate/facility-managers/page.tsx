import { redirect } from "next/navigation";
import {
  fetchLandlordPortalProperties,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalFacilityManagersList from "./facility-managers-list";

export default async function LandlordPortalFacilityManagersPage() {
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

  const { rows: properties, error: propertiesError } =
    await fetchLandlordPortalProperties(session);
  const isDavorsManaged = session.landlordType === "davors_managed";

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Facility Managers</h1>
        <p className="mt-1 text-sm text-slate-600">
          Invite facility managers to handle maintenance, complaints, inspections,
          and services for assigned properties.
          {isDavorsManaged
            ? " Rent and charge collection is managed by Davors staff on your behalf."
            : " You can optionally allow rent and charge collection."}
        </p>
      </div>

      {propertiesError ? (
        <div className={portalErrorBannerClassName}>{propertiesError}</div>
      ) : (
        <LandlordPortalFacilityManagersList
          properties={properties.map((row) => ({
            propertyId: row.propertyId,
            name: row.name,
          }))}
          isDavorsManaged={isDavorsManaged}
        />
      )}
    </div>
  );
}
