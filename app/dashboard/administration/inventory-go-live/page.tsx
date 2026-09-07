import { cookies } from "next/headers";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  normalizeInventoryBalanceConfigRow,
  type InventoryBalanceConfigRow,
} from "@/utils/inventory-balance-config-types";
import {
  fetchInventoryBalanceConfigRow,
  resolveInventoryBalanceConfigBusinessUnitId,
} from "@/utils/inventory-balance-config.server";
import { createClient } from "@/utils/supabase/server";
import InventoryGoLiveSettings from "../inventory-go-live-settings";

export default async function InventoryGoLivePage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in.");
  }

  const businessUnitId = await resolveInventoryBalanceConfigBusinessUnitId(
    supabase,
    tenantId,
    user.id,
  );

  const { data, error } = await fetchInventoryBalanceConfigRow(
    supabase,
    tenantId,
    businessUnitId,
  );

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
