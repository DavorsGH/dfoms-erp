import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { getMfaSettingsForCurrentUser } from "@/lib/mfa/enrollment-actions";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import LandlordMfaSettingsClient from "./mfa-settings-client";

export default async function LandlordMfaSettingsPage() {
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

  const settings = await getMfaSettingsForCurrentUser("landlord");

  return (
    <section className={portalSectionClassName}>
      <Link
        href="/landlord-portal/administration/account-security"
        className="text-sm text-slate-500 underline hover:text-slate-800"
      >
        ← Account security
      </Link>
      <h1 className={`${portalSectionTitleClassName} mt-2`}>
        Two-factor authentication
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Optional extra sign-in protection for the Landlord Portal.
      </p>
      <div className="mt-6">
        <LandlordMfaSettingsClient initialSettings={settings} />
      </div>
    </section>
  );
}
