import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchProductCatalogReportData } from "../../sales-report-data";
import { ProductCatalogReport } from "../../sales-reports";
import ReportsShell from "../../reports-shell";

export default async function ProductCatalogReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const data = await fetchProductCatalogReportData(supabase, buScope);

  return (
    <ReportsShell sectionTitle="Product Catalog">
      <ProductCatalogReport {...data} />
    </ReportsShell>
  );
}
