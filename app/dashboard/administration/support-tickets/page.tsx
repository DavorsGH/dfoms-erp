import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  parseSupportTicketPage,
  parseSupportTicketStatusFilter,
  SUPPORT_TICKETS_PAGE_SIZE,
  type SupportTicketListRow,
} from "@/utils/support-tickets-types";
import SupportTicketsAdmin from "../support-tickets";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    status?: string;
    tenant_id?: string;
    ticket?: string;
  }>;
};

export default async function SupportTicketsPage({ searchParams }: PageProps) {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const page = parseSupportTicketPage(params.page);
  const statusFilter = parseSupportTicketStatusFilter(params.status);
  const tenantFilter = params.tenant_id?.trim() ?? "";
  const selectedTicketId = params.ticket?.trim() || null;
  const from = (page - 1) * SUPPORT_TICKETS_PAGE_SIZE;
  const to = from + SUPPORT_TICKETS_PAGE_SIZE - 1;

  const admin = createAdminClient();

  const tenantsResult = await admin
    .from("tenants")
    .select("id, name")
    .order("name", { ascending: true });

  const tenantNameById = new Map<string, string>();
  for (const tenant of tenantsResult.data ?? []) {
    tenantNameById.set(
      (tenant as { id: string }).id,
      (tenant as { name: string }).name,
    );
  }

  let query = admin
    .from("support_tickets")
    .select(
      "id, tenant_id, submitted_by, subject, description, status, resolution_notes, resolved_by, resolved_at, created_at, updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }
  if (tenantFilter) {
    query = query.eq("tenant_id", tenantFilter);
  }

  const { data, error, count } = await query;

  const rows: SupportTicketListRow[] = ((data as SupportTicketListRow[] | null) ?? []).map(
    (row) => ({
      ...row,
      tenant_name: tenantNameById.get(row.tenant_id) ?? null,
    }),
  );

  const tenantOptions = (tenantsResult.data ?? []).map((tenant) => ({
    tenantId: (tenant as { id: string }).id,
    companyName: (tenant as { name: string }).name,
  }));

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Support Tickets</h2>
      <Suspense fallback={<p className="text-sm text-slate-600">Loading…</p>}>
        <SupportTicketsAdmin
          rows={rows}
          totalCount={count ?? 0}
          page={page}
          pageSize={SUPPORT_TICKETS_PAGE_SIZE}
          statusFilter={statusFilter}
          tenantFilter={tenantFilter}
          tenantOptions={tenantOptions}
          selectedTicketId={selectedTicketId}
          fetchError={error?.message ?? null}
        />
      </Suspense>
    </>
  );
}
