import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cookies } from "next/headers";
import UserActivityLogViewer from "@/components/user-activity-log-viewer";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "@/app/landlord-portal/portal-ui";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createClient } from "@/utils/supabase/server";
import {
  parseUserActivityPage,
  parseUserActivityPersonaFilter,
  parseUserActivityStatusFilter,
  USER_ACTIVITY_LOG_PAGE_SIZE,
  type UserActivityLogRow,
} from "@/utils/user-activity-log-types";
import LandlordPortalPendingApprovalView from "@/app/landlord-portal/pending-approval-view";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    persona?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }>;
};

export default async function LandlordLoginActivityPage({
  searchParams,
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

  const params = await searchParams;
  const page = parseUserActivityPage(params.page);
  const personaFilter = parseUserActivityPersonaFilter(params.persona);
  const statusFilter = parseUserActivityStatusFilter(params.status);
  const dateFrom = params.date_from?.trim() ?? "";
  const dateTo = params.date_to?.trim() ?? "";
  const from = (page - 1) * USER_ACTIVITY_LOG_PAGE_SIZE;
  const to = from + USER_ACTIVITY_LOG_PAGE_SIZE - 1;

  const supabase = createClient(await cookies());

  let query = supabase
    .from("user_activity_log")
    .select(
      "id, persona, tenant_id, auth_user_id, email, event_name, status, ip, metadata, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (personaFilter) query = query.eq("persona", personaFilter);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const { data, error, count } = await query;

  return (
    <section className={portalSectionClassName}>
      <h1 className={portalSectionTitleClassName}>Login Activity</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        Sign-in events for your landlord organization.
      </p>
      <Suspense fallback={<p className="text-sm text-slate-600">Loading…</p>}>
        <UserActivityLogViewer
          rows={(data as UserActivityLogRow[] | null) ?? []}
          totalCount={count ?? 0}
          page={page}
          pageSize={USER_ACTIVITY_LOG_PAGE_SIZE}
          personaFilter={personaFilter}
          statusFilter={statusFilter}
          tenantFilter=""
          dateFrom={dateFrom}
          dateTo={dateTo}
          fetchError={error?.message ?? null}
          basePath="/landlord-portal/administration/login-activity"
        />
      </Suspense>
    </section>
  );
}
