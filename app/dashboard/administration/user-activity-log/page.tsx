import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import UserActivityLogViewer from "@/components/user-activity-log-viewer";
import {
  parseUserActivityPage,
  parseUserActivityPersonaFilter,
  parseUserActivityStatusFilter,
  USER_ACTIVITY_LOG_PAGE_SIZE,
  type UserActivityLogRow,
} from "@/utils/user-activity-log-types";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    persona?: string;
    status?: string;
    tenant_id?: string;
    date_from?: string;
    date_to?: string;
  }>;
};

export default async function UserActivityLogPlatformPage({
  searchParams,
}: PageProps) {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const page = parseUserActivityPage(params.page);
  const personaFilter = parseUserActivityPersonaFilter(params.persona);
  const statusFilter = parseUserActivityStatusFilter(params.status);
  const tenantFilter = params.tenant_id?.trim() ?? "";
  const dateFrom = params.date_from?.trim() ?? "";
  const dateTo = params.date_to?.trim() ?? "";
  const from = (page - 1) * USER_ACTIVITY_LOG_PAGE_SIZE;
  const to = from + USER_ACTIVITY_LOG_PAGE_SIZE - 1;

  const admin = createAdminClient();

  let query = admin
    .from("user_activity_log")
    .select(
      "id, persona, tenant_id, auth_user_id, email, event_name, status, ip, metadata, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (personaFilter) query = query.eq("persona", personaFilter);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (tenantFilter) query = query.eq("tenant_id", tenantFilter);
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const [{ data, error, count }, { data: tenants }] = await Promise.all([
    query,
    admin.from("tenants").select("id, name").order("name"),
  ]);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        User Activity Log
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Login events across all tenants (password, MFA, and OAuth). Phase 1 —
        sign-in audit only.
      </p>
      <Suspense fallback={<p className="text-sm text-slate-600">Loading…</p>}>
        <UserActivityLogViewer
          rows={(data as UserActivityLogRow[] | null) ?? []}
          totalCount={count ?? 0}
          page={page}
          pageSize={USER_ACTIVITY_LOG_PAGE_SIZE}
          personaFilter={personaFilter}
          statusFilter={statusFilter}
          tenantFilter={tenantFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          fetchError={error?.message ?? null}
          basePath="/dashboard/administration/user-activity-log"
          showTenantFilter
          tenantOptions={(tenants ?? []).map((row) => ({
            id: row.id as string,
            name: row.name as string,
          }))}
        />
      </Suspense>
    </>
  );
}
