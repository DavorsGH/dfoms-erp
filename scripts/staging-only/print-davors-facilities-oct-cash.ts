import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

config({ path: resolve(".env.staging.local") });

const D = "00000001-0000-4000-8000-000000000001";
const F = "de215200-e92b-48e3-a7ba-977d7289868c";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const data = await fetchBalanceSheetPageData(admin, D, {
    activeBusinessUnitId: F,
    viewAllBusinessUnits: false,
  });
  const report = buildStandardBalanceSheetReport(data, D, 2026);
  const cash = getBalanceSheetAmountForMonth(
    report.rows.find((r) => r.key === "cash")!,
    9,
  );
  console.log("Oct 2026 Facilities cash:", cash);
  console.log("BS check:", getBalanceSheetMonthCheck(report, 9));
}

main();
