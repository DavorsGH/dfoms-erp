import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchProductSalesReportData } from "../../inventory-report-data";
import { ProductSalesReport } from "../../inventory-reports";
import ReportsShell from "../../reports-shell";

export default async function ProductSalesReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchProductSalesReportData(supabase);

  return (
    <ReportsShell sectionTitle="Product Sales">
      <ProductSalesReport {...data} />
    </ReportsShell>
  );
}
