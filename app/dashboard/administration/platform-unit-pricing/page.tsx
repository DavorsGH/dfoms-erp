import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getPlatformBillingBusinessUnitConfig,
  getPlatformOnlyUnitActivationPricing,
  getPlatformOnlyUnitAnnualPricing,
  getPlatformOnlyUnitCapConfig,
  getReferralRewardGhsConfig,
} from "@/utils/platform-billing-config";
import { BUSINESS_UNIT_SELECT, type BusinessUnitRow } from "@/utils/business-units-types";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import PlatformBillingBusinessUnit from "../platform-billing-business-unit";
import PlatformUnitPricing, {
  type PlatformUnitPricingRow,
} from "../platform-unit-pricing";

export default async function PlatformUnitPricingPage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const [
    monthlyPricing,
    annualPricing,
    capConfig,
    referralReward,
    platformBillingBu,
    businessUnitsResult,
  ] = await Promise.all([
    getPlatformOnlyUnitActivationPricing(admin),
    getPlatformOnlyUnitAnnualPricing(admin),
    getPlatformOnlyUnitCapConfig(admin),
    getReferralRewardGhsConfig(admin),
    getPlatformBillingBusinessUnitConfig(admin),
    admin
      .from("business_units")
      .select(BUSINESS_UNIT_SELECT)
      .eq("tenant_id", DAVORS_TENANT_ID)
      .order("name", { ascending: true }),
  ]);

  const businessUnits = (businessUnitsResult.data as BusinessUnitRow[] | null) ?? [];
  const businessUnitFetchError = businessUnitsResult.error?.message ?? null;

  const initialRows: PlatformUnitPricingRow[] = [
    {
      configKey: monthlyPricing.configKey,
      label: "Platform-only unit activation / monthly",
      priceGhs: monthlyPricing.priceGhs,
      updatedAt: monthlyPricing.updatedAt,
      valueKind: "price",
    },
    {
      configKey: annualPricing.configKey,
      label: "Platform-only unit annual (per unit / year)",
      priceGhs: annualPricing.priceGhs,
      updatedAt: annualPricing.updatedAt,
      valueKind: "price",
    },
    {
      configKey: capConfig.configKey,
      label: "Platform-only active unit cap",
      priceGhs: capConfig.unitCap,
      updatedAt: capConfig.updatedAt,
      valueKind: "integer",
    },
    {
      configKey: referralReward.configKey,
      label: "ERP referral reward",
      priceGhs: referralReward.rewardGhs,
      updatedAt: referralReward.updatedAt,
      valueKind: "price",
    },
  ];

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Platform Unit Pricing
      </h2>
      <div className="mb-8">
        <PlatformBillingBusinessUnit
          businessUnits={businessUnits}
          initialBusinessUnitId={platformBillingBu.businessUnitId}
          initialUpdatedAt={platformBillingBu.updatedAt}
          fetchError={businessUnitFetchError}
        />
      </div>
      <PlatformUnitPricing initialRows={initialRows} fetchError={null} />
    </>
  );
}
