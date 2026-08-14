import { redirect } from "next/navigation";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalChangePasswordForm from "./change-password-form";
import PushNotificationsSettings from "@/components/push-notifications-settings";

export default async function LandlordPortalAccountSecurityPage() {
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

  return (
    <section className={portalSectionClassName}>
      <h1 className={portalSectionTitleClassName}>Account security</h1>
      <p className="mt-1 text-sm text-slate-600">
        Change the password for {session.email ?? "your signed-in account"}.
        Profile photo and logo upload are not available in this portal.
      </p>
      <p className="mt-3 text-sm">
        <a
          href="/landlord-portal/administration/account-security/mfa"
          className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
        >
          Manage two-factor authentication
        </a>
      </p>
      <div className="mt-6 space-y-6">
        <PushNotificationsSettings persona="landlord" />
        <LandlordPortalChangePasswordForm />
      </div>
    </section>
  );
}
