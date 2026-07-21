import { cookies } from "next/headers";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  INVENTORY_BALANCE_CONFIG_SELECT,
  normalizeInventoryBalanceConfigRow,
  type InventoryBalanceConfigRow,
} from "@/utils/inventory-balance-config-types";
import { guardSectionAccess } from "@/utils/section-guard";
import { createClient } from "@/utils/supabase/server";
import InventoryGoLiveSettings from "../../administration/inventory-go-live-settings";
import FinanceNav from "../finance-nav";

const INVENTORY_GO_LIVE_ROLES = ["super_admin", "finance"] as const;

export default async function FinanceInventoryGoLivePage() {
  await guardSectionAccess(INVENTORY_GO_LIVE_ROLES);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("inventory_balance_config")
    .select(INVENTORY_BALANCE_CONFIG_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const config = data
    ? normalizeInventoryBalanceConfigRow(data as InventoryBalanceConfigRow)
    : null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Inventory Go-Live
      </h2>
      <InventoryGoLiveSettings
        initialConfig={config}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
