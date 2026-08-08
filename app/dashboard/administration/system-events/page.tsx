import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchBalanceSheetIntegritySummary } from "@/utils/balance-sheet-integrity-summary";
import {
  parseSystemEventPage,
  parseSystemEventStatusFilter,
  parseSystemEventTypeFilter,
  SYSTEM_EVENT_LOG_PAGE_SIZE,
  type SystemEventLogRow,
} from "@/utils/system-event-log-types";
import SystemEventsViewer from "../system-events";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    event_type?: string;
    status?: string;
  }>;
};

export default async function SystemEventsPage({ searchParams }: PageProps) {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const page = parseSystemEventPage(params.page);
  const eventTypeFilter = parseSystemEventTypeFilter(params.event_type);
  const statusFilter = parseSystemEventStatusFilter(params.status);
  const from = (page - 1) * SYSTEM_EVENT_LOG_PAGE_SIZE;
  const to = from + SYSTEM_EVENT_LOG_PAGE_SIZE - 1;

  const admin = createAdminClient();
  let query = admin
    .from("system_event_log")
    .select(
      "id, event_type, event_name, status, message, metadata, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (eventTypeFilter) {
    query = query.eq("event_type", eventTypeFilter);
  }
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error, count } = await query;

  const outOfBalanceSummary = await fetchBalanceSheetIntegritySummary(admin);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        System Event Log
      </h2>
      <Suspense fallback={<p className="text-sm text-slate-600">Loading…</p>}>
        <SystemEventsViewer
          rows={(data as SystemEventLogRow[] | null) ?? []}
          totalCount={count ?? 0}
          page={page}
          pageSize={SYSTEM_EVENT_LOG_PAGE_SIZE}
          eventTypeFilter={eventTypeFilter}
          statusFilter={statusFilter}
          fetchError={error?.message ?? null}
          outOfBalanceSummary={outOfBalanceSummary}
        />
      </Suspense>
    </>
  );
}
