import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { SupportTicketRow } from "@/utils/support-tickets-types";
import ReportAProblem from "../report-a-problem";

type PageProps = {
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function ReportAProblemPage({ searchParams }: PageProps) {
  if (!(await isSuperAdmin())) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab = tabParam === "my-reports" ? "my-reports" : "report";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("support_tickets")
    .select(
      "id, tenant_id, submitted_by, subject, description, status, resolution_notes, resolved_by, resolved_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Report a Problem</h2>
      <ReportAProblem
        initialTickets={(data as SupportTicketRow[] | null) ?? []}
        fetchError={error?.message ?? null}
        initialTab={initialTab}
      />
    </>
  );
}
