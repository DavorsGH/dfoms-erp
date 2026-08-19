import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getPlatformOnlyUnitActivationPricing,
  getPlatformOnlyUnitAnnualPricing,
  getPlatformOnlyUnitCapConfig,
} from "@/utils/platform-billing-config";
import PlatformUnitPricing, {
  type PlatformUnitPricingRow,
} from "../platform-unit-pricing";

export default async function PlatformUnitPricingPage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const [monthlyPricing, annualPricing, capConfig] = await Promise.all([
    getPlatformOnlyUnitActivationPricing(admin),
    getPlatformOnlyUnitAnnualPricing(admin),
    getPlatformOnlyUnitCapConfig(admin),
  ]);

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
  ];

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Platform Unit Pricing
      </h2>
      <PlatformUnitPricing initialRows={initialRows} fetchError={null} />
    </>
  );
}
