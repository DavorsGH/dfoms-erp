import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import FinanceNav from "../finance-nav";
import BusinessUnitTransfers from "../business-unit-transfers";
import {
  BUSINESS_UNIT_TRANSFER_SELECT,
  type BusinessUnitTransferRecord,
} from "../business-unit-transfers-utils";

export default async function BusinessUnitTransfersPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const [
    { data: businessUnits, error: unitsError },
    { data: transfers, error: transfersError },
  ] = await Promise.all([
    supabase
      .from("business_units")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
    supabase
      .from("business_unit_transfers")
      .select(BUSINESS_UNIT_TRANSFER_SELECT)
      .eq("tenant_id", tenantId)
      .order("transfer_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const unitCount = (businessUnits ?? []).length;
  if (unitCount < 2) {
    redirect("/dashboard/finance/manual-financial-entries");
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Inter-unit Transfers
      </h2>
      <BusinessUnitTransfers
        tenantId={tenantId}
        initialTransfers={(transfers as BusinessUnitTransferRecord[] | null) ?? []}
        businessUnits={(businessUnits ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.name ?? row.id),
        }))}
        fetchError={unitsError?.message ?? transfersError?.message ?? null}
      />
    </div>
  );
}
