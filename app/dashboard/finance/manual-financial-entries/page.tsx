import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import FinanceNav from "../finance-nav";
import ManualFinancialEntries from "../manual-financial-entries";
import type { ManualFinancialEntryRecord } from "../manual-financial-entries-utils";
import type { DirectorsLoanRepaymentRecord } from "../directors-loan-repayments-panel";
import type { AccountsPayablePaymentRow } from "../directors-loan-utils";

export default async function ManualFinancialEntriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const [
    { data, error },
    { data: apPayments, error: apPaymentsError },
    { data: repayments, error: repaymentsError },
  ] = await Promise.all([
    supabase
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("period_month", { ascending: false }),
    supabase
      .from("accounts_payable_payments")
      .select("tenant_id, payment_date, amount, payment_source")
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: true }),
    supabase
      .from("directors_loan_repayments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("repayment_date", { ascending: false }),
  ]);

  const manualCashEntries = (data ?? []).map((entry) => ({
    period_month: entry.period_month,
    loan_proceeds: entry.loan_proceeds,
    loan_repayments: entry.loan_repayments,
    other_cash_inflows: entry.other_cash_inflows,
    opening_cash_balance: entry.opening_cash_balance,
    bank_loans: entry.bank_loans,
    other_long_term_liabilities: entry.other_long_term_liabilities,
    directors_loan: entry.directors_loan,
  }));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Manual Financial Entries
      </h2>
      <ManualFinancialEntries
        tenantId={tenantId}
        initialEntries={(data as ManualFinancialEntryRecord[] | null) ?? []}
        initialManualCashEntries={manualCashEntries}
        initialApPayments={(apPayments as AccountsPayablePaymentRow[] | null) ?? []}
        initialDirectorsLoanRepayments={
          (repayments as DirectorsLoanRepaymentRecord[] | null) ?? []
        }
        fetchError={
          error?.message ?? apPaymentsError?.message ?? repaymentsError?.message ?? null
        }
      />
    </div>
  );
}
