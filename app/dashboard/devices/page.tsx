import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
  scopedFinishedProductsQuery,
} from "../inventory/finished-product-bu-stock-utils";
import { tenantHasFeature } from "@/utils/tier-access";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import {
  canAdministerAttendanceDevices,
  canSetAttendanceClockOut,
  canWriteAttendanceDevices,
} from "@/utils/rbac-access";
import { scannerSimulatorAllowed } from "@/lib/adms/scanner-simulator-gate";
import DevicesHubClient from "./devices-hub-client";

export default async function DevicesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits, role] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentUserRole(),
    ]);

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { data, error } = await scopedFinishedProductsQuery(
    supabase,
    buScope,
    FINISHED_PRODUCT_SELECT,
  );

  let products = ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
    normalizeFinishedProduct(row),
  );

  if (tenantId) {
    const scopedStock = await fetchScopedFinishedProductStock(
      supabase,
      tenantId,
      buScope,
    );
    if (!scopedStock.error) {
      products = mergeScopedStockOntoProducts(
        products,
        scopedStock.stockMap,
        buScope.mode,
      );
    }
  }

  const hasPosFeature = tenantId
    ? await tenantHasFeature(tenantId, "pos")
    : false;

  return (
    <DevicesHubClient
      tenantId={tenantId}
      initialScannerProducts={products}
      scannerFetchError={error?.message ?? null}
      hasPosFeature={hasPosFeature}
      canWriteDevices={canWriteAttendanceDevices(role)}
      canDeleteDevices={canAdministerAttendanceDevices(role)}
      canSetClockOut={canSetAttendanceClockOut(role)}
      canReprocessPunches={canSetAttendanceClockOut(role)}
      showScannerSimulator={role === "super_admin" && scannerSimulatorAllowed()}
    />
  );
}
