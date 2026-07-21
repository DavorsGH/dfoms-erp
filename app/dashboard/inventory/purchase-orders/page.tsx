import { cookies } from "next/headers";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  PURCHASE_ORDER_LIST_SELECT,
  normalizePurchaseOrderListRow,
  type PurchaseOrderListRow,
} from "@/utils/purchase-orders-types";
import InventoryShell from "../inventory-shell";
import PurchaseOrders from "../purchase-orders";

export default async function PurchaseOrdersPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <InventoryShell sectionTitle="Purchase Orders">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </InventoryShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PURCHASE_ORDER_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Purchase Orders">
      <PurchaseOrders
        initialPurchaseOrders={
          ((data as PurchaseOrderListRow[] | null) ?? []).map((row) =>
            normalizePurchaseOrderListRow(row),
          )
        }
        fetchError={error?.message ?? null}
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
