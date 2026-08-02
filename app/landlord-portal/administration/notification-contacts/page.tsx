import { redirect } from "next/navigation";
import {
  fetchLandlordPortalNotificationContacts,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalNotificationContactsForm from "../../dashboard/notification-contacts-form";

export default async function LandlordPortalNotificationContactsPage() {
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

  if (session.landlordType !== "platform_only") {
    redirect("/landlord-portal/administration/workspace");
  }

  const contacts = await fetchLandlordPortalNotificationContacts(session);

  return (
    <section className={portalSectionClassName}>
      <h1 className={portalSectionTitleClassName}>Notification contacts</h1>
      <p className="mt-1 text-sm text-slate-600">
        SMS and email contacts used for Real Estate operational alerts.
      </p>

      {contacts.error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>
          {contacts.error}
        </div>
      ) : (
        <LandlordPortalNotificationContactsForm
          initialPhone={contacts.notificationPhone}
          initialEmail={contacts.notificationEmail}
        />
      )}
    </section>
  );
}
