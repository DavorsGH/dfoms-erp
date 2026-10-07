/**
 * Restore Davors Facilities Jul 2026 after prove-payroll-relock-postings forced full lock + Paid SAL.
 * Target: Partially Locked MEC, no PAYROLL-SAL/ESSNIT finance rows (pre-script partial state).
 *
 * npx tsx scripts/staging-only/restore-davors-july-partial-lock-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";
import {
  deletePayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
} from "../../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import { PAYROLL_STATUS_PARTIALLY_LOCKED } from "../../app/dashboard/hr-payroll/payroll-processing-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";
const PAYROLL_MONTH = "2026-07-01";
const FY = 2026;
const OCT = 9;
const TARGET_CASH = -22645.85;

const MONTH_END_CLOSE_ON_CONFLICT = "tenant_id,month,business_unit_id";

async function facilitiesOct(admin: ReturnType<typeof createClient>) {
  const data = await fetchBalanceSheetPageData(admin, DAVORS, {
    activeBusinessUnitId: FACILITIES,
    viewAllBusinessUnits: false,
  });
  const report = buildStandardBalanceSheetReport(data, DAVORS, FY);
  const cashRow = report.rows.find((r) => r.key === "cash");
  return {
    cash: cashRow ? getBalanceSheetAmountForMonth(cashRow, OCT) : NaN,
    check: getBalanceSheetMonthCheck(report, OCT),
  };
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const before = await facilitiesOct(admin);
  console.log("Before:", before);

  const period = resolvePayrollLockFinancePeriod(PAYROLL_MONTH);
  if (!period) throw new Error("Bad payroll month");

  const { data: histRows, error: histErr } = await admin
    .from("payroll_history")
    .select("employee_id, loan_repayment, net_pay")
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", PAYROLL_MONTH);
  if (histErr) throw histErr;

  const financeDelete = await deletePayrollLockFinanceEntries(
    admin,
    period,
    DAVORS,
    {
      businessUnitId: FACILITIES,
      loanRepaymentRows: (histRows ?? []).map((row) => ({
        employee_id: row.employee_id as string,
        loan_repayment: row.loan_repayment,
      })),
    },
  );
  console.log("Deleted finance postings:", financeDelete);

  const totalNet = Math.round(
    (histRows ?? []).reduce((s, r) => s + (Number(r.net_pay) || 0), 0) * 100,
  ) / 100;

  const { error: mecErr } = await admin.from("month_end_close").upsert(
    {
      tenant_id: DAVORS,
      month: PAYROLL_MONTH,
      business_unit_id: FACILITIES,
      employees_recorded: histRows?.length ?? 0,
      total_net_pay: totalNet,
      lock_status: PAYROLL_STATUS_PARTIALLY_LOCKED,
      notes: null,
    },
    { onConflict: MONTH_END_CLOSE_ON_CONFLICT },
  );
  if (mecErr) throw mecErr;

  const after = await facilitiesOct(admin);
  console.log("After:", after);
  console.log(
    `Target Oct cash ${TARGET_CASH}; delta ${Math.round((after.cash - TARGET_CASH) * 100) / 100}`,
  );

  const { data: sal } = await admin
    .from("expense_register")
    .select("receipt_no, payment_status, amount")
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", "PAYROLL-SAL-2026-07");
  console.log("Jul PAYROLL-SAL after restore:", sal);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
