import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import LoginAccessCard from "@/components/portal-login-access/login-access-card";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function LandlordPortalFacilityManagerDetailPage({
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

  const { id } = await params;
  const facilityManagerId = id.trim();
  const admin = createAdminClient();
  const { data: fm, error } = await admin
    .from("facility_managers")
    .select(
      "facility_manager_id, full_name, email, phone, status, auth_user_id",
    )
    .eq("tenant_id", session.tenantId)
    .eq("facility_manager_id", facilityManagerId)
    .maybeSingle();

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/landlord-portal/real-estate/facility-managers"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to facility managers
        </Link>
        <div className={portalErrorBannerClassName}>{error.message}</div>
      </div>
    );
  }

  if (!fm) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/real-estate/facility-managers"
        backLabel="Back to facility managers"
      />
    );
  }

  const canManageLogin = session.landlordType === "platform_only";

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/landlord-portal/real-estate/facility-managers"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to facility managers
        </Link>
        <h1 className={`mt-2 ${portalSectionTitleClassName}`}>
          {fm.full_name}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Facility manager details
          {canManageLogin
            ? " and portal login access."
            : ". Contact Davors staff to manage login access."}
        </p>
      </div>

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Profile</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd className="font-medium text-slate-900">{fm.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Phone</dt>
            <dd className="font-medium text-slate-900">
              {fm.phone?.trim() || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd className="font-medium text-slate-900">{fm.status}</dd>
          </div>
        </dl>
      </section>

      {canManageLogin ? (
        <LoginAccessCard
          apiBase="landlord-portal"
          persona="facility_manager"
          tenantId={session.tenantId}
          facilityManagerId={fm.facility_manager_id as string}
        />
      ) : null}
    </div>
  );
}
