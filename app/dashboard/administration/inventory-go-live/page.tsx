import { cookies } from "next/headers";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  INVENTORY_BALANCE_CONFIG_SELECT,
  normalizeInventoryBalanceConfigRow,
  type InventoryBalanceConfigRow,
} from "@/utils/inventory-balance-config-types";
import { createClient } from "@/utils/supabase/server";
import InventoryGoLiveSettings from "../inventory-go-live-settings";

export default async function InventoryGoLivePage() {
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
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Inventory Go-Live
      </h2>
      <InventoryGoLiveSettings
        initialConfig={config}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
