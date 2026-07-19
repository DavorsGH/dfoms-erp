import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { ERP_SUITE_CATEGORY } from "../../crm/products/products-utils";
import TierPricing, { type TierPricingRow } from "../tier-pricing";

const TIER_PRICING_SELECT =
  "id, name, unit_price, price_ghs, billing_cycle, is_active";

export default async function TierPricingPage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("crm_products")
    .select(TIER_PRICING_SELECT)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("category", ERP_SUITE_CATEGORY);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Tier Pricing</h2>
      <TierPricing
        initialRows={(rows as TierPricingRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
