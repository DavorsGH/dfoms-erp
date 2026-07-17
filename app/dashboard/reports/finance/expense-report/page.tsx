import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchExpenseReportData } from "../../finance-report-data";
import { ExpenseReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function ExpenseReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchExpenseReportData(supabase);

  return (
    <ReportsShell sectionTitle="Expense Report">
      <ExpenseReport {...data} />
    </ReportsShell>
  );
}
