import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { fetchPositions } from "../../employees/lookup-utils";
import SalarySettings from "../salary-settings";
import type { SalaryRateEntry } from "../salary-rates-utils";
import type {
  AllowanceTypeRow,
  CompensationPolicyRow,
} from "../compensation-policy-utils";

export default async function SalaryRatesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Salary Settings
        </h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Salary Settings.
        </p>
      </>
    );
  }

  const [
    { data: rates, error: ratesError },
    positionLookups,
    { data: allowanceTypes, error: typesError },
    { data: policies, error: policiesError },
  ] = await Promise.all([
    supabase
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    fetchPositions(supabase),
    supabase
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("compensation_policy")
      .select("*")
      .eq("tenant_id", tenantId),
  ]);

  const positions = positionLookups.map((position) => position.name);
  const fetchError =
    ratesError?.message ?? typesError?.message ?? policiesError?.message ?? null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Salary Settings
      </h2>
      <SalarySettings
        tenantId={tenantId}
        initialRates={(rates as SalaryRateEntry[] | null) ?? []}
        initialPositions={positions}
        initialAllowanceTypes={(allowanceTypes as AllowanceTypeRow[] | null) ?? []}
        initialPolicies={(policies as CompensationPolicyRow[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
