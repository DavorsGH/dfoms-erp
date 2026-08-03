import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPlatformOnlyUnitActivationPricing } from "@/utils/platform-billing-config";
import PlatformUnitPricing, {
  type PlatformUnitPricingRow,
} from "../platform-unit-pricing";

export default async function PlatformUnitPricingPage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const pricing = await getPlatformOnlyUnitActivationPricing(admin);

  const initialRow: PlatformUnitPricingRow = {
    configKey: pricing.configKey,
    label: "Platform-only unit activation",
    priceGhs: pricing.priceGhs,
    updatedAt: pricing.updatedAt,
  };

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Platform Unit Pricing
      </h2>
      <PlatformUnitPricing initialRow={initialRow} fetchError={null} />
    </>
  );
}
