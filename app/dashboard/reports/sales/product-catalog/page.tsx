import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchProductCatalogReportData } from "../../sales-report-data";
import { ProductCatalogReport } from "../../sales-reports";
import ReportsShell from "../../reports-shell";

export default async function ProductCatalogReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchProductCatalogReportData(supabase);

  return (
    <ReportsShell sectionTitle="Product Catalog">
      <ProductCatalogReport {...data} />
    </ReportsShell>
  );
}
