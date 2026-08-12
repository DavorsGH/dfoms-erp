import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserClientId } from "@/utils/dashboard-auth";
import {
  CLIENT_QUOTATION_PORTAL_LIST_SELECT,
  type ClientQuotationPortalListRow,
} from "@/utils/client-quotations-types";
import ClientPortalShell from "../client-portal-shell";
import MyQuotations from "../my-quotations";

export default async function ClientPortalQuotationsPage() {
  const clientId = await getCurrentUserClientId();

  if (!clientId) {
    return (
      <ClientPortalShell sectionTitle="My Quotations">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to a customer record.
        </div>
      </ClientPortalShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("client_quotations")
    .select(CLIENT_QUOTATION_PORTAL_LIST_SELECT)
    .neq("status", "draft")
    .order("issue_date", { ascending: false });

  return (
    <ClientPortalShell sectionTitle="My Quotations">
      <MyQuotations
        initialQuotations={(data as ClientQuotationPortalListRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </ClientPortalShell>
  );
}
