import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
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
    date_from?: string;
    date_to?: string;
  }>;
};

export default async function TenantLoginActivityPage({
  searchParams,
}: PageProps) {
  const role = await getCurrentUserRole();
  if (role !== "super_admin" && role !== "director") {
    redirect("/dashboard");
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
    <section className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-[#0f2744]">
        Login Activity
      </h1>
      <p className="mb-6 text-sm text-slate-600">
        Sign-in events for your workspace (RLS-scoped). Includes staff portal
        logins for this tenant.
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
          basePath="/dashboard/login-activity"
        />
      </Suspense>
    </section>
  );
}
