import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { POS_SECTION_ROLES } from "@/utils/rbac-access";
import { matchesProductScanCode, parseBarcodeScanPayload } from "@/utils/barcode-scan-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "@/app/dashboard/inventory/finished-products-utils";
import { scopedFinishedProductsQuery } from "@/app/dashboard/inventory/finished-product-bu-stock-utils";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn([...POS_SECTION_ROLES]);
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const code = parseBarcodeScanPayload(url.searchParams.get("code") ?? "");
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [viewAllBusinessUnits, activeBusinessUnitId] = await Promise.all([
    getViewAllBusinessUnits(),
    getActiveBusinessUnitId(),
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
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as FinishedProductRecord[] | null) ?? [];
  const product =
    rows
      .map(normalizeFinishedProduct)
      .find(
        (row) => matchesProductScanCode(row, code) && !row.is_archived,
      ) ?? null;

  return NextResponse.json({ product });
}
