import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getPlatformOnlyUnitActivationPricing,
  getPlatformOnlyUnitAnnualPricing,
} from "@/utils/platform-billing-config";
import PlatformUnitPricing, {
  type PlatformUnitPricingRow,
} from "../platform-unit-pricing";

export default async function PlatformUnitPricingPage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const [monthlyPricing, annualPricing] = await Promise.all([
    getPlatformOnlyUnitActivationPricing(admin),
    getPlatformOnlyUnitAnnualPricing(admin),
  ]);

  const initialRows: PlatformUnitPricingRow[] = [
    {
      configKey: monthlyPricing.configKey,
      label: "Platform-only unit activation / monthly",
      priceGhs: monthlyPricing.priceGhs,
      updatedAt: monthlyPricing.updatedAt,
    },
    {
      configKey: annualPricing.configKey,
      label: "Platform-only unit annual (per unit / year)",
      priceGhs: annualPricing.priceGhs,
      updatedAt: annualPricing.updatedAt,
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
